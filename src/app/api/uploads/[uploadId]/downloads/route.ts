import { getViewer } from '@/lib/auth';
import { parseExportAuditPayload } from '@/lib/export-audit';
import { jsonError, validUuid } from '@/lib/http';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);

  const { uploadId } = await context.params;
  if (!validUuid(uploadId)) return jsonError('La jornada no es válida.');
  const body = parseExportAuditPayload(await request.json().catch(() => null));
  if (!body) return jsonError('Los datos de la descarga no son válidos.');

  const supabase = await createServerSupabaseClient();
  const { data: upload, error: uploadError } = await supabase
    .from('uploads')
    .select('id, workspace_id')
    .eq('id', uploadId)
    .eq('workspace_id', viewer.workspaceId)
    .maybeSingle();
  if (uploadError) return jsonError(uploadError.message, 400);
  if (!upload) return jsonError('La jornada no existe o no pertenece a este espacio.', 404);

  const admin = createAdminSupabaseClient();
  const { error } = await admin.from('audit_events').insert({
    workspace_id: viewer.workspaceId,
    upload_id: upload.id,
    actor_user_id: viewer.id,
    event_type: 'export.downloaded',
    entity_type: 'export',
    entity_id: upload.id,
    payload: {
      kind: body.kind,
      file_name: body.fileName,
      is_draft: body.isDraft,
      pending_tasks: body.pendingTasks,
      remaining_alerts: body.remainingAlerts,
      upload_version: body.uploadVersion,
    },
  });
  if (error) return jsonError('No fue posible registrar la descarga.', 500);
  return NextResponse.json({ ok: true });
}
