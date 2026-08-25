import { getViewer } from '@/lib/auth';
import { classifyDatabaseError } from '@/lib/database-error';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { uploadId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const supabase = await createServerSupabaseClient();
  const startedAt = performance.now();
  const { data, error } = await supabase.rpc('finalize_upload_ingestion', {
    p_upload_id: uploadId,
    p_source_total_rows: body.sourceTotalRows,
    p_expected_stored_row_count: body.storedRowCount,
    p_expected_task_count: body.taskCount,
    p_expected_alert_count: body.alertCount,
    p_expected_batch_count: body.batchCount,
    p_manifest_hash_hex: body.manifestHash,
  });
  if (error) {
    const classification = classifyDatabaseError(error);
    console.error('finalize_upload_ingestion_failed', {
      uploadId,
      code: classification.code,
      retryable: classification.retryable,
      durationMs: Math.round(performance.now() - startedAt),
    });
    return NextResponse.json({ ok: false, ...classification }, { status: classification.status });
  }
  return NextResponse.json({ ok: true, upload: data });
}
