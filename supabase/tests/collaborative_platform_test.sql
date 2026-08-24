begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(44);

select extensions.ok(
  (select count(*) = 16
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname = any (array[
       'workspaces','profiles','workspace_members','uploads',
       'ingestion_batches','source_rows','conflict_groups','group_members',
       'assignment_blocks','review_tasks','validation_alerts','alert_decisions',
       'cell_resolutions','invoice_links','audit_events','daily_productivity'
     ])),
  'crea las 16 tablas públicas esperadas'
);

select extensions.ok(
  (select bool_and(c.relrowsecurity)
   from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r'
     and c.relname = any (array[
       'workspaces','profiles','workspace_members','uploads',
       'ingestion_batches','source_rows','conflict_groups','group_members',
       'assignment_blocks','review_tasks','validation_alerts','alert_decisions',
       'cell_resolutions','invoice_links','audit_events','daily_productivity'
     ])),
  'RLS está activo en todas las tablas expuestas'
);

select extensions.ok(
  not has_table_privilege('anon', 'public.uploads', 'select'),
  'anon no puede leer cargas'
);
select extensions.ok(
  not has_table_privilege('anon', 'public.validation_alerts', 'select'),
  'anon no puede leer alertas'
);
select extensions.ok(
  has_table_privilege('authenticated', 'public.validation_alerts', 'select'),
  'authenticated puede consultar alertas bajo RLS'
);
select extensions.ok(
  not has_table_privilege('authenticated', 'public.validation_alerts', 'insert'),
  'authenticated no puede insertar alertas fuera de RPC'
);
select extensions.ok(
  (select count(*) >= 16 from pg_policies
   where schemaname in ('public', 'storage')),
  'existen políticas explícitas para datos y Storage'
);
select extensions.ok(
  exists (select 1 from storage.buckets
          where id = 'pqm-private' and not public and file_size_limit = 157286400),
  'el bucket PQM es privado y limita archivos a 150 MiB'
);
select extensions.ok(
  to_regclass('private.bootstrap_tokens') is not null,
  'los tokens iniciales viven en esquema privado'
);
select extensions.ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name = 'auth_email'),
  'profiles incluye email sintético para login server'
);
select extensions.ok(
  exists (select 1 from information_schema.columns
          where table_schema = 'public' and table_name = 'profiles'
            and column_name = 'locked_until'),
  'profiles incluye bloqueo temporal'
);
select extensions.ok(
  to_regprocedure('public.ingest_validation_batch(uuid,uuid,jsonb)') is not null,
  'existe RPC de ingesta idempotente'
);
select extensions.ok(
  to_regprocedure('public.finalize_upload_ingestion(uuid,integer,integer,integer,integer,integer,text)') is not null,
  'existe RPC de finalización con total fuente y filas persistidas separados'
);
select extensions.ok(
  to_regprocedure('public.resolve_alert_guarded(uuid,integer,public.decision_kind,text,uuid,text)') is not null,
  'existe RPC transaccional protegida para resolver alertas'
);
select extensions.ok(
  to_regprocedure('public.reopen_alert_guarded(uuid,integer,text,uuid)') is not null,
  'existe RPC transaccional protegida para reabrir alertas'
);
select extensions.ok(
  to_regprocedure('public.add_related_row_to_block_guarded(uuid,bigint,integer)') is not null,
  'existe RPC protegida para agregar un relacionado sin dueño'
);
select extensions.ok(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'alert_decisions_one_current_uidx'),
  'solo puede existir una decisión vigente por alerta'
);
select extensions.ok(
  exists (select 1 from pg_indexes
          where schemaname = 'public' and indexname = 'cell_resolutions_upload_id_source_row_id_column_index_key'),
  'solo existe un overlay por fila y columna'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.resolve_alert_guarded(uuid,integer,public.decision_kind,text,uuid,text)',
    'execute'
  ),
  'anon no puede invocar resolve_alert'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.resolve_alert_guarded(uuid,integer,public.decision_kind,text,uuid,text)',
    'execute'
  ),
  'authenticated puede resolver mediante la RPC protegida'
);

select extensions.ok(
  to_regprocedure('public.reconcile_assignment_blocks_guarded(uuid,uuid,text,integer,integer,uuid)') is not null,
  'existe RPC protegida de liderazgo para mover o fusionar bloques completos'
);
select extensions.ok(
  to_regprocedure('public.reopen_related_task_guarded(uuid,integer,text,uuid)') is not null,
  'existe RPC protegida para reabrir tareas related-only'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.reconcile_assignment_blocks_guarded(uuid,uuid,text,integer,integer,uuid)',
    'execute'
  ),
  'anon no puede mover ni fusionar bloques'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.reconcile_assignment_blocks_guarded(uuid,uuid,text,integer,integer,uuid)',
    'execute'
  ),
  'authenticated puede invocar la RPC protegida de bloques'
);
select extensions.ok(
  not has_function_privilege(
    'anon',
    'public.reopen_related_task_guarded(uuid,integer,text,uuid)',
    'execute'
  ),
  'anon no puede reabrir tareas relacionadas'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.reopen_related_task_guarded(uuid,integer,text,uuid)',
    'execute'
  ),
  'authenticated puede invocar la RPC protegida para reabrir relacionados'
);

select extensions.ok(to_regprocedure('public.propose_balanced_assignments_versioned(uuid,integer,uuid[])') is not null, 'existe propuesta de reparto con versión esperada');
select extensions.ok(to_regprocedure('public.publish_assignments_versioned(uuid,integer,jsonb)') is not null, 'existe publicación de reparto con versión esperada');
select extensions.ok(to_regprocedure('public.save_related_cell_resolution_guarded(uuid,smallint,text,text,text,integer,uuid)') is not null, 'existe guard de edición para relacionados');
select extensions.ok(to_regprocedure('public.confirm_related_task_guarded(uuid,integer,uuid)') is not null, 'existe guard de confirmación para relacionados');
select extensions.ok(not has_function_privilege('authenticated', 'public.propose_balanced_assignments(uuid,uuid[])', 'execute'), 'authenticated no puede omitir la versión al proponer reparto');
select extensions.ok(not has_function_privilege('authenticated', 'public.publish_assignments(uuid,jsonb)', 'execute'), 'authenticated no puede omitir la versión al publicar reparto');
select extensions.ok(not has_function_privilege('authenticated', 'public.save_related_cell_resolution(uuid,smallint,text,text,text,integer,uuid)', 'execute'), 'authenticated no puede omitir el guard de edición relacionada');
select extensions.ok(not has_function_privilege('authenticated', 'public.confirm_related_task(uuid,integer,uuid)', 'execute'), 'authenticated no puede omitir el guard de confirmación relacionada');
select extensions.ok(has_function_privilege('authenticated', 'public.propose_balanced_assignments_versioned(uuid,integer,uuid[])', 'execute'), 'authenticated puede usar propuesta versionada protegida');
select extensions.ok(has_function_privilege('authenticated', 'public.publish_assignments_versioned(uuid,integer,jsonb)', 'execute'), 'authenticated puede usar publicación versionada protegida');
select extensions.ok(has_function_privilege('authenticated', 'public.save_related_cell_resolution_guarded(uuid,smallint,text,text,text,integer,uuid)', 'execute'), 'authenticated puede editar relacionado mediante el guard');
select extensions.ok(has_function_privilege('authenticated', 'public.confirm_related_task_guarded(uuid,integer,uuid)', 'execute'), 'authenticated puede confirmar relacionado mediante el guard');
select extensions.ok(not has_function_privilege('authenticated', 'public.resolve_alert(uuid,integer,public.decision_kind,text,uuid,text)', 'execute'), 'authenticated no puede omitir el guard al resolver alertas');
select extensions.ok(not has_function_privilege('authenticated', 'public.reopen_alert(uuid,integer,text,uuid)', 'execute'), 'authenticated no puede omitir el guard al reabrir alertas');
select extensions.ok(not has_function_privilege('authenticated', 'public.add_related_row_to_block(uuid,bigint,integer)', 'execute'), 'authenticated no puede omitir el guard al añadir relacionados');
select extensions.ok(not has_function_privilege('authenticated', 'public.reconcile_assignment_blocks(uuid,uuid,text,integer,integer,uuid)', 'execute'), 'authenticated no puede omitir el guard al reconciliar bloques');
select extensions.ok(not has_function_privilege('authenticated', 'public.reopen_related_task(uuid,integer,text,uuid)', 'execute'), 'authenticated no puede omitir el guard al reabrir relacionados');
select extensions.ok(to_regprocedure('private.current_session_is_fresh(timestamptz)') is not null, 'existe el guard persistente de frescura de sesión');

select * from extensions.finish();
rollback;
