import { getViewer } from '@/lib/auth';
import { jsonError, validPositiveInteger, validUuid } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return jsonError('La sesión expiró.', 401);
  const { taskId } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!validUuid(taskId) || !validUuid(body.mutationId)
      || !validPositiveInteger(body.expectedVersion)) {
    return jsonError('Registro, versión e identificador de operación no válidos.');
  }
  const supabase = await createServerSupabaseClient();
  if (body.action === 'reopen') {
    if (viewer.role !== 'leader') return jsonError('Solo un líder puede reabrir este registro.', 403);
    const reason = String(body.reason ?? '').trim();
    if (!reason) return jsonError('La reapertura requiere un motivo.');
    const { data, error } = await supabase.rpc('reopen_related_task_guarded', {
      p_task_id: taskId,
      p_expected_task_version: body.expectedVersion,
      p_reason: reason,
      p_client_mutation_id: body.mutationId,
    });
    if (error) {
      const status = error.code === '40001' || error.code === '55000' || error.code === '23505'
        ? 409
        : error.code === '42501' ? 403 : 400;
      return jsonError(error.message, status);
    }
    return NextResponse.json({ ok: true, task: data });
  }
  if (body.action === 'correct') {
    const { data, error } = await supabase.rpc('confirm_related_task_guarded', {
      p_task_id: taskId,
      p_expected_task_version: body.expectedVersion,
      p_client_mutation_id: body.mutationId,
    });
    if (error) return jsonError(error.message, error.code === '40001' ? 409 : 400);
    return NextResponse.json({ ok: true, task: data });
  }
  if (body.action === 'edit') {
    if (!Number.isInteger(body.columnIndex) || body.columnIndex < 0 || body.columnIndex > 32_767
        || !String(body.fieldName ?? '').trim()) {
      return jsonError('La columna que se desea corregir no es válida.');
    }
    const { data, error } = await supabase.rpc('save_related_cell_resolution_guarded', {
      p_task_id: taskId,
      p_column_index: body.columnIndex,
      p_field_name: String(body.fieldName ?? ''),
      p_original_value: body.originalValue === null ? null : String(body.originalValue ?? ''),
      p_resolved_value: String(body.resolvedValue ?? ''),
      p_expected_task_version: body.expectedVersion,
      p_client_mutation_id: body.mutationId,
    });
    if (error) return jsonError(error.message, error.code === '40001' ? 409 : 400);
    return NextResponse.json({ ok: true, resolution: data });
  }
  return jsonError('Acción no reconocida.');
}
