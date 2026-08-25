begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(6);

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
    'task_invoice_ids as' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'la finalización preagrega facturas sin producto cartesiano'
);

select extensions.ok(
  position(
    'member_rows as' in
    pg_get_functiondef('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure)
  ) > 0,
  'la finalización preagrega registros relacionados por bloque'
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
