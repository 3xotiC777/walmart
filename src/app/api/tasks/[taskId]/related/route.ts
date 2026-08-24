import { getViewer } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import {
  buildRelatedPage,
  parseRelatedCursor,
  RELATED_PAGE_SIZE,
  type RelatedRowProjection,
  type RelatedTaskProjection,
} from '@/lib/related-pagination';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_GROUPS_PER_REQUEST = 64;

export async function GET(request: Request, context: { params: Promise<{ taskId: string }> }) {
  const viewer = await getViewer();
  if (!viewer) return jsonError('La sesión expiró.', 401);

  const { taskId } = await context.params;
  const url = new URL(request.url);
  const requestedGroupIds = [...new Set(url.searchParams.getAll('groupId').filter(Boolean))];
  if (requestedGroupIds.length > MAX_GROUPS_PER_REQUEST || requestedGroupIds.some((id) => !UUID_PATTERN.test(id))) {
    return jsonError('La selección de grupos relacionados no es válida.');
  }

  const cursorText = url.searchParams.get('cursor');
  const cursor = parseRelatedCursor(cursorText);
  if (cursorText !== null && cursor === null) return jsonError('El cursor de paginación no es válido.');

  const supabase = await createServerSupabaseClient();
  const [taskResult, groupResult] = await Promise.all([
    supabase
      .from('review_tasks')
      .select('id, upload_id, source_row_id')
      .eq('id', taskId)
      .maybeSingle(),
    supabase
      .from('validation_alerts')
      .select('group_id')
      .eq('task_id', taskId)
      .not('group_id', 'is', null),
  ]);
  const { data: task, error: taskError } = taskResult;
  if (taskError) return jsonError(taskError.message, 400);
  if (!task) return jsonError('La tarea no existe o no está asignada a este usuario.', 404);

  const { data: alertGroups, error: groupError } = groupResult;
  if (groupError) return jsonError(groupError.message, 400);

  const allowedGroupIds = [...new Set((alertGroups ?? [])
    .map((alert) => alert.group_id)
    .filter((id): id is string => Boolean(id)))];
  const groupIds = requestedGroupIds.length > 0 ? requestedGroupIds : allowedGroupIds;
  if (groupIds.some((id) => !allowedGroupIds.includes(id))) {
    return jsonError('Uno o más grupos no pertenecen a esta tarea.', 403);
  }
  if (groupIds.length === 0) {
    return NextResponse.json({ ok: true, items: [], nextCursor: null, hasMore: false });
  }

  let query = supabase
    .from('source_rows')
    .select('id, excel_row, row_id, barcode, description, field_values, group_members!inner(group_id, is_alert)')
    .eq('upload_id', task.upload_id)
    .in('group_members.group_id', groupIds)
    .neq('id', task.source_row_id)
    .order('id', { ascending: true })
    .limit(RELATED_PAGE_SIZE + 1);
  if (cursor !== null) query = query.gt('id', cursor);

  const { data: rows, error: rowsError } = await query;
  if (rowsError) return jsonError(rowsError.message, 400);

  const sourceIds = (rows ?? []).map((row) => row.id);
  const { data: relatedTasks, error: relatedTaskError } = sourceIds.length > 0
    ? await supabase
      .from('review_tasks')
      .select('id, source_row_id, version, assignment_blocks(id, assigned_to, block_key, version)')
      .eq('upload_id', task.upload_id)
      .in('source_row_id', sourceIds)
    : { data: [], error: null };
  if (relatedTaskError) return jsonError(relatedTaskError.message, 400);

  const page = buildRelatedPage(
    (rows ?? []) as unknown as RelatedRowProjection[],
    (relatedTasks ?? []) as unknown as RelatedTaskProjection[],
  );
  return NextResponse.json({ ok: true, ...page });
}
