-- Invalida de forma persistente las sesiones anteriores a un restablecimiento
-- de credenciales y evita que los reintentos idempotentes omitan autorización.

create or replace function private.manage_pin_reset_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_pin then
    -- El trigger solo se ejecuta cuando must_change_pin forma parte del UPDATE;
    -- repetir un reset rota también el watermark aunque ya estuviera pendiente.
    new.pin_reset_at := date_trunc('second', clock_timestamp());
  elsif tg_op = 'UPDATE' then
    -- Completar el cambio de PIN no debe rehabilitar JWT emitidos antes del reset.
    new.pin_reset_at := old.pin_reset_at;
  end if;
  return new;
end;
$$;

comment on column public.profiles.pin_reset_at is
  'Watermark persistente: una sesión emitida antes del último reset de credenciales no obtiene acceso a la aplicación.';

create or replace function private.current_session_is_fresh(p_reset_at timestamptz)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and (
      p_reset_at is null
      or (
        coalesce((select auth.jwt()) ->> 'iat', '') ~ '^[0-9]+$'
        and (((select auth.jwt()) ->> 'iat')::bigint >=
             floor(extract(epoch from p_reset_at))::bigint)
      )
    )
$$;

create or replace function private.current_member_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
  from public.workspace_members wm
  join public.profiles p
    on p.user_id = wm.user_id
   and p.is_active
   and private.current_session_is_fresh(p.pin_reset_at)
  where wm.user_id = (select auth.uid()) and wm.is_active
$$;

create or replace function private.current_account_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active
      and not p.must_change_pin
      and (p.locked_until is null or p.locked_until <= now())
      and private.current_session_is_fresh(p.pin_reset_at)
  )
$$;

create or replace function private.current_leader_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
  from public.workspace_members wm
  join public.profiles p
    on p.user_id = wm.user_id
   and p.is_active
   and not p.must_change_pin
   and (p.locked_until is null or p.locked_until <= now())
   and private.current_session_is_fresh(p.pin_reset_at)
  where wm.user_id = (select auth.uid())
    and wm.role = 'leader'
    and wm.is_active
$$;

create or replace function private.current_assigned_upload_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct b.upload_id), '{}'::uuid[])
  from public.assignment_blocks b
  join public.workspace_members wm
    on wm.workspace_id = b.workspace_id
   and wm.user_id = (select auth.uid())
   and wm.is_active
  join public.profiles p
    on p.user_id = wm.user_id
   and p.is_active
   and not p.must_change_pin
   and (p.locked_until is null or p.locked_until <= now())
   and private.current_session_is_fresh(p.pin_reset_at)
  where b.assigned_to = (select auth.uid())
    and b.status in ('published', 'in_progress', 'completed')
$$;

drop policy if exists profiles_select_self_or_leader on public.profiles;
create policy profiles_select_self_or_leader
on public.profiles for select to authenticated
using (
  (
    (select auth.uid()) = user_id
    and private.current_session_is_fresh(pin_reset_at)
  )
  or (select private.can_view_profile(user_id))
);

revoke all on function private.current_session_is_fresh(timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function private.current_session_is_fresh(timestamptz)
  to authenticated, service_role;

-- PostgreSQL numeric admite las formas abreviadas Inf/+Inf/-Inf. El overlay
-- debe aceptar exclusivamente valores finitos para las columnas numéricas.
create or replace function private.validate_cell_resolution_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_headers jsonb;
  v_values jsonb;
  v_expected_field text;
  v_expected_original text;
begin
  select upload.source_headers, source.field_values
  into v_headers, v_values
  from public.source_rows source
  join public.uploads upload
    on upload.id = source.upload_id
   and upload.workspace_id = source.workspace_id
  where source.id = new.source_row_id
    and source.upload_id = new.upload_id
    and source.workspace_id = new.workspace_id;
  if not found then
    raise exception using errcode = '23503', message = 'La resolución no corresponde a una fila de esta jornada.';
  end if;
  if new.column_index < 0
     or new.column_index >= jsonb_array_length(v_headers) then
    raise exception using errcode = '22023', message = 'El índice de columna no existe en el Excel original.';
  end if;

  v_expected_field := v_headers ->> (new.column_index::integer);
  if new.field_name is distinct from v_expected_field then
    raise exception using errcode = '22023', message = 'El nombre de columna no corresponde al índice indicado.';
  end if;
  if not (v_values ? v_expected_field) then
    raise exception using errcode = '22023', message = 'La columna no está disponible entre los campos evaluables de esta fila.';
  end if;

  v_expected_original := v_values ->> v_expected_field;
  if new.original_value is distinct from v_expected_original then
    raise exception using errcode = '22023', message = 'El valor original no coincide con la fuente inmutable.';
  end if;
  if v_expected_field = any(array[
    'Cantidad_Productos', 'cantidad_comprada', 'Precio_Unidad',
    'Precio_Total_Preciador', 'Monto Total Fc'
  ]) then
    if new.resolved_value is null
       or btrim(new.resolved_value) = ''
       or lower(btrim(new.resolved_value)) in (
         'nan', 'inf', '+inf', '-inf',
         'infinity', '+infinity', '-infinity'
       ) then
      raise exception using errcode = '22023', message = 'La corrección de una columna numérica debe ser un número finito.';
    end if;
    begin
      perform btrim(new.resolved_value)::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception using errcode = '22023', message = 'La corrección de una columna numérica debe ser un número finito.';
    end;
  end if;
  return new;
end;
$$;

create function public.resolve_alert_guarded(
  p_alert_id uuid,
  p_expected_version integer,
  p_decision public.decision_kind,
  p_resolved_value text,
  p_client_mutation_id uuid,
  p_note text default null
)
returns public.validation_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alert public.validation_alerts%rowtype;
  v_task public.review_tasks%rowtype;
begin
  if p_alert_id is null or p_client_mutation_id is null
     or coalesce(p_expected_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'Alerta, versión e identificador de mutación son obligatorios.';
  end if;
  select * into v_alert
  from public.validation_alerts where id = p_alert_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Alerta no encontrada.';
  end if;
  select * into v_task
  from public.review_tasks where id = v_alert.task_id for update;
  perform 1 from public.assignment_blocks
  where id = v_task.assignment_block_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
  end if;
  perform private.assert_block_access(v_task.assignment_block_id);
  return public.resolve_alert(
    p_alert_id, p_expected_version, p_decision, p_resolved_value,
    p_client_mutation_id, p_note
  );
end;
$$;

create function public.reopen_alert_guarded(
  p_alert_id uuid,
  p_expected_version integer,
  p_reason text,
  p_client_mutation_id uuid
)
returns public.validation_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if p_alert_id is null or p_client_mutation_id is null
     or coalesce(p_expected_version, 0) < 1
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Alerta, versión, motivo e identificador de mutación son obligatorios.';
  end if;
  select task.workspace_id into v_workspace_id
  from public.validation_alerts alert
  join public.review_tasks task on task.id = alert.task_id
  where alert.id = p_alert_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Alerta no encontrada.';
  end if;
  perform 1 from public.workspaces where id = v_workspace_id for share;
  perform private.assert_leader(v_workspace_id);
  return public.reopen_alert(
    p_alert_id, p_expected_version, p_reason, p_client_mutation_id
  );
end;
$$;

create function public.add_related_row_to_block_guarded(
  p_block_id uuid,
  p_source_row_id bigint,
  p_expected_block_version integer
)
returns public.review_tasks
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_block_id is null or p_source_row_id is null
     or coalesce(p_expected_block_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'Bloque, fila y versión son obligatorios.';
  end if;
  perform 1 from public.assignment_blocks where id = p_block_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
  end if;
  perform private.assert_block_access(p_block_id);
  return public.add_related_row_to_block(
    p_block_id, p_source_row_id, p_expected_block_version
  );
end;
$$;

create or replace function public.save_related_cell_resolution_guarded(
  p_task_id uuid,
  p_column_index smallint,
  p_field_name text,
  p_original_value text,
  p_resolved_value text,
  p_expected_task_version integer,
  p_client_mutation_id uuid
)
returns public.cell_resolutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.review_tasks%rowtype;
begin
  if p_task_id is null or p_client_mutation_id is null
     or coalesce(p_expected_task_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'Registro, versión e identificador de mutación son obligatorios.';
  end if;
  select * into v_task
  from public.review_tasks where id = p_task_id for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado editable.';
  end if;
  perform 1 from public.assignment_blocks
  where id = v_task.assignment_block_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
  end if;
  perform private.assert_block_access(v_task.assignment_block_id);

  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
      and actor_user_id = v_actor
      and operation = 'related_cell.save'
      and entity_id = p_task_id::text
  ) then
    return public.save_related_cell_resolution(
      p_task_id, p_column_index, p_field_name, p_original_value,
      p_resolved_value, p_expected_task_version, p_client_mutation_id
    );
  end if;
  if v_task.status = 'resolved' then
    raise exception using errcode = '55000', message = 'Un líder debe reabrir el registro antes de modificarlo nuevamente.';
  end if;
  update public.review_tasks set confirmed_correct_count = 0 where id = p_task_id;
  return public.save_related_cell_resolution(
    p_task_id, p_column_index, p_field_name, p_original_value,
    p_resolved_value, p_expected_task_version, p_client_mutation_id
  );
end;
$$;

create or replace function public.confirm_related_task_guarded(
  p_task_id uuid,
  p_expected_task_version integer,
  p_client_mutation_id uuid
)
returns public.review_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.review_tasks%rowtype;
begin
  if p_task_id is null or p_client_mutation_id is null
     or coalesce(p_expected_task_version, 0) < 1 then
    raise exception using errcode = '22023', message = 'Registro, versión e identificador de mutación son obligatorios.';
  end if;
  select * into v_task
  from public.review_tasks where id = p_task_id for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado.';
  end if;
  perform 1 from public.assignment_blocks
  where id = v_task.assignment_block_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
  end if;
  perform private.assert_block_access(v_task.assignment_block_id);

  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
      and actor_user_id = v_actor
      and operation = 'related_task.confirm'
      and entity_id = p_task_id::text
  ) then
    return public.confirm_related_task(
      p_task_id, p_expected_task_version, p_client_mutation_id
    );
  end if;
  if v_task.status = 'resolved' then
    raise exception using errcode = '55000', message = 'Un líder debe reabrir el registro antes de confirmarlo nuevamente.';
  end if;
  if exists (
    select 1 from public.cell_resolutions
    where upload_id = v_task.upload_id
      and source_row_id = v_task.source_row_id
      and source = 'related_record'
  ) then
    raise exception using errcode = '55000', message = 'El registro conserva una corrección; un líder debe reabrirlo antes de marcarlo correcto.';
  end if;
  update public.review_tasks set corrected_cell_count = 0 where id = p_task_id;
  return public.confirm_related_task(
    p_task_id, p_expected_task_version, p_client_mutation_id
  );
end;
$$;

create function public.reconcile_assignment_blocks_guarded(
  p_target_block_id uuid,
  p_source_block_id uuid,
  p_action text,
  p_expected_target_version integer,
  p_expected_source_version integer,
  p_client_mutation_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if p_target_block_id is null or p_source_block_id is null
     or p_target_block_id = p_source_block_id
     or p_action not in ('move', 'merge')
     or coalesce(p_expected_target_version, 0) < 1
     or coalesce(p_expected_source_version, 0) < 1
     or p_client_mutation_id is null then
    raise exception using errcode = '22023', message = 'Bloques, acción, versiones e identificador de mutación son obligatorios.';
  end if;
  select workspace_id into v_workspace_id
  from public.assignment_blocks where id = p_target_block_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque objetivo no encontrado.';
  end if;
  perform 1 from public.workspaces where id = v_workspace_id for share;
  perform private.assert_leader(v_workspace_id);
  return public.reconcile_assignment_blocks(
    p_target_block_id, p_source_block_id, p_action,
    p_expected_target_version, p_expected_source_version,
    p_client_mutation_id
  );
end;
$$;

create function public.reopen_related_task_guarded(
  p_task_id uuid,
  p_expected_task_version integer,
  p_reason text,
  p_client_mutation_id uuid
)
returns public.review_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  if p_task_id is null or p_client_mutation_id is null
     or coalesce(p_expected_task_version, 0) < 1
     or nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'Registro, versión, motivo e identificador de mutación son obligatorios.';
  end if;
  select workspace_id into v_workspace_id
  from public.review_tasks where id = p_task_id and is_related_only;
  if not found then
    raise exception using errcode = 'P0002', message = 'Registro relacionado no encontrado.';
  end if;
  perform 1 from public.workspaces where id = v_workspace_id for share;
  perform private.assert_leader(v_workspace_id);
  return public.reopen_related_task(
    p_task_id, p_expected_task_version, p_reason, p_client_mutation_id
  );
end;
$$;

-- Las primitivas conservan la implementación transaccional, pero dejan de ser
-- invocables desde Data API. Solo se exponen wrappers que reautorizan incluso
-- un retry idempotente y validan todas las versiones obligatorias.
revoke all on function public.resolve_alert(uuid, integer, public.decision_kind, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reopen_alert(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_related_row_to_block(uuid, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_assignment_blocks(uuid, uuid, text, integer, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reopen_related_task(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;

revoke all on function public.resolve_alert_guarded(uuid, integer, public.decision_kind, text, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.reopen_alert_guarded(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.add_related_row_to_block_guarded(uuid, bigint, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.reconcile_assignment_blocks_guarded(uuid, uuid, text, integer, integer, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.reopen_related_task_guarded(uuid, integer, text, uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.resolve_alert_guarded(uuid, integer, public.decision_kind, text, uuid, text)
  to authenticated, service_role;
grant execute on function public.reopen_alert_guarded(uuid, integer, text, uuid)
  to authenticated, service_role;
grant execute on function public.add_related_row_to_block_guarded(uuid, bigint, integer)
  to authenticated, service_role;
grant execute on function public.reconcile_assignment_blocks_guarded(uuid, uuid, text, integer, integer, uuid)
  to authenticated, service_role;
grant execute on function public.reopen_related_task_guarded(uuid, integer, text, uuid)
  to authenticated, service_role;

notify pgrst, 'reload schema';
