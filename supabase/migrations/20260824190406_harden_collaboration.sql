-- Endurece operaciones que dependen de contexto colaborativo y agrega una
-- finalización auditada para cargas interrumpidas.

create or replace function private.enforce_leader_reopen()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.superseded_at is null and new.superseded_at is not null then
    if (select auth.uid()) is null or not exists (
      select 1
      from public.workspace_members wm
      join public.profiles p on p.user_id = wm.user_id
      where wm.workspace_id = old.workspace_id
        and wm.user_id = (select auth.uid())
        and wm.role = 'leader'
        and wm.is_active
        and p.is_active
    ) then
      raise exception using errcode = '42501', message = 'Solo un líder puede reabrir decisiones.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists alert_decisions_leader_reopen_guard on public.alert_decisions;
create trigger alert_decisions_leader_reopen_guard
before update of superseded_at on public.alert_decisions
for each row execute function private.enforce_leader_reopen();

create or replace function private.enforce_related_task_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.is_related_only and not exists (
    select 1
    from public.group_members gm
    join public.validation_alerts a
      on a.group_id = gm.group_id
     and a.upload_id = gm.upload_id
     and a.workspace_id = gm.workspace_id
    join public.review_tasks owner_task
      on owner_task.id = a.task_id
     and owner_task.upload_id = a.upload_id
     and owner_task.workspace_id = a.workspace_id
    where gm.source_row_id = new.source_row_id
      and gm.upload_id = new.upload_id
      and gm.workspace_id = new.workspace_id
      and owner_task.assignment_block_id = new.assignment_block_id
  ) then
    raise exception using errcode = '42501', message = 'El registro no está relacionado con ninguna alerta de este bloque.';
  end if;
  return new;
end;
$$;

drop trigger if exists review_tasks_related_membership_guard on public.review_tasks;
create trigger review_tasks_related_membership_guard
before insert or update of source_row_id, assignment_block_id, is_related_only
on public.review_tasks
for each row execute function private.enforce_related_task_membership();

create or replace function public.fail_upload(
  p_upload_id uuid,
  p_message text
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_upload public.uploads%rowtype;
begin
  select * into v_upload
  from public.uploads
  where id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_upload.workspace_id);
  if v_upload.status in ('active', 'completed', 'archived', 'deleting') then
    raise exception using errcode = '55000', message = 'La jornada ya no puede marcarse como interrumpida.';
  end if;

  update public.uploads
  set status = 'failed',
      processing_error = left(coalesce(nullif(btrim(p_message), ''), 'Carga interrumpida'), 1000),
      version = version + 1,
      updated_at = now()
  where id = p_upload_id
  returning * into v_upload;

  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_upload.workspace_id, v_upload.id, v_actor, 'upload.failed',
    'upload', v_upload.id::text,
    jsonb_build_object('message', v_upload.processing_error)
  );
  return v_upload;
end;
$$;

revoke all on function public.fail_upload(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.fail_upload(uuid, text) to authenticated, service_role;

notify pgrst, 'reload schema';

