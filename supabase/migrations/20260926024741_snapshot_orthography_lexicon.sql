alter table public.uploads
  add column if not exists orthography_lexicon jsonb not null
  default '{"correct": [], "incorrect": {}}'::jsonb;

create or replace function public.set_upload_orthography_lexicon(
  p_upload_id uuid,
  p_lexicon jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_lexicon is null
    or pg_catalog.jsonb_typeof(p_lexicon->'correct') <> 'array'
    or pg_catalog.jsonb_typeof(p_lexicon->'incorrect') <> 'object'
    or pg_catalog.octet_length(p_lexicon::text) > 200000
  then
    raise exception 'Vocabulario inválido o demasiado grande';
  end if;

  update public.uploads
  set orthography_lexicon = p_lexicon
  where id = p_upload_id
    and created_by = (select auth.uid())
    and workspace_id = any ((select private.current_leader_workspace_ids())::uuid[])
    and status = 'uploading';
  if not found then
    raise exception 'La jornada no puede guardar este vocabulario';
  end if;
end;
$$;

revoke all on function public.set_upload_orthography_lexicon(uuid, jsonb) from public;
grant execute on function public.set_upload_orthography_lexicon(uuid, jsonb) to authenticated;
