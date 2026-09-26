-- La carga solo puede cambiar su snapshot mientras aún no se ingiere.
-- Permiso de columna: ninguna otra columna de uploads admite UPDATE directo.
create policy uploads_update_own_orthography_snapshot on public.uploads
  for update to authenticated
  using (
    created_by = (select auth.uid())
    and workspace_id = any ((select private.current_leader_workspace_ids())::uuid[])
    and status = 'uploading'
  )
  with check (
    created_by = (select auth.uid())
    and workspace_id = any ((select private.current_leader_workspace_ids())::uuid[])
    and status = 'uploading'
  );

grant update (orthography_lexicon) on public.uploads to authenticated;
create index orthography_terms_updated_by_idx on public.orthography_terms (updated_by);

drop function public.set_upload_orthography_lexicon(uuid, jsonb);
