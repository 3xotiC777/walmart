create or replace function public.resolve_alert_guarded(
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

  begin
    select * into v_alert
    from public.validation_alerts
    where id = p_alert_id
    for update nowait;

    if not found then
      raise exception using errcode = 'P0002', message = 'Alerta no encontrada.';
    end if;

    select * into v_task
    from public.review_tasks
    where id = v_alert.task_id
    for update nowait;

    perform 1
    from public.assignment_blocks
    where id = v_task.assignment_block_id
    for update nowait;

    if not found then
      raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
    end if;
  exception
    when lock_not_available then
      raise exception using
        errcode = '55P03',
        message = 'Ya se está guardando otra alerta de esta fila.';
  end;

  perform private.assert_block_access(v_task.assignment_block_id);

  begin
    perform 1
    from public.uploads
    where id = v_alert.upload_id
    for update nowait;

    if not found then
      raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
    end if;
  exception
    when lock_not_available then
      raise exception using
        errcode = '55P03',
        message = 'Otra revisión de esta jornada se está guardando. Espera un instante.';
  end;

  return public.resolve_alert(
    p_alert_id,
    p_expected_version,
    p_decision,
    p_resolved_value,
    p_client_mutation_id,
    p_note
  );
end;
$$;

revoke all on function public.resolve_alert_guarded(
  uuid, integer, public.decision_kind, text, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function public.resolve_alert_guarded(
  uuid, integer, public.decision_kind, text, uuid, text
) to authenticated, service_role;

notify pgrst, 'reload schema';
