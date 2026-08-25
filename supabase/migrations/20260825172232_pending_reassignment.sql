-- Permite escoger el equipo de una jornada y redistribuir únicamente el
-- trabajo pendiente después de publicar, sin modificar decisiones ni crédito
-- histórico. Las versiones de reparto son independientes de las versiones
-- operativas que cambian cada vez que se resuelve una alerta.

alter table public.uploads
  add column assignment_version integer not null default 1;

alter table public.uploads
  add constraint uploads_assignment_version_check
  check (assignment_version > 0);

alter table public.assignment_blocks
  add column assignment_version integer not null default 1;

alter table public.assignment_blocks
  add constraint assignment_blocks_assignment_version_check
  check (assignment_version > 0);

create function private.bump_block_assignment_version()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.assigned_to is distinct from old.assigned_to then
    new.assignment_version := old.assignment_version + 1;
  else
    new.assignment_version := old.assignment_version;
  end if;
  return new;
end;
$$;

create trigger assignment_blocks_bump_assignment_version
before update of assigned_to on public.assignment_blocks
for each row execute function private.bump_block_assignment_version();

-- Una asignación siempre debe apuntar a un validador activo. La versión
-- anterior aceptaba también líderes activos cuando se manipulaba la RPC fuera
-- de la interfaz.
create or replace function private.validate_block_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.workspace_members member
    join public.profiles profile
      on profile.user_id = member.user_id
     and profile.is_active
    where member.workspace_id = new.workspace_id
      and member.user_id = new.assigned_to
      and member.role = 'validator'::public.workspace_role
      and member.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'El responsable debe ser un validador activo del espacio de trabajo.';
  end if;
  return new;
end;
$$;

-- La RPC anterior interpretaba NULL o [] como "todos". Se conserva como
-- primitiva interna para evitar duplicar el algoritmo, pero el contrato público
-- exige ahora una selección explícita y sin duplicados.
alter function public.propose_balanced_assignments_versioned(
  uuid, integer, uuid[]
) rename to propose_balanced_assignments_versioned_legacy;

create function public.propose_balanced_assignments_versioned(
  p_upload_id uuid,
  p_expected_upload_version integer,
  p_validator_ids uuid[]
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
begin
  if p_validator_ids is null
     or cardinality(p_validator_ids) = 0
     or array_position(p_validator_ids, null::uuid) is not null
     or cardinality(p_validator_ids) <>
        (select count(distinct candidate)::integer from unnest(p_validator_ids) candidate) then
    raise exception using
      errcode = '22023',
      message = 'Seleccione al menos un validador activo, sin duplicados.';
  end if;

  return query
  select proposal.block_id, proposal.assignee_id, proposal.cumulative_weight
  from public.propose_balanced_assignments_versioned_legacy(
    p_upload_id,
    p_expected_upload_version,
    p_validator_ids
  ) proposal;
end;
$$;

create function public.preview_pending_reassignment_versioned(
  p_upload_id uuid,
  p_expected_upload_version integer,
  p_validator_ids uuid[]
)
returns table (
  block_id uuid,
  assignee_id uuid,
  cumulative_weight numeric,
  remaining_weight numeric,
  block_assignment_version integer
)
language plpgsql
stable
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
  if p_upload_id is null
     or coalesce(p_expected_upload_version, 0) < 1 then
    raise exception using
      errcode = '22023',
      message = 'Jornada y versión de reparto son obligatorias.';
  end if;
  if p_validator_ids is null
     or cardinality(p_validator_ids) = 0
     or array_position(p_validator_ids, null::uuid) is not null
     or cardinality(p_validator_ids) <>
        (select count(distinct candidate)::integer from unnest(p_validator_ids) candidate) then
    raise exception using
      errcode = '22023',
      message = 'Seleccione al menos un validador activo, sin duplicados.';
  end if;

  select * into v_upload
  from public.uploads
  where id = p_upload_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;

  perform private.assert_leader(v_upload.workspace_id);
  if v_upload.assignment_version <> p_expected_upload_version then
    raise exception using
      errcode = '40001',
      message = 'El reparto cambió; actualice la pantalla antes de recalcular.';
  end if;
  if v_upload.status <> 'active'::public.upload_status then
    raise exception using
      errcode = '55000',
      message = 'Solo se puede redistribuir una jornada ya publicada.';
  end if;

  select array_agg(candidate order by candidate) into v_validators
  from unnest(p_validator_ids) candidate
  join public.workspace_members member
    on member.workspace_id = v_upload.workspace_id
   and member.user_id = candidate
   and member.role = 'validator'::public.workspace_role
   and member.is_active
  join public.profiles profile
    on profile.user_id = member.user_id
   and profile.is_active;

  if coalesce(cardinality(v_validators), 0) <> cardinality(p_validator_ids) then
    raise exception using
      errcode = '22023',
      message = 'La selección contiene usuarios que no son validadores activos.';
  end if;

  foreach v_validator in array v_validators loop
    v_loads := jsonb_set(
      v_loads,
      array[v_validator::text],
      to_jsonb(0::numeric),
      true
    );
  end loop;

  for v_block in
    with pending_stats as (
      select
        task.assignment_block_id,
        count(distinct task.id)::bigint as pending_task_count,
        count(alert.id) filter (
          where alert.status <> 'resolved'::public.review_status
        )::bigint as pending_alert_count
      from public.review_tasks task
      left join public.validation_alerts alert
        on alert.task_id = task.id
       and alert.upload_id = task.upload_id
      where task.upload_id = p_upload_id
        and task.status <> 'resolved'::public.review_status
      group by task.assignment_block_id
    )
    select
      block.id,
      block.assignment_version,
      block.priority,
      stats.pending_task_count,
      stats.pending_alert_count,
      (
        greatest(
          stats.pending_alert_count,
          stats.pending_task_count,
          1::bigint
        )::numeric
        + stats.pending_task_count::numeric * 0.15
        + block.invoice_count::numeric * 0.10
      ) as remaining_weight
    from public.assignment_blocks block
    join pending_stats stats
      on stats.assignment_block_id = block.id
    where block.upload_id = p_upload_id
    order by
      block.priority desc,
      remaining_weight desc,
      stats.pending_alert_count desc,
      stats.pending_task_count desc,
      block.id
  loop
    select candidate into v_assignee
    from unnest(v_validators) candidate
    order by
      coalesce((v_loads ->> candidate::text)::numeric, 0),
      candidate
    limit 1;

    v_new_load :=
      coalesce((v_loads ->> v_assignee::text)::numeric, 0)
      + v_block.remaining_weight;
    v_loads := jsonb_set(
      v_loads,
      array[v_assignee::text],
      to_jsonb(v_new_load),
      true
    );

    block_id := v_block.id;
    assignee_id := v_assignee;
    cumulative_weight := v_new_load;
    remaining_weight := v_block.remaining_weight;
    block_assignment_version := v_block.assignment_version;
    return next;
  end loop;
end;
$$;

create function public.publish_pending_reassignment_versioned(
  p_upload_id uuid,
  p_expected_upload_version integer,
  p_validator_ids uuid[],
  p_assignments jsonb,
  p_client_mutation_id uuid
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_upload public.uploads%rowtype;
  v_receipt private.mutation_receipts%rowtype;
  v_validators uuid[];
  v_pending_block_count integer;
  v_assignment_count integer;
  v_distinct_block_count integer;
  v_changed_block_count integer := 0;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
  v_changes jsonb := '[]'::jsonb;
begin
  if p_upload_id is null
     or coalesce(p_expected_upload_version, 0) < 1
     or p_client_mutation_id is null then
    raise exception using
      errcode = '22023',
      message = 'Jornada, versión de reparto e identificador de mutación son obligatorios.';
  end if;
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using
      errcode = '22023',
      message = 'Las asignaciones deben ser un arreglo JSON.';
  end if;
  if p_validator_ids is null
     or cardinality(p_validator_ids) = 0
     or array_position(p_validator_ids, null::uuid) is not null
     or cardinality(p_validator_ids) <>
        (select count(distinct candidate)::integer from unnest(p_validator_ids) candidate) then
    raise exception using
      errcode = '22023',
      message = 'Seleccione al menos un validador activo, sin duplicados.';
  end if;

  -- Autoriza antes de considerar un recibo idempotente: perder el rol o quedar
  -- inactivo también invalida los reintentos.
  select * into v_upload
  from public.uploads
  where id = p_upload_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_upload.workspace_id);

  select * into v_receipt
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id;
  if found then
    if v_receipt.actor_user_id <> v_actor
       or v_receipt.operation <> 'assignments.redistribute_pending'
       or v_receipt.entity_id <> p_upload_id::text then
      raise exception using
        errcode = '23505',
        message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    select * into v_upload from public.uploads where id = p_upload_id;
    return v_upload;
  end if;

  -- Orden global: upload -> bloques. Las decisiones toman locks NOWAIT y por
  -- ello nunca se forma un ciclo de espera con esta publicación.
  begin
    select * into v_upload
    from public.uploads
    where id = p_upload_id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '55P03',
      message = 'La jornada está siendo actualizada; espere un instante e intente de nuevo.';
  end;

  perform private.assert_leader(v_upload.workspace_id);
  if v_upload.assignment_version <> p_expected_upload_version then
    raise exception using
      errcode = '40001',
      message = 'El reparto cambió; actualice la pantalla antes de publicar.';
  end if;
  if v_upload.status <> 'active'::public.upload_status then
    raise exception using
      errcode = '55000',
      message = 'Solo se puede redistribuir una jornada ya publicada.';
  end if;

  select array_agg(candidate order by candidate) into v_validators
  from unnest(p_validator_ids) candidate
  join public.workspace_members member
    on member.workspace_id = v_upload.workspace_id
   and member.user_id = candidate
   and member.role = 'validator'::public.workspace_role
   and member.is_active
  join public.profiles profile
    on profile.user_id = member.user_id
   and profile.is_active;
  if coalesce(cardinality(v_validators), 0) <> cardinality(p_validator_ids) then
    raise exception using
      errcode = '22023',
      message = 'La selección contiene usuarios que no son validadores activos.';
  end if;

  begin
    perform 1
    from public.assignment_blocks block
    where block.upload_id = p_upload_id
      and exists (
        select 1
        from public.review_tasks task
        where task.assignment_block_id = block.id
          and task.status <> 'resolved'::public.review_status
      )
    order by block.id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '55P03',
      message = 'Un bloque está siendo revisado; espere un instante y vuelva a publicar.';
  end;

  select count(*)::integer into v_pending_block_count
  from public.assignment_blocks block
  where block.upload_id = p_upload_id
    and exists (
      select 1
      from public.review_tasks task
      where task.assignment_block_id = block.id
        and task.status <> 'resolved'::public.review_status
    );

  if v_pending_block_count = 0 then
    raise exception using
      errcode = '55000',
      message = 'La jornada no tiene bloques pendientes para redistribuir.';
  end if;

  select count(*)::integer, count(distinct item.block_id)::integer
  into v_assignment_count, v_distinct_block_count
  from jsonb_to_recordset(p_assignments) as item(
    block_id uuid,
    assigned_to uuid,
    expected_version integer
  );

  if v_assignment_count <> v_distinct_block_count then
    raise exception using
      errcode = '22023',
      message = 'Cada bloque puede aparecer una sola vez en la publicación.';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_assignments) as item(
      block_id uuid,
      assigned_to uuid,
      expected_version integer
    )
    left join public.assignment_blocks block
      on block.id = item.block_id
     and block.upload_id = p_upload_id
    where item.block_id is null
       or item.assigned_to is null
       or not (item.assigned_to = any(v_validators))
       or block.id is null
       or (
         exists (
           select 1
           from public.review_tasks task
           where task.assignment_block_id = block.id
             and task.status <> 'resolved'::public.review_status
         )
         and (
           item.expected_version is null
           or block.assignment_version <> item.expected_version
         )
       )
  ) then
    raise exception using
      errcode = '40001',
      message = 'Un bloque pendiente o su responsable cambió; recalcule el reparto.';
  end if;

  if exists (
    select 1
    from public.assignment_blocks block
    where block.upload_id = p_upload_id
      and exists (
        select 1
        from public.review_tasks task
        where task.assignment_block_id = block.id
          and task.status <> 'resolved'::public.review_status
      )
      and not exists (
        select 1
        from jsonb_to_recordset(p_assignments) as item(
          block_id uuid,
          assigned_to uuid,
          expected_version integer
        )
        where item.block_id = block.id
      )
  ) then
    raise exception using
      errcode = '22023',
      message = 'Falta al menos un bloque pendiente en la publicación.';
  end if;

  with pending_stats as (
    select
      task.assignment_block_id,
      count(distinct task.id)::bigint as tasks,
      count(alert.id) filter (
        where alert.status <> 'resolved'::public.review_status
      )::bigint as alerts
    from public.review_tasks task
    left join public.validation_alerts alert
      on alert.task_id = task.id
     and alert.upload_id = task.upload_id
    where task.upload_id = p_upload_id
      and task.status <> 'resolved'::public.review_status
    group by task.assignment_block_id
  ), grouped as (
    select
      coalesce(block.assigned_to::text, 'sin_asignar') as assignee,
      count(*)::integer as blocks,
      sum(stats.tasks)::bigint as tasks,
      sum(stats.alerts)::bigint as alerts,
      sum(
        greatest(stats.alerts, stats.tasks, 1::bigint)::numeric
        + stats.tasks::numeric * 0.15
        + block.invoice_count::numeric * 0.10
      ) as weight
    from public.assignment_blocks block
    join pending_stats stats on stats.assignment_block_id = block.id
    where block.upload_id = p_upload_id
    group by block.assigned_to
  )
  select coalesce(
    jsonb_object_agg(
      grouped.assignee,
      jsonb_build_object(
        'blocks', grouped.blocks,
        'tasks', grouped.tasks,
        'alerts', grouped.alerts,
        'weight', grouped.weight
      )
    ),
    '{}'::jsonb
  ) into v_before
  from grouped;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'block_id', block.id,
        'from_assignee', block.assigned_to,
        'to_assignee', item.assigned_to
      )
      order by block.id
    ) filter (where block.assigned_to is distinct from item.assigned_to),
    '[]'::jsonb
  ) into v_changes
  from jsonb_to_recordset(p_assignments) as item(
    block_id uuid,
    assigned_to uuid,
    expected_version integer
  )
  join public.assignment_blocks block
    on block.id = item.block_id
   and block.upload_id = p_upload_id
  where exists (
    select 1
    from public.review_tasks task
    where task.assignment_block_id = block.id
      and task.status <> 'resolved'::public.review_status
  );

  update public.assignment_blocks block
  set assigned_to = item.assigned_to,
      version = block.version + 1
  from jsonb_to_recordset(p_assignments) as item(
    block_id uuid,
    assigned_to uuid,
    expected_version integer
  )
  where block.id = item.block_id
    and block.upload_id = p_upload_id
    and exists (
      select 1
      from public.review_tasks task
      where task.assignment_block_id = block.id
        and task.status <> 'resolved'::public.review_status
    )
    and block.assigned_to is distinct from item.assigned_to;
  get diagnostics v_changed_block_count = row_count;

  with pending_stats as (
    select
      task.assignment_block_id,
      count(distinct task.id)::bigint as tasks,
      count(alert.id) filter (
        where alert.status <> 'resolved'::public.review_status
      )::bigint as alerts
    from public.review_tasks task
    left join public.validation_alerts alert
      on alert.task_id = task.id
     and alert.upload_id = task.upload_id
    where task.upload_id = p_upload_id
      and task.status <> 'resolved'::public.review_status
    group by task.assignment_block_id
  ), grouped as (
    select
      coalesce(block.assigned_to::text, 'sin_asignar') as assignee,
      count(*)::integer as blocks,
      sum(stats.tasks)::bigint as tasks,
      sum(stats.alerts)::bigint as alerts,
      sum(
        greatest(stats.alerts, stats.tasks, 1::bigint)::numeric
        + stats.tasks::numeric * 0.15
        + block.invoice_count::numeric * 0.10
      ) as weight
    from public.assignment_blocks block
    join pending_stats stats on stats.assignment_block_id = block.id
    where block.upload_id = p_upload_id
    group by block.assigned_to
  )
  select coalesce(
    jsonb_object_agg(
      grouped.assignee,
      jsonb_build_object(
        'blocks', grouped.blocks,
        'tasks', grouped.tasks,
        'alerts', grouped.alerts,
        'weight', grouped.weight
      )
    ),
    '{}'::jsonb
  ) into v_after
  from grouped;

  update public.uploads
  set assignment_version = assignment_version + 1
  where id = p_upload_id
  returning * into v_upload;

  insert into public.audit_events (
    workspace_id,
    upload_id,
    actor_user_id,
    event_type,
    entity_type,
    entity_id,
    payload
  ) values (
    v_upload.workspace_id,
    v_upload.id,
    v_actor,
    'assignments.pending_redistributed',
    'upload',
    v_upload.id::text,
    jsonb_build_object(
      'mutation_id', p_client_mutation_id,
      'assignment_version_before', p_expected_upload_version,
      'assignment_version_after', v_upload.assignment_version,
      'selected_validator_ids', to_jsonb(v_validators),
      'pending_block_count', v_pending_block_count,
      'changed_block_count', v_changed_block_count,
      'before', v_before,
      'after', v_after,
      'changes', v_changes
    )
  );

  insert into private.mutation_receipts (
    client_mutation_id,
    actor_user_id,
    operation,
    entity_id,
    result
  ) values (
    p_client_mutation_id,
    v_actor,
    'assignments.redistribute_pending',
    p_upload_id::text,
    jsonb_build_object(
      'assignment_version', v_upload.assignment_version,
      'pending_block_count', v_pending_block_count,
      'changed_block_count', v_changed_block_count
    )
  );

  return v_upload;
end;
$$;

revoke all on function private.bump_block_assignment_version()
  from public, anon, authenticated, service_role;

revoke all on function public.propose_balanced_assignments_versioned_legacy(
  uuid, integer, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function public.propose_balanced_assignments_versioned(
  uuid, integer, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function public.preview_pending_reassignment_versioned(
  uuid, integer, uuid[]
) from public, anon, authenticated, service_role;

revoke all on function public.publish_pending_reassignment_versioned(
  uuid, integer, uuid[], jsonb, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.preview_pending_reassignment_versioned(
  uuid, integer, uuid[]
) to authenticated, service_role;

grant execute on function public.publish_pending_reassignment_versioned(
  uuid, integer, uuid[], jsonb, uuid
) to authenticated, service_role;

grant execute on function public.propose_balanced_assignments_versioned(
  uuid, integer, uuid[]
) to authenticated, service_role;

comment on column public.uploads.assignment_version is
  'Versión optimista exclusiva del reparto; no cambia al resolver alertas.';
comment on column public.assignment_blocks.assignment_version is
  'Versión optimista exclusiva del responsable del bloque.';
comment on function public.propose_balanced_assignments_versioned_legacy(uuid, integer, uuid[]) is
  'Primitiva interna del reparto inicial; el wrapper público exige una selección explícita.';
comment on function public.propose_balanced_assignments_versioned(uuid, integer, uuid[]) is
  'Reparte inicialmente solo entre el subconjunto explícito de validadores activos.';
comment on function public.preview_pending_reassignment_versioned(uuid, integer, uuid[]) is
  'Propone sin mutar un reparto equilibrado de los bloques que aún contienen tareas no resueltas.';
comment on function public.publish_pending_reassignment_versioned(uuid, integer, uuid[], jsonb, uuid) is
  'Publica de forma atómica e idempotente el re-reparto de todos y solo los bloques pendientes.';

notify pgrst, 'reload schema';
