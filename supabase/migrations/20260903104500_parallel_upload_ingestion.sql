-- Allow independent batches from one upload to run concurrently. A shared
-- upload lock coordinates all batches with finalization, while an exclusive
-- payload lock keeps retries idempotent without serializing unrelated data.
do $migration$
declare
  v_ingest_definition text;
  v_finalize_definition text;
  v_old text;
begin
  select pg_get_functiondef(
    'public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure
  ) into v_ingest_definition;

  v_old := E'  select u.workspace_id into v_workspace_id\n  from public.uploads u\n  where u.id = p_upload_id\n  for update;';
  if strpos(v_ingest_definition, v_old) = 0 then
    raise exception 'No se encontró el bloqueo global esperado en ingest_validation_batch.';
  end if;
  v_ingest_definition := replace(
    v_ingest_definition,
    v_old,
    E'  select u.workspace_id into v_workspace_id\n  from public.uploads u\n  where u.id = p_upload_id;'
  );

  v_old := E'  perform private.assert_leader(v_workspace_id);\n  if (select status from public.uploads where id = p_upload_id) not in (''uploading'', ''processing'') then';
  if strpos(v_ingest_definition, v_old) = 0 then
    raise exception 'No se encontró la validación de estado esperada en ingest_validation_batch.';
  end if;
  v_ingest_definition := replace(
    v_ingest_definition,
    v_old,
    E'  perform private.assert_leader(v_workspace_id);\n  perform pg_catalog.pg_advisory_xact_lock_shared(\n    pg_catalog.hashtextextended(''upload:'' || p_upload_id::text, 0)\n  );\n  if (select status from public.uploads where id = p_upload_id) not in (''uploading'', ''processing'') then'
  );

  v_old := E'  select b.payload_hash into v_existing_hash\n  from public.ingestion_batches b';
  if strpos(v_ingest_definition, v_old) = 0 then
    raise exception 'No se encontró el control idempotente esperado en ingest_validation_batch.';
  end if;
  v_ingest_definition := replace(
    v_ingest_definition,
    v_old,
    E'  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(\n      ''batch:'' || p_upload_id::text || '':'' || pg_catalog.encode(v_payload_hash, ''hex''),\n      0\n    )\n  );\n\n  select b.payload_hash into v_existing_hash\n  from public.ingestion_batches b'
  );

  v_old := E'  update public.uploads set status = ''processing'' where id = p_upload_id;\n\n';
  if strpos(v_ingest_definition, v_old) = 0 then
    raise exception 'No se encontró la escritura serializante esperada en ingest_validation_batch.';
  end if;
  v_ingest_definition := replace(v_ingest_definition, v_old, '');
  execute v_ingest_definition;

  select pg_get_functiondef(
    'public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure
  ) into v_finalize_definition;
  v_old := E'  perform private.assert_leader(v_workspace_id);';
  if strpos(v_finalize_definition, v_old) = 0 then
    raise exception 'No se encontró la autorización esperada en finalize_upload_ingestion.';
  end if;
  v_finalize_definition := replace(
    v_finalize_definition,
    v_old,
    E'  perform private.assert_leader(v_workspace_id);\n  perform pg_catalog.pg_advisory_xact_lock(\n    pg_catalog.hashtextextended(''upload:'' || p_upload_id::text, 0)\n  );'
  );
  execute v_finalize_definition;
end;
$migration$;

comment on function public.ingest_validation_batch(uuid, uuid, jsonb) is
  'Persiste lotes idempotentes en paralelo por jornada; coordina el cierre mediante advisory locks.';
