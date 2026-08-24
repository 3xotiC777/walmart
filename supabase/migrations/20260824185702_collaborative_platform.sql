-- Plataforma colaborativa PQM Walmart.
-- PostgreSQL 17 / Supabase. Los archivos originales viven en Storage privado;
-- Postgres conserva solo metadatos, contexto mínimo, alertas y deltas.

create extension if not exists citext with schema extensions;
create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- Evita que objetos futuros queden publicados accidentalmente en Data API.
alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

create type public.workspace_role as enum ('leader', 'validator');
create type public.upload_status as enum (
  'draft', 'uploading', 'processing', 'ready', 'assigning',
  'active', 'completed', 'failed', 'archived', 'deleting'
);
create type public.block_status as enum ('draft', 'published', 'in_progress', 'completed');
create type public.review_status as enum ('pending', 'in_progress', 'resolved', 'reopened');
create type public.alert_category as enum ('validation', 'orthography', 'structural', 'hierarchy');
create type public.suggestion_confidence as enum ('none', 'low', 'medium', 'high');
create type public.decision_kind as enum ('apply_suggestion', 'manual_edit', 'confirmed_correct');
create type public.resolution_source as enum ('suggestion', 'manual', 'related_record');

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (name = btrim(name) and char_length(name) between 2 and 120),
  slug extensions.citext not null unique
    check (slug::text ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  retention_days smallint not null default 90 check (retention_days between 1 and 3650),
  audit_retention_days smallint not null default 365 check (audit_retention_days between 30 and 3650),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username extensions.citext not null unique
    check (username::text ~ '^[A-Za-z0-9._-]{3,50}$'),
  auth_email extensions.citext not null unique
    check (auth_email::text = btrim(auth_email::text) and position('@' in auth_email::text) > 1),
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 2 and 120),
  is_active boolean not null default true,
  must_change_pin boolean not null default true,
  failed_login_count smallint not null default 0 check (failed_login_count between 0 and 5),
  login_window_started_at timestamptz,
  locked_until timestamptz,
  last_login_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (failed_login_count = 0 and login_window_started_at is null)
    or (failed_login_count > 0 and login_window_started_at is not null)
  )
);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  role public.workspace_role not null,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table private.bootstrap_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  workspace_name text not null check (workspace_name = btrim(workspace_name)),
  workspace_slug extensions.citext not null check (workspace_slug::text ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (used_at is null or used_by is not null)
);

create table public.uploads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  display_name text not null check (display_name = btrim(display_name) and char_length(display_name) between 1 and 255),
  status public.upload_status not null default 'draft',
  panel_object_path text not null check (panel_object_path !~ '(^|/)\.\.(/|$)'),
  invoice_object_path text check (invoice_object_path !~ '(^|/)\.\.(/|$)'),
  panel_sha256 bytea not null check (octet_length(panel_sha256) = 32),
  invoice_sha256 bytea check (invoice_sha256 is null or octet_length(invoice_sha256) = 32),
  panel_size_bytes bigint not null check (panel_size_bytes > 0 and panel_size_bytes <= 157286400),
  invoice_size_bytes bigint check (invoice_size_bytes is null or invoice_size_bytes between 1 and 157286400),
  source_sheet text not null default 'pqm consolidado',
  source_headers jsonb not null default '[]'::jsonb check (jsonb_typeof(source_headers) = 'array'),
  manifest_hash bytea check (manifest_hash is null or octet_length(manifest_hash) = 32),
  total_rows integer not null default 0 check (total_rows >= 0),
  task_count integer not null default 0 check (task_count >= 0),
  alert_count integer not null default 0 check (alert_count >= 0),
  orthography_count integer not null default 0 check (orthography_count >= 0),
  pending_task_count integer not null default 0 check (pending_task_count >= 0),
  corrected_cell_count integer not null default 0 check (corrected_cell_count >= 0),
  confirmed_correct_count integer not null default 0 check (confirmed_correct_count >= 0),
  processing_error text,
  created_by uuid not null references auth.users(id) on delete restrict,
  finalized_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ingestion_finalized_at timestamptz,
  assignments_published_at timestamptz,
  completed_at timestamptz,
  scrubbed_at timestamptz,
  delete_after timestamptz not null,
  version integer not null default 1 check (version > 0),
  unique (id, workspace_id),
  unique (panel_object_path),
  unique (invoice_object_path),
  check (invoice_object_path is not null or invoice_size_bytes is null),
  check (invoice_object_path is not null or invoice_sha256 is null)
);

create unique index uploads_workspace_panel_hash_active_uidx
  on public.uploads (workspace_id, panel_sha256)
  where status not in ('failed', 'archived');

create table public.ingestion_batches (
  upload_id uuid not null,
  workspace_id uuid not null,
  batch_key uuid not null,
  payload_hash bytea not null check (octet_length(payload_hash) = 32),
  row_count integer not null default 0 check (row_count >= 0),
  alert_count integer not null default 0 check (alert_count >= 0),
  processed_at timestamptz not null default now(),
  primary key (upload_id, batch_key),
  unique (upload_id, payload_hash),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

create table public.source_rows (
  id bigint generated by default as identity primary key,
  upload_id uuid not null,
  workspace_id uuid not null,
  external_key text not null check (external_key = btrim(external_key) and external_key <> ''),
  excel_row integer not null check (excel_row >= 2),
  row_id text,
  id_dn_w text,
  barcode text,
  description text,
  field_values jsonb not null default '{}'::jsonb check (jsonb_typeof(field_values) = 'object'),
  source_fingerprint bytea check (source_fingerprint is null or octet_length(source_fingerprint) = 32),
  created_at timestamptz not null default now(),
  unique (upload_id, excel_row),
  unique (upload_id, external_key),
  unique (id, upload_id, workspace_id),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

create table public.conflict_groups (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null,
  workspace_id uuid not null,
  external_key text not null check (external_key = btrim(external_key) and external_key <> ''),
  rule_code text not null check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9])|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$'),
  group_key text not null,
  normalized_key text,
  affected_field text,
  observed_values jsonb not null default '[]'::jsonb check (jsonb_typeof(observed_values) = 'array'),
  affected_row_count integer not null default 0 check (affected_row_count >= 0),
  alert_count integer not null default 0 check (alert_count >= 0 and alert_count <= affected_row_count),
  created_at timestamptz not null default now(),
  unique (upload_id, rule_code, group_key),
  unique (upload_id, external_key),
  unique (id, upload_id, workspace_id),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

create table public.group_members (
  group_id uuid not null,
  upload_id uuid not null,
  workspace_id uuid not null,
  source_row_id bigint not null,
  is_alert boolean not null default false,
  is_related_context boolean not null default true,
  observed_value text,
  value_frequency integer check (value_frequency is null or value_frequency > 0),
  created_at timestamptz not null default now(),
  primary key (group_id, source_row_id),
  foreign key (group_id, upload_id, workspace_id)
    references public.conflict_groups(id, upload_id, workspace_id) on delete cascade,
  foreign key (source_row_id, upload_id, workspace_id)
    references public.source_rows(id, upload_id, workspace_id) on delete cascade
);

create table public.assignment_blocks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null,
  workspace_id uuid not null,
  external_key text not null check (external_key = btrim(external_key) and external_key <> ''),
  block_key text not null,
  status public.block_status not null default 'draft',
  assigned_to uuid references public.profiles(user_id) on delete set null,
  alert_count integer not null default 0 check (alert_count >= 0),
  member_count integer not null default 0 check (member_count >= 0),
  invoice_count integer not null default 0 check (invoice_count >= 0),
  weight numeric(12,2) not null default 1 check (weight >= 0),
  priority smallint not null default 0 check (priority between -100 and 100),
  version integer not null default 1 check (version > 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (upload_id, block_key),
  unique (upload_id, external_key),
  unique (id, upload_id, workspace_id),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null,
  workspace_id uuid not null,
  external_key text not null check (external_key = btrim(external_key) and external_key <> ''),
  source_row_id bigint not null,
  assignment_block_id uuid not null,
  status public.review_status not null default 'pending',
  is_related_only boolean not null default false,
  alert_count integer not null default 0 check (alert_count >= 0),
  corrected_cell_count integer not null default 0 check (corrected_cell_count >= 0),
  confirmed_correct_count integer not null default 0 check (confirmed_correct_count >= 0),
  version integer not null default 1 check (version > 0),
  resolved_by uuid references public.profiles(user_id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (upload_id, source_row_id),
  unique (upload_id, external_key),
  unique (id, upload_id, workspace_id),
  foreign key (source_row_id, upload_id, workspace_id)
    references public.source_rows(id, upload_id, workspace_id) on delete cascade,
  foreign key (assignment_block_id, upload_id, workspace_id)
    references public.assignment_blocks(id, upload_id, workspace_id) on delete cascade,
  check ((status = 'resolved') = (resolved_at is not null))
);

create table public.validation_alerts (
  id uuid primary key default gen_random_uuid(),
  upload_id uuid not null,
  workspace_id uuid not null,
  task_id uuid not null,
  group_id uuid,
  event_key text not null,
  rule_code text not null check (rule_code ~ '^(R(0[1-9]|1[0-9]|2[0-9])|EST-0[1-3]|JER-0[1-4]|ORT-[A-Z0-9-]+)$'),
  category public.alert_category not null default 'validation',
  affected_field text,
  source_column_index smallint check (source_column_index is null or source_column_index >= 0),
  original_value text,
  expected_or_conflicts text,
  detail text not null,
  severity smallint not null default 1 check (severity between 1 and 5),
  suggested_column_name text,
  suggested_column_index smallint check (suggested_column_index is null or suggested_column_index >= 0),
  suggested_value text,
  suggestion_method text,
  suggestion_confidence public.suggestion_confidence not null default 'none',
  suggestion_evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(suggestion_evidence) = 'object'),
  suggestion_alternatives jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestion_alternatives) = 'array'),
  can_auto_apply boolean not null default false,
  evidence_fingerprint bytea check (evidence_fingerprint is null or octet_length(evidence_fingerprint) = 32),
  status public.review_status not null default 'pending',
  version integer not null default 1 check (version > 0),
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (upload_id, event_key),
  unique (id, upload_id, workspace_id),
  foreign key (task_id, upload_id, workspace_id)
    references public.review_tasks(id, upload_id, workspace_id) on delete cascade,
  foreign key (group_id, upload_id, workspace_id)
    references public.conflict_groups(id, upload_id, workspace_id) on delete set null,
  check (not can_auto_apply or (
    suggestion_confidence = 'high'
    and suggested_value is not null
    and suggested_column_index is not null
  )),
  check ((status = 'resolved') = (resolved_at is not null))
);

create table public.alert_decisions (
  id bigint generated by default as identity primary key,
  alert_id uuid not null,
  upload_id uuid not null,
  workspace_id uuid not null,
  decision public.decision_kind not null,
  column_index smallint check (column_index is null or column_index >= 0),
  field_name text,
  resolved_value text,
  note text,
  evidence_fingerprint bytea check (evidence_fingerprint is null or octet_length(evidence_fingerprint) = 32),
  decided_by uuid not null references public.profiles(user_id) on delete restrict,
  decided_at timestamptz not null default now(),
  superseded_at timestamptz,
  superseded_by uuid references public.profiles(user_id) on delete set null,
  superseded_reason text,
  supersede_mutation_id uuid unique,
  scrubbed_at timestamptz,
  client_mutation_id uuid not null unique,
  foreign key (alert_id, upload_id, workspace_id)
    references public.validation_alerts(id, upload_id, workspace_id) on delete cascade,
  check (
    (decision = 'confirmed_correct')
    or resolved_value is not null
    or scrubbed_at is not null
  ),
  check (
    (superseded_at is null and superseded_by is null)
    or (superseded_at is not null and superseded_by is not null)
  )
);

create table private.mutation_receipts (
  client_mutation_id uuid primary key,
  actor_user_id uuid not null references auth.users(id) on delete cascade,
  operation text not null,
  entity_id text not null,
  result jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index alert_decisions_one_current_uidx
  on public.alert_decisions (alert_id)
  where superseded_at is null;

create table public.cell_resolutions (
  id bigint generated by default as identity primary key,
  upload_id uuid not null,
  workspace_id uuid not null,
  source_row_id bigint not null,
  column_index smallint not null check (column_index >= 0),
  field_name text not null check (field_name = btrim(field_name) and field_name <> ''),
  original_value text,
  resolved_value text not null,
  source public.resolution_source not null,
  last_decision_id bigint references public.alert_decisions(id) on delete set null,
  created_by uuid not null references public.profiles(user_id) on delete restrict,
  updated_by uuid not null references public.profiles(user_id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1 check (version > 0),
  unique (upload_id, source_row_id, column_index),
  unique (id, upload_id, workspace_id),
  foreign key (source_row_id, upload_id, workspace_id)
    references public.source_rows(id, upload_id, workspace_id) on delete cascade
);

create table public.invoice_links (
  id bigint generated by default as identity primary key,
  upload_id uuid not null,
  workspace_id uuid not null,
  source_row_id bigint,
  id_dn_w text,
  ref_id_stg text,
  external_url text,
  storage_object_path text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  foreign key (source_row_id, upload_id, workspace_id)
    references public.source_rows(id, upload_id, workspace_id) on delete cascade,
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade,
  check (external_url is not null or storage_object_path is not null),
  check (external_url is null or external_url ~ '^https://'),
  check (storage_object_path is null or storage_object_path !~ '(^|/)\.\.(/|$)')
);

create unique index invoice_links_natural_uidx
  on public.invoice_links (
    upload_id,
    coalesce(source_row_id, 0::bigint),
    coalesce(ref_id_stg, ''),
    coalesce(external_url, ''),
    coalesce(storage_object_path, '')
  );

create table public.audit_events (
  id bigint generated by default as identity primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  upload_id uuid,
  actor_user_id uuid references public.profiles(user_id) on delete set null,
  event_type text not null check (event_type = btrim(event_type) and event_type <> ''),
  entity_type text not null check (entity_type = btrim(entity_type) and entity_type <> ''),
  entity_id text,
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

create table public.daily_productivity (
  workspace_id uuid not null,
  upload_id uuid not null,
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  activity_date date not null,
  tasks_resolved integer not null default 0 check (tasks_resolved >= 0),
  alerts_resolved integer not null default 0 check (alerts_resolved >= 0),
  cells_changed integer not null default 0 check (cells_changed >= 0),
  rows_corrected integer not null default 0 check (rows_corrected >= 0),
  confirmed_correct integer not null default 0 check (confirmed_correct >= 0),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, upload_id, user_id, activity_date),
  foreign key (upload_id, workspace_id)
    references public.uploads(id, workspace_id) on delete cascade
);

-- Índices para FKs, filtros de bandeja y predicados de RLS.
create index workspace_members_user_active_idx
  on public.workspace_members (user_id, workspace_id) where is_active;
create index workspace_members_workspace_role_active_idx
  on public.workspace_members (workspace_id, role, user_id) where is_active;
create index profiles_active_idx on public.profiles (user_id) where is_active;
create index uploads_workspace_status_created_idx
  on public.uploads (workspace_id, status, created_at desc);
create index uploads_delete_after_idx
  on public.uploads (delete_after) where status not in ('archived', 'deleting');
create index ingestion_batches_workspace_idx
  on public.ingestion_batches (workspace_id, upload_id);
create index source_rows_upload_row_id_idx
  on public.source_rows (upload_id, row_id) where row_id is not null;
create index source_rows_upload_id_dn_idx
  on public.source_rows (upload_id, id_dn_w) where id_dn_w is not null;
create index source_rows_upload_barcode_idx
  on public.source_rows (upload_id, barcode) where barcode is not null;
create index source_rows_workspace_upload_idx
  on public.source_rows (workspace_id, upload_id, excel_row);
create index conflict_groups_upload_rule_idx
  on public.conflict_groups (upload_id, rule_code, alert_count desc);
create index conflict_groups_workspace_idx
  on public.conflict_groups (workspace_id, upload_id);
create index group_members_source_row_idx
  on public.group_members (source_row_id, group_id);
create index group_members_upload_alert_idx
  on public.group_members (upload_id, is_alert, group_id);
create index assignment_blocks_upload_status_weight_idx
  on public.assignment_blocks (upload_id, status, priority desc, weight desc);
create index assignment_blocks_assignee_status_idx
  on public.assignment_blocks (assigned_to, status, upload_id) where assigned_to is not null;
create index assignment_blocks_workspace_assignee_idx
  on public.assignment_blocks (workspace_id, assigned_to, upload_id);
create index review_tasks_block_status_idx
  on public.review_tasks (assignment_block_id, status, id);
create index review_tasks_upload_status_idx
  on public.review_tasks (upload_id, status, id);
create index review_tasks_source_block_idx
  on public.review_tasks (source_row_id, assignment_block_id);
create index validation_alerts_task_status_idx
  on public.validation_alerts (task_id, status, severity desc, id);
create index validation_alerts_upload_rule_status_idx
  on public.validation_alerts (upload_id, rule_code, status, id);
create index validation_alerts_group_idx
  on public.validation_alerts (group_id, task_id) where group_id is not null;
create index validation_alerts_workspace_status_idx
  on public.validation_alerts (workspace_id, status, upload_id);
create index alert_decisions_upload_actor_date_idx
  on public.alert_decisions (upload_id, decided_by, decided_at desc)
  where superseded_at is null;
create index alert_decisions_workspace_idx
  on public.alert_decisions (workspace_id, upload_id);
create index cell_resolutions_upload_row_idx
  on public.cell_resolutions (upload_id, source_row_id, column_index);
create index cell_resolutions_actor_date_idx
  on public.cell_resolutions (updated_by, updated_at desc);
create index invoice_links_source_row_idx
  on public.invoice_links (source_row_id, upload_id) where source_row_id is not null;
create index invoice_links_upload_id_dn_idx
  on public.invoice_links (upload_id, id_dn_w) where id_dn_w is not null;
create index invoice_links_upload_ref_idx
  on public.invoice_links (upload_id, ref_id_stg) where ref_id_stg is not null;
create index audit_events_workspace_time_idx
  on public.audit_events (workspace_id, occurred_at desc, id desc);
create index audit_events_upload_time_idx
  on public.audit_events (upload_id, occurred_at desc, id desc) where upload_id is not null;
create index audit_events_actor_time_idx
  on public.audit_events (actor_user_id, occurred_at desc) where actor_user_id is not null;
create index daily_productivity_user_date_idx
  on public.daily_productivity (workspace_id, user_id, activity_date desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger workspace_members_set_updated_at
before update on public.workspace_members
for each row execute function private.set_updated_at();
create trigger uploads_set_updated_at
before update on public.uploads
for each row execute function private.set_updated_at();
create trigger assignment_blocks_set_updated_at
before update on public.assignment_blocks
for each row execute function private.set_updated_at();
create trigger review_tasks_set_updated_at
before update on public.review_tasks
for each row execute function private.set_updated_at();
create trigger validation_alerts_set_updated_at
before update on public.validation_alerts
for each row execute function private.set_updated_at();
create trigger cell_resolutions_set_updated_at
before update on public.cell_resolutions
for each row execute function private.set_updated_at();

create function private.protect_last_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role = 'leader' and old.is_active
     and (tg_op = 'DELETE' or new.role <> 'leader' or not new.is_active) then
    if not exists (
      select 1
      from public.workspace_members wm
      join public.profiles p on p.user_id = wm.user_id and p.is_active
      where wm.workspace_id = old.workspace_id
        and wm.role = 'leader'
        and wm.is_active
        and wm.user_id <> old.user_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'No se puede desactivar o eliminar al último líder activo.';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger workspace_members_protect_last_leader
before update of role, is_active or delete on public.workspace_members
for each row execute function private.protect_last_leader();

create function private.protect_last_leader_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.is_active and (tg_op = 'DELETE' or not new.is_active) and exists (
    select 1
    from public.workspace_members owned
    where owned.user_id = old.user_id
      and owned.role = 'leader'
      and owned.is_active
      and not exists (
        select 1
        from public.workspace_members other
        join public.profiles p on p.user_id = other.user_id and p.is_active
        where other.workspace_id = owned.workspace_id
          and other.role = 'leader'
          and other.is_active
          and other.user_id <> old.user_id
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'No se puede desactivar o eliminar el perfil del último líder activo.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger profiles_protect_last_leader
before update of is_active or delete on public.profiles
for each row execute function private.protect_last_leader_profile();

create function private.validate_block_assignee()
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
      and wm.is_active
  ) then
    raise exception using
      errcode = '23514',
      message = 'El responsable debe ser un miembro activo del espacio de trabajo.';
  end if;
  return new;
end;
$$;

create trigger assignment_blocks_validate_assignee
before insert or update of workspace_id, assigned_to on public.assignment_blocks
for each row execute function private.validate_block_assignee();

-- Helpers SECURITY DEFINER mínimos para evitar recursión de RLS. No reciben
-- decisiones de autorización desde metadatos editables del usuario.
create function private.current_member_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
  from public.workspace_members wm
  join public.profiles p on p.user_id = wm.user_id and p.is_active
  where wm.user_id = (select auth.uid()) and wm.is_active
$$;

create function private.current_account_ready()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.user_id = (select auth.uid())
      and p.is_active
      and not p.must_change_pin
      and (p.locked_until is null or p.locked_until <= now())
  )
$$;

create function private.current_leader_workspace_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(wm.workspace_id), '{}'::uuid[])
  from public.workspace_members wm
  join public.profiles p
    on p.user_id = wm.user_id
   and p.is_active
   and not p.must_change_pin
   and (p.locked_until is null or p.locked_until <= now())
  where wm.user_id = (select auth.uid())
    and wm.role = 'leader'
    and wm.is_active
$$;

create function private.current_assigned_upload_ids()
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct b.upload_id), '{}'::uuid[])
  from public.assignment_blocks b
  join public.workspace_members wm
    on wm.workspace_id = b.workspace_id
   and wm.user_id = (select auth.uid())
   and wm.is_active
  join public.profiles p
    on p.user_id = wm.user_id
   and p.is_active
   and not p.must_change_pin
   and (p.locked_until is null or p.locked_until <= now())
  where b.assigned_to = (select auth.uid())
    and b.status in ('published', 'in_progress', 'completed')
$$;

create function private.can_access_block(p_block_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.assignment_blocks b
    where b.id = p_block_id
      and (
        b.workspace_id = any (private.current_leader_workspace_ids())
        or (
          b.assigned_to = (select auth.uid())
          and b.status in ('published', 'in_progress', 'completed')
          and (select private.current_account_ready())
        )
      )
  )
$$;

create function private.can_access_source_row(p_source_row_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.source_rows sr
    where sr.id = p_source_row_id
      and (
        sr.workspace_id = any (private.current_leader_workspace_ids())
        or exists (
          select 1
          from public.review_tasks t
          join public.assignment_blocks b on b.id = t.assignment_block_id
          where t.source_row_id = sr.id
            and b.assigned_to = (select auth.uid())
            and b.status in ('published', 'in_progress', 'completed')
            and (select private.current_account_ready())
        )
        or exists (
          select 1
          from public.group_members gm
          join public.validation_alerts a on a.group_id = gm.group_id
          join public.review_tasks t on t.id = a.task_id
          join public.assignment_blocks b on b.id = t.assignment_block_id
          where gm.source_row_id = sr.id
            and b.assigned_to = (select auth.uid())
            and b.status in ('published', 'in_progress', 'completed')
            and (select private.current_account_ready())
        )
      )
  )
$$;

create function private.can_access_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conflict_groups g
    where g.id = p_group_id
      and (
        g.workspace_id = any (private.current_leader_workspace_ids())
        or exists (
          select 1
          from public.validation_alerts a
          join public.review_tasks t on t.id = a.task_id
          join public.assignment_blocks b on b.id = t.assignment_block_id
          where a.group_id = g.id
            and b.assigned_to = (select auth.uid())
            and b.status in ('published', 'in_progress', 'completed')
            and (select private.current_account_ready())
        )
      )
  )
$$;

create function private.assert_leader(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not (p_workspace_id = any (private.current_leader_workspace_ids())) then
    raise exception using errcode = '42501', message = 'Se requiere el rol de líder activo.';
  end if;
end;
$$;

create function private.assert_block_access(p_block_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not private.can_access_block(p_block_id) then
    raise exception using errcode = '42501', message = 'El bloque no está asignado a este usuario.';
  end if;
end;
$$;

create function private.decode_sha256(p_hex text)
returns bytea
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_hex is null or p_hex !~ '^[0-9A-Fa-f]{64}$' then
    raise exception using errcode = '22023', message = 'El hash SHA-256 debe contener 64 caracteres hexadecimales.';
  end if;
  return decode(lower(p_hex), 'hex');
end;
$$;

-- Emisión/consumo del token inicial. Solo se persiste SHA-256; la ruta de
-- servidor genera y entrega el secreto por un canal de un solo uso.
create function public.issue_bootstrap_token(
  p_token_hash_hex text,
  p_workspace_name text,
  p_workspace_slug text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_expires_at <= now() or p_expires_at > now() + interval '24 hours' then
    raise exception using errcode = '22023', message = 'El token debe vencer dentro de las próximas 24 horas.';
  end if;
  if exists (
    select 1 from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id and p.is_active
    where wm.role = 'leader' and wm.is_active
  ) then
    raise exception using errcode = '23514', message = 'La plataforma ya tiene un líder activo.';
  end if;
  insert into private.bootstrap_tokens (
    token_hash, workspace_name, workspace_slug, expires_at
  ) values (
    private.decode_sha256(p_token_hash_hex), btrim(p_workspace_name), lower(btrim(p_workspace_slug)), p_expires_at
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.claim_bootstrap_leader(
  p_token text,
  p_username text,
  p_display_name text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_email text;
  v_token private.bootstrap_tokens%rowtype;
  v_workspace_id uuid;
begin
  if v_actor is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesión autenticada.';
  end if;
  perform pg_advisory_xact_lock(hashtext('pqm:first-leader'));
  select * into v_token
  from private.bootstrap_tokens
  where token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  for update;
  if not found or v_token.used_at is not null or v_token.expires_at <= now() then
    raise exception using errcode = '22023', message = 'El enlace inicial es inválido, expiró o ya fue utilizado.';
  end if;
  if exists (
    select 1 from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id and p.is_active
    where wm.role = 'leader' and wm.is_active
  ) then
    raise exception using errcode = '23514', message = 'La plataforma ya tiene un líder activo.';
  end if;
  select u.email into v_email from auth.users u where u.id = v_actor;
  if v_email is null then
    raise exception using errcode = '23514', message = 'La cuenta autenticada no tiene email interno.';
  end if;

  insert into public.workspaces (name, slug, created_by)
  values (v_token.workspace_name, v_token.workspace_slug, v_actor)
  returning id into v_workspace_id;
  insert into public.profiles (
    user_id, username, auth_email, display_name, is_active,
    must_change_pin, created_by
  ) values (
    v_actor, lower(btrim(p_username)), lower(v_email), btrim(p_display_name),
    true, false, v_actor
  );
  insert into public.workspace_members (
    workspace_id, user_id, role, is_active, created_by
  ) values (v_workspace_id, v_actor, 'leader', true, v_actor);
  update private.bootstrap_tokens
  set used_at = now(), used_by = v_actor
  where id = v_token.id;
  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id
  ) values (
    v_workspace_id, v_actor, 'workspace.bootstrapped', 'workspace', v_workspace_id::text
  );
  return v_workspace_id;
end;
$$;

create function public.register_workspace_member(
  p_workspace_id uuid,
  p_user_id uuid,
  p_username text,
  p_auth_email text,
  p_display_name text,
  p_role public.workspace_role default 'validator'
)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_auth_email text;
  v_profile public.profiles%rowtype;
  v_member public.workspace_members%rowtype;
begin
  perform private.assert_leader(p_workspace_id);
  select lower(u.email) into v_auth_email from auth.users u where u.id = p_user_id;
  if v_auth_email is null or v_auth_email <> lower(btrim(p_auth_email)) then
    raise exception using errcode = '23514', message = 'El email interno no coincide con la cuenta Auth creada por el servidor.';
  end if;
  select * into v_profile from public.profiles where user_id = p_user_id;
  if found then
    if v_profile.username <> p_username::extensions.citext
       or v_profile.auth_email <> p_auth_email::extensions.citext then
      raise exception using errcode = '23505', message = 'La cuenta ya está asociada a otro usuario o email interno.';
    end if;
    update public.profiles
    set display_name = btrim(p_display_name), is_active = true
    where user_id = p_user_id;
  else
    insert into public.profiles (
      user_id, username, auth_email, display_name, created_by
    ) values (
      p_user_id, lower(btrim(p_username)), v_auth_email, btrim(p_display_name), v_actor
    );
  end if;
  insert into public.workspace_members (
    workspace_id, user_id, role, is_active, created_by
  ) values (
    p_workspace_id, p_user_id, p_role, true, v_actor
  )
  on conflict (workspace_id, user_id) do update
    set role = excluded.role, is_active = true
  returning * into v_member;
  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_workspace_id, v_actor, 'member.registered', 'profile', p_user_id::text,
    jsonb_build_object('role', p_role, 'username', lower(btrim(p_username)))
  );
  return v_member;
end;
$$;

create function public.set_workspace_member_active(
  p_workspace_id uuid,
  p_user_id uuid,
  p_is_active boolean
)
returns public.workspace_members
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_member public.workspace_members%rowtype;
begin
  perform private.assert_leader(p_workspace_id);
  update public.workspace_members
  set is_active = p_is_active
  where workspace_id = p_workspace_id and user_id = p_user_id
  returning * into v_member;
  if not found then
    raise exception using errcode = 'P0002', message = 'Miembro no encontrado.';
  end if;
  update public.profiles p
  set is_active = exists (
    select 1 from public.workspace_members wm
    where wm.user_id = p_user_id and wm.is_active
  )
  where p.user_id = p_user_id;
  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id, payload
  ) values (
    p_workspace_id, v_actor,
    case when p_is_active then 'member.activated' else 'member.deactivated' end,
    'profile', p_user_id::text, '{}'::jsonb
  );
  return v_member;
end;
$$;

create function public.reset_member_pin_state(p_workspace_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.assert_leader(p_workspace_id);
  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_workspace_id and user_id = p_user_id
  ) then
    raise exception using errcode = 'P0002', message = 'Miembro no encontrado.';
  end if;
  update public.profiles
  set must_change_pin = true,
      failed_login_count = 0,
      login_window_started_at = null,
      locked_until = null
  where user_id = p_user_id;
  insert into public.audit_events (
    workspace_id, actor_user_id, event_type, entity_type, entity_id
  ) values (
    p_workspace_id, (select auth.uid()), 'member.pin_reset_requested', 'profile', p_user_id::text
  );
end;
$$;

create function public.mark_pin_changed()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Se requiere una sesión autenticada.';
  end if;
  update public.profiles
  set must_change_pin = false,
      failed_login_count = 0,
      login_window_started_at = null,
      locked_until = null
  where user_id = (select auth.uid()) and is_active;
  if not found then
    raise exception using errcode = '42501', message = 'La cuenta no está activa.';
  end if;
end;
$$;

create function public.get_login_identity(p_username text)
returns table (
  user_id uuid,
  auth_email text,
  is_active boolean,
  must_change_pin boolean,
  is_locked boolean,
  locked_until timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, p.auth_email::text, p.is_active, p.must_change_pin,
         coalesce(p.locked_until > now(), false), p.locked_until
  from public.profiles p
  where p.username = lower(btrim(p_username))::extensions.citext
$$;

create function public.record_login_attempt(p_username text, p_succeeded boolean)
returns table (
  accepted boolean,
  failed_login_count smallint,
  locked_until timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile public.profiles%rowtype;
  v_now timestamptz := clock_timestamp();
  v_count smallint;
begin
  select * into v_profile
  from public.profiles
  where username = lower(btrim(p_username))::extensions.citext
  for update;
  if not found then
    -- Respuesta indistinguible para evitar enumeración de usuarios.
    return query select false, 0::smallint, null::timestamptz;
    return;
  end if;
  if not v_profile.is_active or (v_profile.locked_until is not null and v_profile.locked_until > v_now) then
    return query select false, v_profile.failed_login_count, v_profile.locked_until;
    return;
  end if;
  if p_succeeded then
    update public.profiles
    set failed_login_count = 0,
        login_window_started_at = null,
        locked_until = null,
        last_login_at = v_now
    where user_id = v_profile.user_id;
    return query select true, 0::smallint, null::timestamptz;
    return;
  end if;
  if v_profile.login_window_started_at is null
     or v_profile.login_window_started_at <= v_now - interval '15 minutes' then
    v_count := 1;
    update public.profiles
    set failed_login_count = v_count,
        login_window_started_at = v_now,
        locked_until = null
    where user_id = v_profile.user_id;
  else
    v_count := least(v_profile.failed_login_count + 1, 5);
    update public.profiles
    set failed_login_count = v_count,
        locked_until = case when v_count >= 5 then v_now + interval '30 minutes' else null end
    where user_id = v_profile.user_id;
  end if;
  select * into v_profile from public.profiles where user_id = v_profile.user_id;
  return query select false, v_profile.failed_login_count, v_profile.locked_until;
end;
$$;

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
  p_source_headers jsonb default '[]'::jsonb
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
    panel_size_bytes, invoice_size_bytes, source_headers,
    created_by, delete_after
  ) values (
    p_upload_id, p_workspace_id, btrim(p_display_name), 'uploading', p_panel_object_path,
    p_invoice_object_path, private.decode_sha256(p_panel_sha256_hex),
    case when p_invoice_sha256_hex is null then null else private.decode_sha256(p_invoice_sha256_hex) end,
    p_panel_size_bytes, p_invoice_size_bytes, coalesce(p_source_headers, '[]'::jsonb),
    v_actor, now() + make_interval(days => v_retention)
  ) returning * into v_upload;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id
  ) values (
    p_workspace_id, p_upload_id, v_actor, 'upload.created', 'upload', p_upload_id::text
  );
  return v_upload;
end;
$$;

create function public.ingest_validation_batch(
  p_upload_id uuid,
  p_batch_key uuid,
  p_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_existing_hash bytea;
  v_existing_batch_key uuid;
  v_payload_hash bytea := extensions.digest(convert_to(p_payload::text, 'UTF8'), 'sha256');
  v_row_count integer := jsonb_array_length(coalesce(p_payload -> 'rows', '[]'::jsonb));
  v_alert_count integer := jsonb_array_length(coalesce(p_payload -> 'alerts', '[]'::jsonb));
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception using errcode = '22023', message = 'El lote debe ser un objeto JSON.';
  end if;
  if v_row_count > 1000 or v_alert_count > 10000 then
    raise exception using errcode = '54000', message = 'El lote supera el límite de 1.000 filas o 10.000 alertas.';
  end if;
  select u.workspace_id into v_workspace_id
  from public.uploads u
  where u.id = p_upload_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga ya no acepta lotes de ingesta.';
  end if;

  select b.payload_hash into v_existing_hash
  from public.ingestion_batches b
  where b.upload_id = p_upload_id and b.batch_key = p_batch_key;
  if found then
    if v_existing_hash <> v_payload_hash then
      raise exception using errcode = '23505', message = 'La clave del lote ya fue usada con contenido diferente.';
    end if;
    return jsonb_build_object(
      'already_processed', true,
      'rows', v_row_count,
      'alerts', v_alert_count
    );
  end if;
  select b.batch_key into v_existing_batch_key
  from public.ingestion_batches b
  where b.upload_id = p_upload_id and b.payload_hash = v_payload_hash;
  if found then
    return jsonb_build_object(
      'already_processed', true,
      'canonical_batch_key', v_existing_batch_key,
      'rows', v_row_count,
      'alerts', v_alert_count
    );
  end if;

  update public.uploads set status = 'processing' where id = p_upload_id;

  insert into public.source_rows (
    upload_id, workspace_id, external_key, excel_row, row_id, id_dn_w, barcode,
    description, field_values, source_fingerprint
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(r.external_key), ''), 'row-' || r.excel_row::text),
    r.excel_row, nullif(r.row_id, ''),
    nullif(r.id_dn_w, ''), nullif(r.barcode, ''), r.description,
    coalesce(r.field_values, '{}'::jsonb),
    case when r.source_fingerprint_hex is null then null
         else private.decode_sha256(r.source_fingerprint_hex) end
  from jsonb_to_recordset(coalesce(p_payload -> 'rows', '[]'::jsonb)) as r(
    external_key text,
    excel_row integer,
    row_id text,
    id_dn_w text,
    barcode text,
    description text,
    field_values jsonb,
    source_fingerprint_hex text
  )
  on conflict (upload_id, excel_row) do update
  set row_id = excluded.row_id,
      external_key = excluded.external_key,
      id_dn_w = excluded.id_dn_w,
      barcode = excluded.barcode,
      description = excluded.description,
      field_values = excluded.field_values,
      source_fingerprint = excluded.source_fingerprint;

  insert into public.conflict_groups (
    upload_id, workspace_id, external_key, rule_code, group_key, normalized_key,
    affected_field, observed_values, affected_row_count, alert_count
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(g.external_key), ''), g.rule_code || ':' || g.group_key),
    g.rule_code, g.group_key,
    g.normalized_key, g.affected_field,
    coalesce(g.observed_values, '[]'::jsonb),
    coalesce(g.affected_row_count, 0), coalesce(g.alert_count, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'groups', '[]'::jsonb)) as g(
    external_key text,
    rule_code text,
    group_key text,
    normalized_key text,
    affected_field text,
    observed_values jsonb,
    affected_row_count integer,
    alert_count integer
  )
  on conflict (upload_id, rule_code, group_key) do update
  set normalized_key = excluded.normalized_key,
      external_key = excluded.external_key,
      affected_field = excluded.affected_field,
      observed_values = excluded.observed_values,
      affected_row_count = excluded.affected_row_count,
      alert_count = excluded.alert_count;

  insert into public.group_members (
    group_id, upload_id, workspace_id, source_row_id, is_alert,
    is_related_context, observed_value, value_frequency
  )
  select
    g.id, p_upload_id, v_workspace_id, sr.id, coalesce(m.is_alert, false),
    coalesce(m.is_related_context, true), m.observed_value, m.value_frequency
  from jsonb_to_recordset(coalesce(p_payload -> 'group_members', '[]'::jsonb)) as m(
    group_external_key text,
    row_external_key text,
    rule_code text,
    group_key text,
    excel_row integer,
    is_alert boolean,
    is_related_context boolean,
    observed_value text,
    value_frequency integer
  )
  join public.conflict_groups g
    on g.upload_id = p_upload_id
   and (
     (m.group_external_key is not null and g.external_key = m.group_external_key)
     or (m.group_external_key is null and g.rule_code = m.rule_code and g.group_key = m.group_key)
   )
  join public.source_rows sr
    on sr.upload_id = p_upload_id
   and (
     (m.row_external_key is not null and sr.external_key = m.row_external_key)
     or (m.row_external_key is null and sr.excel_row = m.excel_row)
   )
  on conflict (group_id, source_row_id) do update
  set is_alert = excluded.is_alert,
      is_related_context = excluded.is_related_context,
      observed_value = excluded.observed_value,
      value_frequency = excluded.value_frequency;

  insert into public.assignment_blocks (
    upload_id, workspace_id, external_key, block_key, alert_count, member_count,
    invoice_count, weight, priority
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(b.external_key), ''), b.block_key),
    coalesce(nullif(b.block_key, ''), b.external_key),
    coalesce(b.alert_count, 0), coalesce(b.member_count, 0),
    coalesce(b.invoice_count, 0), coalesce(b.weight, 1),
    coalesce(b.priority, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'blocks', '[]'::jsonb)) as b(
    external_key text,
    block_key text,
    alert_count integer,
    member_count integer,
    invoice_count integer,
    weight numeric,
    priority smallint
  )
  on conflict (upload_id, block_key) do update
  set alert_count = excluded.alert_count,
      external_key = excluded.external_key,
      member_count = excluded.member_count,
      invoice_count = excluded.invoice_count,
      weight = excluded.weight,
      priority = excluded.priority;

  insert into public.review_tasks (
    upload_id, workspace_id, external_key, source_row_id, assignment_block_id,
    is_related_only, alert_count
  )
  select
    p_upload_id, v_workspace_id,
    coalesce(nullif(btrim(t.external_key), ''), 'task-' || sr.excel_row::text),
    sr.id, b.id,
    coalesce(t.is_related_only, false), coalesce(t.alert_count, 0)
  from jsonb_to_recordset(coalesce(p_payload -> 'tasks', '[]'::jsonb)) as t(
    external_key text,
    row_external_key text,
    block_external_key text,
    excel_row integer,
    block_key text,
    is_related_only boolean,
    alert_count integer
  )
  join public.source_rows sr
    on sr.upload_id = p_upload_id
   and (
     (t.row_external_key is not null and sr.external_key = t.row_external_key)
     or (t.row_external_key is null and sr.excel_row = t.excel_row)
   )
  join public.assignment_blocks b
    on b.upload_id = p_upload_id
   and (
     (t.block_external_key is not null and b.external_key = t.block_external_key)
     or (t.block_external_key is null and b.block_key = t.block_key)
   )
  on conflict (upload_id, source_row_id) do update
  set assignment_block_id = excluded.assignment_block_id,
      external_key = excluded.external_key,
      is_related_only = excluded.is_related_only,
      alert_count = excluded.alert_count;

  insert into public.validation_alerts (
    upload_id, workspace_id, task_id, group_id, event_key, rule_code,
    category, affected_field, source_column_index, original_value,
    expected_or_conflicts, detail, severity, suggested_column_name,
    suggested_column_index, suggested_value, suggestion_method,
    suggestion_confidence, suggestion_evidence, suggestion_alternatives,
    can_auto_apply, evidence_fingerprint
  )
  select
    p_upload_id, v_workspace_id, t.id, g.id, a.event_key, a.rule_code,
    coalesce(nullif(a.category, ''), 'validation')::public.alert_category,
    a.affected_field, a.source_column_index, a.original_value,
    a.expected_or_conflicts, a.detail, coalesce(a.severity, 1),
    a.suggested_column_name, a.suggested_column_index, a.suggested_value,
    a.suggestion_method,
    coalesce(nullif(a.suggestion_confidence, ''), 'none')::public.suggestion_confidence,
    coalesce(a.suggestion_evidence, '{}'::jsonb),
    coalesce(a.suggestion_alternatives, '[]'::jsonb),
    coalesce(a.can_auto_apply, false),
    case when a.evidence_fingerprint_hex is null then null
         else private.decode_sha256(a.evidence_fingerprint_hex) end
  from jsonb_to_recordset(coalesce(p_payload -> 'alerts', '[]'::jsonb)) as a(
    event_key text,
    task_external_key text,
    group_external_key text,
    excel_row integer,
    rule_code text,
    group_key text,
    category text,
    affected_field text,
    source_column_index smallint,
    original_value text,
    expected_or_conflicts text,
    detail text,
    severity smallint,
    suggested_column_name text,
    suggested_column_index smallint,
    suggested_value text,
    suggestion_method text,
    suggestion_confidence text,
    suggestion_evidence jsonb,
    suggestion_alternatives jsonb,
    can_auto_apply boolean,
    evidence_fingerprint_hex text
  )
  join public.source_rows sr
    on sr.upload_id = p_upload_id and sr.excel_row = a.excel_row
  join public.review_tasks t
    on t.upload_id = p_upload_id
   and (
     (a.task_external_key is not null and t.external_key = a.task_external_key)
     or (a.task_external_key is null and t.source_row_id = sr.id)
   )
  left join public.conflict_groups g
    on g.upload_id = p_upload_id
   and (
     (a.group_external_key is not null and g.external_key = a.group_external_key)
     or (a.group_external_key is null and g.rule_code = a.rule_code and g.group_key = a.group_key)
   )
  on conflict (upload_id, event_key) do update
  set task_id = excluded.task_id,
      group_id = excluded.group_id,
      rule_code = excluded.rule_code,
      category = excluded.category,
      affected_field = excluded.affected_field,
      source_column_index = excluded.source_column_index,
      original_value = excluded.original_value,
      expected_or_conflicts = excluded.expected_or_conflicts,
      detail = excluded.detail,
      severity = excluded.severity,
      suggested_column_name = excluded.suggested_column_name,
      suggested_column_index = excluded.suggested_column_index,
      suggested_value = excluded.suggested_value,
      suggestion_method = excluded.suggestion_method,
      suggestion_confidence = excluded.suggestion_confidence,
      suggestion_evidence = excluded.suggestion_evidence,
      suggestion_alternatives = excluded.suggestion_alternatives,
      can_auto_apply = excluded.can_auto_apply,
      evidence_fingerprint = excluded.evidence_fingerprint;

  insert into public.invoice_links (
    upload_id, workspace_id, source_row_id, id_dn_w, ref_id_stg,
    external_url, storage_object_path, metadata
  )
  select
    p_upload_id, v_workspace_id, sr.id, i.id_dn_w, i.ref_id_stg,
    i.external_url, i.storage_object_path, coalesce(i.metadata, '{}'::jsonb)
  from jsonb_to_recordset(coalesce(p_payload -> 'invoices', '[]'::jsonb)) as i(
    row_external_key text,
    excel_row integer,
    id_dn_w text,
    ref_id_stg text,
    external_url text,
    storage_object_path text,
    metadata jsonb
  )
  left join public.source_rows sr
    on sr.upload_id = p_upload_id
   and (
     (i.row_external_key is not null and sr.external_key = i.row_external_key)
     or (i.row_external_key is null and sr.excel_row = i.excel_row)
   )
  on conflict do nothing;

  insert into public.ingestion_batches (
    upload_id, workspace_id, batch_key, payload_hash, row_count, alert_count
  ) values (
    p_upload_id, v_workspace_id, p_batch_key, v_payload_hash, v_row_count, v_alert_count
  );
  return jsonb_build_object(
    'already_processed', false,
    'rows', v_row_count,
    'alerts', v_alert_count
  );
end;
$$;

create function public.finalize_upload_ingestion(
  p_upload_id uuid,
  p_source_total_rows integer,
  p_expected_stored_row_count integer,
  p_expected_task_count integer,
  p_expected_alert_count integer,
  p_expected_batch_count integer,
  p_manifest_hash_hex text
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_rows integer;
  v_tasks integer;
  v_alerts integer;
  v_batches integer;
  v_orthography integer;
  v_upload public.uploads%rowtype;
begin
  select u.workspace_id into v_workspace_id
  from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('uploading', 'processing') then
    raise exception using errcode = '55000', message = 'La carga no está en proceso de ingesta.';
  end if;
  select count(*)::integer into v_rows from public.source_rows where upload_id = p_upload_id;
  select count(*)::integer into v_tasks from public.review_tasks where upload_id = p_upload_id;
  select count(*)::integer into v_alerts from public.validation_alerts where upload_id = p_upload_id;
  select count(*)::integer into v_batches from public.ingestion_batches where upload_id = p_upload_id;
  select count(*)::integer into v_orthography
  from public.validation_alerts where upload_id = p_upload_id and category = 'orthography';

  if p_source_total_rows < v_rows or p_source_total_rows < 0 then
    raise exception using errcode = '22023', message = 'El total de filas fuente no puede ser menor que las filas persistidas.';
  end if;
  if v_rows <> p_expected_stored_row_count
     or v_tasks <> p_expected_task_count
     or v_alerts <> p_expected_alert_count
     or v_batches <> p_expected_batch_count then
    raise exception using
      errcode = '22000',
      message = format(
        'Conteos de ingesta incompletos. filas=%s/%s tareas=%s/%s alertas=%s/%s lotes=%s/%s',
        v_rows, p_expected_stored_row_count, v_tasks, p_expected_task_count,
        v_alerts, p_expected_alert_count, v_batches, p_expected_batch_count
      );
  end if;

  update public.review_tasks t
  set alert_count = x.alert_count
  from (
    select t2.id, count(a.id)::integer as alert_count
    from public.review_tasks t2
    left join public.validation_alerts a on a.task_id = t2.id
    where t2.upload_id = p_upload_id
    group by t2.id
  ) x
  where t.id = x.id;

  update public.assignment_blocks b
  set alert_count = x.alert_count,
      member_count = x.member_count,
      invoice_count = x.invoice_count,
      weight = greatest(x.alert_count, 1)::numeric
             + (x.member_count::numeric * 0.15)
             + (x.invoice_count::numeric * 0.10)
  from (
    select b2.id,
           count(distinct a.id)::integer as alert_count,
           count(distinct coalesce(gm.source_row_id, t.source_row_id))::integer as member_count,
           count(distinct il.id)::integer as invoice_count
    from public.assignment_blocks b2
    left join public.review_tasks t on t.assignment_block_id = b2.id
    left join public.validation_alerts a on a.task_id = t.id
    left join public.group_members gm on gm.group_id = a.group_id
    left join public.source_rows sr on sr.id = t.source_row_id
    left join public.invoice_links il
      on il.upload_id = b2.upload_id
     and (il.source_row_id = t.source_row_id or (il.id_dn_w is not null and il.id_dn_w = sr.id_dn_w))
    where b2.upload_id = p_upload_id
    group by b2.id
  ) x
  where b.id = x.id;

  update public.uploads
  set status = 'ready',
      manifest_hash = private.decode_sha256(p_manifest_hash_hex),
      total_rows = p_source_total_rows,
      task_count = v_tasks,
      alert_count = v_alerts,
      orthography_count = v_orthography,
      pending_task_count = v_tasks,
      processing_error = null,
      finalized_by = (select auth.uid()),
      ingestion_finalized_at = now(),
      version = version + 1
  where id = p_upload_id
  returning * into v_upload;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_workspace_id, p_upload_id, (select auth.uid()), 'upload.ingestion_finalized',
    'upload', p_upload_id::text,
    jsonb_build_object(
      'source_total_rows', p_source_total_rows,
      'stored_rows', v_rows,
      'tasks', v_tasks,
      'alerts', v_alerts,
      'batches', v_batches
    )
  );
  return v_upload;
end;
$$;

create function public.propose_balanced_assignments(
  p_upload_id uuid,
  p_validator_ids uuid[] default null
)
returns table (
  block_id uuid,
  assignee_id uuid,
  cumulative_weight numeric
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_validators uuid[];
  v_loads jsonb := '{}'::jsonb;
  v_validator uuid;
  v_assignee uuid;
  v_block record;
  v_new_load numeric;
begin
  select u.workspace_id into v_workspace_id
  from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('ready', 'assigning') then
    raise exception using errcode = '55000', message = 'Solo se puede repartir una carga lista o en asignación.';
  end if;
  if p_validator_ids is null or cardinality(p_validator_ids) = 0 then
    select array_agg(wm.user_id order by wm.user_id) into v_validators
    from public.workspace_members wm
    join public.profiles p on p.user_id = wm.user_id and p.is_active
    where wm.workspace_id = v_workspace_id
      and wm.role = 'validator' and wm.is_active;
  else
    select array_agg(distinct candidate order by candidate) into v_validators
    from unnest(p_validator_ids) candidate
    join public.workspace_members wm
      on wm.workspace_id = v_workspace_id and wm.user_id = candidate and wm.is_active
    join public.profiles p on p.user_id = wm.user_id and p.is_active;
    if cardinality(v_validators) <> (select count(distinct x) from unnest(p_validator_ids) x) then
      raise exception using errcode = '22023', message = 'La lista contiene usuarios que no son miembros activos.';
    end if;
  end if;
  if coalesce(cardinality(v_validators), 0) = 0 then
    raise exception using errcode = '22023', message = 'No hay validadores activos para repartir la carga.';
  end if;
  foreach v_validator in array v_validators loop
    v_loads := jsonb_set(v_loads, array[v_validator::text], to_jsonb(0::numeric), true);
  end loop;
  for v_block in
    select b.id, b.weight
    from public.assignment_blocks b
    where b.upload_id = p_upload_id
    order by b.priority desc, b.weight desc, b.id
  loop
    select candidate into v_assignee
    from unnest(v_validators) candidate
    order by coalesce((v_loads ->> candidate::text)::numeric, 0), candidate
    limit 1;
    v_new_load := coalesce((v_loads ->> v_assignee::text)::numeric, 0) + v_block.weight;
    v_loads := jsonb_set(v_loads, array[v_assignee::text], to_jsonb(v_new_load), true);
    update public.assignment_blocks
    set assigned_to = v_assignee, status = 'draft', version = version + 1
    where id = v_block.id;
    block_id := v_block.id;
    assignee_id := v_assignee;
    cumulative_weight := v_new_load;
    return next;
  end loop;
  update public.uploads set status = 'assigning', version = version + 1 where id = p_upload_id;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_workspace_id, p_upload_id, (select auth.uid()), 'assignments.proposed',
    'upload', p_upload_id::text,
    jsonb_build_object('validator_ids', to_jsonb(v_validators), 'loads', v_loads)
  );
end;
$$;

create function public.publish_assignments(
  p_upload_id uuid,
  p_assignments jsonb default '[]'::jsonb
)
returns public.uploads
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_upload public.uploads%rowtype;
begin
  if p_assignments is null or jsonb_typeof(p_assignments) <> 'array' then
    raise exception using errcode = '22023', message = 'Las asignaciones deben ser un arreglo JSON.';
  end if;
  select u.workspace_id into v_workspace_id
  from public.uploads u where u.id = p_upload_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Carga no encontrada.';
  end if;
  perform private.assert_leader(v_workspace_id);
  if (select status from public.uploads where id = p_upload_id) not in ('ready', 'assigning') then
    raise exception using errcode = '55000', message = 'La carga no está pendiente de publicación.';
  end if;
  if (
    select count(*) <> count(distinct x.block_id)
    from jsonb_to_recordset(p_assignments) as x(block_id uuid, assigned_to uuid)
  ) then
    raise exception using errcode = '22023', message = 'Un bloque aparece más de una vez en las asignaciones.';
  end if;
  update public.assignment_blocks b
  set assigned_to = x.assigned_to, version = b.version + 1
  from jsonb_to_recordset(p_assignments) as x(block_id uuid, assigned_to uuid)
  where b.id = x.block_id and b.upload_id = p_upload_id;

  if exists (
    select 1
    from jsonb_to_recordset(p_assignments) as x(block_id uuid, assigned_to uuid)
    where not exists (
      select 1 from public.assignment_blocks b
      where b.id = x.block_id and b.upload_id = p_upload_id
    )
  ) then
    raise exception using errcode = '22023', message = 'Una asignación apunta a un bloque de otra carga.';
  end if;
  if exists (
    select 1 from public.assignment_blocks b
    where b.upload_id = p_upload_id and b.assigned_to is null
  ) then
    raise exception using errcode = '23514', message = 'Todos los bloques deben tener responsable antes de publicar.';
  end if;
  -- El trigger valida que cada responsable siga activo.
  update public.assignment_blocks
  set status = 'published', published_at = now(), version = version + 1
  where upload_id = p_upload_id;
  update public.uploads
  set status = case when exists (
        select 1 from public.assignment_blocks where upload_id = p_upload_id
      ) then 'active'::public.upload_status else 'completed'::public.upload_status end,
      assignments_published_at = now(),
      completed_at = case when exists (
        select 1 from public.assignment_blocks where upload_id = p_upload_id
      ) then null else now() end,
      version = version + 1
  where id = p_upload_id
  returning * into v_upload;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_workspace_id, p_upload_id, (select auth.uid()), 'assignments.published',
    'upload', p_upload_id::text,
    jsonb_build_object('block_count', (select count(*) from public.assignment_blocks where upload_id = p_upload_id))
  );
  return v_upload;
end;
$$;

create function private.refresh_productivity(
  p_workspace_id uuid,
  p_upload_id uuid,
  p_user_id uuid,
  p_activity_date date
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.daily_productivity (
    workspace_id, upload_id, user_id, activity_date, tasks_resolved,
    alerts_resolved, cells_changed, rows_corrected, confirmed_correct
  )
  select
    p_workspace_id,
    p_upload_id,
    p_user_id,
    p_activity_date,
    (
      select count(*)::integer from public.review_tasks t
      where t.upload_id = p_upload_id and t.resolved_by = p_user_id
        and (t.resolved_at at time zone 'America/Bogota')::date = p_activity_date
    ),
    (
      select count(*)::integer from public.alert_decisions d
      where d.upload_id = p_upload_id and d.decided_by = p_user_id
        and d.superseded_at is null
        and (d.decided_at at time zone 'America/Bogota')::date = p_activity_date
    ),
    (
      select count(*)::integer from public.cell_resolutions c
      where c.upload_id = p_upload_id and c.updated_by = p_user_id
        and c.resolved_value is distinct from c.original_value
        and (c.updated_at at time zone 'America/Bogota')::date = p_activity_date
    ),
    (
      select count(distinct c.source_row_id)::integer from public.cell_resolutions c
      where c.upload_id = p_upload_id and c.updated_by = p_user_id
        and c.resolved_value is distinct from c.original_value
        and (c.updated_at at time zone 'America/Bogota')::date = p_activity_date
    ),
    (
      select (
        (select count(*) from public.alert_decisions d
         where d.upload_id = p_upload_id and d.decided_by = p_user_id
           and d.decision = 'confirmed_correct' and d.superseded_at is null
           and (d.decided_at at time zone 'America/Bogota')::date = p_activity_date)
        +
        (select coalesce(sum(t.confirmed_correct_count), 0) from public.review_tasks t
         where t.upload_id = p_upload_id and t.resolved_by = p_user_id
           and t.is_related_only
           and (t.resolved_at at time zone 'America/Bogota')::date = p_activity_date)
      )::integer
    )
  on conflict (workspace_id, upload_id, user_id, activity_date) do update
  set tasks_resolved = excluded.tasks_resolved,
      alerts_resolved = excluded.alerts_resolved,
      cells_changed = excluded.cells_changed,
      rows_corrected = excluded.rows_corrected,
      confirmed_correct = excluded.confirmed_correct,
      updated_at = now();
end;
$$;

create function private.refresh_review_rollups(
  p_upload_id uuid,
  p_task_id uuid,
  p_block_id uuid,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
  v_alert_count integer;
  v_unresolved integer;
  v_any_resolved boolean;
begin
  select workspace_id into v_workspace_id from public.uploads where id = p_upload_id;
  select count(*)::integer,
         count(*) filter (where status <> 'resolved')::integer,
         coalesce(bool_or(status = 'resolved'), false)
  into v_alert_count, v_unresolved, v_any_resolved
  from public.validation_alerts
  where task_id = p_task_id;

  update public.review_tasks t
  set alert_count = v_alert_count,
      corrected_cell_count = (
        select count(*)::integer from public.cell_resolutions c
        where c.source_row_id = t.source_row_id
      ),
      confirmed_correct_count = (
        case when t.is_related_only then t.confirmed_correct_count else (
          select count(*)::integer
          from public.validation_alerts a
          join public.alert_decisions d
            on d.alert_id = a.id and d.superseded_at is null
          where a.task_id = t.id and d.decision = 'confirmed_correct'
        ) end
      ),
      status = case
        when v_alert_count > 0 and v_unresolved = 0 then 'resolved'::public.review_status
        when v_any_resolved then 'in_progress'::public.review_status
        when t.status = 'reopened' then 'reopened'::public.review_status
        else t.status
      end,
      resolved_by = case
        when t.is_related_only then t.resolved_by
        when v_alert_count > 0 and v_unresolved = 0 then p_actor
        else null
      end,
      resolved_at = case
        when t.is_related_only then t.resolved_at
        when v_alert_count > 0 and v_unresolved = 0 then coalesce(t.resolved_at, now())
        else null
      end,
      version = version + 1
  where t.id = p_task_id;

  update public.assignment_blocks b
  set status = case
        when not exists (
          select 1 from public.review_tasks t
          where t.assignment_block_id = b.id and t.status <> 'resolved'
        ) then 'completed'::public.block_status
        when exists (
          select 1 from public.review_tasks t
          where t.assignment_block_id = b.id and t.status in ('in_progress', 'reopened', 'resolved')
        ) then 'in_progress'::public.block_status
        else b.status
      end,
      version = version + 1
  where b.id = p_block_id;

  update public.uploads u
  set pending_task_count = (
        select count(*)::integer from public.review_tasks t
        where t.upload_id = u.id and t.status <> 'resolved'
      ),
      corrected_cell_count = (
        select count(*)::integer from public.cell_resolutions c
        where c.upload_id = u.id and c.resolved_value is distinct from c.original_value
      ),
      confirmed_correct_count = (
        select count(*)::integer from public.alert_decisions d
        where d.upload_id = u.id and d.superseded_at is null
          and d.decision = 'confirmed_correct'
      ),
      status = case
        when not exists (
          select 1 from public.review_tasks t
          where t.upload_id = u.id and t.status <> 'resolved'
        ) then 'completed'::public.upload_status
        when u.status = 'completed' then 'active'::public.upload_status
        else u.status
      end,
      completed_at = case
        when not exists (
          select 1 from public.review_tasks t
          where t.upload_id = u.id and t.status <> 'resolved'
        ) then coalesce(u.completed_at, now())
        else null
      end,
      version = version + 1
  where u.id = p_upload_id;

  perform private.refresh_productivity(
    v_workspace_id, p_upload_id, p_actor,
    (now() at time zone 'America/Bogota')::date
  );
end;
$$;

create function public.resolve_alert(
  p_alert_id uuid,
  p_expected_version integer,
  p_decision public.decision_kind,
  p_resolved_value text,
  p_client_mutation_id uuid,
  p_note text default null
)
returns public.validation_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_alert public.validation_alerts%rowtype;
  v_task public.review_tasks%rowtype;
  v_block public.assignment_blocks%rowtype;
  v_value text;
  v_source public.resolution_source;
  v_column_index smallint;
  v_field_name text;
  v_decision_id bigint;
  v_existing public.cell_resolutions%rowtype;
  v_existing_alert uuid;
begin
  select d.alert_id into v_existing_alert
  from public.alert_decisions d
  where d.client_mutation_id = p_client_mutation_id;
  if found then
    if v_existing_alert <> p_alert_id then
      raise exception using errcode = '23505', message = 'El identificador de mutación ya fue usado en otra alerta.';
    end if;
    select * into v_alert from public.validation_alerts where id = p_alert_id;
    return v_alert;
  end if;

  select a.* into v_alert from public.validation_alerts a where a.id = p_alert_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Alerta no encontrada.';
  end if;
  select * into v_task from public.review_tasks where id = v_alert.task_id for update;
  select * into v_block from public.assignment_blocks where id = v_task.assignment_block_id for update;
  perform private.assert_block_access(v_block.id);
  if v_alert.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'La alerta cambió; actualice la pantalla antes de guardar.';
  end if;
  if v_alert.status = 'resolved' or exists (
    select 1 from public.alert_decisions where alert_id = v_alert.id and superseded_at is null
  ) then
    raise exception using errcode = '55000', message = 'La alerta ya tiene una decisión vigente.';
  end if;
  perform 1 from public.uploads
  where id = v_alert.upload_id and status in ('active', 'completed')
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está publicada.';
  end if;

  if p_decision is null then
    raise exception using errcode = '22004', message = 'La decisión es obligatoria.';
  end if;
  case p_decision
    when 'apply_suggestion' then
      if not v_alert.can_auto_apply
         or v_alert.suggestion_confidence <> 'high'
         or v_alert.suggested_value is null then
        raise exception using errcode = '23514', message = 'Esta alerta no admite aplicación automática.';
      end if;
      v_value := v_alert.suggested_value;
      v_source := 'suggestion';
      v_column_index := v_alert.suggested_column_index;
      v_field_name := coalesce(v_alert.suggested_column_name, v_alert.affected_field);
    when 'manual_edit' then
      if p_resolved_value is null then
        raise exception using errcode = '22004', message = 'La edición manual requiere un valor, aunque sea vacío.';
      end if;
      v_value := p_resolved_value;
      v_source := 'manual';
      v_column_index := v_alert.source_column_index;
      v_field_name := v_alert.affected_field;
    when 'confirmed_correct' then
      v_value := v_alert.original_value;
      v_source := 'manual';
      v_column_index := v_alert.source_column_index;
      v_field_name := v_alert.affected_field;
  end case;

  if p_decision <> 'confirmed_correct' and v_column_index is null then
    raise exception using errcode = '23514', message = 'La alerta no identifica una columna editable.';
  end if;
  if v_column_index is not null then
    select * into v_existing
    from public.cell_resolutions c
    where c.upload_id = v_alert.upload_id
      and c.source_row_id = v_task.source_row_id
      and c.column_index = v_column_index
    for update;
    if found and v_existing.resolved_value is distinct from v_value then
      raise exception using
        errcode = '40001',
        message = 'Otra decisión ya propuso un valor diferente para la misma celda.';
    end if;
  end if;

  insert into public.alert_decisions (
    alert_id, upload_id, workspace_id, decision, column_index, field_name,
    resolved_value, note,
    evidence_fingerprint, decided_by, client_mutation_id
  ) values (
    v_alert.id, v_alert.upload_id, v_alert.workspace_id, p_decision,
    v_column_index, v_field_name,
    v_value, nullif(btrim(p_note), ''), v_alert.evidence_fingerprint,
    v_actor, p_client_mutation_id
  ) returning id into v_decision_id;

  if v_column_index is not null
     and v_value is distinct from v_alert.original_value then
    insert into public.cell_resolutions (
      upload_id, workspace_id, source_row_id, column_index, field_name,
      original_value, resolved_value, source, last_decision_id,
      created_by, updated_by
    ) values (
      v_alert.upload_id, v_alert.workspace_id, v_task.source_row_id,
      v_column_index,
      coalesce(v_field_name, 'Columna ' || v_column_index::text),
      v_alert.original_value, v_value, v_source, v_decision_id, v_actor, v_actor
    )
    on conflict (upload_id, source_row_id, column_index) do update
    set last_decision_id = excluded.last_decision_id,
        updated_by = excluded.updated_by,
        version = public.cell_resolutions.version + 1
    where public.cell_resolutions.resolved_value is not distinct from excluded.resolved_value;
  end if;

  update public.validation_alerts
  set status = 'resolved', resolved_at = now(), version = version + 1
  where id = v_alert.id
  returning * into v_alert;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_alert.workspace_id, v_alert.upload_id, v_actor, 'alert.resolved',
    'alert', v_alert.id::text,
    jsonb_build_object(
      'decision', p_decision,
      'rule_code', v_alert.rule_code,
      'column_index', v_column_index,
      'changed', v_value is distinct from v_alert.original_value
    )
  );
  perform private.refresh_review_rollups(v_alert.upload_id, v_task.id, v_block.id, v_actor);
  return v_alert;
end;
$$;

create function public.reopen_alert(
  p_alert_id uuid,
  p_expected_version integer,
  p_reason text,
  p_client_mutation_id uuid
)
returns public.validation_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_alert public.validation_alerts%rowtype;
  v_task public.review_tasks%rowtype;
  v_block public.assignment_blocks%rowtype;
  v_decision public.alert_decisions%rowtype;
  v_other public.alert_decisions%rowtype;
  v_decision_date date;
begin
  select a.* into v_alert from public.validation_alerts a where a.id = p_alert_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Alerta no encontrada.';
  end if;
  select d.* into v_decision
  from public.alert_decisions d
  where d.alert_id = p_alert_id and d.superseded_at is null
  for update;
  if not found then
    if exists (
      select 1 from public.alert_decisions
      where alert_id = p_alert_id and supersede_mutation_id = p_client_mutation_id
    ) then
      return v_alert;
    end if;
    raise exception using errcode = '55000', message = 'La alerta no tiene una decisión vigente.';
  end if;
  select * into v_task from public.review_tasks where id = v_alert.task_id for update;
  select * into v_block from public.assignment_blocks where id = v_task.assignment_block_id for update;
  perform private.assert_block_access(v_block.id);
  perform 1 from public.uploads
  where id = v_alert.upload_id and status in ('active', 'completed')
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está publicada.';
  end if;
  if v_alert.version <> p_expected_version then
    raise exception using errcode = '40001', message = 'La alerta cambió; actualice la pantalla antes de reabrir.';
  end if;
  if nullif(btrim(p_reason), '') is null then
    raise exception using errcode = '22023', message = 'La reapertura requiere un motivo.';
  end if;
  v_decision_date := (v_decision.decided_at at time zone 'America/Bogota')::date;
  update public.alert_decisions
  set superseded_at = now(), superseded_by = v_actor,
      superseded_reason = btrim(p_reason), supersede_mutation_id = p_client_mutation_id
  where id = v_decision.id;

  if v_decision.column_index is not null and exists (
    select 1 from public.cell_resolutions c
    where c.upload_id = v_alert.upload_id
      and c.source_row_id = v_task.source_row_id
      and c.column_index = v_decision.column_index
      and c.last_decision_id = v_decision.id
  ) then
    select d.* into v_other
    from public.alert_decisions d
    join public.validation_alerts a on a.id = d.alert_id
    join public.review_tasks t on t.id = a.task_id
    where d.upload_id = v_alert.upload_id
      and d.superseded_at is null
      and d.decision in ('apply_suggestion', 'manual_edit')
      and t.source_row_id = v_task.source_row_id
      and d.column_index = v_decision.column_index
      and d.resolved_value is distinct from a.original_value
    order by d.decided_at desc, d.id desc
    limit 1;
    if found then
      update public.cell_resolutions
      set resolved_value = v_other.resolved_value,
          last_decision_id = v_other.id,
          updated_by = v_actor,
          version = version + 1
      where upload_id = v_alert.upload_id
        and source_row_id = v_task.source_row_id
        and column_index = v_decision.column_index;
    else
      delete from public.cell_resolutions
      where upload_id = v_alert.upload_id
        and source_row_id = v_task.source_row_id
        and column_index = v_decision.column_index
        and last_decision_id = v_decision.id;
    end if;
  end if;

  update public.validation_alerts
  set status = 'reopened', resolved_at = null, version = version + 1
  where id = p_alert_id
  returning * into v_alert;
  update public.review_tasks
  set status = 'reopened', resolved_by = null, resolved_at = null, version = version + 1
  where id = v_task.id;
  update public.assignment_blocks
  set status = 'in_progress', version = version + 1 where id = v_block.id;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_alert.workspace_id, v_alert.upload_id, v_actor, 'alert.reopened',
    'alert', v_alert.id::text,
    jsonb_build_object('reason', btrim(p_reason), 'rule_code', v_alert.rule_code)
  );
  perform private.refresh_review_rollups(v_alert.upload_id, v_task.id, v_block.id, v_actor);
  perform private.refresh_productivity(
    v_alert.workspace_id, v_alert.upload_id, v_decision.decided_by, v_decision_date
  );
  return v_alert;
end;
$$;

create function public.add_related_row_to_block(
  p_block_id uuid,
  p_source_row_id bigint,
  p_expected_block_version integer
)
returns public.review_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_block public.assignment_blocks%rowtype;
  v_row public.source_rows%rowtype;
  v_task public.review_tasks%rowtype;
begin
  select * into v_block from public.assignment_blocks where id = p_block_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Bloque no encontrado.';
  end if;
  perform private.assert_block_access(v_block.id);
  perform 1 from public.uploads
  where id = v_block.upload_id and status in ('active', 'completed')
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está publicada.';
  end if;
  if v_block.version <> p_expected_block_version then
    raise exception using errcode = '40001', message = 'El bloque cambió; actualice la pantalla.';
  end if;
  select * into v_row
  from public.source_rows
  where id = p_source_row_id and upload_id = v_block.upload_id
  for update;
  if not found then
    raise exception using errcode = '22023', message = 'El registro relacionado no pertenece a esta carga.';
  end if;
  select * into v_task
  from public.review_tasks
  where upload_id = v_block.upload_id and source_row_id = v_row.id;
  if found then
    if v_task.assignment_block_id <> v_block.id then
      raise exception using errcode = '23505', message = 'El registro ya pertenece a otro bloque; un líder debe mover o fusionar el bloque.';
    end if;
    return v_task;
  end if;
  insert into public.review_tasks (
    upload_id, workspace_id, external_key, source_row_id,
    assignment_block_id, status, is_related_only
  ) values (
    v_block.upload_id, v_block.workspace_id,
    'related-' || v_block.external_key || '-' || v_row.external_key,
    v_row.id, v_block.id, 'pending', true
  ) returning * into v_task;
  update public.assignment_blocks
  set member_count = member_count + 1,
      weight = weight + 0.15,
      status = case when status = 'completed' then 'in_progress'::public.block_status else status end,
      version = version + 1
  where id = v_block.id;
  update public.uploads
  set task_count = task_count + 1,
      pending_task_count = pending_task_count + 1,
      status = case when status = 'completed' then 'active'::public.upload_status else status end,
      completed_at = null,
      version = version + 1
  where id = v_block.upload_id;
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_block.workspace_id, v_block.upload_id, v_actor, 'related_row.added',
    'review_task', v_task.id::text,
    jsonb_build_object('block_id', v_block.id, 'source_row_id', v_row.id)
  );
  return v_task;
end;
$$;

create function public.save_related_cell_resolution(
  p_task_id uuid,
  p_column_index smallint,
  p_field_name text,
  p_original_value text,
  p_resolved_value text,
  p_expected_task_version integer,
  p_client_mutation_id uuid
)
returns public.cell_resolutions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.review_tasks%rowtype;
  v_block public.assignment_blocks%rowtype;
  v_resolution public.cell_resolutions%rowtype;
  v_receipt jsonb;
  v_receipt_operation text;
  v_receipt_entity text;
begin
  select result, operation, entity_id
  into v_receipt, v_receipt_operation, v_receipt_entity
  from private.mutation_receipts
  where client_mutation_id = p_client_mutation_id and actor_user_id = v_actor;
  if found then
    if v_receipt_operation <> 'related_cell.save' or v_receipt_entity <> p_task_id::text then
      raise exception using errcode = '23505', message = 'El identificador de mutación ya fue usado en otra operación.';
    end if;
    select * into v_resolution from public.cell_resolutions
    where id = (v_receipt ->> 'resolution_id')::bigint;
    return v_resolution;
  end if;
  select * into v_task from public.review_tasks where id = p_task_id for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado editable.';
  end if;
  select * into v_block from public.assignment_blocks where id = v_task.assignment_block_id for update;
  perform private.assert_block_access(v_block.id);
  perform 1 from public.uploads
  where id = v_task.upload_id and status in ('active', 'completed')
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está publicada.';
  end if;
  if v_task.version <> p_expected_task_version then
    raise exception using errcode = '40001', message = 'El registro cambió; actualice la pantalla.';
  end if;
  if p_column_index < 0 or nullif(btrim(p_field_name), '') is null or p_resolved_value is null then
    raise exception using errcode = '22023', message = 'Columna, nombre y valor corregido son obligatorios.';
  end if;
  insert into public.cell_resolutions (
    upload_id, workspace_id, source_row_id, column_index, field_name,
    original_value, resolved_value, source, created_by, updated_by
  ) values (
    v_task.upload_id, v_task.workspace_id, v_task.source_row_id,
    p_column_index, btrim(p_field_name), p_original_value,
    p_resolved_value, 'related_record', v_actor, v_actor
  )
  on conflict (upload_id, source_row_id, column_index) do update
  set field_name = excluded.field_name,
      original_value = excluded.original_value,
      resolved_value = excluded.resolved_value,
      source = 'related_record',
      last_decision_id = null,
      updated_by = excluded.updated_by,
      version = public.cell_resolutions.version + 1
  returning * into v_resolution;
  update public.review_tasks
  set status = 'resolved', corrected_cell_count = 1,
      resolved_by = v_actor, resolved_at = now(), version = version + 1
  where id = v_task.id;
  insert into private.mutation_receipts (
    client_mutation_id, actor_user_id, operation, entity_id, result
  ) values (
    p_client_mutation_id, v_actor, 'related_cell.save', v_task.id::text,
    jsonb_build_object('resolution_id', v_resolution.id)
  );
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_task.workspace_id, v_task.upload_id, v_actor, 'related_cell.corrected',
    'cell_resolution', v_resolution.id::text,
    jsonb_build_object('task_id', v_task.id, 'column_index', p_column_index, 'field_name', btrim(p_field_name))
  );
  perform private.refresh_review_rollups(v_task.upload_id, v_task.id, v_block.id, v_actor);
  select * into v_resolution from public.cell_resolutions where id = v_resolution.id;
  return v_resolution;
end;
$$;

create function public.confirm_related_task(
  p_task_id uuid,
  p_expected_task_version integer,
  p_client_mutation_id uuid
)
returns public.review_tasks
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_task public.review_tasks%rowtype;
  v_block public.assignment_blocks%rowtype;
begin
  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
      and actor_user_id = v_actor
      and operation = 'related_task.confirm'
      and entity_id = p_task_id::text
  ) then
    select * into v_task from public.review_tasks where id = p_task_id;
    return v_task;
  end if;
  if exists (
    select 1 from private.mutation_receipts
    where client_mutation_id = p_client_mutation_id
  ) then
    raise exception using errcode = '23505', message = 'El identificador de mutación ya fue usado en otra operación.';
  end if;
  select * into v_task from public.review_tasks where id = p_task_id for update;
  if not found or not v_task.is_related_only then
    raise exception using errcode = '22023', message = 'La tarea no es un registro relacionado.';
  end if;
  select * into v_block from public.assignment_blocks where id = v_task.assignment_block_id for update;
  perform private.assert_block_access(v_block.id);
  perform 1 from public.uploads
  where id = v_task.upload_id and status in ('active', 'completed')
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está publicada.';
  end if;
  if v_task.version <> p_expected_task_version then
    raise exception using errcode = '40001', message = 'El registro cambió; actualice la pantalla.';
  end if;
  update public.review_tasks
  set status = 'resolved', confirmed_correct_count = 1,
      resolved_by = v_actor, resolved_at = now(), version = version + 1
  where id = v_task.id
  returning * into v_task;
  insert into private.mutation_receipts (
    client_mutation_id, actor_user_id, operation, entity_id, result
  ) values (
    p_client_mutation_id, v_actor, 'related_task.confirm', v_task.id::text,
    jsonb_build_object('task_id', v_task.id)
  );
  insert into public.audit_events (
    workspace_id, upload_id, actor_user_id, event_type, entity_type, entity_id
  ) values (
    v_task.workspace_id, v_task.upload_id, v_actor, 'related_row.confirmed_correct',
    'review_task', v_task.id::text
  );
  perform private.refresh_review_rollups(v_task.upload_id, v_task.id, v_block.id, v_actor);
  select * into v_task from public.review_tasks where id = p_task_id;
  return v_task;
end;
$$;

create function public.claim_expired_uploads(p_limit integer default 20)
returns table (
  upload_id uuid,
  workspace_id uuid,
  panel_object_path text,
  invoice_object_path text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit < 1 or p_limit > 100 then
    raise exception using errcode = '22023', message = 'El límite debe estar entre 1 y 100.';
  end if;
  delete from private.bootstrap_tokens
  where expires_at < now() - interval '1 day'
     or used_at < now() - interval '1 day';
  delete from private.mutation_receipts
  where created_at < now() - interval '90 days';
  return query
  with candidates as (
    select u.id
    from public.uploads u
    where u.scrubbed_at is null
      and u.delete_after <= now()
      and (
        u.status <> 'deleting'
        or u.updated_at <= now() - interval '15 minutes'
      )
    order by u.delete_after, u.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.uploads u
    set status = 'deleting', version = version + 1
    from candidates c
    where u.id = c.id
    returning u.id, u.workspace_id, u.panel_object_path, u.invoice_object_path
  )
  select c.id, c.workspace_id, c.panel_object_path, c.invoice_object_path
  from claimed c;
end;
$$;

create function public.finalize_upload_retention(p_upload_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace_id uuid;
begin
  select workspace_id into v_workspace_id
  from public.uploads
  where id = p_upload_id and status = 'deleting'
  for update;
  if not found then
    raise exception using errcode = '55000', message = 'La carga no está reclamada para limpieza.';
  end if;

  -- La ruta server ya eliminó los objetos de Storage. Aquí se purgan valores
  -- personales/comerciales, conservando únicamente conteos y trazabilidad.
  delete from public.invoice_links where upload_id = p_upload_id;
  delete from public.cell_resolutions where upload_id = p_upload_id;
  update public.alert_decisions
  set resolved_value = null, note = null, scrubbed_at = now()
  where upload_id = p_upload_id;
  update public.validation_alerts
  set original_value = null,
      expected_or_conflicts = null,
      detail = 'Detalle eliminado por política de retención.',
      suggested_value = null,
      suggestion_evidence = '{}'::jsonb,
      suggestion_alternatives = '[]'::jsonb,
      can_auto_apply = false,
      evidence_fingerprint = null
  where upload_id = p_upload_id;
  update public.group_members
  set observed_value = null
  where upload_id = p_upload_id;
  update public.conflict_groups
  set observed_values = '[]'::jsonb, normalized_key = null
  where upload_id = p_upload_id;
  update public.source_rows
  set row_id = null,
      id_dn_w = null,
      barcode = null,
      description = null,
      field_values = '{}'::jsonb,
      source_fingerprint = null
  where upload_id = p_upload_id;
  update public.uploads
  set status = 'archived',
      invoice_object_path = null,
      invoice_sha256 = null,
      invoice_size_bytes = null,
      source_headers = '[]'::jsonb,
      manifest_hash = null,
      scrubbed_at = now(),
      version = version + 1
  where id = p_upload_id;
  insert into public.audit_events (
    workspace_id, upload_id, event_type, entity_type, entity_id,
    payload
  ) values (
    v_workspace_id, p_upload_id, 'upload.retention_scrubbed',
    'upload', p_upload_id::text, jsonb_build_object('retention_days_elapsed', true)
  );
end;
$$;

create function private.can_view_profile(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user_id = (select auth.uid()) or exists (
    select 1
    from public.workspace_members target
    where target.user_id = p_user_id
      and target.workspace_id = any (private.current_leader_workspace_ids())
  )
$$;

create function private.can_access_task(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.review_tasks t
    join public.assignment_blocks b on b.id = t.assignment_block_id
    where t.id = p_task_id
      and (
        t.workspace_id = any (private.current_leader_workspace_ids())
        or (
          b.assigned_to = (select auth.uid())
          and b.status in ('published', 'in_progress', 'completed')
          and (select private.current_account_ready())
        )
      )
  )
$$;

create function private.can_access_alert(p_alert_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.validation_alerts a
    where a.id = p_alert_id and private.can_access_task(a.task_id)
  )
$$;

create function private.safe_path_uuid(p_value text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return p_value::uuid;
  end if;
  return null;
end;
$$;

create function private.can_write_storage_object(p_name text)
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
      and u.status in ('draft', 'uploading', 'processing')
      and u.workspace_id = any (private.current_leader_workspace_ids())
      and (
        p_name = u.panel_object_path
        or p_name = u.invoice_object_path
        or p_name like u.workspace_id::text || '/' || u.id::text || '/invoices/%'
      )
  )
$$;

create function private.can_read_storage_object(p_name text)
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
      and (
        u.workspace_id = any (private.current_leader_workspace_ids())
        or (
          split_part(p_name, '/', 3) = 'invoices'
          and u.id = any (private.current_assigned_upload_ids())
        )
      )
  )
$$;

-- RLS: toda tabla expuesta queda cerrada por defecto y solo se habilita lectura
-- según membresía/liderazgo o bloque asignado. Las escrituras pasan por RPC.
alter table public.workspaces enable row level security;
alter table public.profiles enable row level security;
alter table public.workspace_members enable row level security;
alter table public.uploads enable row level security;
alter table public.ingestion_batches enable row level security;
alter table public.source_rows enable row level security;
alter table public.conflict_groups enable row level security;
alter table public.group_members enable row level security;
alter table public.assignment_blocks enable row level security;
alter table public.review_tasks enable row level security;
alter table public.validation_alerts enable row level security;
alter table public.alert_decisions enable row level security;
alter table public.cell_resolutions enable row level security;
alter table public.invoice_links enable row level security;
alter table public.audit_events enable row level security;
alter table public.daily_productivity enable row level security;

create policy workspaces_select_member
on public.workspaces for select to authenticated
using (id = any (private.current_member_workspace_ids()));

create policy profiles_select_self_or_leader
on public.profiles for select to authenticated
using ((select auth.uid()) = user_id or (select private.can_view_profile(user_id)));

create policy workspace_members_select_workspace
on public.workspace_members for select to authenticated
using (workspace_id = any (private.current_member_workspace_ids()));

create policy uploads_select_authorized
on public.uploads for select to authenticated
using (
  workspace_id = any (private.current_leader_workspace_ids())
  or id = any (private.current_assigned_upload_ids())
);

create policy ingestion_batches_select_leader
on public.ingestion_batches for select to authenticated
using (workspace_id = any (private.current_leader_workspace_ids()));

create policy source_rows_select_authorized
on public.source_rows for select to authenticated
using ((select private.can_access_source_row(id)));

create policy conflict_groups_select_authorized
on public.conflict_groups for select to authenticated
using ((select private.can_access_group(id)));

create policy group_members_select_authorized
on public.group_members for select to authenticated
using ((select private.can_access_group(group_id)));

create policy assignment_blocks_select_authorized
on public.assignment_blocks for select to authenticated
using (
  workspace_id = any (private.current_leader_workspace_ids())
  or (
    assigned_to = (select auth.uid())
    and status in ('published', 'in_progress', 'completed')
    and (select private.current_account_ready())
  )
);

create policy review_tasks_select_authorized
on public.review_tasks for select to authenticated
using ((select private.can_access_task(id)));

create policy validation_alerts_select_authorized
on public.validation_alerts for select to authenticated
using ((select private.can_access_task(task_id)));

create policy alert_decisions_select_authorized
on public.alert_decisions for select to authenticated
using ((select private.can_access_alert(alert_id)));

create policy cell_resolutions_select_authorized
on public.cell_resolutions for select to authenticated
using ((select private.can_access_source_row(source_row_id)));

create policy invoice_links_select_authorized
on public.invoice_links for select to authenticated
using (
  workspace_id = any (private.current_leader_workspace_ids())
  or (source_row_id is not null and (select private.can_access_source_row(source_row_id)))
);

create policy audit_events_select_leader_or_actor
on public.audit_events for select to authenticated
using (
  workspace_id = any (private.current_leader_workspace_ids())
  or actor_user_id = (select auth.uid())
);

create policy daily_productivity_select_leader_or_self
on public.daily_productivity for select to authenticated
using (
  workspace_id = any (private.current_leader_workspace_ids())
  or user_id = (select auth.uid())
);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pqm-private',
  'pqm-private',
  false,
  157286400,
  array[
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream',
    'image/jpeg',
    'image/png',
    'application/pdf'
  ]::text[]
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy pqm_private_objects_select
on storage.objects for select to authenticated
using (
  bucket_id = 'pqm-private'
  and (select private.can_read_storage_object(name))
);

create policy pqm_private_objects_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'pqm-private'
  and (select private.can_write_storage_object(name))
);

create policy pqm_private_objects_update
on storage.objects for update to authenticated
using (
  bucket_id = 'pqm-private'
  and (select private.can_write_storage_object(name))
)
with check (
  bucket_id = 'pqm-private'
  and (select private.can_write_storage_object(name))
);

create policy pqm_private_objects_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'pqm-private'
  and (select private.can_write_storage_object(name))
);

-- Exposición explícita para el nuevo comportamiento de Data API. Anon no
-- recibe acceso a ninguna tabla ni RPC de la aplicación.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on table
  public.workspaces,
  public.profiles,
  public.workspace_members,
  public.uploads,
  public.ingestion_batches,
  public.source_rows,
  public.conflict_groups,
  public.group_members,
  public.assignment_blocks,
  public.review_tasks,
  public.validation_alerts,
  public.alert_decisions,
  public.cell_resolutions,
  public.invoice_links,
  public.audit_events,
  public.daily_productivity
to authenticated;

grant all privileges on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

revoke all on all functions in schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;
grant execute on function private.current_member_workspace_ids() to authenticated;
grant execute on function private.current_account_ready() to authenticated;
grant execute on function private.current_leader_workspace_ids() to authenticated;
grant execute on function private.current_assigned_upload_ids() to authenticated;
grant execute on function private.can_access_block(uuid) to authenticated;
grant execute on function private.can_access_source_row(bigint) to authenticated;
grant execute on function private.can_access_group(uuid) to authenticated;
grant execute on function private.can_view_profile(uuid) to authenticated;
grant execute on function private.can_access_task(uuid) to authenticated;
grant execute on function private.can_access_alert(uuid) to authenticated;
grant execute on function private.can_write_storage_object(text) to authenticated;
grant execute on function private.can_read_storage_object(text) to authenticated;

revoke all on function public.issue_bootstrap_token(text, text, text, timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.claim_bootstrap_leader(text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.register_workspace_member(uuid, uuid, text, text, text, public.workspace_role) from public, anon, authenticated, service_role;
revoke all on function public.set_workspace_member_active(uuid, uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.reset_member_pin_state(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.mark_pin_changed() from public, anon, authenticated, service_role;
revoke all on function public.get_login_identity(text) from public, anon, authenticated, service_role;
revoke all on function public.record_login_attempt(text, boolean) from public, anon, authenticated, service_role;
revoke all on function public.create_upload(uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.ingest_validation_batch(uuid, uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.finalize_upload_ingestion(uuid, integer, integer, integer, integer, integer, text) from public, anon, authenticated, service_role;
revoke all on function public.propose_balanced_assignments(uuid, uuid[]) from public, anon, authenticated, service_role;
revoke all on function public.publish_assignments(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.resolve_alert(uuid, integer, public.decision_kind, text, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.reopen_alert(uuid, integer, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.add_related_row_to_block(uuid, bigint, integer) from public, anon, authenticated, service_role;
revoke all on function public.save_related_cell_resolution(uuid, smallint, text, text, text, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_related_task(uuid, integer, uuid) from public, anon, authenticated, service_role;
revoke all on function public.claim_expired_uploads(integer) from public, anon, authenticated, service_role;
revoke all on function public.finalize_upload_retention(uuid) from public, anon, authenticated, service_role;

grant execute on function public.issue_bootstrap_token(text, text, text, timestamptz) to service_role;
grant execute on function public.get_login_identity(text) to service_role;
grant execute on function public.record_login_attempt(text, boolean) to service_role;
grant execute on function public.claim_expired_uploads(integer) to service_role;
grant execute on function public.finalize_upload_retention(uuid) to service_role;

grant execute on function public.claim_bootstrap_leader(text, text, text) to authenticated;
grant execute on function public.register_workspace_member(uuid, uuid, text, text, text, public.workspace_role) to authenticated;
grant execute on function public.set_workspace_member_active(uuid, uuid, boolean) to authenticated;
grant execute on function public.reset_member_pin_state(uuid, uuid) to authenticated;
grant execute on function public.mark_pin_changed() to authenticated;
grant execute on function public.create_upload(uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb) to authenticated;
grant execute on function public.ingest_validation_batch(uuid, uuid, jsonb) to authenticated;
grant execute on function public.finalize_upload_ingestion(uuid, integer, integer, integer, integer, integer, text) to authenticated;
grant execute on function public.propose_balanced_assignments(uuid, uuid[]) to authenticated;
grant execute on function public.publish_assignments(uuid, jsonb) to authenticated;
grant execute on function public.resolve_alert(uuid, integer, public.decision_kind, text, uuid, text) to authenticated;
grant execute on function public.reopen_alert(uuid, integer, text, uuid) to authenticated;
grant execute on function public.add_related_row_to_block(uuid, bigint, integer) to authenticated;
grant execute on function public.save_related_cell_resolution(uuid, smallint, text, text, text, integer, uuid) to authenticated;
grant execute on function public.confirm_related_task(uuid, integer, uuid) to authenticated;

-- service_role sigue siendo la única identidad de servidor y puede ejecutar
-- las RPC autenticadas para tareas administrativas controladas.
grant execute on function public.claim_bootstrap_leader(text, text, text) to service_role;
grant execute on function public.register_workspace_member(uuid, uuid, text, text, text, public.workspace_role) to service_role;
grant execute on function public.set_workspace_member_active(uuid, uuid, boolean) to service_role;
grant execute on function public.reset_member_pin_state(uuid, uuid) to service_role;
grant execute on function public.mark_pin_changed() to service_role;
grant execute on function public.create_upload(uuid, uuid, text, text, text, bigint, text, text, bigint, jsonb) to service_role;
grant execute on function public.ingest_validation_batch(uuid, uuid, jsonb) to service_role;
grant execute on function public.finalize_upload_ingestion(uuid, integer, integer, integer, integer, integer, text) to service_role;
grant execute on function public.propose_balanced_assignments(uuid, uuid[]) to service_role;
grant execute on function public.publish_assignments(uuid, jsonb) to service_role;
grant execute on function public.resolve_alert(uuid, integer, public.decision_kind, text, uuid, text) to service_role;
grant execute on function public.reopen_alert(uuid, integer, text, uuid) to service_role;
grant execute on function public.add_related_row_to_block(uuid, bigint, integer) to service_role;
grant execute on function public.save_related_cell_resolution(uuid, smallint, text, text, text, integer, uuid) to service_role;
grant execute on function public.confirm_related_task(uuid, integer, uuid) to service_role;

comment on table public.source_rows is
  'Solo filas alertadas o necesarias como contexto; total_rows vive en uploads y corresponde a toda la hoja fuente.';
comment on column public.profiles.auth_email is
  'Email sintético interno usado solo por rutas server para autenticar username+PIN.';
comment on table public.cell_resolutions is
  'Overlay único de correcciones por carga, fila y columna; nunca modifica el Excel original.';
comment on function public.ingest_validation_batch(uuid, uuid, jsonb) is
  'Ingesta idempotente de hasta 1000 filas usando external_key estable para filas, grupos, bloques y tareas.';

notify pgrst, 'reload schema';

