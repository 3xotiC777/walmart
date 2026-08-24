'use client';

import hierarchyData from '@/data/hierarchy.json';
import {
  revalidateExportOverlay,
  type RevalidatedExportAlert,
} from '@/lib/export-revalidation';
import { useState } from 'react';
import { DownloadIcon, FileIcon } from './icons';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { parseWorkbook } from '@/lib/parser';
import { buildCollaborativeReportWorkbook } from '@/lib/collaborative-report';
import { buildCorrectedWorkbookFileName, buildSuggestionsWorkbook, coerceWorkbookCorrectionValue, patchOriginalWorkbook, type WorkbookCellCorrection, type WorkbookSuggestion } from '@/lib/workbookExports';
import type { HierarchyCatalog } from '@/lib/types';

interface UploadInfo { id: string; display_name: string; panel_object_path: string; total_rows: number; task_count: number; alert_count: number; orthography_count: number; pending_task_count: number; corrected_cell_count: number; confirmed_correct_count: number; created_at: string }
interface PreflightSummary {
  pendingTasks: number;
  remainingAlertCount: number;
  invalidConfirmedCorrectCount: number;
  validationAlertCount: number;
  orthographyAlertCount: number;
  alerts: RevalidatedExportAlert[];
  safeForFinal: boolean;
}

const hierarchy = hierarchyData as HierarchyCatalog;
const PREFLIGHT_ALERT_PREVIEW = 25;

function save(buffer: ArrayBuffer, filename: string) {
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; document.body.appendChild(anchor); anchor.click(); anchor.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

async function fetchAll(table: string, select: string, uploadId?: string, orderKey = 'id'): Promise<any[]> {
  const supabase = createBrowserSupabaseClient();
  const rows: any[] = [];
  let cursor: string | number | null = null;
  for (;;) {
    let query = supabase.from(table).select(select).order(orderKey, { ascending: true }).limit(1_000);
    if (uploadId) query = query.eq('upload_id', uploadId);
    if (cursor !== null) query = query.gt(orderKey, cursor);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1_000) break;
    const nextCursor = (data[data.length - 1] as unknown as Record<string, unknown> | undefined)?.[orderKey];
    if (typeof nextCursor !== 'string' && typeof nextCursor !== 'number') throw new Error(`No fue posible paginar ${table} de forma estable.`);
    cursor = nextCursor;
  }
  return rows;
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value).trim();
}

function validateOverlay(dataset: ReturnType<typeof parseWorkbook>, resolutions: any[]) {
  const records = new Map(dataset.records.map((record) => [record.excelRow, record]));
  const cells = new Set<string>();
  for (const resolution of resolutions) {
    const source = Array.isArray(resolution.source_rows) ? resolution.source_rows[0] : resolution.source_rows;
    const excelRow = Number(source?.excel_row);
    const columnIndex = Number(resolution.column_index);
    const record = records.get(excelRow);
    if (!record || !Number.isInteger(columnIndex) || columnIndex < 0 || columnIndex >= dataset.headers.length) {
      throw new Error(`La corrección de la fila ${excelRow || 'desconocida'} ya no apunta a una celda válida.`);
    }
    const key = `${excelRow}:${columnIndex}`;
    if (cells.has(key)) throw new Error(`Hay más de una corrección vigente para la fila ${excelRow}, columna ${columnIndex + 1}.`);
    cells.add(key);
    const header = dataset.outputHeaders[columnIndex] || dataset.headers[columnIndex];
    if (resolution.field_name && header !== resolution.field_name && dataset.headers[columnIndex] !== resolution.field_name) {
      throw new Error(`La columna de la corrección en la fila ${excelRow} cambió desde la revisión.`);
    }
    const original = record.values[columnIndex];
    if (resolution.original_value !== null && cellText(original) !== cellText(resolution.original_value)) {
      const bothNumeric = Number.isFinite(Number(cellText(original))) && Number.isFinite(Number(cellText(resolution.original_value)));
      if (!bothNumeric || Number(cellText(original)) !== Number(cellText(resolution.original_value))) {
        throw new Error(`El valor original de la fila ${excelRow}, columna ${columnIndex + 1}, no coincide con la evidencia revisada.`);
      }
    }
  }
}

export function ExportCenter({ upload }: { upload: UploadInfo }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [preflight, setPreflight] = useState<PreflightSummary | null>(null);

  async function original(): Promise<ArrayBuffer> {
    const supabase = createBrowserSupabaseClient();
    const { data, error: signedError } = await supabase.storage.from('pqm-private').createSignedUrl(upload.panel_object_path, 600);
    if (signedError || !data?.signedUrl) throw signedError ?? new Error('No fue posible autorizar la descarga del panel.');
    const response = await fetch(data.signedUrl);
    if (!response.ok) throw new Error('No fue posible recuperar el panel original.');
    return response.arrayBuffer();
  }

  async function loadData(includeReportContext: boolean) {
    const supabase = createBrowserSupabaseClient();
    const snapshot = async () => {
      const { data, error: snapshotError } = await supabase.from('uploads').select('version, pending_task_count, corrected_cell_count, confirmed_correct_count').eq('id', upload.id).single();
      if (snapshotError) throw snapshotError;
      return data;
    };
    const before = await snapshot();
    const [tasks, alerts, decisions, profiles, resolutions, invoices, conflictGroups] = await Promise.all([
      fetchAll('review_tasks', 'id, status, source_row_id, source_rows(excel_row,row_id,id_dn_w,barcode,description), assignment_blocks(assigned_to)', upload.id),
      fetchAll('validation_alerts', 'id, event_key, task_id, rule_code, category, affected_field, original_value, expected_or_conflicts, detail, suggested_column_name, suggested_column_index, suggested_value, suggestion_confidence, suggestion_method, suggestion_evidence, can_auto_apply, evidence_fingerprint, status', upload.id),
      fetchAll('alert_decisions', 'id, alert_id, decision, resolved_value, evidence_fingerprint, decided_by, decided_at, superseded_at', upload.id),
      fetchAll('profiles', 'user_id, display_name', undefined, 'user_id'),
      fetchAll('cell_resolutions', 'id, source_row_id, column_index, field_name, original_value, resolved_value, last_decision_id, source_rows(excel_row)', upload.id),
      includeReportContext ? fetchAll('invoice_links', 'id, id_dn_w, external_url', upload.id) : Promise.resolve([]),
      includeReportContext ? fetchAll('conflict_groups', 'id, rule_code, affected_row_count', upload.id) : Promise.resolve([]),
    ]);
    const after = await snapshot();
    if (before.version !== after.version) throw new Error('La jornada cambió mientras se preparaba la exportación. Intenta nuevamente para usar un corte consistente.');
    return { tasks, alerts, decisions: decisions.filter((item) => !item.superseded_at), profiles, resolutions, invoices, conflictGroups, snapshot: after };
  }

  async function assertSnapshotVersion(expectedVersion: number) {
    const supabase = createBrowserSupabaseClient();
    const { data, error: snapshotError } = await supabase
      .from('uploads')
      .select('version')
      .eq('id', upload.id)
      .single();
    if (snapshotError) throw snapshotError;
    if (Number(data.version) !== Number(expectedVersion)) {
      throw new Error('La jornada cambió durante la revalidación. Intenta descargar nuevamente para incluir las decisiones más recientes.');
    }
  }

  async function run(kind: 'report' | 'suggestions' | 'corrected') {
    setBusy(kind); setError(''); setPreflight(null);
    try {
      const data = await loadData(kind === 'report');
      const currentUpload = { ...upload, ...data.snapshot };
      const originalBuffer = await original();
      const dataset = parseWorkbook(originalBuffer.slice(0), upload.display_name);
      validateOverlay(dataset, data.resolutions);
      const revalidation = await revalidateExportOverlay({
        dataset,
        resolutions: data.resolutions,
        alerts: data.alerts,
        decisions: data.decisions,
        hierarchy,
      });
      const requiresDraft = Number(data.snapshot.pending_task_count) > 0 || !revalidation.safeForFinal;
      setPreflight({
        pendingTasks: Number(data.snapshot.pending_task_count),
        remainingAlertCount: revalidation.remainingAlerts.length,
        invalidConfirmedCorrectCount: revalidation.invalidConfirmedCorrect.length,
        validationAlertCount: revalidation.validationAlertCount,
        orthographyAlertCount: revalidation.orthographyAlertCount,
        alerts: revalidation.remainingAlerts.slice(0, PREFLIGHT_ALERT_PREVIEW),
        safeForFinal: !requiresDraft,
      });
      if (kind === 'report') {
        await assertSnapshotVersion(data.snapshot.version);
        save(buildCollaborativeReportWorkbook({ upload: currentUpload, tasks: data.tasks, alerts: data.alerts, decisions: data.decisions, profiles: data.profiles, invoices: data.invoices, conflictGroups: data.conflictGroups, dataset }), `Reporte_Alertas_PQM_${new Date().toISOString().slice(0, 10)}.xlsx`);
      } else {
        if (kind === 'suggestions') {
          const recordByRow = new Map(dataset.records.map((record) => [record.excelRow, record]));
          const taskById = new Map(data.tasks.map((task) => [task.id, task]));
          const unique = new Map<string, WorkbookSuggestion>();
          const conflicted = new Set<string>();
          for (const alert of data.alerts) {
            if (!alert.can_auto_apply || alert.suggestion_confidence !== 'high' || alert.suggested_column_index === null || alert.suggested_value === null) continue;
            const task = taskById.get(alert.task_id); const row = task ? (Array.isArray(task.source_rows) ? task.source_rows[0] : task.source_rows) : null;
            if (!row) continue;
            const key = `${row.excel_row}:${alert.suggested_column_index}`;
            if (conflicted.has(key)) continue;
            const originalCell = recordByRow.get(row.excel_row)?.values[alert.suggested_column_index];
            const field = alert.suggested_column_name ?? alert.affected_field ?? dataset.headers[alert.suggested_column_index] ?? '';
            const candidate: WorkbookSuggestion = { excelRow: row.excel_row, field, columnIndex: alert.suggested_column_index, proposedValue: coerceWorkbookCorrectionValue(alert.suggested_value, originalCell, field), autoApplicable: true, confidence: 'high' };
            const existing = unique.get(key);
            if (!existing || String(existing.proposedValue) === String(candidate.proposedValue)) unique.set(key, candidate);
            else { unique.delete(key); conflicted.add(key); }
          }
          await assertSnapshotVersion(data.snapshot.version);
          save(buildSuggestionsWorkbook(dataset, [...unique.values()]), `Base_PQM_con_Sugerencias_${new Date().toISOString().slice(0, 10)}.xlsx`);
        } else {
          if (requiresDraft) {
            const reasons = [
              Number(data.snapshot.pending_task_count) > 0
                ? `${Number(data.snapshot.pending_task_count).toLocaleString('es-CO')} tareas pendientes`
                : null,
              revalidation.remainingAlerts.length > 0
                ? `${revalidation.remainingAlerts.length.toLocaleString('es-CO')} alertas activas después de reaplicar las reglas`
                : null,
              revalidation.invalidConfirmedCorrect.length > 0
                ? `${revalidation.invalidConfirmedCorrect.length.toLocaleString('es-CO')} decisiones “Está correcto” con evidencia modificada`
                : null,
            ].filter(Boolean).join(', ');
            if (!window.confirm(`La revalidación encontró ${reasons}. No se generará un archivo Final: solo un Borrador con las correcciones aceptadas hasta ahora. ¿Continuar?`)) return;
          }
          const records = new Map(dataset.records.map((record) => [record.excelRow, record]));
          const corrections: WorkbookCellCorrection[] = data.resolutions.map((resolution) => {
            const source = Array.isArray(resolution.source_rows) ? resolution.source_rows[0] : resolution.source_rows;
            const excelRow = Number(source?.excel_row); const originalCell = records.get(excelRow)?.values[resolution.column_index];
            const field = dataset.headers[resolution.column_index] ?? resolution.field_name;
            const value = coerceWorkbookCorrectionValue(resolution.resolved_value, originalCell, field);
            return { excelRow, columnIndex: resolution.column_index, value };
          });
          await assertSnapshotVersion(data.snapshot.version);
          save(patchOriginalWorkbook(originalBuffer, corrections), buildCorrectedWorkbookFileName(requiresDraft ? Math.max(1, Number(data.snapshot.pending_task_count)) : 0));
        }
      }
    } catch (cause) { setPreflight(null); setError(cause instanceof Error ? cause.message : 'No fue posible generar el archivo.'); }
    finally { setBusy(null); }
  }

  const cards = [
    { id: 'report' as const, title: 'Reporte de alertas', copy: 'Resumen, alertas, registros, ortografía, sugerencia, responsable y decisión.', button: 'Descargar reporte' },
    { id: 'suggestions' as const, title: 'Base con sugerencias', copy: 'Todas las filas originales y una columna sugerida junto a cada campo evaluado.', button: 'Descargar sugerencias' },
    { id: 'corrected' as const, title: upload.pending_task_count ? 'Excel corregido · borrador' : 'Excel corregido · validación previa', copy: 'Reaplica todas las reglas sobre las correcciones antes de decidir si el archivo puede llamarse Final, preservando sus tablas dinámicas.', button: 'Validar y descargar' },
  ];
  return <><div className="split-grid export-grid">{cards.map((card) => <section className="panel" key={card.id}><div className="panel-body"><FileIcon/><p className="overline">ARCHIVO INDEPENDIENTE</p><h2>{card.title}</h2><p>{card.copy}</p><button className="button button-primary" disabled={busy !== null} onClick={() => void run(card.id)} type="button"><DownloadIcon/>{busy === card.id ? 'Revalidando…' : card.button}</button></div></section>)}</div>{preflight && <section className="panel" aria-live="polite"><div className="panel-header"><div><p className="overline">REVALIDACIÓN DEL OVERLAY</p><h2>{preflight.safeForFinal ? 'Las correcciones superan la validación final' : 'La jornada aún solo permite un Borrador'}</h2><p>{preflight.safeForFinal ? 'No reaparecieron alertas y no quedan tareas pendientes en el corte exportado.' : `${preflight.pendingTasks.toLocaleString('es-CO')} tareas pendientes · ${preflight.remainingAlertCount.toLocaleString('es-CO')} alertas activas · ${preflight.invalidConfirmedCorrectCount.toLocaleString('es-CO')} confirmaciones con evidencia modificada.`}</p><p>Motor ejecutado: {preflight.validationAlertCount.toLocaleString('es-CO')} alertas R/EST/JER y {preflight.orthographyAlertCount.toLocaleString('es-CO')} alertas ORT.</p></div><span className={`status ${preflight.safeForFinal ? 'resolved' : 'draft'}`}>{preflight.safeForFinal ? 'APTO PARA FINAL' : 'SOLO BORRADOR'}</span></div>{preflight.alerts.length > 0 && <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Regla</th><th>Fila</th><th>Campo</th><th>Resultado de la revalidación</th></tr></thead><tbody>{preflight.alerts.map((alert) => <tr key={alert.eventKey}><td><span className="rule-badge">{alert.ruleId}</span></td><td className="mono">{alert.sourceRow}</td><td>{alert.field || 'Revisión manual'}</td><td><strong>{alert.reasonLabel}</strong><small>{alert.detail}</small></td></tr>)}</tbody></table>{preflight.remainingAlertCount > preflight.alerts.length && <footer className="page-footer"><span>Se muestran {preflight.alerts.length.toLocaleString('es-CO')} de {preflight.remainingAlertCount.toLocaleString('es-CO')} alertas activas.</span></footer>}</div>}</section>}{error && <p className="form-error" role="alert">{error}</p>}</>;
}
