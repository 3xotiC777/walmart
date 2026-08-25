import { getViewer } from '@/lib/auth';
import { classifyDatabaseError, ingestionPayloadSummary } from '@/lib/database-error';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { uploadId } = await context.params;
  const body = await request.json().catch(() => ({}));
  if (typeof body.batchKey !== 'string' || !body.payload || typeof body.payload !== 'object') return jsonError('Lote inválido.');
  const supabase = await createServerSupabaseClient();
  const startedAt = performance.now();
  const { data, error } = await supabase.rpc('ingest_validation_batch', {
    p_upload_id: uploadId,
    p_batch_key: body.batchKey,
    p_payload: body.payload,
  });
  if (error) {
    const classification = classifyDatabaseError(error);
    console.error('ingest_validation_batch_failed', {
      uploadId,
      batchKey: body.batchKey,
      counts: ingestionPayloadSummary(body.payload),
      code: classification.code,
      retryable: classification.retryable,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ ok: false, ...classification }, { status: classification.status });
  }
  return NextResponse.json({ ok: true, result: data });
}
