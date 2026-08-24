-- Evita que dos líderes publiquen sobre una propuesta desactualizada y hace
-- que todo overlay apunte exactamente a una celda conocida de la fuente.

create function public.propose_balanced_assignments_versioned(
  p_upload_id uuid,
  p_expected_upload_version integer,
  p_validator_ids uuid[] default null
)
returns table (
  block_id uuid,
  assignee_id uuid,
  cumulative_weight numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_validators uuid[];
  v_loads jsonb := '{}'::jsonb;
  v_validator uuid;
  v_assignee uuid;
  v_block record;
  v_new_load numeric;
begin
  select * into v_upload
  from public.uploads
  where id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_upload.workspace_id);
  if p_expected_upload_version is null or v_upload.version <> p_expected_upload_version then
    raise exception using errcode = '40001', message = 'La jornada cambió; actualice la pantalla antes de recalcular.';
  end if;

  begin
    perform 1
    from public.assignment_blocks
    where upload_id = p_upload_id
    order by id
    for update nowait;
  exception when lock_not_available then
    raise exception using errcode = '40001', message = 'Un bloque está siendo revisado; actualice e intente de nuevo.';
  end;

  if v_upload.status not in ('ready', 'assigning') then
    raise exception using errcode = '55000', message = 'Solo se puede repartir una carga lista o en asignación.';
  end if;
  if p_validator_ids is null or cardinality(p_validator_ids) = 0 then
    select array_agg(member.user_id order by member.user_id) into v_validators
    from public.workspace_members member
    join public.profiles profile
      on profile.user_id = member.user_id and profile.is_active
    where member.workspace_id = v_upload.workspace_id
      and member.role = 'validator'
      and member.is_active;
  else
    select array_agg(distinct candidate order by candidate) into v_validators
    from unnest(p_validator_ids) candidate
    join public.workspace_members member
      on member.workspace_id = v_upload.workspace_id
     and member.user_id = candidate
     and member.role = 'validator'
     and member.is_active
    join public.profiles profile
      on profile.user_id = member.user_id and profile.is_active;
    if cardinality(v_validators) <> (select count(distinct item) from unnest(p_validator_ids) item) then
      raise exception using errcode = '22023', message = 'La lista contiene usuarios que no son validadores activos.';
    end if;
  end if;
  if coalesce(cardinality(v_validators), 0) = 0 then
    raise exception using errcode = '22023', message = 'No hay validadores activos para repartir la carga.';
  end if;

  foreach v_validator in array v_validators loop
    v_loads := jsonb_set(v_loads, array[v_validator::text], to_jsonb(0::numeric), true);
  end loop;
  for v_block in
    select block.id, block.weight
    from public.assignment_blocks block
    where block.upload_id = p_upload_id
    order by block.priority desc,
             block.alert_count desc,
             block.member_count desc,
             block.invoice_count desc,
             block.weight desc,
             block.id
  loop
    select candidate into v_assignee
    from unnest(v_validators) candidate
    order by coalesce((v_loads ->> candidate::text)::numeric, 0), candidate
    limit 1;
    v_new_load := coalesce((v_loads ->> v_assignee::text)::numeric, 0) + v_block.weight;
    v_loads := jsonb_set(v_loads, array[v_assignee::text], to_jsonb(v_new_load), true);
    update public.assignment_blocks
    set assigned_to = v_assignee, status = 'draft', version = version + 1
    where id = v_block.id;
    block_id := v_block.id;
    assignee_id := v_assignee;
    cumulative_weight := v_new_load;
    return next;
  end loop;

  update public.uploads
  set status = 'assigning', version = version + 1
  where id = p_upload_id;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    v_upload.workspace_id, p_upload_id, (select auth.uid()), 'assignments.proposed',
    'upload', p_upload_id::text,
    jsonb_build_object('validator_ids', to_jsonb(v_validators), 'loads', v_loads)
  );
end;
$$;

create function public.publish_assignments_versioned(
  p_upload_id uuid,
  p_expected_upload_version integer,
  p_assignments jsonb default '[]'::jsonb
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload public.uploads%rowtype;
  v_block_count integer;
begin
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'Las asignaciones deben ser un arreglo JSON.';
  end if;

  select * into v_upload
  from public.uploads
  where id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_upload.workspace_id);
  if p_expected_upload_version is null or v_upload.version <> p_expected_upload_version then
    raise exception using errcode = '40001', message = 'La jornada cambió; actualice la pantalla antes de publicar.';
  end if;

  begin
    perform 1
    from public.assignment_blocks
    where upload_id = p_upload_id
    order by id
    for update nowait;
  exception when lock_not_available then
    raise exception using errcode = '40001', message = 'Un bloque está siendo revisado; actualice e intente de nuevo.';
  end;
  select count(*)::integer into v_block_count
  from public.assignment_blocks
  where upload_id = p_upload_id;

  if jsonb_array_length(p_assignments) <> v_block_count or (
    select count(distinct item.block_id) <> v_block_count
    from jsonb_to_recordset(p_assignments)
      as item(block_id uuid, assigned_to uuid, expected_version integer)
  ) then
    raise exception using errcode = '22023', message = 'La publicación debe incluir cada bloque exactamente una vez.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_assignments)
      as item(block_id uuid, assigned_to uuid, expected_version integer)
    left join public.assignment_blocks block
      on block.id = item.block_id and block.upload_id = p_upload_id
    where block.id is null
       or item.assigned_to is null
       or item.expected_version is null
       or block.version <> item.expected_version
  ) then
    raise exception using errcode = '40001', message = 'Uno de los bloques cambió; actualice la pantalla antes de publicar.';
  end if;

  return public.publish_assignments(p_upload_id, p_assignments);
end;
$$;

create function private.validate_cell_resolution_source()
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
       or lower(btrim(new.resolved_value)) in ('nan', 'infinity', '+infinity', '-infinity') then
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

create trigger validate_cell_resolution_source_trigger
before insert or update of upload_id, workspace_id, source_row_id, column_index, field_name, original_value, resolved_value
on public.cell_resolutions
for each row execute function private.validate_cell_resolution_source();

create function public.save_related_cell_resolution_guarded(
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
  -- Los reintentos con el mismo mutation id conservan la idempotencia de la
  -- primitiva aun cuando la tarea ya quedó resuelta.
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

  select * into v_task
  from public.review_tasks
  where id = p_task_id
  for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado editable.';
  end if;
  if v_task.status = 'resolved' then
    raise exception using errcode = '55000', message = 'Un líder debe reabrir el registro antes de modificarlo nuevamente.';
  end if;
  update public.review_tasks
  set confirmed_correct_count = 0
  where id = p_task_id;

  return public.save_related_cell_resolution(
    p_task_id, p_column_index, p_field_name, p_original_value,
    p_resolved_value, p_expected_task_version, p_client_mutation_id
  );
end;
$$;

create function public.confirm_related_task_guarded(
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

  select * into v_task
  from public.review_tasks
  where id = p_task_id
  for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado.';
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
  update public.review_tasks
  set corrected_cell_count = 0
  where id = p_task_id;

  return public.confirm_related_task(
    p_task_id, p_expected_task_version, p_client_mutation_id
  );
end;
$$;

create function private.enforce_upload_confirmed_correct_rollup()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.confirmed_correct_count :=
    (
      select count(*)::integer
      from public.alert_decisions decision
      where decision.upload_id = new.id
        and decision.superseded_at is null
        and decision.decision = 'confirmed_correct'
    )
    +
    (
      select coalesce(sum(task.confirmed_correct_count), 0)::integer
      from public.review_tasks task
      where task.upload_id = new.id
        and task.is_related_only
    );
  return new;
end;
$$;

create trigger enforce_upload_confirmed_correct_rollup_trigger
before update of confirmed_correct_count on public.uploads
for each row execute function private.enforce_upload_confirmed_correct_rollup();

create function private.enforce_assignment_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.member_count := (
    select count(distinct member.source_row_id)::integer
    from public.validation_alerts alert
    join public.review_tasks task on task.id = alert.task_id
    join public.group_members member on member.group_id = alert.group_id
    where task.assignment_block_id = old.id
  );
  return new;
end;
$$;

create trigger enforce_assignment_member_count_trigger
before update of member_count on public.assignment_blocks
for each row execute function private.enforce_assignment_member_count();

revoke all on function public.propose_balanced_assignments_versioned(uuid, integer, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.publish_assignments_versioned(uuid, integer, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_related_cell_resolution_guarded(uuid, smallint, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_related_task_guarded(uuid, integer, uuid) from public, anon, authenticated, service_role;
-- Las implementaciones sin versión quedan como primitivas internas llamadas
-- únicamente por los wrappers SECURITY DEFINER anteriores.
revoke all on function public.propose_balanced_assignments(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.publish_assignments(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.save_related_cell_resolution(uuid, smallint, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_related_task(uuid, integer, uuid) from public, anon, authenticated, service_role;
grant execute on function public.propose_balanced_assignments_versioned(uuid, integer, uuid[]) to authenticated, service_role;
grant execute on function public.publish_assignments_versioned(uuid, integer, jsonb) to authenticated, service_role;
grant execute on function public.save_related_cell_resolution_guarded(uuid, smallint, text, text, text, integer, uuid) to authenticated, service_role;
grant execute on function public.confirm_related_task_guarded(uuid, integer, uuid) to authenticated, service_role;

comment on function public.propose_balanced_assignments(uuid, uuid[]) is 'Primitiva interna sin control de versión; no exponer por PostgREST.';
comment on function public.publish_assignments(uuid, jsonb) is 'Primitiva interna sin control de versión; no exponer por PostgREST.';
comment on function public.save_related_cell_resolution(uuid, smallint, text, text, text, integer, uuid) is 'Primitiva interna; usar el wrapper guarded para impedir dobles decisiones.';
comment on function public.confirm_related_task(uuid, integer, uuid) is 'Primitiva interna; usar el wrapper guarded para impedir dobles decisiones.';

notify pgrst, 'reload schema';
