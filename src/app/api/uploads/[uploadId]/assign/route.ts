import { getViewer } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { uploadId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const expectedUploadVersion = Number(body.expectedUploadVersion);
  if (!Number.isInteger(expectedUploadVersion) || expectedUploadVersion < 0) {
    return jsonError('La versión de la jornada no es válida. Actualice la pantalla.', 409);
  }
  const supabase = await createServerSupabaseClient();
  if (body.action === 'propose') {
    const validatorIds = Array.isArray(body.validatorIds) ? body.validatorIds : null;
    const { error } = await supabase.rpc('propose_balanced_assignments_versioned', { p_upload_id: uploadId, p_expected_upload_version: expectedUploadVersion, p_validator_ids: validatorIds });
    if (error) return jsonError(error.message, error.code === '40001' ? 409 : 400);
    const [{ data: upload }, { data: assignments }] = await Promise.all([
      supabase.from('uploads').select('version').eq('id', uploadId).single(),
      supabase.from('assignment_blocks').select('id, assigned_to, version').eq('upload_id', uploadId),
    ]);
    return NextResponse.json({ ok: true, uploadVersion: upload?.version, assignments: (assignments ?? []).map((item) => ({ block_id: item.id, assigned_to: item.assigned_to, version: item.version })) });
  }
  if (body.action === 'publish') {
    if (!Array.isArray(body.assignments)) return jsonError('Las asignaciones no son válidas.');
    const { data, error } = await supabase.rpc('publish_assignments_versioned', { p_upload_id: uploadId, p_expected_upload_version: expectedUploadVersion, p_assignments: body.assignments });
    if (error) return jsonError(error.message, error.code === '40001' ? 409 : 400);
    return NextResponse.json({ ok: true, upload: data });
  }
  return jsonError('Acción no reconocida.');
}
