import type { CollaborationAlert, CollaborationValue } from './collaboration';
import type { SourceDataset, SourceRecord } from './types';

function fingerprintValue(value: unknown): CollaborationValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function fingerprintDisplay(value: unknown): string | null {
  const normalized = fingerprintValue(value);
  return normalized === null ? null : String(normalized);
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Reproduce exactamente la huella que se persiste durante la ingesta. Mantener
 * esta función compartida evita que el preflight de exportación y Postgres
 * terminen comparando definiciones distintas de "misma evidencia".
 */
export async function collaborationAlertEvidenceFingerprint(
  dataset: SourceDataset,
  alert: CollaborationAlert,
  sourceRecord?: SourceRecord,
): Promise<string> {
  const record = sourceRecord ?? dataset.records.find((candidate) => candidate.excelRow === alert.sourceRow);
  const targetField = alert.suggestion.targetField && dataset.headers.includes(alert.suggestion.targetField)
    ? alert.suggestion.targetField
    : null;
  const observed = targetField
    ? fingerprintDisplay(record?.fields[targetField])
    : alert.observed || null;
  const input = JSON.stringify({
    rule: alert.ruleId,
    observed,
    evidence: alert.suggestion.evidence,
    alternatives: alert.suggestion.alternatives,
  });
  return sha256Hex(input);
}

export function normalizeEvidenceFingerprint(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^\\x/i, '').toLowerCase();
  return /^[0-9a-f]{64}$/.test(normalized) ? normalized : null;
}
