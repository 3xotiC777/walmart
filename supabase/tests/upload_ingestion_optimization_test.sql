begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(15);

select extensions.ok(
  position(
    'g.external_key = coalesce' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) > 0,
  'group_members resuelve grupos mediante la clave externa indexada'
);

select extensions.ok(
  position(
    'sr.external_key = coalesce' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) > 0,
  'group_members y tareas resuelven filas mediante la clave externa indexada'
);

select extensions.ok(
  position(
    'm.group_external_key is not null' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) = 0,
  'la ingesta ya no usa el OR que agotaba statement_timeout'
);

select extensions.ok(
  position(
    'for update' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) = 0,
  'la ingesta no bloquea globalmente la fila de la jornada'
);

select extensions.ok(
  position(
    'update public.uploads set status = ''processing''' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) = 0,
  'cada lote evita una escritura serializante sobre uploads'
);

select extensions.ok(
  position(
    'pg_advisory_xact_lock_shared' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) > 0,
  'los lotes usan un bloqueo compartido por jornada'
);

select extensions.ok(
  position(
    '''batch:''' in
    pg_get_functiondef('public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure)
  ) > 0,
  'los reintentos del mismo contenido conservan exclusión idempotente'
);

select extensions.ok(
  position(
    'pg_advisory_xact_lock' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'el cierre espera los lotes concurrentes antes de comprobar conteos'
);

select extensions.ok(
  position(
    'coalesce(sum(alert_count), 0)::integer' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'la finalización valida los contadores ya persistidos por tarea y bloque'
);

select extensions.ok(
  position(
    'member_rows as' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) = 0,
  'la finalización no multiplica alertas por registros relacionados'
);

select extensions.ok(
  position(
    'task_invoice_ids as' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) = 0,
  'la finalización no vuelve a cruzar tareas y facturas'
);

select extensions.ok(
  to_regclass('public.validation_alerts_upload_category_idx') is not null,
  'el conteo de ortografía tiene un índice por carga y categoría'
);

select extensions.ok(
  position(
    'v_task_alerts <> v_alerts' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0
  and position(
    'v_block_alerts <> v_alerts' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'la finalización conserva la validación de integridad de tareas y bloques'
);

select extensions.ok(
  to_regclass('public.uploads_workspace_panel_hash_active_uidx') is null,
  'una jornada terminada no bloquea otra carga de los mismos archivos'
);

select extensions.ok(
  position(
    'v_upload.ingestion_finalized_at is not null' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'un reintento devuelve la jornada ya finalizada cuando manifiesto y conteos coinciden'
);

select * from extensions.finish();
rollback;
