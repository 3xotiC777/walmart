-- Aísla metadatos de equipo, archivos fuente y responsables por rol. También
-- permite guardar una sola identidad de factura sin duplicarla por cada fila.

create or replace function private.validate_block_assignee()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assigned_to is not null and not exists (
    select 1
    from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id and p.is_active
    where wm.workspace_id = new.workspace_id
      and wm.user_id = new.assigned_to
      and wm.role = 'validator'
      and wm.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'El responsable debe ser un validador activo del espacio de trabajo.';
  end if;
  return new;
end;
$$;

create or replace function private.can_read_storage_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.uploads u
    where u.workspace_id = private.safe_path_uuid(split_part(p_name, '/', 1))
      and u.id = private.safe_path_uuid(split_part(p_name, '/', 2))
      and u.workspace_id = any (private.current_leader_workspace_ids())
      and (
        p_name = u.panel_object_path
        or p_name = u.invoice_object_path
        or p_name like u.workspace_id::text || '/' || u.id::text || '/invoices/%'
      )
  )
$$;

create or replace function private.can_access_invoice_link(p_link_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.invoice_links il
    where il.id = p_link_id
      and (
        il.workspace_id = any (private.current_leader_workspace_ids())
        or (il.source_row_id is not null and private.can_access_source_row(il.source_row_id))
        or (
          il.id_dn_w is not null
          and exists (
            select 1
            from public.source_rows sr
            where sr.upload_id = il.upload_id
              and sr.id_dn_w = il.id_dn_w
              and private.can_access_source_row(sr.id)
          )
        )
      )
  )
$$;

revoke all on function private.can_access_invoice_link(bigint)
  from public, anon, authenticated, service_role;
grant execute on function private.can_access_invoice_link(bigint) to authenticated;

drop policy if exists workspace_members_select_workspace on public.workspace_members;
create policy workspace_members_select_self_or_leader
on public.workspace_members for select to authenticated
using (
  user_id = (select auth.uid())
  or workspace_id = any (private.current_leader_workspace_ids())
);

drop policy if exists invoice_links_select_authorized on public.invoice_links;
create policy invoice_links_select_authorized
on public.invoice_links for select to authenticated
using ((select private.can_access_invoice_link(id)));

notify pgrst, 'reload schema';

