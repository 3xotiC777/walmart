-- Finalization used to rebuild task and block counters by joining every alert
-- with every related row. Large conflict groups could therefore create a
-- quadratic intermediate result and hit Supabase's statement timeout even
-- though every ingestion batch had already committed successfully.
--
-- The browser manifest already stores the authoritative counters on each task
-- and block. Finalization now validates their inexpensive totals against the
-- persisted alerts and only promotes the upload to ready. Source data, alerts,
-- relationships, assignments and validation rules are unchanged.

create index if not exists validation_alerts_upload_category_idx
  on public.validation_alerts (upload_id, category);

-- Identical source files may legitimately be used in different jornadas. The
-- application still resumes the newest unfinished upload with the same pair of
-- hashes, but a completed upload must not block a new jornada.
drop index if exists public.uploads_workspace_panel_hash_active_uidx;

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
  v_task_alerts integer;
  v_block_alerts integer;
  v_blocks integer;
  v_manifest_hash bytea;
  v_upload public.uploads%rowtype;
begin
  if p_source_total_rows < 0
     or p_expected_stored_row_count < 0
     or p_expected_task_count < 0
     or p_expected_alert_count < 0
     or p_expected_batch_count < 0 then
    raise exception using errcode = '22023', message = 'Los conteos esperados no pueden ser negativos.';
  end if;

  v_manifest_hash := private.decode_sha256(p_manifest_hash_hex);

  select u.* into v_upload
  from public.uploads u
  where u.id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  v_workspace_id := v_upload.workspace_id;
  perform private.assert_leader(v_workspace_id);

  select count(*)::integer
  into v_rows
  from public.source_rows
  where upload_id = p_upload_id;

  select count(*)::integer, coalesce(sum(alert_count), 0)::integer
  into v_tasks, v_task_alerts
  from public.review_tasks
  where upload_id = p_upload_id;

  select count(*)::integer,
         count(*) filter (where category = 'orthography')::integer
  into v_alerts, v_orthography
  from public.validation_alerts
  where upload_id = p_upload_id;

  select count(*)::integer
  into v_batches
  from public.ingestion_batches
  where upload_id = p_upload_id;

  select count(*)::integer, coalesce(sum(alert_count), 0)::integer
  into v_blocks, v_block_alerts
  from public.assignment_blocks
  where upload_id = p_upload_id;

  if v_upload.ingestion_finalized_at is not null
     and v_upload.status in ('ready', 'assigning', 'active', 'completed') then
    if v_upload.total_rows = p_source_total_rows
       and v_rows = p_expected_stored_row_count
       and v_upload.task_count = p_expected_task_count
       and v_tasks = p_expected_task_count
       and v_upload.alert_count = p_expected_alert_count
       and v_alerts = p_expected_alert_count
       and v_batches = p_expected_batch_count
       and v_upload.manifest_hash = v_manifest_hash then
      return v_upload;
    end if;
    raise exception using
      errcode = '55000',
      message = 'La carga ya fue finalizada con un manifiesto o conteos diferentes.';
  end if;

  if v_upload.status not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga no está en proceso de ingesta.';
  end if;
  if p_source_total_rows < v_rows then
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

  if v_task_alerts <> v_alerts then
    raise exception using
      errcode = '22000',
      message = format(
        'Los conteos de alertas por tarea no coinciden. tareas=%s alertas=%s',
        v_task_alerts, v_alerts
      );
  end if;

  if (v_tasks > 0 and v_blocks = 0) or v_block_alerts <> v_alerts then
    raise exception using
      errcode = '22000',
      message = format(
        'Los conteos de alertas por bloque no coinciden. bloques=%s alertas=%s/%s',
        v_blocks, v_block_alerts, v_alerts
      );
  end if;

  update public.uploads
  set status = 'ready',
      manifest_hash = v_manifest_hash,
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
