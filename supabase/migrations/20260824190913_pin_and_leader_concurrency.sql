-- El PIN se marca como cambiado exclusivamente desde el servidor y las
-- desactivaciones de líderes se serializan por workspace.

create or replace function public.mark_pin_changed_for_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.profiles
  set must_change_pin = false,
      failed_login_count = 0,
      login_window_started_at = null,
      locked_until = null
  where user_id = p_user_id and is_active;
  if not found then
    raise exception using errcode = '42501', message = 'La cuenta no está activa.';
  end if;
end;
$$;

revoke all on function public.mark_pin_changed() from public, anon, authenticated, service_role;
revoke all on function public.mark_pin_changed_for_user(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_pin_changed_for_user(uuid) to service_role;

create or replace function private.lock_last_leader_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'workspace_members' then
    if old.role = 'leader' and old.is_active
       and (tg_op = 'DELETE' or not new.is_active or new.role <> 'leader') then
      perform 1 from public.workspaces where id = old.workspace_id for update;
    end if;
  elsif tg_table_name = 'profiles' then
    if old.is_active and (tg_op = 'DELETE' or not new.is_active) then
      perform 1
      from public.workspaces w
      join public.workspace_members wm on wm.workspace_id = w.id
      where wm.user_id = old.user_id and wm.role = 'leader' and wm.is_active
      order by w.id
      for update of w;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists aa_workspace_members_lock_last_leader on public.workspace_members;
create trigger aa_workspace_members_lock_last_leader
before update of is_active, role or delete on public.workspace_members
for each row execute function private.lock_last_leader_transition();

drop trigger if exists aa_profiles_lock_last_leader on public.profiles;
create trigger aa_profiles_lock_last_leader
before update of is_active or delete on public.profiles
for each row execute function private.lock_last_leader_transition();

notify pgrst, 'reload schema';

