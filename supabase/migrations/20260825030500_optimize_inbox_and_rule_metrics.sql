-- Keep the public RPCs SECURITY INVOKER while moving the expensive reads into
-- guarded private helpers. The helpers authorize the caller once and then read
-- the already-scoped task set without executing the row-dependent RLS helper
-- once per task and alert.

create or replace function private.get_upload_assignment_metrics_scoped(p_upload_id uuid)
returns table (
  task_count bigint,
  pending_task_count bigint,
  alert_count bigint,
  orthography_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select member.role
    from public.uploads upload
    join public.workspace_members member
      on member.workspace_id = upload.workspace_id
     and member.user_id = (select auth.uid())
     and member.is_active
    where upload.id = p_upload_id
      and (select private.current_account_ready())
    limit 1
  ),
  visible_tasks as materialized (
    select task.id, task.status
    from public.review_tasks task
    join public.assignment_blocks block
      on block.id = task.assignment_block_id
     and block.upload_id = task.upload_id
     and block.workspace_id = task.workspace_id
    cross join viewer
    where task.upload_id = p_upload_id
      and (
        viewer.role = 'leader'::public.workspace_role
        or (
          viewer.role = 'validator'::public.workspace_role
          and block.assigned_to = (select auth.uid())
          and block.status in (
            'published'::public.block_status,
            'in_progress'::public.block_status,
            'completed'::public.block_status
          )
        )
      )
  ),
  task_metrics as (
    select
      count(*)::bigint as task_count,
      count(*) filter (
        where status <> 'resolved'::public.review_status
      )::bigint as pending_task_count
    from visible_tasks
  ),
  alert_metrics as (
    select
      count(*)::bigint as alert_count,
      count(*) filter (
        where alert.rule_code like 'ORT-%'
      )::bigint as orthography_count
    from public.validation_alerts alert
    join visible_tasks task on task.id = alert.task_id
    where alert.upload_id = p_upload_id
  )
  select
    task_metrics.task_count,
    task_metrics.pending_task_count,
    alert_metrics.alert_count,
    alert_metrics.orthography_count
  from task_metrics
  cross join alert_metrics;
$$;

create or replace function public.get_upload_assignment_metrics(p_upload_id uuid)
returns table (
  task_count bigint,
  pending_task_count bigint,
  alert_count bigint,
  orthography_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_upload_assignment_metrics_scoped(p_upload_id);
$$;

create or replace function private.browse_review_tasks_scoped(
  p_upload_id uuid,
  p_status public.review_status default null,
  p_rule text default null,
  p_search text default null,
  p_sort text default 'rule_asc',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  status public.review_status,
  alert_count integer,
  corrected_cell_count integer,
  confirmed_correct_count integer,
  version integer,
  created_at timestamptz,
  excel_row integer,
  row_id text,
  id_dn_w text,
  barcode text,
  description text,
  validation_alerts jsonb,
  primary_rule text,
  total_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select member.role
    from public.uploads upload
    join public.workspace_members member
      on member.workspace_id = upload.workspace_id
     and member.user_id = (select auth.uid())
     and member.is_active
    where upload.id = p_upload_id
      and (select private.current_account_ready())
    limit 1
  ),
  visible_tasks as materialized (
    select task.*
    from public.review_tasks task
    join public.assignment_blocks block
      on block.id = task.assignment_block_id
     and block.upload_id = task.upload_id
     and block.workspace_id = task.workspace_id
    cross join viewer
    where task.upload_id = p_upload_id
      and (
        viewer.role = 'leader'::public.workspace_role
        or (
          viewer.role = 'validator'::public.workspace_role
          and block.assigned_to = (select auth.uid())
          and block.status in (
            'published'::public.block_status,
            'in_progress'::public.block_status,
            'completed'::public.block_status
          )
        )
      )
  ),
  candidate as (
    select
      task.id,
      task.status,
      task.alert_count,
      task.corrected_cell_count,
      task.confirmed_correct_count,
      task.version,
      task.created_at,
      source.excel_row,
      source.row_id,
      source.id_dn_w,
      source.barcode,
      source.description,
      primary_alert.rule_code as primary_rule,
      primary_alert.rule_rank
    from visible_tasks task
    join public.source_rows source
      on source.id = task.source_row_id
     and source.upload_id = task.upload_id
     and source.workspace_id = task.workspace_id
    left join lateral (
      select
        alert.rule_code,
        case
          when alert.rule_code ~ '^R[0-9]+$'
            then substring(alert.rule_code from 2)::integer
          when alert.rule_code ~ '^EST-[0-9]+$'
            then 100 + substring(alert.rule_code from 5)::integer
          when alert.rule_code ~ '^JER-[0-9]+$'
            then 200 + substring(alert.rule_code from 5)::integer
          when alert.rule_code like 'ORT-%'
            then 300
          else 1000
        end as rule_rank
      from public.validation_alerts alert
      where alert.task_id = task.id
        and alert.upload_id = p_upload_id
      order by
        case
          when alert.rule_code ~ '^R[0-9]+$'
            then substring(alert.rule_code from 2)::integer
          when alert.rule_code ~ '^EST-[0-9]+$'
            then 100 + substring(alert.rule_code from 5)::integer
          when alert.rule_code ~ '^JER-[0-9]+$'
            then 200 + substring(alert.rule_code from 5)::integer
          when alert.rule_code like 'ORT-%'
            then 300
          else 1000
        end,
        alert.rule_code,
        alert.id
      limit 1
    ) primary_alert on true
    where (p_status is null or task.status = p_status)
      and (
        nullif(btrim(p_rule), '') is null
        or exists (
          select 1
          from public.validation_alerts filtered_alert
          where filtered_alert.task_id = task.id
            and filtered_alert.upload_id = p_upload_id
            and filtered_alert.rule_code = btrim(p_rule)
        )
      )
      and (
        nullif(btrim(p_search), '') is null
        or coalesce(source.row_id, '') ilike '%' || left(btrim(p_search), 120) || '%'
        or coalesce(source.id_dn_w, '') ilike '%' || left(btrim(p_search), 120) || '%'
        or coalesce(source.barcode, '') ilike '%' || left(btrim(p_search), 120) || '%'
        or coalesce(source.description, '') ilike '%' || left(btrim(p_search), 120) || '%'
      )
  ),
  counted as (
    select candidate.*, count(*) over ()::bigint as total_count
    from candidate
  ),
  paged as materialized (
    select candidate.*
    from counted candidate
    order by
      case when p_sort = 'rule_desc' then candidate.rule_rank end desc nulls last,
      case when p_sort = 'rule_asc' then candidate.rule_rank end asc nulls last,
      case when p_sort = 'row_desc' then candidate.excel_row end desc,
      case when p_sort = 'row_asc' then candidate.excel_row end asc,
      candidate.excel_row asc,
      candidate.id asc
    limit least(greatest(coalesce(p_page_size, 50), 1), 100)
    offset (
      (greatest(coalesce(p_page, 1), 1) - 1)
      * least(greatest(coalesce(p_page_size, 50), 1), 100)
    )
  )
  select
    candidate.id,
    candidate.status,
    candidate.alert_count,
    candidate.corrected_cell_count,
    candidate.confirmed_correct_count,
    candidate.version,
    candidate.created_at,
    candidate.excel_row,
    candidate.row_id,
    candidate.id_dn_w,
    candidate.barcode,
    candidate.description,
    coalesce(alerts.items, '[]'::jsonb) as validation_alerts,
    candidate.primary_rule,
    candidate.total_count
  from paged candidate
  left join lateral (
    select jsonb_agg(
      jsonb_build_object(
        'id', alert.id,
        'rule_code', alert.rule_code,
        'status', alert.status
      )
      order by
        case
          when alert.rule_code ~ '^R[0-9]+$'
            then substring(alert.rule_code from 2)::integer
          when alert.rule_code ~ '^EST-[0-9]+$'
            then 100 + substring(alert.rule_code from 5)::integer
          when alert.rule_code ~ '^JER-[0-9]+$'
            then 200 + substring(alert.rule_code from 5)::integer
          when alert.rule_code like 'ORT-%'
            then 300
          else 1000
        end,
        alert.rule_code,
        alert.id
    ) as items
    from public.validation_alerts alert
    where alert.task_id = candidate.id
      and alert.upload_id = p_upload_id
  ) alerts on true
  order by
    case when p_sort = 'rule_desc' then candidate.rule_rank end desc nulls last,
    case when p_sort = 'rule_asc' then candidate.rule_rank end asc nulls last,
    case when p_sort = 'row_desc' then candidate.excel_row end desc,
    case when p_sort = 'row_asc' then candidate.excel_row end asc,
    candidate.excel_row asc,
    candidate.id asc;
$$;

create or replace function public.browse_review_tasks(
  p_upload_id uuid,
  p_status public.review_status default null,
  p_rule text default null,
  p_search text default null,
  p_sort text default 'rule_asc',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  status public.review_status,
  alert_count integer,
  corrected_cell_count integer,
  confirmed_correct_count integer,
  version integer,
  created_at timestamptz,
  excel_row integer,
  row_id text,
  id_dn_w text,
  barcode text,
  description text,
  validation_alerts jsonb,
  primary_rule text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.browse_review_tasks_scoped(
    p_upload_id,
    p_status,
    p_rule,
    p_search,
    p_sort,
    p_page,
    p_page_size
  );
$$;

create or replace function private.get_upload_rule_metrics_scoped(p_upload_id uuid)
returns table (
  rule_code text,
  category public.alert_category,
  alert_count bigint,
  pending_alert_count bigint,
  affected_task_count bigint,
  pending_task_count bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select member.role
    from public.uploads upload
    join public.workspace_members member
      on member.workspace_id = upload.workspace_id
     and member.user_id = (select auth.uid())
     and member.is_active
    where upload.id = p_upload_id
      and (select private.current_account_ready())
    limit 1
  ),
  visible_tasks as materialized (
    select task.id
    from public.review_tasks task
    join public.assignment_blocks block
      on block.id = task.assignment_block_id
     and block.upload_id = task.upload_id
     and block.workspace_id = task.workspace_id
    cross join viewer
    where task.upload_id = p_upload_id
      and (
        viewer.role = 'leader'::public.workspace_role
        or (
          viewer.role = 'validator'::public.workspace_role
          and block.assigned_to = (select auth.uid())
          and block.status in (
            'published'::public.block_status,
            'in_progress'::public.block_status,
            'completed'::public.block_status
          )
        )
      )
  )
  select
    alert.rule_code,
    alert.category,
    count(*)::bigint as alert_count,
    count(*) filter (
      where alert.status <> 'resolved'::public.review_status
    )::bigint as pending_alert_count,
    count(distinct alert.task_id)::bigint as affected_task_count,
    count(distinct alert.task_id) filter (
      where alert.status <> 'resolved'::public.review_status
    )::bigint as pending_task_count
  from public.validation_alerts alert
  join visible_tasks task on task.id = alert.task_id
  where alert.upload_id = p_upload_id
  group by alert.rule_code, alert.category
  order by
    count(*) filter (
      where alert.status <> 'resolved'::public.review_status
    ) desc,
    count(*) desc,
    alert.rule_code;
$$;

create or replace function public.get_upload_rule_metrics(p_upload_id uuid)
returns table (
  rule_code text,
  category public.alert_category,
  alert_count bigint,
  pending_alert_count bigint,
  affected_task_count bigint,
  pending_task_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_upload_rule_metrics_scoped(p_upload_id);
$$;

revoke all on function private.get_upload_assignment_metrics_scoped(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.browse_review_tasks_scoped(
  uuid, public.review_status, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function private.get_upload_rule_metrics_scoped(uuid)
  from public, anon, authenticated, service_role;

grant usage on schema private to authenticated, service_role;
grant execute on function private.get_upload_assignment_metrics_scoped(uuid)
  to authenticated, service_role;
grant execute on function private.browse_review_tasks_scoped(
  uuid, public.review_status, text, text, text, integer, integer
) to authenticated, service_role;
grant execute on function private.get_upload_rule_metrics_scoped(uuid)
  to authenticated, service_role;

revoke all on function public.get_upload_assignment_metrics(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.browse_review_tasks(
  uuid, public.review_status, text, text, text, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.get_upload_rule_metrics(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.get_upload_assignment_metrics(uuid)
  to authenticated, service_role;
grant execute on function public.browse_review_tasks(
  uuid, public.review_status, text, text, text, integer, integer
) to authenticated, service_role;
grant execute on function public.get_upload_rule_metrics(uuid)
  to authenticated, service_role;

comment on function private.get_upload_assignment_metrics_scoped(uuid) is
  'Authorizes the current member once and computes assignment metrics without row-dependent RLS scans.';
comment on function private.browse_review_tasks_scoped(
  uuid, public.review_status, text, text, text, integer, integer
) is
  'Authorizes the current member once and returns only the leader workspace or validator assignment scope.';
comment on function private.get_upload_rule_metrics_scoped(uuid) is
  'Returns per-rule counts within the explicitly authorized assignment scope.';
comment on function public.get_upload_assignment_metrics(uuid) is
  'Public invoker wrapper for assignment-scoped metrics.';
comment on function public.browse_review_tasks(
  uuid, public.review_status, text, text, text, integer, integer
) is
  'Public invoker wrapper for the paginated assignment-scoped task inbox.';
comment on function public.get_upload_rule_metrics(uuid) is
  'Public invoker wrapper for per-rule alert counts in the current assignment scope.';
