export interface StoredAlertAlternative {
  value: unknown;
  count: number;
}

function validAlternatives(value: unknown): StoredAlertAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is StoredAlertAlternative => {
    if (!item || typeof item !== 'object') return false;
    const candidate = item as { count?: unknown };
    return typeof candidate.count === 'number' && Number.isFinite(candidate.count);
  });
}

/**
 * New uploads keep alternatives once on the conflict group. Older uploads
 * stored them on every alert, so prefer that legacy value when it exists.
 */
export function resolveStoredAlertAlternatives(
  alertAlternatives: unknown,
  groupObservedValues: unknown,
): StoredAlertAlternative[] {
  const legacyAlternatives = validAlternatives(alertAlternatives);
  return legacyAlternatives.length > 0
    ? legacyAlternatives
    : validAlternatives(groupObservedValues);
}
