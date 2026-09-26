create table if not exists public.orthography_terms (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  word text not null,
  classification text not null check (classification in ('correct', 'incorrect')),
  replacement text,
  updated_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, word),
  constraint orthography_word_length check (length(word) between 1 and 80)
);

alter table public.orthography_terms enable row level security;

create policy orthography_terms_select_member on public.orthography_terms
  for select to authenticated
  using (workspace_id = any ((select private.current_member_workspace_ids())::uuid[]));

create policy orthography_terms_insert_leader on public.orthography_terms
  for insert to authenticated
  with check (workspace_id = any ((select private.current_leader_workspace_ids())::uuid[]) and updated_by = (select auth.uid()));

create policy orthography_terms_update_leader on public.orthography_terms
  for update to authenticated
  using (workspace_id = any ((select private.current_leader_workspace_ids())::uuid[]))
  with check (workspace_id = any ((select private.current_leader_workspace_ids())::uuid[]) and updated_by = (select auth.uid()));

create policy orthography_terms_delete_leader on public.orthography_terms
  for delete to authenticated
  using (workspace_id = any ((select private.current_leader_workspace_ids())::uuid[]));

grant select, insert, update, delete on public.orthography_terms to authenticated;
