-- Índices de cobertura para todas las claves foráneas detectadas por el
-- asesor de rendimiento de Supabase. Evitan escaneos completos al borrar,
-- reasignar o consultar entidades relacionadas.

create index if not exists bootstrap_tokens_used_by_idx
  on private.bootstrap_tokens (used_by);
create index if not exists mutation_receipts_actor_user_idx
  on private.mutation_receipts (actor_user_id);

create index if not exists alert_decisions_alert_upload_workspace_idx
  on public.alert_decisions (alert_id, upload_id, workspace_id);
create index if not exists alert_decisions_decided_by_idx
  on public.alert_decisions (decided_by);
create index if not exists alert_decisions_superseded_by_idx
  on public.alert_decisions (superseded_by);

create index if not exists assignment_blocks_upload_workspace_idx
  on public.assignment_blocks (upload_id, workspace_id);
create index if not exists audit_events_upload_workspace_idx
  on public.audit_events (upload_id, workspace_id);

create index if not exists cell_resolutions_created_by_idx
  on public.cell_resolutions (created_by);
create index if not exists cell_resolutions_last_decision_idx
  on public.cell_resolutions (last_decision_id);
create index if not exists cell_resolutions_source_upload_workspace_idx
  on public.cell_resolutions (source_row_id, upload_id, workspace_id);

create index if not exists conflict_groups_upload_workspace_idx
  on public.conflict_groups (upload_id, workspace_id);
create index if not exists daily_productivity_upload_workspace_idx
  on public.daily_productivity (upload_id, workspace_id);
create index if not exists daily_productivity_user_idx
  on public.daily_productivity (user_id);

create index if not exists group_members_group_upload_workspace_idx
  on public.group_members (group_id, upload_id, workspace_id);
create index if not exists group_members_source_upload_workspace_idx
  on public.group_members (source_row_id, upload_id, workspace_id);
create index if not exists ingestion_batches_upload_workspace_idx
  on public.ingestion_batches (upload_id, workspace_id);

create index if not exists invoice_links_source_upload_workspace_idx
  on public.invoice_links (source_row_id, upload_id, workspace_id);
create index if not exists invoice_links_upload_workspace_idx
  on public.invoice_links (upload_id, workspace_id);
create index if not exists profiles_created_by_idx
  on public.profiles (created_by);

create index if not exists review_tasks_block_upload_workspace_idx
  on public.review_tasks (assignment_block_id, upload_id, workspace_id);
create index if not exists review_tasks_resolved_by_idx
  on public.review_tasks (resolved_by);
create index if not exists review_tasks_source_upload_workspace_idx
  on public.review_tasks (source_row_id, upload_id, workspace_id);
create index if not exists source_rows_upload_workspace_idx
  on public.source_rows (upload_id, workspace_id);

create index if not exists uploads_created_by_idx
  on public.uploads (created_by);
create index if not exists uploads_finalized_by_idx
  on public.uploads (finalized_by);

create index if not exists validation_alerts_group_upload_workspace_idx
  on public.validation_alerts (group_id, upload_id, workspace_id);
create index if not exists validation_alerts_task_upload_workspace_idx
  on public.validation_alerts (task_id, upload_id, workspace_id);
create index if not exists workspace_members_created_by_idx
  on public.workspace_members (created_by);
create index if not exists workspaces_created_by_idx
  on public.workspaces (created_by);

