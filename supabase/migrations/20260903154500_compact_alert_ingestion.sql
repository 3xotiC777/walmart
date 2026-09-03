-- Alert alternatives are now normalized in conflict_groups.observed_values
-- instead of repeated on every validation_alert. If an interrupted browser
-- resumes with the compact plan, both the old and new idempotent batch receipts
-- may coexist. Entity counts and manifest hashes remain the integrity source.
do $migration$
declare
  v_definition text;
  v_old text;
begin
  select pg_get_functiondef(
    'public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)'::regprocedure
  ) into v_definition;

  v_old := 'and v_batches = p_expected_batch_count';
  if strpos(v_definition, v_old) > 0 then
    v_definition := replace(v_definition, v_old, 'and v_batches >= p_expected_batch_count');
  elsif strpos(v_definition, 'and v_batches >= p_expected_batch_count') = 0 then
    raise exception 'No se encontró la comparación idempotente esperada de lotes.';
  end if;

  v_old := 'or v_batches <> p_expected_batch_count then';
  if strpos(v_definition, v_old) > 0 then
    v_definition := replace(v_definition, v_old, 'or v_batches < p_expected_batch_count then');
  elsif strpos(v_definition, 'or v_batches < p_expected_batch_count then') = 0 then
    raise exception 'No se encontró la validación esperada de lotes incompletos.';
  end if;

  execute v_definition;
end;
$migration$;

comment on function public.finalize_upload_ingestion(uuid, integer, integer, integer, integer, integer, text) is
  'Finaliza una ingesta íntegra y tolera recibos idempotentes adicionales producidos al reempaquetar una reanudación.';
