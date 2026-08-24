begin;

create extension if not exists pgtap with schema extensions;

select extensions.plan(45);

-- Identidades aisladas para probar RLS y RPC con el mismo rol que usa PostgREST.
insert into auth.users (id, email)
values
  ('a1100000-0000-4000-8000-000000000001', 'rls-leader-1@auth.invalid'),
  ('a1100000-0000-4000-8000-000000000002', 'rls-leader-2@auth.invalid'),
  ('a1100000-0000-4000-8000-000000000003', 'rls-validator-a@auth.invalid'),
  ('a1100000-0000-4000-8000-000000000004', 'rls-validator-b@auth.invalid');

insert into public.workspaces (id, name, slug, created_by)
values (
  'b2200000-0000-4000-8000-000000000001',
  'Workspace prueba RLS',
  'workspace-prueba-rls',
  'a1100000-0000-4000-8000-000000000001'
);

insert into public.profiles (
  user_id, username, auth_email, display_name, is_active, must_change_pin, created_by
)
values
  ('a1100000-0000-4000-8000-000000000001', 'rls_leader_1', 'rls-leader-1@auth.invalid', 'Líder RLS 1', true, false, 'a1100000-0000-4000-8000-000000000001'),
  ('a1100000-0000-4000-8000-000000000002', 'rls_leader_2', 'rls-leader-2@auth.invalid', 'Líder RLS 2', true, false, 'a1100000-0000-4000-8000-000000000001'),
  ('a1100000-0000-4000-8000-000000000003', 'rls_validator_a', 'rls-validator-a@auth.invalid', 'Validador RLS A', true, false, 'a1100000-0000-4000-8000-000000000001'),
  ('a1100000-0000-4000-8000-000000000004', 'rls_validator_b', 'rls-validator-b@auth.invalid', 'Validador RLS B', true, false, 'a1100000-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role, is_active, created_by)
values
  ('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', 'leader', true, 'a1100000-0000-4000-8000-000000000001'),
  ('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', 'leader', true, 'a1100000-0000-4000-8000-000000000001'),
  ('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000003', 'validator', true, 'a1100000-0000-4000-8000-000000000001'),
  ('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000004', 'validator', true, 'a1100000-0000-4000-8000-000000000001');

insert into public.uploads (
  id, workspace_id, display_name, status, panel_object_path,
  panel_sha256, panel_size_bytes, source_headers, total_rows,
  task_count, alert_count, pending_task_count, created_by, delete_after
)
values (
  'c3300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'panel-prueba-rls.xlsx',
  'active',
  'b2200000-0000-4000-8000-000000000001/c3300000-0000-4000-8000-000000000001/panel/panel-prueba-rls.xlsx',
  decode(repeat('11', 32), 'hex'),
  1024,
  '["Row-Id","codiGo_barras","Descripcion"]'::jsonb,
  4,
  2,
  2,
  2,
  'a1100000-0000-4000-8000-000000000001',
  now() + interval '90 days'
);

insert into public.source_rows (
  id, upload_id, workspace_id, external_key, excel_row, row_id,
  id_dn_w, barcode, description, field_values
)
values
  (910001, 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'row-2', 2, 'ROW-A', 'ID-A', '001', 'PRODUCTO A', '{"Descripcion":"PRODUCTO A"}'::jsonb),
  (910002, 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'row-3', 3, 'ROW-B', 'ID-B', '002', 'PRODUCTO B', '{"Descripcion":"PRODUCTO B"}'::jsonb),
  (910003, 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'row-4', 4, 'ROW-CONTEXT', 'ID-A', '001', 'PRODUCTO A CONTEXTO', '{"Descripcion":"PRODUCTO A CONTEXTO"}'::jsonb),
  (910004, 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'row-5', 5, 'ROW-UNRELATED', 'ID-X', '999', 'SIN RELACIÓN', '{"Descripcion":"SIN RELACIÓN"}'::jsonb);

insert into public.assignment_blocks (
  id, upload_id, workspace_id, external_key, block_key, status,
  assigned_to, alert_count, member_count, weight, published_at
)
values
  ('d4400000-0000-4000-8000-000000000001', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'block-a', 'block-a', 'published', 'a1100000-0000-4000-8000-000000000003', 1, 2, 1.30, now()),
  ('d4400000-0000-4000-8000-000000000002', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'block-b', 'block-b', 'published', 'a1100000-0000-4000-8000-000000000004', 1, 1, 1.15, now());

insert into public.review_tasks (
  id, upload_id, workspace_id, external_key, source_row_id,
  assignment_block_id, status, alert_count
)
values
  ('e5500000-0000-4000-8000-000000000001', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'task-a', 910001, 'd4400000-0000-4000-8000-000000000001', 'pending', 1),
  ('e5500000-0000-4000-8000-000000000002', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'task-b', 910002, 'd4400000-0000-4000-8000-000000000002', 'pending', 1);

insert into public.conflict_groups (
  id, upload_id, workspace_id, external_key, rule_code, group_key,
  normalized_key, affected_field, observed_values, affected_row_count, alert_count
)
values (
  'f6600000-0000-4000-8000-000000000001',
  'c3300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'group-a', 'R01', 'group-a', '001', 'Descripcion',
  '["PRODUCTO A","PRODUCTO A CONTEXTO"]'::jsonb, 2, 1
);

insert into public.group_members (
  group_id, upload_id, workspace_id, source_row_id, is_alert, is_related_context
)
values
  ('f6600000-0000-4000-8000-000000000001', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 910001, true, false),
  ('f6600000-0000-4000-8000-000000000001', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 910003, false, true);

insert into public.validation_alerts (
  id, upload_id, workspace_id, task_id, group_id, event_key,
  rule_code, category, affected_field, source_column_index,
  original_value, detail, status
)
values
  ('07670000-0000-4000-8000-000000000001', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000001', 'f6600000-0000-4000-8000-000000000001', 'alert-a', 'R01', 'validation', 'Descripcion', 2, 'PRODUCTO A', 'Alerta asignada al validador A.', 'pending'),
  ('07670000-0000-4000-8000-000000000002', 'c3300000-0000-4000-8000-000000000001', 'b2200000-0000-4000-8000-000000000001', 'e5500000-0000-4000-8000-000000000002', null, 'alert-b', 'R15', 'validation', 'Descripcion', 2, 'PRODUCTO B', 'Alerta asignada al validador B.', 'pending');

insert into storage.objects (bucket_id, name, owner_id, metadata)
values (
  'pqm-private',
  'b2200000-0000-4000-8000-000000000001/c3300000-0000-4000-8000-000000000001/panel/panel-prueba-rls.xlsx',
  'a1100000-0000-4000-8000-000000000001',
  '{"mimetype":"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}'::jsonb
);

-- Líder: ve toda la carga, todo el equipo y ambos bloques.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","iat":1900000000}',
  true
);
select extensions.is((select count(*) from public.assignment_blocks where upload_id = 'c3300000-0000-4000-8000-000000000001'), 2::bigint, 'el líder ve todos los bloques');
select extensions.is((select count(*) from public.workspace_members where workspace_id = 'b2200000-0000-4000-8000-000000000001'), 4::bigint, 'el líder ve todo el equipo');
select extensions.is((select count(*) from storage.objects where bucket_id = 'pqm-private' and name like '%panel-prueba-rls.xlsx'), 1::bigint, 'el líder puede leer el panel original');
reset role;

-- Validador A: solo su membresía, su bloque, su tarea y su alerta.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","iat":1900000000}',
  true
);
select extensions.is((select count(*) from public.workspace_members where workspace_id = 'b2200000-0000-4000-8000-000000000001'), 1::bigint, 'el validador solo ve su propia membresía');
select extensions.is((select count(*) from public.assignment_blocks where id = 'd4400000-0000-4000-8000-000000000001'), 1::bigint, 'el validador ve su bloque asignado');
select extensions.is((select count(*) from public.assignment_blocks where id = 'd4400000-0000-4000-8000-000000000002'), 0::bigint, 'el validador no ve el bloque de otra persona');
select extensions.is((select count(*) from public.review_tasks where id = 'e5500000-0000-4000-8000-000000000001'), 1::bigint, 'el validador ve su tarea');
select extensions.is((select count(*) from public.review_tasks where id = 'e5500000-0000-4000-8000-000000000002'), 0::bigint, 'el validador no ve la tarea ajena');
select extensions.is((select count(*) from public.validation_alerts where id = '07670000-0000-4000-8000-000000000001'), 1::bigint, 'el validador ve su alerta');
select extensions.is((select count(*) from public.validation_alerts where id = '07670000-0000-4000-8000-000000000002'), 0::bigint, 'el validador no ve la alerta ajena');
select extensions.is((select count(*) from public.source_rows where id = 910004), 0::bigint, 'el validador no ve una fila no relacionada');
select extensions.is((select count(*) from storage.objects where bucket_id = 'pqm-private' and name like '%panel-prueba-rls.xlsx'), 0::bigint, 'el validador no puede leer el panel original');
select extensions.is(
  (select task_count from public.get_upload_assignment_metrics('c3300000-0000-4000-8000-000000000001')),
  1::bigint,
  'las métricas solo cuentan la tarea asignada al validador'
);
select extensions.is(
  (select alert_count from public.get_upload_assignment_metrics('c3300000-0000-4000-8000-000000000001')),
  1::bigint,
  'las métricas solo cuentan la alerta asignada al validador'
);
select extensions.is(
  (select id::text from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_asc', 1, 50
  )),
  'e5500000-0000-4000-8000-000000000001',
  'la bandeja devuelve la tarea propia y no la ajena'
);
select extensions.is(
  (select total_count from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_asc', 1, 50
  )),
  1::bigint,
  'el total paginado también respeta la asignación del validador'
);

select extensions.throws_ok(
  $$select public.add_related_row_to_block_guarded('d4400000-0000-4000-8000-000000000001', 910004, 1)$$,
  '42501',
  'El registro no está relacionado con ninguna alerta de este bloque.',
  'no se puede añadir una fila sin relación al bloque'
);
select extensions.lives_ok(
  $$select public.add_related_row_to_block_guarded('d4400000-0000-4000-8000-000000000001', 910003, 1)$$,
  'se puede añadir al bloque un registro relacionado sin responsable'
);
select extensions.ok(
  exists (select 1 from public.review_tasks where source_row_id = 910003 and is_related_only),
  'la tarea relacionada queda visible para el responsable del bloque'
);
select extensions.is(
  (select member_count from public.assignment_blocks where id = 'd4400000-0000-4000-8000-000000000001'),
  2,
  'añadir un relacionado no duplica el conteo de miembros que ya incluía el contexto'
);

select extensions.throws_ok(
  $$select public.save_related_cell_resolution_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    2::smallint, 'Descripcion', 'PRODUCTO A CONTEXTO', 'PRODUCTO A',
    null,
    '18780000-0000-4000-8000-000000000016'
  )$$,
  '22023',
  'Registro, versión e identificador de mutación son obligatorios.',
  'la edición relacionada no admite una versión nula'
);
select extensions.throws_ok(
  $$select public.confirm_related_task_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    null,
    '18780000-0000-4000-8000-000000000017'
  )$$,
  '22023',
  'Registro, versión e identificador de mutación son obligatorios.',
  'la confirmación relacionada no admite una versión nula'
);

select extensions.throws_ok(
  $$select public.save_related_cell_resolution_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    99::smallint, 'Descripcion', 'PRODUCTO A CONTEXTO', 'PRODUCTO A',
    (select version from public.review_tasks where source_row_id = 910003),
    '18780000-0000-4000-8000-000000000010'
  )$$,
  '22023',
  'El índice de columna no existe en el Excel original.',
  'el overlay rechaza un índice fuera de los encabezados originales'
);
select extensions.throws_ok(
  $$select public.save_related_cell_resolution_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    2::smallint, 'Descripcion', 'ORIGINAL INVENTADO', 'PRODUCTO A',
    (select version from public.review_tasks where source_row_id = 910003),
    '18780000-0000-4000-8000-000000000011'
  )$$,
  '22023',
  'El valor original no coincide con la fuente inmutable.',
  'el overlay rechaza evidencia original adulterada'
);
select extensions.lives_ok(
  $$select public.save_related_cell_resolution_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    2::smallint, 'Descripcion', 'PRODUCTO A CONTEXTO', 'PRODUCTO A',
    (select version from public.review_tasks where source_row_id = 910003),
    '18780000-0000-4000-8000-000000000012'
  )$$,
  'el validador puede guardar una corrección relacionada íntegra'
);
select extensions.throws_ok(
  $$select public.confirm_related_task_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    (select version from public.review_tasks where source_row_id = 910003),
    '18780000-0000-4000-8000-000000000013'
  )$$,
  '55000',
  'Un líder debe reabrir el registro antes de confirmarlo nuevamente.',
  'un validador no puede decidir otra vez una tarea relacionada resuelta'
);

select extensions.lives_ok(
  $$select public.resolve_alert_guarded('07670000-0000-4000-8000-000000000001', 1, 'confirmed_correct', null, '18780000-0000-4000-8000-000000000001', null)$$,
  'el validador puede resolver su propia alerta'
);
select extensions.throws_ok(
  $$select public.reopen_alert_guarded('07670000-0000-4000-8000-000000000001', 2, 'intento de validador', '18780000-0000-4000-8000-000000000002')$$,
  '42501',
  'Se requiere el rol de líder activo.',
  'un validador no puede reabrir una decisión'
);
reset role;

-- El líder sí puede reabrir exactamente esa decisión.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","iat":1900000000}',
  true
);
select extensions.lives_ok(
  $$select public.reopen_alert_guarded('07670000-0000-4000-8000-000000000001', 2, 'revisión del líder', '18780000-0000-4000-8000-000000000003')$$,
  'el líder puede reabrir una decisión'
);
select extensions.is(
  (select status::text from public.validation_alerts where id = '07670000-0000-4000-8000-000000000001'),
  'reopened',
  'la alerta queda reabierta'
);
select extensions.lives_ok(
  $$select public.reopen_related_task_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    (select version from public.review_tasks where source_row_id = 910003),
    'corrección relacionada a revisar',
    '18780000-0000-4000-8000-000000000014'
  )$$,
  'el líder puede reabrir una tarea relacionada resuelta'
);
select extensions.is(
  (select status::text from public.review_tasks where source_row_id = 910003),
  'reopened',
  'la tarea relacionada queda reabierta y sin overlay'
);
reset role;

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","iat":1900000000}',
  true
);
select extensions.lives_ok(
  $$select public.confirm_related_task_guarded(
    (select id from public.review_tasks where source_row_id = 910003),
    (select version from public.review_tasks where source_row_id = 910003),
    '18780000-0000-4000-8000-000000000015'
  )$$,
  'tras la reapertura el validador puede confirmar que el registro está correcto'
);
select extensions.is(
  (select confirmed_correct_count from public.uploads where id = 'c3300000-0000-4000-8000-000000000001'),
  1,
  'el contador de confirmaciones incluye tareas relacionadas'
);
reset role;

-- Un retry idempotente tampoco puede devolver datos después de reasignar el bloque.
select set_config(
  'test.related_task_id',
  (select id::text from public.review_tasks where source_row_id = 910003),
  true
);
select set_config(
  'test.related_task_version',
  (select version::text from public.review_tasks where source_row_id = 910003),
  true
);
update public.assignment_blocks
set assigned_to = 'a1100000-0000-4000-8000-000000000004'
where id = 'd4400000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","iat":1900000000}',
  true
);
select extensions.throws_ok(
  $$select public.confirm_related_task_guarded(
    current_setting('test.related_task_id')::uuid,
    current_setting('test.related_task_version')::integer,
    '18780000-0000-4000-8000-000000000015'
  )$$,
  '42501',
  'El bloque no está asignado a este usuario.',
  'un retry idempotente revalida que el bloque siga asignado al actor'
);
reset role;
update public.assignment_blocks
set assigned_to = 'a1100000-0000-4000-8000-000000000003'
where id = 'd4400000-0000-4000-8000-000000000001';

-- El watermark sobrevive a completar el cambio de PIN y bloquea JWT anteriores.
update public.profiles
set must_change_pin = true
where user_id = 'a1100000-0000-4000-8000-000000000003';
update public.profiles
set must_change_pin = false
where user_id = 'a1100000-0000-4000-8000-000000000003';
select extensions.ok(
  (select pin_reset_at is not null from public.profiles
   where user_id = 'a1100000-0000-4000-8000-000000000003'),
  'completar el PIN conserva el watermark de credenciales'
);
update public.profiles
set pin_reset_at = to_timestamp(1900000001)
where user_id = 'a1100000-0000-4000-8000-000000000003';
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","iat":1900000000}',
  true
);
select extensions.is(
  (select count(*) from public.assignment_blocks
   where id = 'd4400000-0000-4000-8000-000000000001'),
  0::bigint,
  'una sesión anterior al reset deja de ver incluso su bloque asignado'
);
reset role;
update public.profiles set pin_reset_at = null
where user_id = 'a1100000-0000-4000-8000-000000000003';

update public.assignment_blocks
set weight = weight
where id = 'd4400000-0000-4000-8000-000000000002';
select extensions.is(
  (select member_count from public.assignment_blocks
   where id = 'd4400000-0000-4000-8000-000000000002'),
  1,
  'una alerta sin grupo conserva su propia fila en member_count'
);

-- Dos líderes permiten desactivar uno; el trigger protege al último restante.
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000002","role":"authenticated","iat":1900000000}',
  true
);
select extensions.lives_ok(
  $$select public.set_workspace_member_active('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000001', false)$$,
  'se puede desactivar un líder cuando queda otro activo'
);
select extensions.throws_ok(
  $$select public.set_workspace_member_active('b2200000-0000-4000-8000-000000000001', 'a1100000-0000-4000-8000-000000000002', false)$$,
  '23514',
  'No se puede desactivar o eliminar al último líder activo.',
  'no se puede desactivar al último líder activo'
);
select extensions.ok(
  exists (
    select 1 from public.workspace_members
    where workspace_id = 'b2200000-0000-4000-8000-000000000001'
      and user_id = 'a1100000-0000-4000-8000-000000000002'
      and role = 'leader' and is_active
  ),
  'el último líder permanece activo tras el rechazo'
);
reset role;

-- La ordenación por regla se aplica al conjunto completo antes de paginar.
insert into public.source_rows (
  id, upload_id, workspace_id, external_key, excel_row, row_id,
  id_dn_w, barcode, description, field_values
)
values (
  910005, 'c3300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001', 'row-6', 6,
  'ROW-R25', 'ID-R25', '025', 'PRODUCTO R25',
  '{"Descripcion":"PRODUCTO R25"}'::jsonb
);
insert into public.review_tasks (
  id, upload_id, workspace_id, external_key, source_row_id,
  assignment_block_id, status, alert_count
)
values (
  'e5500000-0000-4000-8000-000000000003',
  'c3300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'task-r25', 910005, 'd4400000-0000-4000-8000-000000000001',
  'pending', 1
);
insert into public.validation_alerts (
  id, upload_id, workspace_id, task_id, event_key, rule_code,
  category, affected_field, source_column_index, original_value, detail, status
)
values (
  '07670000-0000-4000-8000-000000000003',
  'c3300000-0000-4000-8000-000000000001',
  'b2200000-0000-4000-8000-000000000001',
  'e5500000-0000-4000-8000-000000000003',
  'alert-r25', 'R25', 'validation', 'Precio_Unidad', 3,
  '10000', 'Precio superior al rango esperado.', 'pending'
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"a1100000-0000-4000-8000-000000000003","role":"authenticated","iat":1900000000}',
  true
);
select extensions.is(
  (select primary_rule from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_asc', 1, 1
  )),
  'R01',
  'rule_asc comienza por la regla de menor rango'
);
select extensions.is(
  (select primary_rule from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_desc', 1, 1
  )),
  'R25',
  'rule_desc comienza por la regla de mayor rango'
);
select extensions.is(
  (select primary_rule from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_asc', 2, 1
  )),
  'R25',
  'la segunda página continúa el orden global sin repetir la primera tarea'
);
select extensions.is(
  (select total_count from public.browse_review_tasks(
    'c3300000-0000-4000-8000-000000000001', null, null, null, 'rule_asc', 1, 1
  )),
  3::bigint,
  'el total incluye las tres tareas visibles aunque la página contenga una'
);
reset role;

select * from extensions.finish();
rollback;
