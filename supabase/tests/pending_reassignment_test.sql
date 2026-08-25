begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(26);

select extensions.ok(
  to_regprocedure(
    'public.preview_pending_reassignment_versioned(uuid,integer,uuid[])'
  ) is not null,
  'existe la vista previa versionada de re-reparto pendiente'
);
select extensions.ok(
  to_regprocedure(
    'public.publish_pending_reassignment_versioned(uuid,integer,uuid[],jsonb,uuid)'
  ) is not null,
  'existe la publicación atómica de re-reparto pendiente'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.preview_pending_reassignment_versioned(uuid,integer,uuid[])',
    'execute'
  ) and has_function_privilege(
    'service_role',
    'public.preview_pending_reassignment_versioned(uuid,integer,uuid[])',
    'execute'
  ) and not has_function_privilege(
    'anon',
    'public.preview_pending_reassignment_versioned(uuid,integer,uuid[])',
    'execute'
  ),
  'solo authenticated puede solicitar la vista previa'
);
select extensions.ok(
  has_function_privilege(
    'authenticated',
    'public.publish_pending_reassignment_versioned(uuid,integer,uuid[],jsonb,uuid)',
    'execute'
  ) and has_function_privilege(
    'service_role',
    'public.publish_pending_reassignment_versioned(uuid,integer,uuid[],jsonb,uuid)',
    'execute'
  ) and not has_function_privilege(
    'anon',
    'public.publish_pending_reassignment_versioned(uuid,integer,uuid[],jsonb,uuid)',
    'execute'
  ),
  'solo authenticated puede publicar el re-reparto'
);
select extensions.ok(
  position(
    'for update nowait' in lower(pg_get_functiondef(
      'public.publish_pending_reassignment_versioned(uuid,integer,uuid[],jsonb,uuid)'::regprocedure
    ))
  ) > 0,
  'la publicación falla rápido cuando otro proceso usa la jornada o sus bloques'
);
select extensions.ok(
  to_regprocedure(
    'public.propose_balanced_assignments_versioned_legacy(uuid,integer,uuid[])'
  ) is not null
  and not has_function_privilege(
    'authenticated',
    'public.propose_balanced_assignments_versioned_legacy(uuid,integer,uuid[])',
    'execute'
  ),
  'el algoritmo inicial permisivo queda como primitiva no expuesta'
);
select extensions.throws_ok(
  $$select public.propose_balanced_assignments_versioned(
    '00000000-0000-4000-8000-000000000001', 1, '{}'::uuid[]
  )$$,
  '22023',
  'Seleccione al menos un validador activo, sin duplicados.',
  'el reparto inicial ya no convierte una selección vacía en todos'
);

insert into auth.users (id, email)
values
  ('aa100000-0000-4000-8000-000000000001', 'pending-leader@auth.invalid'),
  ('aa100000-0000-4000-8000-000000000002', 'pending-validator-a@auth.invalid'),
  ('aa100000-0000-4000-8000-000000000003', 'pending-validator-b@auth.invalid'),
  ('aa100000-0000-4000-8000-000000000004', 'pending-validator-inactive@auth.invalid');

insert into public.workspaces (id, name, slug, created_by)
values (
  'bb200000-0000-4000-8000-000000000001',
  'Workspace re-reparto',
  'workspace-re-reparto',
  'aa100000-0000-4000-8000-000000000001'
);

insert into public.profiles (
  user_id, username, auth_email, display_name, is_active,
  must_change_pin, created_by
)
values
  (
    'aa100000-0000-4000-8000-000000000001',
    'pending_leader', 'pending-leader@auth.invalid', 'Líder pendiente',
    true, false, 'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'aa100000-0000-4000-8000-000000000002',
    'pending_validator_a', 'pending-validator-a@auth.invalid', 'Validador A',
    true, false, 'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'aa100000-0000-4000-8000-000000000003',
    'pending_validator_b', 'pending-validator-b@auth.invalid', 'Validador B',
    true, false, 'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'aa100000-0000-4000-8000-000000000004',
    'pending_validator_inactive', 'pending-validator-inactive@auth.invalid',
    'Validador inactivo', false, false,
    'aa100000-0000-4000-8000-000000000001'
  );

insert into public.workspace_members (
  workspace_id, user_id, role, is_active, created_by
)
values
  (
    'bb200000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000001', 'leader', true,
    'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'bb200000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000002', 'validator', true,
    'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'bb200000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000003', 'validator', true,
    'aa100000-0000-4000-8000-000000000001'
  ),
  (
    'bb200000-0000-4000-8000-000000000001',
    'aa100000-0000-4000-8000-000000000004', 'validator', true,
    'aa100000-0000-4000-8000-000000000001'
  );

insert into public.uploads (
  id, workspace_id, display_name, status, panel_object_path,
  panel_sha256, panel_size_bytes, source_headers, total_rows,
  task_count, alert_count, pending_task_count, created_by, delete_after
)
values (
  'cc300000-0000-4000-8000-000000000001',
  'bb200000-0000-4000-8000-000000000001',
  'panel-re-reparto.xlsx', 'active',
  'bb200000-0000-4000-8000-000000000001/cc300000-0000-4000-8000-000000000001/panel/panel.xlsx',
  decode(repeat('ab', 32), 'hex'), 1024,
  '["Row-Id","Descripcion"]'::jsonb, 3, 3, 0, 2,
  'aa100000-0000-4000-8000-000000000001', now() + interval '90 days'
);

insert into public.source_rows (
  id, upload_id, workspace_id, external_key, excel_row, row_id,
  description, field_values
)
values
  (
    920001, 'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-row-1', 2,
    'PENDING-1', 'PENDIENTE UNO', '{"Descripcion":"PENDIENTE UNO"}'::jsonb
  ),
  (
    920002, 'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'resolved-row', 3,
    'RESOLVED', 'RESUELTO', '{"Descripcion":"RESUELTO"}'::jsonb
  ),
  (
    920003, 'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-row-2', 4,
    'PENDING-2', 'PENDIENTE DOS', '{"Descripcion":"PENDIENTE DOS"}'::jsonb
  );

insert into public.assignment_blocks (
  id, upload_id, workspace_id, external_key, block_key, status,
  assigned_to, alert_count, member_count, invoice_count, weight, published_at
)
values
  (
    'dd400000-0000-4000-8000-000000000001',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-block-1',
    'pending-block-1', 'published',
    'aa100000-0000-4000-8000-000000000003', 0, 1, 0, 1.15, now()
  ),
  (
    'dd400000-0000-4000-8000-000000000002',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'resolved-block',
    'resolved-block', 'completed',
    'aa100000-0000-4000-8000-000000000002', 0, 1, 0, 1.15, now()
  ),
  (
    'dd400000-0000-4000-8000-000000000003',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-block-2',
    'pending-block-2', 'in_progress',
    'aa100000-0000-4000-8000-000000000002', 0, 1, 0, 1.15, now()
  );

insert into public.review_tasks (
  id, upload_id, workspace_id, external_key, source_row_id,
  assignment_block_id, status, alert_count, resolved_by, resolved_at
)
values
  (
    'ee500000-0000-4000-8000-000000000001',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-task-1', 920001,
    'dd400000-0000-4000-8000-000000000001', 'pending', 0, null, null
  ),
  (
    'ee500000-0000-4000-8000-000000000002',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'resolved-task', 920002,
    'dd400000-0000-4000-8000-000000000002', 'resolved', 0,
    'aa100000-0000-4000-8000-000000000002', now()
  ),
  (
    'ee500000-0000-4000-8000-000000000003',
    'cc300000-0000-4000-8000-000000000001',
    'bb200000-0000-4000-8000-000000000001', 'pending-task-2', 920003,
    'dd400000-0000-4000-8000-000000000003', 'in_progress', 0, null, null
  );

insert into public.daily_productivity (
  workspace_id, upload_id, user_id, activity_date,
  tasks_resolved, alerts_resolved, cells_changed, rows_corrected,
  confirmed_correct
)
values (
  'bb200000-0000-4000-8000-000000000001',
  'cc300000-0000-4000-8000-000000000001',
  'aa100000-0000-4000-8000-000000000002', current_date,
  1, 4, 2, 1, 2
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aa100000-0000-4000-8000-000000000001","role":"authenticated","iat":1900000000}',
  true
);

select extensions.is(
  (
    select count(*)
    from public.preview_pending_reassignment_versioned(
      'cc300000-0000-4000-8000-000000000001',
      1,
      array[
        'aa100000-0000-4000-8000-000000000002',
        'aa100000-0000-4000-8000-000000000003'
      ]::uuid[]
    )
  ),
  2::bigint,
  'la vista previa contiene solo los dos bloques con tareas pendientes'
);

select extensions.ok(
  not exists (
    select 1
    from public.preview_pending_reassignment_versioned(
      'cc300000-0000-4000-8000-000000000001',
      1,
      array[
        'aa100000-0000-4000-8000-000000000002',
        'aa100000-0000-4000-8000-000000000003'
      ]::uuid[]
    ) preview
    where preview.assignee_id <> all(array[
      'aa100000-0000-4000-8000-000000000002',
      'aa100000-0000-4000-8000-000000000003'
    ]::uuid[])
      or preview.block_assignment_version <> 1
  ),
  'la propuesta usa únicamente el equipo elegido y la versión exclusiva'
);

select extensions.is(
  (
    select count(*)
    from public.assignment_blocks
    where upload_id = 'cc300000-0000-4000-8000-000000000001'
      and assigned_to = 'aa100000-0000-4000-8000-000000000002'
  ),
  2::bigint,
  'la vista previa no modifica ninguna asignación'
);

select extensions.throws_ok(
  $$select public.preview_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    1,
    array['aa100000-0000-4000-8000-000000000001']::uuid[]
  )$$,
  '22023',
  'La selección contiene usuarios que no son validadores activos.',
  'un líder no puede inyectarse como responsable'
);

select extensions.throws_ok(
  $$select public.preview_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    1,
    array['aa100000-0000-4000-8000-000000000004']::uuid[]
  )$$,
  '22023',
  'La selección contiene usuarios que no son validadores activos.',
  'un perfil inactivo no puede recibir carga'
);

create temporary table test_pending_reassignment_preview
on commit drop
as
select *
from public.preview_pending_reassignment_versioned(
  'cc300000-0000-4000-8000-000000000001',
  1,
  array[
    'aa100000-0000-4000-8000-000000000002',
    'aa100000-0000-4000-8000-000000000003'
  ]::uuid[]
);

select extensions.is(
  (
    select assignee_id
    from test_pending_reassignment_preview
    where block_id = 'dd400000-0000-4000-8000-000000000001'
  ),
  'aa100000-0000-4000-8000-000000000002'::uuid,
  'la propuesta realmente intenta mover a A el bloque que actualmente pertenece a B'
);

-- Simula que el primer bloque queda completamente resuelto después de que el
-- líder calculó la propuesta, pero antes de publicarla. La publicación debe
-- ignorar ese elemento obsoleto sin moverlo ni exigir un nuevo cálculo.
reset role;
update public.review_tasks
set status = 'resolved',
    resolved_by = 'aa100000-0000-4000-8000-000000000002',
    resolved_at = now(),
    version = version + 1
where id = 'ee500000-0000-4000-8000-000000000001';
update public.assignment_blocks
set status = 'completed',
    version = version + 1
where id = 'dd400000-0000-4000-8000-000000000001';

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aa100000-0000-4000-8000-000000000001","role":"authenticated","iat":1900000000}',
  true
);

select extensions.lives_ok(
  $$select public.publish_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    1,
    array[
      'aa100000-0000-4000-8000-000000000002',
      'aa100000-0000-4000-8000-000000000003'
    ]::uuid[],
    (
      select jsonb_agg(jsonb_build_object(
        'block_id', preview.block_id,
        'assigned_to', preview.assignee_id,
        'expected_version', preview.block_assignment_version
      ))
      from test_pending_reassignment_preview preview
    ),
    'ff600000-0000-4000-8000-000000000001'
  )$$,
  'se publica atómicamente el reparto de los pendientes'
);

select extensions.is(
  (
    select assignment_version
    from public.uploads
    where id = 'cc300000-0000-4000-8000-000000000001'
  ),
  2,
  'la publicación incrementa una sola vez la versión de reparto de la jornada'
);

select extensions.ok(
  (
    select assigned_to = 'aa100000-0000-4000-8000-000000000002'
       and assignment_version = 1
    from public.assignment_blocks
    where id = 'dd400000-0000-4000-8000-000000000002'
  ),
  'el bloque completamente resuelto conserva responsable y versión'
);

select extensions.ok(
  (
    select assigned_to = 'aa100000-0000-4000-8000-000000000003'
       and assignment_version = 1
    from public.assignment_blocks
    where id = 'dd400000-0000-4000-8000-000000000001'
  ),
  'un bloque resuelto después de la vista previa queda intacto al publicar'
);

select extensions.ok(
  (
    select assigned_to = 'aa100000-0000-4000-8000-000000000003'
       and assignment_version = 2
    from public.assignment_blocks
    where id = 'dd400000-0000-4000-8000-000000000003'
  ),
  'el bloque que continúa pendiente conserva la asignación propuesta'
);

select extensions.is(
  (
    select array_agg(status::text order by id)
    from public.review_tasks
    where upload_id = 'cc300000-0000-4000-8000-000000000001'
  ),
  array['resolved', 'resolved', 'in_progress']::text[],
  're-repartir no cambia el estado de ninguna tarea'
);

select extensions.ok(
  exists (
    select 1
    from public.daily_productivity
    where upload_id = 'cc300000-0000-4000-8000-000000000001'
      and user_id = 'aa100000-0000-4000-8000-000000000002'
      and tasks_resolved = 1
      and alerts_resolved = 4
      and cells_changed = 2
      and rows_corrected = 1
      and confirmed_correct = 2
  ),
  'la productividad histórica del validador anterior permanece intacta'
);

select extensions.ok(
  exists (
    select 1
    from public.audit_events
    where upload_id = 'cc300000-0000-4000-8000-000000000001'
      and event_type = 'assignments.pending_redistributed'
      and payload ? 'before'
      and payload ? 'after'
      and payload ? 'changes'
      and payload ->> 'assignment_version_after' = '2'
  ),
  'la auditoría conserva resumen antes, después y bloques cambiados'
);

select extensions.lives_ok(
  $$select public.publish_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    1,
    array[
      'aa100000-0000-4000-8000-000000000002',
      'aa100000-0000-4000-8000-000000000003'
    ]::uuid[],
    '[]'::jsonb,
    'ff600000-0000-4000-8000-000000000001'
  )$$,
  'repetir el mismo mutation id devuelve el primer resultado sin duplicar cambios'
);

select extensions.is(
  (
    select assignment_version
    from public.uploads
    where id = 'cc300000-0000-4000-8000-000000000001'
  ),
  2,
  'el retry idempotente no incrementa nuevamente la versión'
);

select extensions.throws_ok(
  $$select public.preview_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    1,
    array[
      'aa100000-0000-4000-8000-000000000002',
      'aa100000-0000-4000-8000-000000000003'
    ]::uuid[]
  )$$,
  '40001',
  'El reparto cambió; actualice la pantalla antes de recalcular.',
  'una vista previa obsoleta no pisa un reparto más nuevo'
);

reset role;

select extensions.throws_ok(
  $$update public.assignment_blocks
    set assigned_to = 'aa100000-0000-4000-8000-000000000001'
    where id = 'dd400000-0000-4000-8000-000000000001'$$,
  '23514',
  'El responsable debe ser un validador activo del espacio de trabajo.',
  'el trigger impide asignar un bloque a un líder incluso fuera de la RPC'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"aa100000-0000-4000-8000-000000000002","role":"authenticated","iat":1900000000}',
  true
);
select extensions.throws_ok(
  $$select public.preview_pending_reassignment_versioned(
    'cc300000-0000-4000-8000-000000000001',
    2,
    array['aa100000-0000-4000-8000-000000000002']::uuid[]
  )$$,
  '42501',
  'Se requiere el rol de líder activo.',
  'un validador no puede calcular un re-reparto'
);
reset role;

select * from extensions.finish(true);
rollback;
