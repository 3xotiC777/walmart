-- Mantiene el mismo contrato de conteo tanto al finalizar la ingesta como al
-- recalcular un bloque publicado. Las alertas sin conflict_group cuentan su
-- propia fila; las alertas con grupo cuentan todos sus miembros relacionados.

create or replace function private.enforce_assignment_member_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_upload_status public.upload_status;
begin
  select status into v_upload_status
  from public.uploads
  where id = new.upload_id;
  if v_upload_status not in ('active', 'completed') then
    return new;
  end if;
  new.member_count := (
    select count(distinct coalesce(member.source_row_id, task.source_row_id))::integer
    from public.validation_alerts alert
    join public.review_tasks task on task.id = alert.task_id
    left join public.group_members member on member.group_id = alert.group_id
    where task.assignment_block_id = new.id
  );
  return new;
end;
$$;

notify pgrst, 'reload schema';
