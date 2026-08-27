export const EXPORT_AUDIT_KINDS = ['report', 'suggestions', 'corrected'] as const;
export type ExportAuditKind = (typeof EXPORT_AUDIT_KINDS)[number];

export interface ExportAuditPayload {
  kind: ExportAuditKind;
  fileName: string;
  isDraft: boolean;
  pendingTasks: number;
  remainingAlerts: number;
  uploadVersion: number;
}

function nonNegativeInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function parseExportAuditPayload(value: unknown): ExportAuditPayload | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  if (!EXPORT_AUDIT_KINDS.includes(body.kind as ExportAuditKind)) return null;
  const fileName = typeof body.fileName === 'string' ? body.fileName.trim() : '';
  if (!fileName || fileName.length > 255 || !fileName.toLocaleLowerCase('es').endsWith('.xlsx')) return null;
  if (typeof body.isDraft !== 'boolean') return null;
  const pendingTasks = nonNegativeInteger(body.pendingTasks);
  const remainingAlerts = nonNegativeInteger(body.remainingAlerts);
  const uploadVersion = nonNegativeInteger(body.uploadVersion);
  if (pendingTasks === null || remainingAlerts === null || uploadVersion === null || uploadVersion < 1) return null;
  return { kind: body.kind as ExportAuditKind, fileName, isDraft: body.isDraft, pendingTasks, remainingAlerts, uploadVersion };
}
