import { getViewer } from '@/lib/auth';
import { jsonError, validPositiveInteger, validUuid } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ blockId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return jsonError('La sesión expiró.', 401);
  const { blockId } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (!validUuid(blockId) || !validPositiveInteger(body.sourceRowId)
      || !validPositiveInteger(body.expectedBlockVersion)) {
    return jsonError('Bloque, fila relacionada o versión no válidos.');
  }
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc('add_related_row_to_block_guarded', {
    p_block_id: blockId,
    p_source_row_id: body.sourceRowId,
    p_expected_block_version: body.expectedBlockVersion,
  });
  if (error) return jsonError(error.message, error.code === '40001' || error.code === '23505' ? 409 : 400);
  return NextResponse.json({ ok: true, task: data });
}
