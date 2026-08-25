-- R15 used an empty barcode as its relationship key in studies configured
-- without barcodes. That could turn the whole source into one conflict group
-- and therefore one indivisible assignment block. Repair only unpublished,
-- untouched jornadas; published work and reviewer decisions are never moved.

create temporary table _pqm_affected_uploads on commit drop as
select
  upload.id as upload_id,
  upload.workspace_id,
  (
    select count(*)::integer
    from public.assignment_blocks block
    where block.upload_id = upload.id
  ) as old_block_count
from public.uploads upload
where not upload.has_barcode
  and upload.status in ('ready', 'assigning')
  and upload.assignments_published_at is null
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
  and exists (
    select 1
    from public.conflict_groups conflict_group
    join public.group_members member on member.group_id = conflict_group.id
    join public.source_rows source_row on source_row.id = member.source_row_id
    where conflict_group.upload_id = upload.id
      and conflict_group.rule_code = 'R15'
    group by conflict_group.id
    having count(distinct upper(regexp_replace(btrim(coalesce(source_row.description, '')), '[[:space:]]+', ' ', 'g'))) > 1
  );

create temporary table _pqm_r15_group_map on commit drop as
select
  gen_random_uuid() as group_id,
  source.upload_id,
  source.workspace_id,
  source.description_key
from (
  select distinct
    affected.upload_id,
    affected.workspace_id,
    case
      when upper(regexp_replace(btrim(coalesce(source_row.description, '')), '[[:space:]]+', ' ', 'g')) = ''
        then '__SOURCE_ROW__:' || source_row.id::text
      else upper(regexp_replace(btrim(source_row.description), '[[:space:]]+', ' ', 'g'))
    end as description_key
  from _pqm_affected_uploads affected
  join public.validation_alerts alert
    on alert.upload_id = affected.upload_id
   and alert.rule_code = 'R15'
  join public.review_tasks task on task.id = alert.task_id
  join public.source_rows source_row on source_row.id = task.source_row_id
) source;

insert into public.conflict_groups (
  id,
  upload_id,
  workspace_id,
  external_key,
  rule_code,
  group_key,
  normalized_key,
  affected_field,
  observed_values,
  affected_row_count,
  alert_count
)
select
  group_map.group_id,
  group_map.upload_id,
  group_map.workspace_id,
  'repair-r15-description-' || md5(group_map.description_key),
  'R15',
  'repair-r15-description-' || md5(group_map.description_key),
  group_map.description_key,
  'Descripcion',
  '[]'::jsonb,
  count(distinct source_row.id)::integer,
  count(distinct alert.id)::integer
from _pqm_r15_group_map group_map
join public.source_rows source_row
  on source_row.upload_id = group_map.upload_id
 and case
   when upper(regexp_replace(btrim(coalesce(source_row.description, '')), '[[:space:]]+', ' ', 'g')) = ''
     then '__SOURCE_ROW__:' || source_row.id::text
   else upper(regexp_replace(btrim(source_row.description), '[[:space:]]+', ' ', 'g'))
 end = group_map.description_key
left join public.review_tasks task
  on task.upload_id = source_row.upload_id
 and task.source_row_id = source_row.id
left join public.validation_alerts alert
  on alert.task_id = task.id
 and alert.rule_code = 'R15'
group by group_map.group_id, group_map.upload_id, group_map.workspace_id, group_map.description_key;

insert into public.group_members (
  group_id,
  upload_id,
  workspace_id,
  source_row_id,
  is_alert,
  is_related_context,
  observed_value,
  value_frequency
)
select
  group_map.group_id,
  group_map.upload_id,
  group_map.workspace_id,
  source_row.id,
  exists (
    select 1
    from public.review_tasks task
    join public.validation_alerts alert
      on alert.task_id = task.id
     and alert.rule_code = 'R15'
    where task.upload_id = group_map.upload_id
      and task.source_row_id = source_row.id
  ),
  not exists (
    select 1
    from public.review_tasks task
    join public.validation_alerts alert
      on alert.task_id = task.id
     and alert.rule_code = 'R15'
    where task.upload_id = group_map.upload_id
      and task.source_row_id = source_row.id
  ),
  source_row.description,
  count(*) over (partition by group_map.group_id)::integer
from _pqm_r15_group_map group_map
join public.source_rows source_row
  on source_row.upload_id = group_map.upload_id
 and case
   when upper(regexp_replace(btrim(coalesce(source_row.description, '')), '[[:space:]]+', ' ', 'g')) = ''
     then '__SOURCE_ROW__:' || source_row.id::text
   else upper(regexp_replace(btrim(source_row.description), '[[:space:]]+', ' ', 'g'))
 end = group_map.description_key;

update public.validation_alerts alert
set group_id = group_map.group_id,
    updated_at = now()
from public.review_tasks task
join public.source_rows source_row on source_row.id = task.source_row_id
join _pqm_r15_group_map group_map
  on group_map.upload_id = task.upload_id
 and case
   when upper(regexp_replace(btrim(coalesce(source_row.description, '')), '[[:space:]]+', ' ', 'g')) = ''
     then '__SOURCE_ROW__:' || source_row.id::text
   else upper(regexp_replace(btrim(source_row.description), '[[:space:]]+', ' ', 'g'))
 end = group_map.description_key
where alert.task_id = task.id
  and alert.upload_id = group_map.upload_id
  and alert.rule_code = 'R15';

delete from public.conflict_groups conflict_group
using _pqm_affected_uploads affected
where conflict_group.upload_id = affected.upload_id
  and conflict_group.rule_code = 'R15'
  and not exists (
    select 1
    from _pqm_r15_group_map group_map
    where group_map.group_id = conflict_group.id
  );

-- Recreate connected components after the R15 groups have been corrected.
-- Context rows only link components when they are also review tasks, matching
-- the browser manifest algorithm.
create temporary table _pqm_task_components on commit drop as
with recursive
nodes as (
  select
    task.upload_id,
    task.workspace_id,
    task.id as task_id,
    task.source_row_id
  from public.review_tasks task
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
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
  select member.upload_id, member.source_row_id, anchor.anchor_source_row_id as linked_source_row_id
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

create temporary table _pqm_component_blocks on commit drop as
select
  gen_random_uuid() as block_id,
  component.upload_id,
  component.workspace_id,
  component.component_source_row_id
from (
  select distinct upload_id, workspace_id, component_source_row_id
  from _pqm_task_components
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
  'repair-block-' || component.component_source_row_id::text,
  'repair-block-' || component.component_source_row_id::text,
  'draft',
  null,
  0,
  0,
  0,
  1,
  0
from _pqm_component_blocks component;

update public.review_tasks task
set assignment_block_id = component_block.block_id,
    updated_at = now()
from _pqm_task_components component
join _pqm_component_blocks component_block
  on component_block.upload_id = component.upload_id
 and component_block.component_source_row_id = component.component_source_row_id
where task.id = component.task_id;

delete from public.assignment_blocks block
using _pqm_affected_uploads affected
where block.upload_id = affected.upload_id
  and not exists (
    select 1
    from _pqm_component_blocks component
    where component.block_id = block.id
  );

with alert_totals as (
  select task.assignment_block_id as block_id, count(alert.id)::integer as alert_count
  from public.review_tasks task
  join public.validation_alerts alert on alert.task_id = task.id
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
  group by task.assignment_block_id
),
member_rows as (
  select task.assignment_block_id as block_id, task.source_row_id
  from public.review_tasks task
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
  union
  select task.assignment_block_id as block_id, member.source_row_id
  from public.review_tasks task
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
  join public.validation_alerts alert on alert.task_id = task.id
  join public.group_members member on member.group_id = alert.group_id
),
member_totals as (
  select block_id, count(*)::integer as member_count
  from member_rows
  group by block_id
),
task_invoice_ids as (
  select task.assignment_block_id as block_id, invoice.id as invoice_id
  from public.review_tasks task
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
  join public.invoice_links invoice
    on invoice.upload_id = task.upload_id
   and invoice.source_row_id = task.source_row_id
  union
  select task.assignment_block_id as block_id, invoice.id as invoice_id
  from public.review_tasks task
  join _pqm_affected_uploads affected on affected.upload_id = task.upload_id
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
    weight = greatest(coalesce(alert_totals.alert_count, 0), 1)::numeric
      + (coalesce(member_totals.member_count, 0)::numeric * 0.15)
      + (coalesce(invoice_totals.invoice_count, 0)::numeric * 0.10),
    updated_at = now()
from _pqm_component_blocks component
left join alert_totals on alert_totals.block_id = component.block_id
left join member_totals on member_totals.block_id = component.block_id
left join invoice_totals on invoice_totals.block_id = component.block_id
where block.id = component.block_id;

update public.uploads upload
set status = 'ready',
    assignments_published_at = null,
    version = upload.version + 1,
    processing_error = null,
    updated_at = now()
from _pqm_affected_uploads affected
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
  'assignment_blocks.repaired_no_barcode_r15',
  'upload',
  affected.upload_id::text,
  jsonb_build_object(
    'old_block_count', affected.old_block_count,
    'new_block_count', (
      select count(*)
      from _pqm_component_blocks component
      where component.upload_id = affected.upload_id
    )
  )
from _pqm_affected_uploads affected;
