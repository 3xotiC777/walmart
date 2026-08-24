-- Conserva la modalidad de análisis para que carga, reanudación y exportación
-- vuelvan a ejecutar las reglas con la misma interpretación del archivo fuente.
alter table public.uploads
  add column has_barcode boolean not null default true;

-- El mismo archivo puede producir un resultado distinto según la modalidad.
-- Los reintentos siguen siendo únicos dentro de la misma combinación.
drop index public.uploads_workspace_panel_hash_active_uidx;
create unique index uploads_workspace_panel_hash_active_uidx
  on public.uploads (workspace_id, panel_sha256, has_barcode)
  where status not in ('failed', 'archived');

revoke all on function public.create_upload(
  uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb
) from public, anon, authenticated, service_role;

drop function public.create_upload(
  uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb
);

create function public.create_upload(
  p_upload_id uuid,
  p_workspace_id uuid,
  p_display_name text,
  p_panel_object_path text,
  p_panel_sha256_hex text,
  p_panel_size_bytes bigint,
  p_invoice_object_path text default null,
  p_invoice_sha256_hex text default null,
  p_invoice_size_bytes bigint default null,
  p_source_headers jsonb default '[]'::jsonb,
  p_has_barcode boolean default true
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_retention smallint;
  v_upload public.uploads%rowtype;
  v_prefix text := p_workspace_id::text || '/' || p_upload_id::text || '/';
begin
  perform private.assert_leader(p_workspace_id);
  if p_has_barcode is null then
    raise exception using errcode = '22023', message = 'Debe indicar si el estudio contiene código de barras.';
  end if;
  select retention_days into v_retention from public.workspaces where id = p_workspace_id;
  if p_panel_object_path not like v_prefix || 'panel/%' then
    raise exception using errcode = '22023', message = 'La ruta del panel no pertenece a la carga indicada.';
  end if;
  if p_invoice_object_path is not null
     and p_invoice_object_path not like v_prefix || 'invoices/%' then
    raise exception using errcode = '22023', message = 'La ruta de facturas no pertenece a la carga indicada.';
  end if;
  insert into public.uploads (
    id, workspace_id, display_name, status, panel_object_path,
    invoice_object_path, panel_sha256, invoice_sha256,
    panel_size_bytes, invoice_size_bytes, source_headers, has_barcode,
    created_by, delete_after
  ) values (
    p_upload_id, p_workspace_id, btrim(p_display_name), 'uploading', p_panel_object_path,
    p_invoice_object_path, private.decode_sha256(p_panel_sha256_hex),
    case when p_invoice_sha256_hex is null then null else private.decode_sha256(p_invoice_sha256_hex) end,
    p_panel_size_bytes, p_invoice_size_bytes, coalesce(p_source_headers, '[]'::jsonb), p_has_barcode,
    v_actor, now() + make_interval(days => v_retention)
  ) returning * into v_upload;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    p_workspace_id, p_upload_id, v_actor, 'upload.created', 'upload', p_upload_id::text,
    jsonb_build_object('has_barcode', p_has_barcode)
  );
  return v_upload;
end;
$$;

revoke all on function public.create_upload(
  uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb, boolean
) from public, anon, authenticated, service_role;

grant execute on function public.create_upload(
  uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb, boolean
) to authenticated, service_role;

comment on column public.uploads.has_barcode is
  'Modalidad inmutable de la jornada: true agrupa por código y descripción; false aplica reglas adaptadas por descripción.';

comment on function public.create_upload(
  uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb, boolean
) is 'Crea una carga privada y persiste la modalidad de código de barras usada por el motor local.';

notify pgrst, 'reload schema';
