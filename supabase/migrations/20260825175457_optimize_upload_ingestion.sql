-- Keep every ingestion lookup on the indexed (upload_id, external_key) path.
-- The previous compatibility OR predicates forced PostgreSQL to scan thousands
-- of already-ingested groups/rows for every member in a JSON batch.
create or replace function public.ingest_validation_batch(
  p_upload_id uuid,
  p_batch_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_existing_hash bytea;
  v_existing_batch_key uuid;
  v_payload_hash bytea := extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256');
  v_row_count integer := jsonb_array_length(coalesce(p_payload -> 'rows', '[]'::jsonb));
  v_alert_count integer := jsonb_array_length(coalesce(p_payload -> 'alerts', '[]'::jsonb));
  v_member_count integer := jsonb_array_length(coalesce(p_payload -> 'group_members', '[]'::jsonb));
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'El lote debe ser un objeto JSON.';
  end if;
  if v_row_count > 1000 or v_alert_count > 10000 or v_member_count > 2000 then
    raise exception using errcode = '54000', message = 'El lote supera el límite permitido.';
  end if;

  select u.workspace_id into v_workspace_id
  from public.uploads u
  where u.id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga ya no acepta lotes de ingesta.';
  end if;

  select b.payload_hash into v_existing_hash
  from public.ingestion_batches b
  where b.upload_id = p_upload_id and b.batch_key = p_batch_key;
  if found then
    if v_existing_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'La clave del lote ya fue usada con contenido diferente.';
    end if;
    return jsonb_build_object(
      'already_processed', true,
      'rows', v_row_count,
      'alerts', v_alert_count
    );
  end if;

  select b.batch_key into v_existing_batch_key
  from public.ingestion_batches b
  where b.upload_id = p_upload_id and b.payload_hash = v_payload_hash;
  if found then
    return jsonb_build_object(
      'already_processed', true,
      'canonical_batch_key', v_existing_batch_key,
      'rows', v_row_count,
      'alerts', v_alert_count
    );
  end if;

  update public.uploads set status = 'processing' where id = p_upload_id;

  insert into public.source_rows (
    upload_id, workspace_id, external_key, excel_row, row_id, id_dn_w, barcode,
    description, field_values, source_fingerprint
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(r.external_key), ''), 'row-' || r.excel_row::text),
    r.excel_row, nullif(r.row_id, ''),
    nullif(r.id_dn_w, ''), nullif(r.barcode, ''), r.description,
    coalesce(r.field_values, '{}'::jsonb),
    case when r.source_fingerprint_hex is null then null
         else private.decode_sha256(r.source_fingerprint_hex) end
  from jsonb_to_recordset(coalesce(p_payload -> 'rows', '[]'::jsonb)) as r(
    external_key text,
    excel_row integer,
    row_id text,
    id_dn_w text,
    barcode text,
    description text,
    field_values jsonb,
    source_fingerprint_hex text
  )
  on conflict (upload_id, excel_row) do update
  set row_id = excluded.row_id,
      external_key = excluded.external_key,
      id_dn_w = excluded.id_dn_w,
      barcode = excluded.barcode,
      description = excluded.description,
      field_values = excluded.field_values,
      source_fingerprint = excluded.source_fingerprint;

  insert into public.conflict_groups (
    upload_id, workspace_id, external_key, rule_code, group_key, normalized_key,
    affected_field, observed_values, affected_row_count, alert_count
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(g.external_key), ''), g.rule_code || ':' || g.group_key),
    g.rule_code, g.group_key,
    g.normalized_key, g.affected_field,
    coalesce(g.observed_values, '[]'::jsonb),
    coalesce(g.affected_row_count, 0), coalesce(g.alert_count, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'groups', '[]'::jsonb)) as g(
    external_key text,
    rule_code text,
    group_key text,
    normalized_key text,
    affected_field text,
    observed_values jsonb,
    affected_row_count integer,
    alert_count integer
  )
  on conflict (upload_id, rule_code, group_key) do update
  set normalized_key = excluded.normalized_key,
      external_key = excluded.external_key,
      affected_field = excluded.affected_field,
      observed_values = excluded.observed_values,
      affected_row_count = excluded.affected_row_count,
      alert_count = excluded.alert_count;

  insert into public.group_members (
    group_id, upload_id, workspace_id, source_row_id, is_alert,
    is_related_context, observed_value, value_frequency
  )
  select
    g.id, p_upload_id, v_workspace_id, sr.id, coalesce(m.is_alert, false),
    coalesce(m.is_related_context, true), m.observed_value, m.value_frequency
  from jsonb_to_recordset(coalesce(p_payload -> 'group_members', '[]'::jsonb)) as m(
    group_external_key text,
    row_external_key text,
    rule_code text,
    group_key text,
    excel_row integer,
    is_alert boolean,
    is_related_context boolean,
    observed_value text,
    value_frequency integer
  )
  join public.conflict_groups g
    on g.upload_id = p_upload_id
   and g.external_key = coalesce(
     nullif(btrim(m.group_external_key), ''),
     m.rule_code || ':' || m.group_key
   )
  join public.source_rows sr
    on sr.upload_id = p_upload_id
   and sr.external_key = coalesce(
     nullif(btrim(m.row_external_key), ''),
     'row-' || m.excel_row::text
   )
  on conflict (group_id, source_row_id) do update
  set is_alert = excluded.is_alert,
      is_related_context = excluded.is_related_context,
      observed_value = excluded.observed_value,
      value_frequency = excluded.value_frequency;

  insert into public.assignment_blocks (
    upload_id, workspace_id, external_key, block_key, alert_count, member_count,
    invoice_count, weight, priority
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(b.external_key), ''), b.block_key),
    coalesce(nullif(b.block_key, ''), b.external_key),
    coalesce(b.alert_count, 0), coalesce(b.member_count, 0),
    coalesce(b.invoice_count, 0), coalesce(b.weight, 1),
    coalesce(b.priority, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'blocks', '[]'::jsonb)) as b(
    external_key text,
    block_key text,
    alert_count integer,
    member_count integer,
    invoice_count integer,
    weight numeric,
    priority smallint
  )
  on conflict (upload_id, block_key) do update
  set alert_count = excluded.alert_count,
      external_key = excluded.external_key,
      member_count = excluded.member_count,
      invoice_count = excluded.invoice_count,
      weight = excluded.weight,
      priority = excluded.priority;

  insert into public.review_tasks (
    upload_id, workspace_id, external_key, source_row_id, assignment_block_id,
    is_related_only, alert_count
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(t.external_key), ''), 'task-' || sr.excel_row::text),
    sr.id, b.id,
    coalesce(t.is_related_only, false), coalesce(t.alert_count, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'tasks', '[]'::jsonb)) as t(
    external_key text,
    row_external_key text,
    block_external_key text,
    excel_row integer,
    block_key text,
    is_related_only boolean,
    alert_count integer
  )
  join public.source_rows sr
    on sr.upload_id = p_upload_id
   and sr.external_key = coalesce(
     nullif(btrim(t.row_external_key), ''),
     'row-' || t.excel_row::text
   )
  join public.assignment_blocks b
    on b.upload_id = p_upload_id
   and b.external_key = coalesce(
     nullif(btrim(t.block_external_key), ''),
     nullif(btrim(t.block_key), '')
   )
  on conflict (upload_id, source_row_id) do update
  set assignment_block_id = excluded.assignment_block_id,
      external_key = excluded.external_key,
      is_related_only = excluded.is_related_only,
      alert_count = excluded.alert_count;

  insert into public.validation_alerts (
    upload_id, workspace_id, task_id, group_id, event_key, rule_code,
    category, affected_field, source_column_index, original_value,
    expected_or_conflicts, detail, severity, suggested_column_name,
    suggested_column_index, suggested_value, suggestion_method,
    suggestion_confidence, suggestion_evidence, suggestion_alternatives,
    can_auto_apply, evidence_fingerprint
  )
  select
    p_upload_id, v_workspace_id, t.id, g.id, a.event_key, a.rule_code,
    coalesce(nullif(a.category, ''), 'validation')::public.alert_category,
    a.affected_field, a.source_column_index, a.original_value,
    a.expected_or_conflicts, a.detail, coalesce(a.severity, 1),
    a.suggested_column_name, a.suggested_column_index, a.suggested_value,
    a.suggestion_method,
    coalesce(nullif(a.suggestion_confidence, ''), 'none')::public.suggestion_confidence,
    coalesce(a.suggestion_evidence, '{}'::jsonb),
    coalesce(a.suggestion_alternatives, '[]'::jsonb),
    coalesce(a.can_auto_apply, false),
    case when a.evidence_fingerprint_hex is null then null
         else private.decode_sha256(a.evidence_fingerprint_hex) end
  from jsonb_to_recordset(coalesce(p_payload -> 'alerts', '[]'::jsonb)) as a(
    event_key text,
    task_external_key text,
    group_external_key text,
    excel_row integer,
    rule_code text,
    group_key text,
    category text,
    affected_field text,
    source_column_index smallint,
    original_value text,
    expected_or_conflicts text,
    detail text,
    severity smallint,
    suggested_column_name text,
    suggested_column_index smallint,
    suggested_value text,
    suggestion_method text,
    suggestion_confidence text,
    suggestion_evidence jsonb,
    suggestion_alternatives jsonb,
    can_auto_apply boolean,
    evidence_fingerprint_hex text
  )
  join public.source_rows sr
    on sr.upload_id = p_upload_id and sr.excel_row = a.excel_row
  join public.review_tasks t
    on t.upload_id = p_upload_id
   and t.external_key = coalesce(
     nullif(btrim(a.task_external_key), ''),
     'task-' || a.excel_row::text
   )
  left join public.conflict_groups g
    on g.upload_id = p_upload_id
   and g.external_key = coalesce(
     nullif(btrim(a.group_external_key), ''),
     a.rule_code || ':' || a.group_key
   )
  on conflict (upload_id, event_key) do update
  set task_id = excluded.task_id,
      group_id = excluded.group_id,
      rule_code = excluded.rule_code,
      category = excluded.category,
      affected_field = excluded.affected_field,
      source_column_index = excluded.source_column_index,
      original_value = excluded.original_value,
      expected_or_conflicts = excluded.expected_or_conflicts,
      detail = excluded.detail,
      severity = excluded.severity,
      suggested_column_name = excluded.suggested_column_name,
      suggested_column_index = excluded.suggested_column_index,
      suggested_value = excluded.suggested_value,
      suggestion_method = excluded.suggestion_method,
      suggestion_confidence = excluded.suggestion_confidence,
      suggestion_evidence = excluded.suggestion_evidence,
      suggestion_alternatives = excluded.suggestion_alternatives,
      can_auto_apply = excluded.can_auto_apply,
      evidence_fingerprint = excluded.evidence_fingerprint;

  insert into public.invoice_links (
    upload_id, workspace_id, source_row_id, id_dn_w, ref_id_stg,
    external_url, storage_object_path, metadata
  )
  select
    p_upload_id, v_workspace_id, sr.id, i.id_dn_w, i.ref_id_stg,
    i.external_url, i.storage_object_path, coalesce(i.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_payload -> 'invoices', '[]'::jsonb)) as i(
    row_external_key text,
    excel_row integer,
    id_dn_w text,
    ref_id_stg text,
    external_url text,
    storage_object_path text,
    metadata jsonb
  )
  left join public.source_rows sr
    on sr.upload_id = p_upload_id
   and sr.external_key = coalesce(
     nullif(btrim(i.row_external_key), ''),
     case when i.excel_row is null then null else 'row-' || i.excel_row::text end
   )
  on conflict do nothing;

  insert into public.ingestion_batches (
    upload_id, workspace_id, batch_key, payload_hash, row_count, alert_count
  ) values (
    p_upload_id, v_workspace_id, p_batch_key, v_payload_hash, v_row_count, v_alert_count
  );
  return jsonb_build_object(
    'already_processed', false,
    'rows', v_row_count,
    'alerts', v_alert_count
  );
end;
$$;

-- Aggregate each block dimension separately. This avoids the former
-- alerts x related members x invoices Cartesian product during finalization.
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
  select u.workspace_id into v_workspace_id
  from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga no está en proceso de ingesta.';
  end if;

  select count(*)::integer into v_rows from public.source_rows where upload_id = p_upload_id;
  select count(*)::integer into v_tasks from public.review_tasks where upload_id = p_upload_id;
  select count(*)::integer into v_alerts from public.validation_alerts where upload_id = p_upload_id;
  select count(*)::integer into v_batches from public.ingestion_batches where upload_id = p_upload_id;
  select count(*)::integer into v_orthography
  from public.validation_alerts where upload_id = p_upload_id and category = 'orthography';

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
