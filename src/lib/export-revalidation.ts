import { collaborationAlertEvidenceFingerprint, normalizeEvidenceFingerprint } from './alert-evidence';
import { createCollaborationManifest } from './collaboration';
import { generateOrthographyAlerts } from './orthography';
import { validateDataset } from './rules';
import type { HierarchyCatalog, SourceDataset } from './types';
import { coerceWorkbookCorrectionValue } from './workbookExports';

export interface ExportResolutionProjection {
  column_index: number;
  field_name: string;
  resolved_value: string;
  source_rows: { excel_row: number } | Array<{ excel_row: number }> | null;
}

export interface ExportAlertProjection {
  id: string;
  event_key: string;
  rule_code: string;
  evidence_fingerprint: string | null;
}

export interface ExportDecisionProjection {
  alert_id: string;
  decision: string;
  evidence_fingerprint: string | null;
  superseded_at?: string | null;
}

export type RevalidationReason =
  | 'new_alert'
  | 'pending_alert'
  | 'correction_did_not_resolve'
  | 'confirmed_correct_evidence_changed';

export interface RevalidatedExportAlert {
  eventKey: string;
  ruleId: string;
  sourceRow: number;
  field: string;
  observed: string;
  expected: string;
  detail: string;
  reason: RevalidationReason;
  reasonLabel: string;
}

export interface ExportRevalidationResult {
  overlayDataset: SourceDataset;
  remainingAlerts: RevalidatedExportAlert[];
  invalidConfirmedCorrect: RevalidatedExportAlert[];
  acceptedConfirmedCorrect: number;
  validationAlertCount: number;
  orthographyAlertCount: number;
  safeForFinal: boolean;
}

function sourceExcelRow(sourceRows: ExportResolutionProjection['source_rows']): number | null {
  const source = Array.isArray(sourceRows) ? sourceRows[0] : sourceRows;
  const value = Number(source?.excel_row);
  return Number.isInteger(value) && value >= 2 ? value : null;
}

/** Aplica las correcciones a clones de filas/celdas; nunca muta el dataset fuente. */
export function applyOverlayToDataset(
  dataset: SourceDataset,
  resolutions: ReadonlyArray<ExportResolutionProjection>,
): SourceDataset {
  const recordsByRow = new Map(dataset.records.map((record) => [record.excelRow, record]));
  const replacements = new Map<number, SourceDataset['records'][number]>();

  for (const resolution of resolutions) {
    const excelRow = sourceExcelRow(resolution.source_rows);
    const columnIndex = Number(resolution.column_index);
    const originalRecord = excelRow === null ? undefined : recordsByRow.get(excelRow);
    if (!originalRecord || !Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= dataset.headers.length) {
      throw new Error('Una corrección ya no apunta a una celda válida del panel original.');
    }

    const record = replacements.get(originalRecord.excelRow) ?? {
      ...originalRecord,
      values: [...originalRecord.values],
      fields: { ...originalRecord.fields },
    };
    const header = dataset.headers[columnIndex];
    const value = coerceWorkbookCorrectionValue(
      resolution.resolved_value,
      originalRecord.values[columnIndex],
      header || resolution.field_name,
    );
    record.values[columnIndex] = value;
    // SourceRecord.fields representa la primera aparición de cada encabezado.
    if (dataset.headers.indexOf(header) === columnIndex) record.fields[header] = value;
    replacements.set(record.excelRow, record);
  }

  return {
    ...dataset,
    headers: [...dataset.headers],
    outputHeaders: [...dataset.outputHeaders],
    records: dataset.records.map((record) => replacements.get(record.excelRow) ?? record),
  };
}

function reasonFor(
  storedAlert: ExportAlertProjection | undefined,
  decision: ExportDecisionProjection | undefined,
  sameEvidence: boolean,
): { reason: RevalidationReason; label: string } | null {
  if (!storedAlert) {
    return {
      reason: 'new_alert',
      label: 'La corrección generó una alerta que no existía en el análisis inicial.',
    };
  }
  if (!decision) {
    return {
      reason: 'pending_alert',
      label: 'La alerta continúa activa y no tiene una decisión vigente.',
    };
  }
  if (decision.decision === 'confirmed_correct') {
    return sameEvidence
      ? null
      : {
          reason: 'confirmed_correct_evidence_changed',
          label: 'Se marcó “Está correcto”, pero otra corrección cambió la evidencia revisada.',
        };
  }
  return {
    reason: 'correction_did_not_resolve',
    label: 'La alerta continúa activa después de aplicar las correcciones aceptadas.',
  };
}

export async function revalidateExportOverlay(input: {
  dataset: SourceDataset;
  resolutions: ReadonlyArray<ExportResolutionProjection>;
  alerts: ReadonlyArray<ExportAlertProjection>;
  decisions: ReadonlyArray<ExportDecisionProjection>;
  hierarchy: HierarchyCatalog;
  hasBarcode: boolean;
}): Promise<ExportRevalidationResult> {
  const overlayDataset = {
    ...applyOverlayToDataset(input.dataset, input.resolutions),
    hasBarcode: input.hasBarcode,
  };
  const validation = validateDataset(overlayDataset, input.hierarchy, undefined, {
    hasBarcode: input.hasBarcode,
  });
  const orthography = generateOrthographyAlerts(overlayDataset);
  const manifest = createCollaborationManifest(overlayDataset, validation, orthography);
  const storedByEvent = new Map(input.alerts.map((alert) => [alert.event_key, alert]));
  const currentDecisionByAlert = new Map(
    input.decisions
      .filter((decision) => !decision.superseded_at)
      .map((decision) => [decision.alert_id, decision]),
  );
  const currentAlerts = manifest.tasks.flatMap((task) => task.alerts);
  const overlayRecordByRow = new Map(
    overlayDataset.records.map((record) => [record.excelRow, record]),
  );
  const fingerprints = await Promise.all(
    currentAlerts.map((alert) => {
      const storedAlert = storedByEvent.get(alert.id);
      const decision = storedAlert ? currentDecisionByAlert.get(storedAlert.id) : undefined;
      return decision?.decision === 'confirmed_correct'
        ? collaborationAlertEvidenceFingerprint(
            overlayDataset,
            alert,
            overlayRecordByRow.get(alert.sourceRow),
          )
        : Promise.resolve(null);
    }),
  );
  const remainingAlerts: RevalidatedExportAlert[] = [];
  let acceptedConfirmedCorrect = 0;

  currentAlerts.forEach((alert, index) => {
    const storedAlert = storedByEvent.get(alert.id);
    const decision = storedAlert ? currentDecisionByAlert.get(storedAlert.id) : undefined;
    const expectedFingerprint = normalizeEvidenceFingerprint(
      decision?.evidence_fingerprint ?? storedAlert?.evidence_fingerprint,
    );
    const sameEvidence = expectedFingerprint !== null && expectedFingerprint === fingerprints[index];
    const reason = reasonFor(storedAlert, decision, sameEvidence);
    if (!reason) {
      acceptedConfirmedCorrect += 1;
      return;
    }
    remainingAlerts.push({
      eventKey: alert.id,
      ruleId: alert.ruleId,
      sourceRow: alert.sourceRow,
      field: alert.field,
      observed: alert.observed,
      expected: alert.expected,
      detail: alert.detail,
      reason: reason.reason,
      reasonLabel: reason.label,
    });
  });

  const invalidConfirmedCorrect = remainingAlerts.filter(
    (alert) => alert.reason === 'confirmed_correct_evidence_changed',
  );
  return {
    overlayDataset,
    remainingAlerts,
    invalidConfirmedCorrect,
    acceptedConfirmedCorrect,
    validationAlertCount: validation.alerts.length,
    orthographyAlertCount: orthography.length,
    safeForFinal: remainingAlerts.length === 0,
  };
}
