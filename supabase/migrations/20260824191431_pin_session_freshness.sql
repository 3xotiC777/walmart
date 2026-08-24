-- Una sesión emitida antes de un reset no puede escoger el nuevo PIN.

alter table public.profiles
  add column if not exists pin_reset_at timestamptz;

update public.profiles
set pin_reset_at = date_trunc('second', created_at)
where must_change_pin and pin_reset_at is null;

create or replace function private.manage_pin_reset_timestamp()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.must_change_pin then
    new.pin_reset_at := date_trunc('second', clock_timestamp());
  else
    new.pin_reset_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_manage_pin_reset_timestamp on public.profiles;
create trigger profiles_manage_pin_reset_timestamp
before insert or update of must_change_pin on public.profiles
for each row execute function private.manage_pin_reset_timestamp();

comment on column public.profiles.pin_reset_at is
  'Instante desde el cual se exige una sesión nueva creada con la clave temporal.';

notify pgrst, 'reload schema';

