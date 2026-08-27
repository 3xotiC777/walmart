export const HISTORY_PAGE_SIZE = 50;

export const HISTORY_KINDS = ['all', 'uploads', 'reviews', 'downloads', 'assignments', 'team'] as const;
export type HistoryKind = (typeof HISTORY_KINDS)[number];

const GROUPED_EVENT_TYPES: Record<Exclude<HistoryKind, 'all'>, readonly string[]> = {
  uploads: ['upload.created', 'upload.ingestion_finalized', 'upload.failed', 'upload.retention_scrubbed'],
  reviews: [
    'alert.resolved',
    'alert.reopened',
    'related_cell.corrected',
    'related_row.confirmed_correct',
    'related_row.reopened',
    'related_row.added',
  ],
  downloads: ['export.downloaded'],
  assignments: [
    'assignments.proposed',
    'assignments.published',
    'assignments.pending_redistributed',
    'assignment_block.moved',
    'assignment_block.merged',
  ],
  team: ['member.registered', 'member.activated', 'member.deactivated', 'member.pin_reset_requested'],
};

export interface HistoryDecisionDetail {
  decision: 'apply_suggestion' | 'manual_edit' | 'confirmed_correct';
  originalValue: string | null;
  resolvedValue: string | null;
  fieldName: string | null;
  ruleCode: string | null;
  excelRow: number | null;
  rowId: string | null;
}

export interface HistoryResolutionDetail {
  originalValue: string | null;
  resolvedValue: string | null;
  fieldName: string | null;
  excelRow: number | null;
  rowId: string | null;
}

export interface HistoryPresentation {
  category: Exclude<HistoryKind, 'all'> | 'system';
  title: string;
  detail: string;
  before: string | null;
  after: string | null;
}

function payloadRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function integer(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rowReference(excelRow: number | null | undefined, rowId: string | null | undefined): string {
  const parts = [excelRow ? `fila ${excelRow}` : '', rowId ? `Row-Id ${rowId}` : ''].filter(Boolean);
  return parts.join(' · ');
}

function exportName(value: unknown): string {
  if (value === 'report') return 'Reporte de alertas';
  if (value === 'suggestions') return 'Base con sugerencias';
  if (value === 'corrected') return 'Excel corregido';
  return 'Excel';
}

export function normalizeHistoryKind(value: string | string[] | undefined): HistoryKind {
  const candidate = Array.isArray(value) ? value[0] : value;
  return HISTORY_KINDS.includes(candidate as HistoryKind) ? candidate as HistoryKind : 'all';
}

export function normalizeHistoryCursor(value: string | string[] | undefined): number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!candidate || !/^\d+$/.test(candidate)) return null;
  const parsed = Number(candidate);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function historyEventTypes(kind: HistoryKind): readonly string[] | null {
  return kind === 'all' ? null : GROUPED_EVENT_TYPES[kind];
}

export function buildHistoryHref(filters: {
  uploadId?: string;
  actorId?: string;
  kind?: HistoryKind;
  before?: number | null;
}): string {
  const params = new URLSearchParams();
  if (filters.uploadId) params.set('upload', filters.uploadId);
  if (filters.actorId) params.set('actor', filters.actorId);
  if (filters.kind && filters.kind !== 'all') params.set('kind', filters.kind);
  if (filters.before) params.set('before', String(filters.before));
  const query = params.toString();
  return `/workspace/historia${query ? `?${query}` : ''}`;
}

export function describeHistoryEvent(input: {
  eventType: string;
  payload: unknown;
  decision?: HistoryDecisionDetail | null;
  resolution?: HistoryResolutionDetail | null;
}): HistoryPresentation {
  const payload = payloadRecord(input.payload);
  const decision = input.decision;
  const resolution = input.resolution;

  if (input.eventType === 'upload.created') {
    return { category: 'uploads', title: 'Cargó una nueva jornada', detail: 'El panel y sus referencias comenzaron a guardarse de forma privada.', before: null, after: null };
  }
  if (input.eventType === 'upload.ingestion_finalized') {
    const rows = integer(payload.source_total_rows);
    const alerts = integer(payload.alerts);
    return { category: 'uploads', title: 'Terminó de procesar la jornada', detail: [rows === null ? '' : `${rows.toLocaleString('es-CO')} registros`, alerts === null ? '' : `${alerts.toLocaleString('es-CO')} alertas`].filter(Boolean).join(' · '), before: null, after: null };
  }
  if (input.eventType === 'upload.failed') {
    return { category: 'uploads', title: 'La carga de la jornada falló', detail: text(payload.message) || 'No se guardó el procesamiento completo.', before: null, after: null };
  }
  if (input.eventType === 'upload.retention_scrubbed') {
    return { category: 'uploads', title: 'Se aplicó la política de retención', detail: 'Los archivos y valores sensibles fueron eliminados; se conserva la trazabilidad resumida.', before: null, after: null };
  }
  if (input.eventType === 'export.downloaded') {
    const fileName = text(payload.file_name);
    const completion = payload.kind === 'corrected'
      ? (payload.is_draft === true ? 'Borrador' : 'Archivo final')
      : '';
    return { category: 'downloads', title: `Descargó ${exportName(payload.kind)}`, detail: [fileName, completion].filter(Boolean).join(' · '), before: null, after: null };
  }
  if (input.eventType === 'alert.resolved') {
    const decisionKind = decision?.decision ?? text(payload.decision);
    const changed = payload.changed === true || (decision?.originalValue !== decision?.resolvedValue && decisionKind !== 'confirmed_correct');
    const title = decisionKind === 'confirmed_correct'
      ? 'Marcó una alerta como “Está correcto”'
      : decisionKind === 'apply_suggestion'
        ? 'Aplicó la solución propuesta'
        : changed ? 'Editó manualmente una celda' : 'Resolvió una alerta';
    const rule = decision?.ruleCode ?? text(payload.rule_code);
    const field = decision?.fieldName ?? '';
    const row = rowReference(decision?.excelRow, decision?.rowId);
    return {
      category: 'reviews',
      title,
      detail: [rule, field, row].filter(Boolean).join(' · '),
      before: changed ? decision?.originalValue ?? null : null,
      after: changed ? decision?.resolvedValue ?? null : null,
    };
  }
  if (input.eventType === 'alert.reopened') {
    return { category: 'reviews', title: 'Reabrió una alerta', detail: [text(payload.rule_code), text(payload.reason)].filter(Boolean).join(' · '), before: null, after: null };
  }
  if (input.eventType === 'related_cell.corrected') {
    const field = resolution?.fieldName ?? text(payload.field_name);
    return { category: 'reviews', title: 'Corrigió un registro relacionado', detail: [field, rowReference(resolution?.excelRow, resolution?.rowId)].filter(Boolean).join(' · '), before: resolution?.originalValue ?? null, after: resolution?.resolvedValue ?? null };
  }
  if (input.eventType === 'related_row.confirmed_correct') {
    return { category: 'reviews', title: 'Confirmó correcto un registro relacionado', detail: '', before: null, after: null };
  }
  if (input.eventType === 'related_row.added') {
    return { category: 'reviews', title: 'Añadió un registro relacionado a su bloque', detail: '', before: null, after: null };
  }
  if (input.eventType === 'related_row.reopened') {
    return { category: 'reviews', title: 'Reabrió un registro relacionado', detail: text(payload.reason), before: null, after: null };
  }
  if (input.eventType === 'assignments.proposed') {
    const validators = Array.isArray(payload.validator_ids) ? payload.validator_ids.length : null;
    return { category: 'assignments', title: 'Calculó una propuesta de reparto', detail: validators === null ? '' : `${validators} validadores seleccionados`, before: null, after: null };
  }
  if (input.eventType === 'assignments.published') {
    const blocks = integer(payload.block_count);
    return { category: 'assignments', title: 'Publicó el reparto de la jornada', detail: blocks === null ? '' : `${blocks.toLocaleString('es-CO')} bloques`, before: null, after: null };
  }
  if (input.eventType === 'assignments.pending_redistributed') {
    const changed = integer(payload.changed_block_count);
    return { category: 'assignments', title: 'Redistribuyó las tareas pendientes', detail: changed === null ? '' : `${changed.toLocaleString('es-CO')} bloques cambiaron de responsable`, before: null, after: null };
  }
  if (input.eventType === 'assignment_block.moved' || input.eventType === 'assignment_block.merged') {
    return { category: 'assignments', title: input.eventType.endsWith('moved') ? 'Movió un bloque de revisión' : 'Fusionó bloques de revisión', detail: '', before: null, after: null };
  }
  if (input.eventType === 'member.registered') {
    return { category: 'team', title: 'Creó un integrante del equipo', detail: [text(payload.username), text(payload.role)].filter(Boolean).join(' · '), before: null, after: null };
  }
  if (input.eventType === 'member.activated' || input.eventType === 'member.deactivated') {
    return { category: 'team', title: input.eventType === 'member.activated' ? 'Reactivó una cuenta' : 'Desactivó una cuenta', detail: '', before: null, after: null };
  }
  if (input.eventType === 'member.pin_reset_requested') {
    return { category: 'team', title: 'Restableció el PIN de un integrante', detail: '', before: null, after: null };
  }
  if (input.eventType.startsWith('assignment_blocks.')) {
    return { category: 'system', title: 'Mantenimiento automático de bloques', detail: input.eventType, before: null, after: null };
  }
  if (input.eventType === 'workspace.bootstrapped') {
    return { category: 'system', title: 'Creó el espacio de trabajo', detail: '', before: null, after: null };
  }
  return { category: 'system', title: 'Actividad del sistema', detail: input.eventType, before: null, after: null };
}
