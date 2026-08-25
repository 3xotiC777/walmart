export type AssignmentSelectionMode = 'initial' | 'redistribute';

export interface SelectableValidator {
  userId: string;
  /**
   * The assignment page already receives active validators only. Keeping this
   * optional makes that existing contract compatible while still allowing a
   * caller to explicitly exclude an inactive account.
   */
  isActive?: boolean;
}

export interface AssignmentSelectionBlock {
  assignedTo: string | null;
  status?: string;
  pendingTaskCount?: number;
}

export interface AssignmentLoadBlock extends AssignmentSelectionBlock {
  alertCount?: number;
  weight?: number;
}

export interface SelectedValidatorLoad {
  validatorId: string;
  blockCount: number;
  alertCount: number;
  weight: number;
}

function normalizedId(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Normalizes an ordered checkbox selection without changing the order chosen
 * by the leader. Blank entries are ignored and duplicate IDs keep their first
 * occurrence.
 */
export function normalizeSelectedValidatorIds(
  validatorIds: ReadonlyArray<string | null | undefined>,
): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const rawId of validatorIds) {
    const validatorId = normalizedId(rawId);
    if (!validatorId || seen.has(validatorId)) continue;
    seen.add(validatorId);
    normalized.push(validatorId);
  }

  return normalized;
}

/** Returns a safe RPC payload and prevents an empty array from meaning "all". */
export function requireSelectedValidatorIds(
  validatorIds: ReadonlyArray<string | null | undefined>,
): string[] {
  const normalized = normalizeSelectedValidatorIds(validatorIds);
  if (normalized.length === 0) {
    throw new Error('Selecciona al menos un validador para repartir la jornada.');
  }
  return normalized;
}

function hasPendingWork(block: AssignmentSelectionBlock): boolean {
  if (Number.isFinite(block.pendingTaskCount)) {
    return Math.max(0, Number(block.pendingTaskCount)) > 0;
  }
  return block.status !== 'completed';
}

/**
 * Chooses the checkboxes shown as selected when the board opens.
 *
 * - Initial assignment: every active validator starts selected.
 * - Redistribution: only active current owners of blocks with pending work.
 * - If no pending owner is still active, all active validators are selected so
 *   a newly-created team can take over the remaining work.
 */
export function calculateInitialValidatorSelection({
  mode,
  validators,
  blocks = [],
}: {
  mode: AssignmentSelectionMode;
  validators: readonly SelectableValidator[];
  blocks?: readonly AssignmentSelectionBlock[];
}): string[] {
  const activeValidatorIds = normalizeSelectedValidatorIds(
    validators
      .filter((validator) => validator.isActive !== false)
      .map((validator) => validator.userId),
  );

  if (mode === 'initial') return activeValidatorIds;

  const pendingOwnerIds = new Set(
    blocks
      .filter(hasPendingWork)
      .map((block) => normalizedId(block.assignedTo))
      .filter(Boolean),
  );
  const currentActiveOwners = activeValidatorIds.filter((validatorId) => (
    pendingOwnerIds.has(validatorId)
  ));

  return currentActiveOwners.length > 0 ? currentActiveOwners : activeValidatorIds;
}

/**
 * Summarizes only the selected team. Callers may pass all blocks or just the
 * pending/proposed subset depending on the board metric they want to display.
 */
export function calculateSelectedValidatorLoads(
  validatorIds: ReadonlyArray<string | null | undefined>,
  blocks: readonly AssignmentLoadBlock[],
): SelectedValidatorLoad[] {
  const selectedIds = requireSelectedValidatorIds(validatorIds);
  const selectedSet = new Set(selectedIds);
  const loads = new Map(selectedIds.map((validatorId) => [validatorId, {
    validatorId,
    blockCount: 0,
    alertCount: 0,
    weight: 0,
  }]));

  for (const block of blocks) {
    const assigneeId = normalizedId(block.assignedTo);
    if (!selectedSet.has(assigneeId)) continue;
    const load = loads.get(assigneeId)!;
    load.blockCount += 1;
    load.alertCount += Number.isFinite(block.alertCount)
      ? Math.max(0, Number(block.alertCount))
      : 0;
    load.weight += Number.isFinite(block.weight)
      ? Math.max(0, Number(block.weight))
      : 0;
  }

  return selectedIds.map((validatorId) => loads.get(validatorId)!);
}
