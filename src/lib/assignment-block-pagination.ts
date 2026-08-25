import type { SupabaseClient } from '@supabase/supabase-js';

export const ASSIGNMENT_BLOCK_PAGE_SIZE = 500;

export interface AssignmentBlockRow {
  id: string;
  block_key: string;
  status: string;
  alert_count: number;
  member_count: number;
  invoice_count: number;
  weight: number | string;
  assigned_to: string | null;
  version: number;
  assignment_version: number;
}

interface AssignmentBlockPage {
  rows: AssignmentBlockRow[];
  total: number | null;
}

export interface AssignmentBlockCollection {
  blocks: AssignmentBlockRow[];
  total: number;
}

export async function collectAssignmentBlockPages(
  loadPage: (from: number, to: number, includeCount: boolean) => Promise<AssignmentBlockPage>,
  pageSize = ASSIGNMENT_BLOCK_PAGE_SIZE,
): Promise<AssignmentBlockCollection> {
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new Error('El tamaño de página para los bloques no es válido.');
  }

  const blocks: AssignmentBlockRow[] = [];
  let expectedTotal: number | null = null;

  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1, from === 0);
    if (from === 0) expectedTotal = page.total;
    blocks.push(...page.rows);

    if (expectedTotal !== null && blocks.length >= expectedTotal) break;
    if (page.rows.length < pageSize) break;
  }

  const total = expectedTotal ?? blocks.length;
  const uniqueIds = new Set(blocks.map((block) => block.id));
  if (blocks.length !== total || uniqueIds.size !== total) {
    throw new Error(`No fue posible cargar todos los bloques del reparto (${blocks.length} de ${total}).`);
  }

  return { blocks, total };
}

export async function fetchAllAssignmentBlocks(
  supabase: SupabaseClient,
  uploadId: string,
): Promise<AssignmentBlockCollection> {
  return collectAssignmentBlockPages(async (from, to, includeCount) => {
    const { data, error, count } = await supabase
      .from('assignment_blocks')
      .select(
        'id, block_key, status, alert_count, member_count, invoice_count, weight, assigned_to, version, assignment_version',
        includeCount ? { count: 'exact' } : undefined,
      )
      .eq('upload_id', uploadId)
      .order('weight', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to);

    if (error) throw new Error(error.message);
    return {
      rows: (data ?? []) as AssignmentBlockRow[],
      total: includeCount ? count : null,
    };
  });
}
