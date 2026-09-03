-- Alert payloads contain comparatively large JSONB evidence. Authenticated
-- requests default to a short statement timeout, so give only this bounded RPC
-- enough time to finish while the client limits concurrent alert batches.
do $migration$
declare
  v_definition text;
  v_redundant_join text;
begin
  select pg_get_functiondef(
    'public.ingest_validation_batch(uuid,uuid,jsonb)'::regprocedure
  ) into v_definition;

  v_redundant_join := E'  join public.source_rows sr\n    on sr.upload_id = p_upload_id and sr.excel_row = a.excel_row\n';
  if strpos(v_definition, v_redundant_join) = 0 then
    raise exception 'No se encontró la búsqueda redundante esperada en validation_alerts.';
  end if;

  v_definition := replace(v_definition, v_redundant_join, '');
  execute v_definition;
end;
$migration$;

alter function public.ingest_validation_batch(uuid, uuid, jsonb)
  set statement_timeout = '60s';

comment on function public.ingest_validation_batch(uuid, uuid, jsonb) is
  'Persiste lotes idempotentes por jornada; los lotes JSONB pesados tienen un timeout acotado de 60 segundos.';
