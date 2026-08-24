import { getViewer } from '@/lib/auth';
import { jsonError, validPositiveInteger, validUuid } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function rpcStatus(code: string | undefined): number {
  if (code === '40001' || code === '23505' || code === '23514' || code === '55000') return 409;
  if (code === '42501') return 403;
  if (code === 'P0002') return 404;
  return 400;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ blockId: string }> },
) {
  const viewer = await getViewer();
  if (!viewer) return jsonError('La sesión expiró.', 401);
  if (viewer.role !== 'leader') return jsonError('Solo un líder puede mover o fusionar bloques.', 403);

  const { blockId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const action = body.action === 'move' || body.action === 'merge' ? body.action : null;
  const sourceBlockId = typeof body.sourceBlockId === 'string' ? body.sourceBlockId : '';
  const mutationId = typeof body.mutationId === 'string' ? body.mutationId : '';
  const expectedTargetVersion = Number(body.expectedTargetVersion);
  const expectedSourceVersion = Number(body.expectedSourceVersion);

  if (!validUuid(blockId) || !validUuid(sourceBlockId) || !validUuid(mutationId)) {
    return jsonError('Los identificadores de bloque o mutación no son válidos.');
  }
  if (!action || blockId === sourceBlockId) return jsonError('La operación entre bloques no es válida.');
  if (!validPositiveInteger(expectedTargetVersion) || !validPositiveInteger(expectedSourceVersion)) {
    return jsonError('Las versiones de ambos bloques son obligatorias.');
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('reconcile_assignment_blocks_guarded', {
    p_target_block_id: blockId,
    p_source_block_id: sourceBlockId,
    p_action: action,
    p_expected_target_version: expectedTargetVersion,
    p_expected_source_version: expectedSourceVersion,
    p_client_mutation_id: mutationId,
  });
  if (error) return jsonError(error.message, rpcStatus(error.code));
  return NextResponse.json({ ok: true, result: data });
}
