-- A client may lose the HTTP response after PostgreSQL commits. Returning the
-- already-finalized upload for the same manifest makes that retry truthful and
-- prevents a completed jornada from appearing as failed in the browser.
create or replace function public.finalize_upload_ingestion(
  p_upload_id uuid,
  p_source_total_rows integer,
  p_expected_stored_row_count integer,
  p_expected_task_count integer,
  p_expected_alert_count integer,
  p_expected_batch_count integer,
  p_manifest_hash_hex text
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_rows integer;
  v_tasks integer;
  v_alerts integer;
  v_batches integer;
  v_orthography integer;
  v_upload public.uploads%rowtype;
begin
  select u.* into v_upload
  from public.uploads u
  where u.id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  v_workspace_id := v_upload.workspace_id;
  perform private.assert_leader(v_workspace_id);

  select count(*)::integer into v_rows from public.source_rows where upload_id = p_upload_id;
  select count(*)::integer into v_tasks from public.review_tasks where upload_id = p_upload_id;
  select count(*)::integer into v_alerts from public.validation_alerts where upload_id = p_upload_id;
  select count(*)::integer into v_batches from public.ingestion_batches where upload_id = p_upload_id;
  select count(*)::integer into v_orthography
  from public.validation_alerts where upload_id = p_upload_id and category = 'orthography';

  if v_upload.ingestion_finalized_at is not null
     and v_upload.status in ('ready', 'assigning', 'active', 'completed') then
    if v_upload.total_rows = p_source_total_rows
       and v_rows = p_expected_stored_row_count
       and v_upload.task_count = p_expected_task_count
       and v_tasks = p_expected_task_count
       and v_upload.alert_count = p_expected_alert_count
       and v_alerts = p_expected_alert_count
       and v_batches = p_expected_batch_count
       and v_upload.manifest_hash = private.decode_sha256(p_manifest_hash_hex) then
      return v_upload;
    end if;
    raise exception using
      errcode = '55000',
      message = 'La carga ya fue finalizada con un manifiesto o conteos diferentes.';
  end if;

  if v_upload.status not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga no está en proceso de ingesta.';
  end if;
  if p_source_total_rows < v_rows or p_source_total_rows < 0 then
    raise exception using errcode = '22023', message = 'El total de filas fuente no puede ser menor que las filas persistidas.';
  end if;
  if v_rows <> p_expected_stored_row_count
     or v_tasks <> p_expected_task_count
     or v_alerts <> p_expected_alert_count
     or v_batches <> p_expected_batch_count then
    raise exception using
      errcode = '22000',
      message = format(
        'Conteos de ingesta incompletos. filas=%s/%s tareas=%s/%s alertas=%s/%s lotes=%s/%s',
        v_rows, p_expected_stored_row_count, v_tasks, p_expected_task_count,
        v_alerts, p_expected_alert_count, v_batches, p_expected_batch_count
      );
  end if;

  update public.review_tasks t
  set alert_count = x.alert_count
  from (
    select t2.id, count(a.id)::integer as alert_count
    from public.review_tasks t2
    left join public.validation_alerts a on a.task_id = t2.id
    where t2.upload_id = p_upload_id
    group by t2.id
  ) x
  where t.id = x.id;

  with alert_totals as (
    select t.assignment_block_id as block_id, count(a.id)::integer as alert_count
    from public.review_tasks t
    join public.validation_alerts a on a.task_id = t.id
    where t.upload_id = p_upload_id
    group by t.assignment_block_id
  ), member_rows as (
    select t.assignment_block_id as block_id, t.source_row_id
    from public.review_tasks t
    where t.upload_id = p_upload_id
    union
    select t.assignment_block_id as block_id, gm.source_row_id
    from public.review_tasks t
    join public.validation_alerts a on a.task_id = t.id
    join public.group_members gm on gm.group_id = a.group_id
    where t.upload_id = p_upload_id
  ), member_totals as (
    select block_id, count(*)::integer as member_count
    from member_rows
    group by block_id
  ), task_invoice_ids as (
    select t.assignment_block_id as block_id, il.id as invoice_id
    from public.review_tasks t
    join public.invoice_links il
      on il.upload_id = p_upload_id
     and il.source_row_id = t.source_row_id
    where t.upload_id = p_upload_id
    union
    select t.assignment_block_id as block_id, il.id as invoice_id
    from public.review_tasks t
    join public.source_rows sr on sr.id = t.source_row_id
    join public.invoice_links il
      on il.upload_id = p_upload_id
     and il.id_dn_w is not null
     and il.id_dn_w = sr.id_dn_w
    where t.upload_id = p_upload_id
      and sr.id_dn_w is not null
  ), invoice_totals as (
    select block_id, count(*)::integer as invoice_count
    from task_invoice_ids
    group by block_id
  ), totals as (
    select
      b.id as block_id,
      coalesce(a.alert_count, 0) as alert_count,
      coalesce(m.member_count, 0) as member_count,
      coalesce(i.invoice_count, 0) as invoice_count
    from public.assignment_blocks b
    left join alert_totals a on a.block_id = b.id
    left join member_totals m on m.block_id = b.id
    left join invoice_totals i on i.block_id = b.id
    where b.upload_id = p_upload_id
  )
  update public.assignment_blocks b
  set alert_count = x.alert_count,
      member_count = x.member_count,
      invoice_count = x.invoice_count,
      weight = greatest(x.alert_count, 1)::numeric
             + (x.member_count::numeric * 0.15)
             + (x.invoice_count::numeric * 0.10)
  from totals x
  where b.id = x.block_id;

  update public.uploads
  set status = 'ready',
      manifest_hash = private.decode_sha256(p_manifest_hash_hex),
      total_rows = p_source_total_rows,
      task_count = v_tasks,
      alert_count = v_alerts,
      orthography_count = v_orthography,
      pending_task_count = v_tasks,
      processing_error = null,
      finalized_by = (select auth.uid()),
      ingestion_finalized_at = now(),
      version = version + 1
  where id = p_upload_id
  returning * into v_upload;

  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_workspace_id, p_upload_id, (select auth.uid()), 'upload.ingestion_finalized',
    'upload', p_upload_id::text,
    jsonb_build_object(
      'source_total_rows', p_source_total_rows,
      'stored_rows', v_rows,
      'tasks', v_tasks,
      'alerts', v_alerts,
      'batches', v_batches
    )
  );
  return v_upload;
end;
$$;
