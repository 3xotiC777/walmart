export const CORRECTION_TRACEABILITY_HEADER = 'Trazabilidad_de_cambios';

export interface CorrectionAttributionProfile {
  userId: string;
  displayName: string;
  username?: string | null;
}

export interface CorrectionAttributionInput {
  excelRow: number;
  columnIndex: number;
  fieldName: string;
  actorUserId: string | null;
}

export interface CorrectionTraceabilityValue {
  excelRow: number;
  value: string;
}

function actorLabel(
  actorUserId: string | null,
  profiles: ReadonlyMap<string, CorrectionAttributionProfile>,
): string {
  if (!actorUserId) return 'Usuario sin identificar';
  const profile = profiles.get(actorUserId);
  if (!profile) return `Usuario ${actorUserId.slice(0, 8)}`;
  const displayName = profile.displayName.trim() || profile.username?.trim() || 'Usuario';
  const username = profile.username?.trim();
  return username ? `${displayName} (@${username})` : displayName;
}

/**
 * Produces one visible audit value per corrected source row. Each changed field
 * keeps its own actor so a row edited by several people remains unambiguous.
 */
export function buildCorrectionTraceabilityValues(
  corrections: readonly CorrectionAttributionInput[],
  profileList: readonly CorrectionAttributionProfile[],
): CorrectionTraceabilityValue[] {
  const profiles = new Map(profileList.map((profile) => [profile.userId, profile]));
  const byRow = new Map<number, CorrectionAttributionInput[]>();
  for (const correction of corrections) {
    if (!Number.isInteger(correction.excelRow) || correction.excelRow < 2) continue;
    const row = byRow.get(correction.excelRow) ?? [];
    row.push(correction);
    byRow.set(correction.excelRow, row);
  }

  return [...byRow.entries()]
    .sort(([left], [right]) => left - right)
    .map(([excelRow, rowCorrections]) => {
      const seenColumns = new Set<number>();
      const details = [...rowCorrections]
        .sort((left, right) => left.columnIndex - right.columnIndex)
        .filter((correction) => {
          if (seenColumns.has(correction.columnIndex)) return false;
          seenColumns.add(correction.columnIndex);
          return true;
        })
        .map((correction) => {
          const field = correction.fieldName.trim() || `Columna ${correction.columnIndex + 1}`;
          return `${field} → ${actorLabel(correction.actorUserId, profiles)}`;
        });
      return { excelRow, value: details.join(' | ') };
    })
    .filter((item) => item.value.length > 0);
}
