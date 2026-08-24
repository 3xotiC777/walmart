-- Operaciones de liderazgo para conservar los bloques como unidades indivisibles.
-- La migración se agrega al repositorio, pero debe aplicarse junto con el resto
-- de migraciones solo después de validar el despliegue correspondiente.

create function public.reconcile_assignment_blocks(
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
  v_actor uuid := (select auth.uid());
  v_target public.assignment_blocks%rowtype;
  v_source public.assignment_blocks%rowtype;
  v_upload public.uploads%rowtype;
  v_receipt private.mutation_receipts%rowtype;
  v_result jsonb;
  v_source_task_count integer;
  v_previous_assignee uuid;
begin
  select * into v_receipt
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id
    and actor_user_id = v_actor;

  if found then
    if v_receipt.operation <> 'assignment_blocks.reconcile'
       or v_receipt.entity_id <> p_target_block_id::text then
      raise exception using
        errcode = '23505',
        message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    return v_receipt.result;
  end if;

  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'El identificador de mutación ya fue usado por otro usuario.';
  end if;

  if p_client_mutation_id is null
     or p_target_block_id is null
     or p_source_block_id is null
     or p_target_block_id = p_source_block_id
     or p_action is null
     or p_action not in ('move', 'merge')
     or coalesce(p_expected_target_version, 0) < 1
     or coalesce(p_expected_source_version, 0) < 1 then
    raise exception using
      errcode = '22023',
      message = 'Bloques, acción, versiones e identificador de mutación son obligatorios.';
  end if;

  -- Lectura preliminar: resuelve el upload a bloquear sin tomar locks de bloque.
  select * into v_target
  from public.assignment_blocks
  where id = p_target_block_id;
  select * into v_source
  from public.assignment_blocks
  where id = p_source_block_id;

  if v_target.id is null or v_source.id is null then
    raise exception using errcode = 'P0002', message = 'Uno de los bloques ya no existe.';
  end if;
  if v_target.workspace_id <> v_source.workspace_id
     or v_target.upload_id <> v_source.upload_id then
    raise exception using
      errcode = '22023',
      message = 'Solo se pueden relacionar bloques de la misma carga.';
  end if;

  perform private.assert_leader(v_target.workspace_id);

  -- Todas las mutaciones colaborativas respetan upload → blocks → tasks. Esto
  -- las serializa con propuesta/publicación y evita ciclos de espera.
  select * into v_upload
  from public.uploads
  where id = v_target.upload_id
  for update;

  -- Una repetición concurrente puede haber esperado este lock. Relee el
  -- recibo después de serializar para devolver exactamente el primer resultado.
  select * into v_receipt
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id;
  if found then
    if v_receipt.actor_user_id <> v_actor
       or v_receipt.operation <> 'assignment_blocks.reconcile'
       or v_receipt.entity_id <> p_target_block_id::text then
      raise exception using
        errcode = '23505',
        message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    return v_receipt.result;
  end if;

  if v_upload.status not in ('ready', 'assigning', 'active', 'completed') then
    raise exception using
      errcode = '55000',
      message = 'La carga todavía no admite cambios de reparto.';
  end if;

  begin
    perform 1
    from public.assignment_blocks b
    where b.id in (p_target_block_id, p_source_block_id)
    order by b.id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'Los bloques están siendo modificados; intente nuevamente.';
  end;

  -- Relee bajo lock: la lectura preliminar nunca autoriza ni decide la versión.
  select * into v_target
  from public.assignment_blocks
  where id = p_target_block_id;
  select * into v_source
  from public.assignment_blocks
  where id = p_source_block_id;
  if v_target.id is null or v_source.id is null then
    raise exception using errcode = 'P0002', message = 'Uno de los bloques ya no existe.';
  end if;
  if v_target.workspace_id <> v_source.workspace_id
     or v_target.upload_id <> v_source.upload_id
     or v_target.upload_id <> v_upload.id then
    raise exception using
      errcode = '22023',
      message = 'Solo se pueden relacionar bloques de la misma carga.';
  end if;

  if v_target.version <> p_expected_target_version
     or v_source.version <> p_expected_source_version then
    raise exception using
      errcode = '40001',
      message = 'Uno de los bloques cambió; actualice la pantalla.';
  end if;
  if v_upload.status in ('active', 'completed')
     and v_target.assigned_to is null then
    raise exception using
      errcode = '23514',
      message = 'El bloque objetivo publicado debe tener un responsable.';
  end if;

  v_previous_assignee := v_source.assigned_to;
  select count(*)::integer into v_source_task_count
  from public.review_tasks
  where assignment_block_id = v_source.id;

  if p_action = 'move' then
    update public.assignment_blocks
    set assigned_to = v_target.assigned_to,
        version = version + 1
    where id = v_source.id
    returning * into v_source;

    v_result := jsonb_build_object(
      'action', 'move',
      'targetBlockId', v_target.id,
      'targetBlockVersion', v_target.version,
      'sourceBlockId', v_source.id,
      'sourceBlockVersion', v_source.version,
      'assignedTo', v_source.assigned_to,
      'movedTaskCount', v_source_task_count
    );

    insert into public.audit_events (
      workspace_id, upload_id, actor_user_id, event_type, entity_type,
      entity_id, payload
    ) values (
      v_source.workspace_id, v_source.upload_id, v_actor,
      'assignment_block.moved', 'assignment_block', v_source.id::text,
      jsonb_build_object(
        'target_block_id', v_target.id,
        'target_block_key', v_target.block_key,
        'source_block_key', v_source.block_key,
        'from_assignee', v_previous_assignee,
        'to_assignee', v_source.assigned_to,
        'task_count', v_source_task_count,
        'previous_version', p_expected_source_version,
        'version', v_source.version
      )
    );
  else
    -- Primero se mueven las tareas con alertas. Así el guard de pertenencia
    -- puede comprobar después cada tarea related-only contra su alerta dueña.
    begin
      perform 1
      from public.review_tasks t
      where t.assignment_block_id in (v_target.id, v_source.id)
      order by t.id
      for update nowait;
    exception when lock_not_available then
      raise exception using
        errcode = '40001',
        message = 'Una tarea del bloque está siendo revisada; intente nuevamente.';
    end;

    update public.review_tasks
    set assignment_block_id = v_target.id,
        version = version + 1
    where assignment_block_id = v_source.id
      and not is_related_only;

    update public.review_tasks
    set assignment_block_id = v_target.id,
        version = version + 1
    where assignment_block_id = v_source.id
      and is_related_only;

    update public.assignment_blocks b
    set alert_count = (
          select count(*)::integer
          from public.validation_alerts a
          join public.review_tasks t on t.id = a.task_id
          where t.assignment_block_id = b.id
        ),
        member_count = (
          select count(distinct gm.source_row_id)::integer
          from public.validation_alerts a
          join public.review_tasks t on t.id = a.task_id
          join public.group_members gm on gm.group_id = a.group_id
          where t.assignment_block_id = b.id
        ),
        invoice_count = (
          select count(distinct coalesce(il.storage_object_path, il.external_url, il.id::text))::integer
          from public.invoice_links il
          where il.upload_id = b.upload_id
            and exists (
              select 1
              from public.review_tasks t
              join public.source_rows sr on sr.id = t.source_row_id
              where t.assignment_block_id = b.id
                and (
                  il.source_row_id = sr.id
                  or (
                    il.source_row_id is null
                    and il.id_dn_w is not null
                    and il.id_dn_w = sr.id_dn_w
                  )
                )
            )
        ),
        weight = greatest(1::numeric, v_target.weight + v_source.weight),
        status = case
          when v_upload.status in ('ready', 'assigning') then 'draft'::public.block_status
          when not exists (
            select 1 from public.review_tasks t
            where t.assignment_block_id = b.id and t.status <> 'resolved'
          ) then 'completed'::public.block_status
          when exists (
            select 1 from public.review_tasks t
            where t.assignment_block_id = b.id
              and t.status in ('in_progress', 'reopened', 'resolved')
          ) then 'in_progress'::public.block_status
          else 'published'::public.block_status
        end,
        version = version + 1
    where b.id = v_target.id
    returning * into v_target;

    delete from public.assignment_blocks where id = v_source.id;

    v_result := jsonb_build_object(
      'action', 'merge',
      'targetBlockId', v_target.id,
      'targetBlockVersion', v_target.version,
      'sourceBlockId', v_source.id,
      'sourceBlockRemoved', true,
      'movedTaskCount', v_source_task_count
    );

    insert into public.audit_events (
      workspace_id, upload_id, actor_user_id, event_type, entity_type,
      entity_id, payload
    ) values (
      v_target.workspace_id, v_target.upload_id, v_actor,
      'assignment_block.merged', 'assignment_block', v_target.id::text,
      jsonb_build_object(
        'source_block_id', v_source.id,
        'source_block_key', v_source.block_key,
        'target_block_key', v_target.block_key,
        'source_assignee', v_previous_assignee,
        'target_assignee', v_target.assigned_to,
        'moved_task_count', v_source_task_count,
        'source_version', p_expected_source_version,
        'previous_target_version', p_expected_target_version,
        'target_version', v_target.version
      )
    );
  end if;

  update public.uploads
  set version = version + 1
  where id = v_target.upload_id;

  insert into private.mutation_receipts (
    client_mutation_id, actor_user_id, operation, entity_id, result
  ) values (
    p_client_mutation_id, v_actor, 'assignment_blocks.reconcile',
    v_target.id::text, v_result
  );

  return v_result;
end;
$$;

create function public.reopen_related_task(
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
  v_actor uuid := (select auth.uid());
  v_task public.review_tasks%rowtype;
  v_block public.assignment_blocks%rowtype;
  v_upload public.uploads%rowtype;
  v_receipt private.mutation_receipts%rowtype;
  v_previous_resolver uuid;
  v_previous_resolution_date date;
  v_removed_resolution_count integer := 0;
begin
  select * into v_receipt
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id
    and actor_user_id = v_actor;

  if found then
    if v_receipt.operation <> 'related_task.reopen'
       or v_receipt.entity_id <> p_task_id::text then
      raise exception using
        errcode = '23505',
        message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    select * into v_task from public.review_tasks where id = p_task_id;
    return v_task;
  end if;

  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
  ) then
    raise exception using
      errcode = '23505',
      message = 'El identificador de mutación ya fue usado por otro usuario.';
  end if;

  if p_client_mutation_id is null
     or coalesce(p_expected_task_version, 0) < 1
     or nullif(btrim(p_reason), '') is null then
    raise exception using
      errcode = '22023',
      message = 'Versión, motivo e identificador de mutación son obligatorios.';
  end if;

  -- Lectura preliminar para resolver upload/workspace sin tomar locks inversos.
  select * into v_task
  from public.review_tasks
  where id = p_task_id;
  if not found or not v_task.is_related_only then
    raise exception using
      errcode = '22023',
      message = 'La tarea no es un registro relacionado.';
  end if;

  perform private.assert_leader(v_task.workspace_id);

  select * into v_upload
  from public.uploads
  where id = v_task.upload_id
  for update;

  select * into v_receipt
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id;
  if found then
    if v_receipt.actor_user_id <> v_actor
       or v_receipt.operation <> 'related_task.reopen'
       or v_receipt.entity_id <> p_task_id::text then
      raise exception using
        errcode = '23505',
        message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    select * into v_task from public.review_tasks where id = p_task_id;
    return v_task;
  end if;

  if v_upload.status not in ('active', 'completed') then
    raise exception using
      errcode = '55000',
      message = 'La carga no está publicada.';
  end if;

  begin
    select * into v_block
    from public.assignment_blocks
    where id = v_task.assignment_block_id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'El bloque está siendo modificado; intente nuevamente.';
  end;
  if not found then
    raise exception using errcode = 'P0002', message = 'El bloque ya no existe.';
  end if;

  begin
    select * into v_task
    from public.review_tasks
    where id = p_task_id
    for update nowait;
  exception when lock_not_available then
    raise exception using
      errcode = '40001',
      message = 'El registro está siendo modificado; intente nuevamente.';
  end;
  if not found or not v_task.is_related_only
     or v_task.upload_id <> v_upload.id
     or v_task.assignment_block_id <> v_block.id then
    raise exception using
      errcode = '40001',
      message = 'El registro cambió de bloque; actualice la pantalla.';
  end if;
  if v_task.version <> p_expected_task_version then
    raise exception using
      errcode = '40001',
      message = 'El registro cambió; actualice la pantalla.';
  end if;
  if v_task.status <> 'resolved' then
    raise exception using
      errcode = '55000',
      message = 'Solo se puede reabrir un registro relacionado resuelto.';
  end if;

  v_previous_resolver := v_task.resolved_by;
  v_previous_resolution_date :=
    (v_task.resolved_at at time zone 'America/Bogota')::date;

  delete from public.cell_resolutions
  where upload_id = v_task.upload_id
    and source_row_id = v_task.source_row_id
    and source = 'related_record';
  get diagnostics v_removed_resolution_count = row_count;

  update public.review_tasks
  set status = 'reopened',
      corrected_cell_count = 0,
      confirmed_correct_count = 0,
      resolved_by = null,
      resolved_at = null,
      version = version + 1
  where id = v_task.id;

  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type,
    entity_id, payload
  ) values (
    v_task.workspace_id, v_task.upload_id, v_actor,
    'related_row.reopened', 'review_task', v_task.id::text,
    jsonb_build_object(
      'reason', left(btrim(p_reason), 500),
      'removed_resolution_count', v_removed_resolution_count,
      'previous_resolver', v_previous_resolver,
      'previous_version', p_expected_task_version
    )
  );

  insert into private.mutation_receipts (
    client_mutation_id, actor_user_id, operation, entity_id, result
  ) values (
    p_client_mutation_id, v_actor, 'related_task.reopen', v_task.id::text,
    jsonb_build_object('task_id', v_task.id)
  );

  perform private.refresh_review_rollups(
    v_task.upload_id, v_task.id, v_block.id, v_actor
  );

  if v_previous_resolver is not null
     and v_previous_resolution_date is not null then
    perform private.refresh_productivity(
      v_task.workspace_id,
      v_task.upload_id,
      v_previous_resolver,
      v_previous_resolution_date
    );
  end if;

  select * into v_task from public.review_tasks where id = p_task_id;
  return v_task;
end;
$$;

revoke all on function public.reconcile_assignment_blocks(
  uuid, uuid, text, integer, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.reopen_related_task(
  uuid, integer, text, uuid
) from public, anon, authenticated, service_role;

grant execute on function public.reconcile_assignment_blocks(
  uuid, uuid, text, integer, integer, uuid
) to authenticated, service_role;
grant execute on function public.reopen_related_task(
  uuid, integer, text, uuid
) to authenticated, service_role;

comment on function public.reconcile_assignment_blocks(
  uuid, uuid, text, integer, integer, uuid
) is 'Mueve un bloque completo al responsable objetivo o fusiona ambos; solo líderes y con control optimista de las dos versiones.';
comment on function public.reopen_related_task(
  uuid, integer, text, uuid
) is 'Reabre una tarea related-only resuelta, retira su overlay y recalcula métricas y productividad.';

notify pgrst, 'reload schema';
