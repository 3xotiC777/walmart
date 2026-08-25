import { getViewer } from '@/lib/auth';
import { alertMutationError, shouldRetryAlertMutation } from '@/lib/alert-decision-context';
import { jsonError, validPositiveInteger, validUuid } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ alertId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return jsonError('La sesión expiró.', 401);
  const { alertId } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!validUuid(alertId) || !validUuid(body.mutationId)
      || !validPositiveInteger(body.expectedVersion)) {
    return jsonError('Alerta, versión e identificador de operación no válidos.');
  }
  const supabase = await createServerSupabaseClient();
  if (body.action === 'reopen') {
    if (viewer.role !== 'leader') return jsonError('Solo un líder puede reabrir decisiones.', 403);
    const reason = String(body.reason ?? 'Revisión solicitada por líder').trim();
    if (!reason) return jsonError('La reapertura requiere un motivo.');
    const { data, error } = await supabase.rpc('reopen_alert_guarded', {
      p_alert_id: alertId,
      p_expected_version: body.expectedVersion,
      p_reason: reason,
      p_client_mutation_id: body.mutationId,
    });
    if (error) return jsonError(error.message, error.code === '40001' ? 409 : 400);
    return NextResponse.json({ ok: true, alert: data });
  }

  const decisions: Record<string, string> = { apply: 'apply_suggestion', manual: 'manual_edit', correct: 'confirmed_correct' };
  const decision = decisions[String(body.action)];
  if (!decision) return jsonError('Decisión no reconocida.');
  const parameters = {
    p_alert_id: alertId,
    p_expected_version: body.expectedVersion,
    p_decision: decision,
    p_resolved_value: body.action === 'manual' ? String(body.value ?? '') : null,
    p_client_mutation_id: body.mutationId,
    p_note: body.note ? String(body.note) : null,
  };
  let attempt = 0;
  let result = await supabase.rpc('resolve_alert_guarded', parameters);
  while (result.error && shouldRetryAlertMutation(result.error.code, attempt)) {
    await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    attempt += 1;
    result = await supabase.rpc('resolve_alert_guarded', parameters);
  }
  const { data, error } = result;
  if (error) {
    const translated = alertMutationError(error.code, error.message);
    console.error('[alerts.resolve] RPC failed', {
      alertId,
      code: error.code,
      attempts: attempt + 1,
      retryable: translated.retryable,
    });
    return jsonError(translated.message, translated.status, {
      code: error.code,
      retryable: translated.retryable,
    });
  }
  return NextResponse.json({ ok: true, alert: data });
}
