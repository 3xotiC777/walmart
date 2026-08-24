export const RELATED_PAGE_SIZE = 50;

export interface RelatedGroupMember {
  group_id: string;
  is_alert: boolean;
}

export interface RelatedRowProjection {
  id: number;
  excel_row: number;
  row_id: string | null;
  barcode: string | null;
  description: string | null;
  field_values: unknown;
  group_members: RelatedGroupMember | RelatedGroupMember[] | null;
}

export interface RelatedTaskProjection {
  id: string;
  source_row_id: number;
  version: number;
  assignment_blocks:
    | { id: string; assigned_to: string | null; block_key: string; version: number }
    | Array<{ id: string; assigned_to: string | null; block_key: string; version: number }>
    | null;
}

export interface RelatedRecordView {
  id: number;
  excel_row: number;
  row_id: string | null;
  barcode: string | null;
  description: string | null;
  field_values: Record<string, unknown>;
  is_alert: boolean;
  group_ids: string[];
  task_id: string | null;
  task_version: number | null;
  block_id: string | null;
  block_key: string | null;
  block_version: number | null;
  owner: string | null;
}

export interface RelatedPage {
  items: RelatedRecordView[];
  nextCursor: string | null;
  hasMore: boolean;
}

function asObject(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function taskOwner(task: RelatedTaskProjection): string | null {
  const block = Array.isArray(task.assignment_blocks)
    ? task.assignment_blocks[0]
    : task.assignment_blocks;
  return block?.assigned_to ?? null;
}

/**
 * Normaliza la respuesta embebida de PostgREST. Aunque la consulta principal ya
 * devuelve una fila por source_row, esta segunda deduplicación evita duplicados
 * si cambia la forma del join y conserva todos los grupos e indicadores de alerta.
 */
export function buildRelatedPage(
  rows: RelatedRowProjection[],
  tasks: RelatedTaskProjection[],
  pageSize = RELATED_PAGE_SIZE,
): RelatedPage {
  const taskByRow = new Map(tasks.map((task) => [task.source_row_id, task]));
  const byRow = new Map<number, RelatedRecordView>();

  for (const row of rows) {
    const members = (Array.isArray(row.group_members)
      ? row.group_members
      : row.group_members ? [row.group_members] : [])
      .filter((member) => Boolean(member.group_id));
    const existing = byRow.get(row.id);

    if (existing) {
      existing.is_alert ||= members.some((member) => member.is_alert);
      for (const member of members) {
        if (!existing.group_ids.includes(member.group_id)) existing.group_ids.push(member.group_id);
      }
      continue;
    }

    const task = taskByRow.get(row.id);
    byRow.set(row.id, {
      id: row.id,
      excel_row: row.excel_row,
      row_id: row.row_id,
      barcode: row.barcode,
      description: row.description,
      field_values: asObject(row.field_values),
      is_alert: members.some((member) => member.is_alert),
      group_ids: [...new Set(members.map((member) => member.group_id))].sort(),
      task_id: task?.id ?? null,
      task_version: task?.version ?? null,
      block_id: task ? (Array.isArray(task.assignment_blocks) ? task.assignment_blocks[0]?.id : task.assignment_blocks?.id) ?? null : null,
      block_key: task ? (Array.isArray(task.assignment_blocks) ? task.assignment_blocks[0]?.block_key : task.assignment_blocks?.block_key) ?? null : null,
      block_version: task ? (Array.isArray(task.assignment_blocks) ? task.assignment_blocks[0]?.version : task.assignment_blocks?.version) ?? null : null,
      owner: task ? taskOwner(task) : null,
    });
  }

  const normalized = [...byRow.values()].sort((left, right) => left.id - right.id);
  const items = normalized.slice(0, pageSize);
  const hasMore = normalized.length > pageSize;

  return {
    items,
    hasMore,
    nextCursor: hasMore && items.length > 0 ? String(items.at(-1)!.id) : null,
  };
}

export function parseRelatedCursor(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const cursor = Number(value);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}
