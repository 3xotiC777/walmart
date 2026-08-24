-- Build alert details only for the 50 rows selected on the requested page.
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
  with candidate as (
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
    from public.review_tasks task
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
    where task.upload_id = p_upload_id
      and (p_status is null or task.status = p_status)
      and (
        nullif(btrim(p_rule), '') is null
        or exists (
          select 1
          from public.validation_alerts filtered_alert
          where filtered_alert.task_id = task.id
            and filtered_alert.rule_code = btrim(p_rule)
        )
      )
      and (
        nullif(btrim(p_search), '') is null
        or coalesce(source.row_id, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(source.id_dn_w, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(source.barcode, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(source.description, '') ilike '%' || btrim(p_search) || '%'
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
  ) alerts on true
  order by
    case when p_sort = 'rule_desc' then candidate.rule_rank end desc nulls last,
    case when p_sort = 'rule_asc' then candidate.rule_rank end asc nulls last,
    case when p_sort = 'row_desc' then candidate.excel_row end desc,
    case when p_sort = 'row_asc' then candidate.excel_row end asc,
    candidate.excel_row asc,
    candidate.id asc;
$$;
