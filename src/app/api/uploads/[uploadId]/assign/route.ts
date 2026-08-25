import { getViewer } from '@/lib/auth';
import { fetchAllAssignmentBlocks } from '@/lib/assignment-block-pagination';
import { jsonError } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assignmentErrorStatus(code?: string) {
  if (code === '42501') return 403;
  return code === '40001' || code === '55P03' || code === '55000' || code === '23505' ? 409 : 400;
}

function readValidatorIds(value: unknown): { ids: string[]; error?: string } {
  if (!Array.isArray(value) || value.length === 0) {
    return { ids: [], error: 'Selecciona al menos un validador para esta jornada.' };
  }
  const ids = value.filter((item): item is string => typeof item === 'string');
  if (ids.length !== value.length || ids.some((id) => !UUID_PATTERN.test(id))) {
    return { ids: [], error: 'La selección de validadores no es válida.' };
  }
  if (new Set(ids).size !== ids.length) {
    return { ids: [], error: 'Cada validador debe aparecer una sola vez.' };
  }
  return { ids };
}

function readAssignments(value: unknown, validatorIds: readonly string[]) {
  if (!Array.isArray(value)) return { assignments: [], error: 'Las asignaciones no son válidas.' };
  const selected = new Set(validatorIds);
  const assignments: Array<{ block_id: string; assigned_to: string; expected_version: number }> = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') return { assignments: [], error: 'Las asignaciones no son válidas.' };
    const candidate = item as Record<string, unknown>;
    const version = Number(candidate.expected_version);
    if (
      typeof candidate.block_id !== 'string'
      || !UUID_PATTERN.test(candidate.block_id)
      || typeof candidate.assigned_to !== 'string'
      || !UUID_PATTERN.test(candidate.assigned_to)
      || !selected.has(candidate.assigned_to)
      || !Number.isInteger(version)
      || version < 1
    ) {
      return { assignments: [], error: 'Cada bloque debe tener un responsable seleccionado y una versión válida.' };
    }
    assignments.push({ block_id: candidate.block_id, assigned_to: candidate.assigned_to, expected_version: version });
  }
  if (new Set(assignments.map((item) => item.block_id)).size !== assignments.length) {
    return { assignments: [], error: 'Cada bloque debe aparecer una sola vez.' };
  }
  return { assignments };
}

export async function POST(request: Request, context: { params: Promise<{ uploadId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { uploadId } = await context.params;
  const parsedBody: unknown = await request.json().catch(() => ({}));
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) {
    return jsonError('La solicitud de reparto no es válida.');
  }
  const body = parsedBody as Record<string, unknown>;
  const expectedUploadVersion = Number(body.expectedUploadVersion);
  if (!Number.isInteger(expectedUploadVersion) || expectedUploadVersion < 1) {
    return jsonError('La versión de la jornada no es válida. Actualice la pantalla.', 409);
  }
  const mayFinalizeWithoutValidators = body.action === 'publish'
    && Array.isArray(body.assignments)
    && body.assignments.length === 0;
  const validatorSelection: { ids: string[]; error?: string } = mayFinalizeWithoutValidators
    ? { ids: [] as string[] }
    : readValidatorIds(body.validatorIds);
  if (validatorSelection.error) return jsonError(validatorSelection.error);
  const validatorIds = validatorSelection.ids;
  const supabase = await createServerSupabaseClient();
  if (body.action === 'propose') {
    const { error } = await supabase.rpc('propose_balanced_assignments_versioned', { p_upload_id: uploadId, p_expected_upload_version: expectedUploadVersion, p_validator_ids: validatorIds });
    if (error) return jsonError(error.message, assignmentErrorStatus(error.code));
    const [{ data: upload }, assignmentCollection] = await Promise.all([
      supabase.from('uploads').select('version').eq('id', uploadId).single(),
      fetchAllAssignmentBlocks(supabase, uploadId),
    ]);
    return NextResponse.json({ ok: true, uploadVersion: upload?.version, blockCount: assignmentCollection.total, assignments: assignmentCollection.blocks.map((item) => ({ block_id: item.id, assigned_to: item.assigned_to, version: item.version })) });
  }
  if (body.action === 'publish') {
    const parsed = readAssignments(body.assignments, validatorIds);
    if (parsed.error) return jsonError(parsed.error);
    const { data, error } = await supabase.rpc('publish_assignments_versioned', { p_upload_id: uploadId, p_expected_upload_version: expectedUploadVersion, p_assignments: parsed.assignments });
    if (error) return jsonError(error.message, assignmentErrorStatus(error.code));
    return NextResponse.json({ ok: true, upload: data });
  }
  if (body.action === 'preview-redistribution') {
    const { data, error } = await supabase.rpc('preview_pending_reassignment_versioned', {
      p_upload_id: uploadId,
      p_expected_upload_version: expectedUploadVersion,
      p_validator_ids: validatorIds,
    });
    if (error) return jsonError(error.message, assignmentErrorStatus(error.code));
    const previewRows = (data ?? []) as Array<{
      block_id: string;
      assignee_id: string;
      block_assignment_version: number;
      remaining_weight: number | string;
    }>;
    const assignments = previewRows.map((item) => ({
      block_id: item.block_id,
      assigned_to: item.assignee_id,
      version: item.block_assignment_version,
      remaining_weight: item.remaining_weight,
    }));
    return NextResponse.json({
      ok: true,
      assignmentVersion: expectedUploadVersion,
      uploadVersion: expectedUploadVersion,
      blockCount: assignments.length,
      assignments,
    });
  }
  if (body.action === 'publish-redistribution') {
    const parsed = readAssignments(body.assignments, validatorIds);
    if (parsed.error) return jsonError(parsed.error);
    if (typeof body.clientMutationId !== 'string' || !UUID_PATTERN.test(body.clientMutationId)) {
      return jsonError('El identificador de la publicación no es válido.');
    }
    const { data, error } = await supabase.rpc('publish_pending_reassignment_versioned', {
      p_upload_id: uploadId,
      p_expected_upload_version: expectedUploadVersion,
      p_validator_ids: validatorIds,
      p_assignments: parsed.assignments,
      p_client_mutation_id: body.clientMutationId,
    });
    if (error) return jsonError(error.message, assignmentErrorStatus(error.code));
    return NextResponse.json({ ok: true, assignmentVersion: data?.assignment_version, upload: data });
  }
  return jsonError('Acción no reconocida.');
}
