import { getViewer } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { uploadId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('fail_upload', {
    p_upload_id: uploadId,
    p_message: String(body.message ?? 'Carga interrumpida').slice(0, 1_000),
  });
  if (error) return jsonError(error.message, 400);
  return NextResponse.json({ ok: true });
}
