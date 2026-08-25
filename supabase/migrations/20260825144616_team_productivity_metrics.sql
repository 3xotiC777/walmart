create function private.get_upload_team_productivity_scoped(p_upload_id uuid)
returns table (
  user_id uuid,
  assigned_task_count bigint,
  assigned_alert_count bigint,
  pending_task_count bigint,
  completed_assignment_task_count bigint,
  tasks_resolved bigint,
  alerts_resolved bigint,
  cells_changed bigint,
  rows_corrected bigint,
  confirmed_correct bigint
)
language sql
stable
security definer
set search_path = ''
as $$
  with viewer as materialized (
    select 1
    from public.uploads upload
    join public.workspace_members member
      on member.workspace_id = upload.workspace_id
     and member.user_id = (select auth.uid())
     and member.role = 'leader'::public.workspace_role
     and member.is_active
    where upload.id = p_upload_id
      and (select private.current_account_ready())
    limit 1
  ),
  assignment_stats as (
    select
      block.assigned_to as user_id,
      count(task.id)::bigint as assigned_task_count,
      coalesce(sum(task.alert_count), 0)::bigint as assigned_alert_count,
      count(task.id) filter (
        where task.status <> 'resolved'::public.review_status
      )::bigint as pending_task_count,
      count(task.id) filter (
        where task.status = 'resolved'::public.review_status
      )::bigint as completed_assignment_task_count
    from public.review_tasks task
    join public.assignment_blocks block
      on block.id = task.assignment_block_id
     and block.upload_id = task.upload_id
     and block.workspace_id = task.workspace_id
    cross join viewer
    where task.upload_id = p_upload_id
      and block.assigned_to is not null
      and block.status in (
        'published'::public.block_status,
        'in_progress'::public.block_status,
        'completed'::public.block_status
      )
    group by block.assigned_to
  ),
  productivity_stats as (
    select
      productivity.user_id,
      coalesce(sum(productivity.tasks_resolved), 0)::bigint as tasks_resolved,
      coalesce(sum(productivity.alerts_resolved), 0)::bigint as alerts_resolved,
      coalesce(sum(productivity.cells_changed), 0)::bigint as cells_changed,
      coalesce(sum(productivity.rows_corrected), 0)::bigint as rows_corrected,
      coalesce(sum(productivity.confirmed_correct), 0)::bigint as confirmed_correct
    from public.daily_productivity productivity
    cross join viewer
    where productivity.upload_id = p_upload_id
    group by productivity.user_id
  )
  select
    coalesce(assignment.user_id, productivity.user_id) as user_id,
    coalesce(assignment.assigned_task_count, 0)::bigint as assigned_task_count,
    coalesce(assignment.assigned_alert_count, 0)::bigint as assigned_alert_count,
    coalesce(assignment.pending_task_count, 0)::bigint as pending_task_count,
    coalesce(assignment.completed_assignment_task_count, 0)::bigint
      as completed_assignment_task_count,
    coalesce(productivity.tasks_resolved, 0)::bigint as tasks_resolved,
    coalesce(productivity.alerts_resolved, 0)::bigint as alerts_resolved,
    coalesce(productivity.cells_changed, 0)::bigint as cells_changed,
    coalesce(productivity.rows_corrected, 0)::bigint as rows_corrected,
    coalesce(productivity.confirmed_correct, 0)::bigint as confirmed_correct
  from assignment_stats assignment
  full join productivity_stats productivity using (user_id)
  order by user_id;
$$;

create function public.get_upload_team_productivity(p_upload_id uuid)
returns table (
  user_id uuid,
  assigned_task_count bigint,
  assigned_alert_count bigint,
  pending_task_count bigint,
  completed_assignment_task_count bigint,
  tasks_resolved bigint,
  alerts_resolved bigint,
  cells_changed bigint,
  rows_corrected bigint,
  confirmed_correct bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select *
  from private.get_upload_team_productivity_scoped(p_upload_id);
$$;

revoke all on function private.get_upload_team_productivity_scoped(uuid)
  from public, anon, authenticated, service_role;
grant usage on schema private to authenticated, service_role;
grant execute on function private.get_upload_team_productivity_scoped(uuid)
  to authenticated, service_role;

revoke all on function public.get_upload_team_productivity(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_upload_team_productivity(uuid)
  to authenticated, service_role;

comment on function private.get_upload_team_productivity_scoped(uuid) is
  'Authorizes an active leader once and aggregates current assignments plus attributed productivity for one upload.';
comment on function public.get_upload_team_productivity(uuid) is
  'Leader-only invoker wrapper for per-person assignment and productivity metrics.';
