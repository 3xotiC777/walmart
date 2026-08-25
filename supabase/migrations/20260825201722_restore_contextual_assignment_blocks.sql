-- Restore the product contract after the no-barcode R15 repair: tasks that are
-- alerted and share a conflict-group context stay in the same indivisible
-- block. The no-barcode R15 groups remain split by description, so an empty
-- barcode can no longer connect the whole upload.

do $$
declare
  v_upload_id uuid;
begin
  for v_upload_id in
    select upload.id
    from public.uploads upload
    where upload.status in ('ready', 'assigning')
      and upload.assignments_published_at is null
      and exists (
        select 1
        from public.audit_events audit
        where audit.upload_id = upload.id
          and audit.event_type = 'assignment_blocks.rebuilt_from_alerted_members'
      )
      and not exists (
        select 1
        from public.audit_events audit
        where audit.upload_id = upload.id
          and audit.event_type = 'assignment_blocks.restored_contextual_components'
      )
      and not exists (
        select 1
        from public.review_tasks task
        where task.upload_id = upload.id
          and task.status <> 'pending'
      )
      and not exists (
        select 1 from public.alert_decisions decision where decision.upload_id = upload.id
      )
      and not exists (
        select 1 from public.cell_resolutions resolution where resolution.upload_id = upload.id
      )
    order by upload.id
  loop
    -- The assignment RPC locks this same row first. Keeping the lock until the
    -- migration commits prevents a concurrent proposal from using old blocks.
    perform 1
    from public.uploads upload
    where upload.id = v_upload_id
    for update;
  end loop;
end;
$$;

create temporary table _pqm_context_uploads on commit drop as
select
  upload.id as upload_id,
  upload.workspace_id,
  (
    select count(*)::integer
    from public.assignment_blocks block
    where block.upload_id = upload.id
  ) as old_block_count
from public.uploads upload
where upload.status in ('ready', 'assigning')
  and upload.assignments_published_at is null
  and exists (
    select 1
    from public.audit_events audit
    where audit.upload_id = upload.id
      and audit.event_type = 'assignment_blocks.rebuilt_from_alerted_members'
  )
  and not exists (
    select 1
    from public.audit_events audit
    where audit.upload_id = upload.id
      and audit.event_type = 'assignment_blocks.restored_contextual_components'
  )
  and not exists (
    select 1
    from public.review_tasks task
    where task.upload_id = upload.id
      and task.status <> 'pending'
  )
  and not exists (
    select 1 from public.alert_decisions decision where decision.upload_id = upload.id
  )
  and not exists (
    select 1 from public.cell_resolutions resolution where resolution.upload_id = upload.id
  );

create temporary table _pqm_context_task_components on commit drop as
with recursive
nodes as (
  select
    task.upload_id,
    task.workspace_id,
    task.id as task_id,
    task.source_row_id
  from public.review_tasks task
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
),
group_task_members as (
  select distinct member.group_id, member.upload_id, member.source_row_id
  from public.group_members member
  join nodes node
    on node.upload_id = member.upload_id
   and node.source_row_id = member.source_row_id
),
group_anchors as (
  select group_id, upload_id, min(source_row_id) as anchor_source_row_id
  from group_task_members
  group by group_id, upload_id
),
edges as (
  select member.upload_id, member.source_row_id,
         anchor.anchor_source_row_id as linked_source_row_id
  from group_task_members member
  join group_anchors anchor
    on anchor.group_id = member.group_id
   and anchor.upload_id = member.upload_id
  union
  select member.upload_id, anchor.anchor_source_row_id, member.source_row_id
  from group_task_members member
  join group_anchors anchor
    on anchor.group_id = member.group_id
   and anchor.upload_id = member.upload_id
),
reach (upload_id, source_row_id, reachable_source_row_id) as (
  select node.upload_id, node.source_row_id, node.source_row_id
  from nodes node
  union
  select reach.upload_id, reach.source_row_id, edge.linked_source_row_id
  from reach
  join edges edge
    on edge.upload_id = reach.upload_id
   and edge.source_row_id = reach.reachable_source_row_id
)
select
  node.upload_id,
  node.workspace_id,
  node.task_id,
  node.source_row_id,
  min(reach.reachable_source_row_id) as component_source_row_id
from nodes node
join reach
  on reach.upload_id = node.upload_id
 and reach.source_row_id = node.source_row_id
group by node.upload_id, node.workspace_id, node.task_id, node.source_row_id;

create temporary table _pqm_context_blocks on commit drop as
select
  gen_random_uuid() as block_id,
  component.upload_id,
  component.workspace_id,
  component.component_source_row_id
from (
  select distinct upload_id, workspace_id, component_source_row_id
  from _pqm_context_task_components
) component;

insert into public.assignment_blocks (
  id,
  upload_id,
  workspace_id,
  external_key,
  block_key,
  status,
  assigned_to,
  alert_count,
  member_count,
  invoice_count,
  weight,
  priority
)
select
  component.block_id,
  component.upload_id,
  component.workspace_id,
  'context-block-v3-' || component.component_source_row_id::text,
  'context-block-v3-' || component.component_source_row_id::text,
  'draft',
  null,
  0,
  0,
  0,
  1,
  0
from _pqm_context_blocks component;

update public.review_tasks task
set assignment_block_id = component_block.block_id,
    updated_at = now()
from _pqm_context_task_components component
join _pqm_context_blocks component_block
  on component_block.upload_id = component.upload_id
 and component_block.component_source_row_id = component.component_source_row_id
where task.id = component.task_id;

delete from public.assignment_blocks block
using _pqm_context_uploads affected
where block.upload_id = affected.upload_id
  and not exists (
    select 1
    from _pqm_context_blocks component
    where component.block_id = block.id
  );

with alert_totals as (
  select task.assignment_block_id as block_id, count(alert.id)::integer as alert_count
  from public.review_tasks task
  join public.validation_alerts alert on alert.task_id = task.id
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
  group by task.assignment_block_id
),
block_groups as (
  select distinct task.assignment_block_id as block_id, member.group_id
  from public.review_tasks task
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
  join public.group_members member
    on member.upload_id = task.upload_id
   and member.source_row_id = task.source_row_id
),
member_rows as (
  select task.assignment_block_id as block_id, task.source_row_id
  from public.review_tasks task
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
  union
  select block_group.block_id, member.source_row_id
  from block_groups block_group
  join public.group_members member on member.group_id = block_group.group_id
),
member_totals as (
  select block_id, count(*)::integer as member_count
  from member_rows
  group by block_id
),
task_invoice_ids as (
  select task.assignment_block_id as block_id, invoice.id as invoice_id
  from public.review_tasks task
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
  join public.invoice_links invoice
    on invoice.upload_id = task.upload_id
   and invoice.source_row_id = task.source_row_id
  union
  select task.assignment_block_id as block_id, invoice.id as invoice_id
  from public.review_tasks task
  join _pqm_context_uploads affected on affected.upload_id = task.upload_id
  join public.source_rows source_row on source_row.id = task.source_row_id
  join public.invoice_links invoice
    on invoice.upload_id = task.upload_id
   and invoice.id_dn_w is not null
   and invoice.id_dn_w = source_row.id_dn_w
  where source_row.id_dn_w is not null
),
invoice_totals as (
  select block_id, count(*)::integer as invoice_count
  from task_invoice_ids
  group by block_id
)
update public.assignment_blocks block
set alert_count = coalesce(alert_totals.alert_count, 0),
    member_count = coalesce(member_totals.member_count, 0),
    invoice_count = coalesce(invoice_totals.invoice_count, 0),
    weight = greatest(coalesce(alert_totals.alert_count, 0), 1)::numeric,
    updated_at = now()
from _pqm_context_blocks component
left join alert_totals on alert_totals.block_id = component.block_id
left join member_totals on member_totals.block_id = component.block_id
left join invoice_totals on invoice_totals.block_id = component.block_id
where block.id = component.block_id;

update public.uploads upload
set status = 'ready',
    assignments_published_at = null,
    version = upload.version + 1,
    assignment_version = upload.assignment_version + 1,
    processing_error = null,
    updated_at = now()
from _pqm_context_uploads affected
where upload.id = affected.upload_id;

insert into public.audit_events (
  workspace_id,
  upload_id,
  actor_user_id,
  event_type,
  entity_type,
  entity_id,
  payload
)
select
  affected.workspace_id,
  affected.upload_id,
  null,
  'assignment_blocks.restored_contextual_components',
  'upload',
  affected.upload_id::text,
  jsonb_build_object(
    'old_block_count', affected.old_block_count,
    'new_block_count', (
      select count(*)
      from _pqm_context_blocks component
      where component.upload_id = affected.upload_id
    ),
    'weight_method', 'max_alert_count',
    'context_method', 'all_groups_containing_alerted_tasks'
  )
from _pqm_context_uploads affected;
