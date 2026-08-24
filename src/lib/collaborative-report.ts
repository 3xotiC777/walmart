import * as XLSX from 'xlsx';
import { getRuleDefinitions } from './rules';
import { ORTHOGRAPHY_RULE, type SourceDataset } from './types';

export interface ReportUpload {
  display_name: string;
  has_barcode: boolean;
  total_rows: number;
  task_count: number;
  alert_count: number;
  orthography_count: number;
  pending_task_count: number;
  corrected_cell_count: number;
  confirmed_correct_count: number;
  created_at: string;
}

export interface ReportTask {
  id: string;
  status: string;
  source_rows: { excel_row: number; row_id: string | null; id_dn_w: string | null; barcode: string | null; description: string | null } | Array<{ excel_row: number; row_id: string | null; id_dn_w: string | null; barcode: string | null; description: string | null }>;
  assignment_blocks?: { assigned_to: string | null } | Array<{ assigned_to: string | null }> | null;
}

interface ReportStatistics {
  groupAverage?: number;
  priceThreshold?: number;
  priceDifferencePercent?: number;
}

export interface ReportAlert {
  id: string;
  task_id: string;
  rule_code: string;
  category: string;
  affected_field: string | null;
  original_value: string | null;
  expected_or_conflicts: string | null;
  detail: string;
  suggested_value: string | null;
  suggestion_confidence: string;
  suggestion_method: string | null;
  suggestion_evidence?: { statistics?: ReportStatistics } | null;
  status: string;
}

export interface ReportDecision { alert_id: string; decision: string; resolved_value: string | null; decided_by: string; decided_at: string }
export interface ReportProfile { user_id: string; display_name: string }
export interface ReportInvoice { id_dn_w: string | null; external_url: string | null }
export interface ReportConflictGroup { id: string; rule_code: string; affected_row_count: number }

// Estas reglas marcan todo el grupo conflictivo como afectado aunque solo la
// minoría genere eventos. Sus grupos son disjuntos por la clave de cada regla,
// por lo que sumar affected_row_count reproduce el Set usado por el motor.
const GROUP_AFFECTED_RULES = new Set([
  'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10',
  'R11', 'R12', 'R13', 'R14', 'R16', 'R17', 'R18', 'R19', 'R20', 'R22',
  'R23', 'R24', 'R29',
]);

function aoaSheet(rows: unknown[][], widths: number[]) {
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1:A1' };
  sheet['!freeze'] = { xSplit: 0, ySplit: 1 };
  sheet['!cols'] = widths.map((wch) => ({ wch }));
  return sheet;
}

function taskRow(task: ReportTask | undefined) {
  if (!task) return undefined;
  return Array.isArray(task.source_rows) ? task.source_rows[0] : task.source_rows;
}

function taskBlock(task: ReportTask | undefined) {
  if (!task?.assignment_blocks) return undefined;
  return Array.isArray(task.assignment_blocks) ? task.assignment_blocks[0] : task.assignment_blocks;
}

function normalized(value: string | null | undefined) {
  return String(value ?? '').trim().toUpperCase();
}

export function buildCollaborativeReportWorkbook(input: {
  upload: ReportUpload;
  tasks: ReportTask[];
  alerts: ReportAlert[];
  decisions: ReportDecision[];
  profiles: ReportProfile[];
  invoices?: ReportInvoice[];
  conflictGroups?: ReportConflictGroup[];
  dataset?: SourceDataset;
}): ArrayBuffer {
  const taskById = new Map(input.tasks.map((task) => [task.id, task]));
  const decisionByAlert = new Map(input.decisions.map((decision) => [decision.alert_id, decision]));
  const nameByUser = new Map(input.profiles.map((profile) => [profile.user_id, profile.display_name]));
  const alertsByTask = new Map<string, ReportAlert[]>();
  for (const alert of input.alerts) {
    const values = alertsByTask.get(alert.task_id) ?? [];
    values.push(alert);
    alertsByTask.set(alert.task_id, values);
  }
  const invoicesBySurvey = new Map<string, string[]>();
  for (const invoice of input.invoices ?? []) {
    if (!invoice.external_url) continue;
    const key = normalized(invoice.id_dn_w);
    const urls = invoicesBySurvey.get(key) ?? [];
    if (!urls.includes(invoice.external_url)) urls.push(invoice.external_url);
    invoicesBySurvey.set(key, urls);
  }

  const affectedCountFallback = new Map<string, number>();
  for (const group of input.conflictGroups ?? []) {
    affectedCountFallback.set(
      group.rule_code,
      (affectedCountFallback.get(group.rule_code) ?? 0) + Math.max(0, group.affected_row_count),
    );
  }

  const resolvedTasks = input.tasks.filter((task) => task.status === 'resolved').length;
  const allDefinitions = [...getRuleDefinitions(input.upload.has_barcode), ORTHOGRAPHY_RULE];
  const summary = [
    ['Métrica', 'Valor'],
    ['Jornada', input.upload.display_name],
    ['Fecha de carga', input.upload.created_at],
    ['Registros totales de la base', input.upload.total_rows],
    ['Tareas o filas únicas', input.upload.task_count],
    ['Eventos de alerta', input.upload.alert_count],
    ['Alertas ortográficas', input.upload.orthography_count],
    ['Tareas pendientes', input.upload.pending_task_count],
    ['Tareas resueltas', resolvedTasks],
    ['Celdas cambiadas', input.upload.corrected_cell_count],
    ['Valores confirmados como correctos', input.upload.confirmed_correct_count],
    [],
    ['Regla', 'Nombre', 'Estado', 'Registros afectados', 'Alertas', 'Pendientes', 'Resueltos', 'Descripción'],
    ...allDefinitions.map((definition) => {
      const alerts = input.alerts.filter((alert) => alert.rule_code === definition.id);
      const alertedRows = new Set(alerts.map((alert) => taskRow(taskById.get(alert.task_id))?.excel_row).filter(Boolean));
      const affectedCount = GROUP_AFFECTED_RULES.has(definition.id)
        ? affectedCountFallback.get(definition.id) ?? alertedRows.size
        : alertedRows.size;
      return [
        definition.id,
        definition.name,
        definition.status,
        affectedCount,
        alerts.length,
        alerts.filter((alert) => alert.status !== 'resolved').length,
        alerts.filter((alert) => alert.status === 'resolved').length,
        definition.description,
      ];
    }),
  ];

  const alertHeader = [
    'Regla', 'Fila_Excel', 'Row-Id', 'Id_Dn W', 'Código', 'Descripción',
    'Columna_Afectada', 'Valor_Original', 'Valor_Esperado_o_Conflictos', 'Detalle',
    'Promedio_Grupo', 'Umbral_15_Por_Ciento', 'Porcentaje_Diferencia_Promedio', 'Foto_Factura',
    'Solución_Propuesta', 'Confianza', 'Método', 'Responsable', 'Estado',
    'Decisión', 'Valor_Final', 'Fecha_Decisión',
  ];
  const alertRows = input.alerts.map((alert) => {
    const task = taskById.get(alert.task_id);
    const row = taskRow(task);
    const block = taskBlock(task);
    const decision = decisionByAlert.get(alert.id);
    const statistics = alert.suggestion_evidence?.statistics;
    const invoiceUrls = invoicesBySurvey.get(normalized(row?.id_dn_w)) ?? [];
    return [
      alert.rule_code, row?.excel_row, row?.row_id, row?.id_dn_w, row?.barcode, row?.description,
      alert.affected_field, alert.original_value, alert.expected_or_conflicts, alert.detail,
      statistics?.groupAverage ?? null, statistics?.priceThreshold ?? null,
      statistics?.priceDifferencePercent ?? null,
      invoiceUrls.join('\n'), alert.suggested_value, alert.suggestion_confidence,
      alert.suggestion_method,
      block?.assigned_to ? nameByUser.get(block.assigned_to) ?? block.assigned_to : 'Sin asignar',
      alert.status, decision?.decision ?? '', decision?.resolved_value ?? '', decision?.decided_at ?? '',
    ];
  });

  const datasetByRow = new Map(input.dataset?.records.map((record) => [record.excelRow, record]) ?? []);
  const sourceHeaders = input.dataset?.outputHeaders ?? ['Row-Id', 'Id_Dn W', 'codiGo_barras', 'Descripcion'];
  const taskHeader = ['Cantidad_Alertas', 'Reglas_Alerta', 'Motivos_Alerta', 'Fila_Origen', ...sourceHeaders, 'Responsable', 'Estado'];
  const taskRows = input.tasks.map((task) => {
    const row = taskRow(task);
    const alerts = alertsByTask.get(task.id) ?? [];
    const block = taskBlock(task);
    const sourceRecord = row ? datasetByRow.get(row.excel_row) : undefined;
    const sourceValues = sourceRecord?.values ?? [row?.row_id, row?.id_dn_w, row?.barcode, row?.description];
    return [
      alerts.length,
      [...new Set(alerts.map((alert) => alert.rule_code))].join(', '),
      alerts.map((alert) => `${alert.rule_code}: ${alert.detail}`).join(' | '),
      row?.excel_row,
      ...sourceValues,
      block?.assigned_to ? nameByUser.get(block.assigned_to) ?? block.assigned_to : 'Sin asignar',
      task.status,
    ];
  });
  const orthographyRows = alertRows.filter((row) => row[0] === 'ORT-01');

  const workbook = XLSX.utils.book_new();
  workbook.Props = { Title: `Reporte colaborativo ${input.upload.display_name}`, Author: 'PQM Control Walmart', CreatedDate: new Date() };
  XLSX.utils.book_append_sheet(workbook, aoaSheet(summary, [14, 34, 24, 20, 14, 14, 14, 76]), 'Resumen');
  const alertsSheet = aoaSheet([alertHeader, ...alertRows], [12, 12, 18, 18, 18, 38, 24, 24, 35, 70, 20, 22, 28, 60, 32, 14, 22, 26, 14, 22, 28, 22]);
  alertRows.forEach((row, index) => {
    const firstInvoice = String(row[13] ?? '').split('\n').filter(Boolean)[0];
    const cell = alertsSheet[XLSX.utils.encode_cell({ r: index + 1, c: 13 })];
    if (cell && firstInvoice) cell.l = { Target: firstInvoice, Tooltip: 'Abrir la primera factura asociada' };
  });
  for (let row = 1; row <= alertRows.length; row += 1) {
    const averageCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 10 })];
    const thresholdCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 11 })];
    const differenceCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 12 })];
    if (averageCell) averageCell.z = '#,##0.0000';
    if (thresholdCell) thresholdCell.z = '#,##0.0000';
    if (differenceCell) differenceCell.z = '0.00%';
  }
  XLSX.utils.book_append_sheet(workbook, alertsSheet, 'Alertas');
  XLSX.utils.book_append_sheet(workbook, aoaSheet([taskHeader, ...taskRows], [16, 28, 90, 12, ...sourceHeaders.map((header) => Math.min(48, Math.max(12, header.length + 2))), 26, 14]), 'Registros_a_revisar');
  XLSX.utils.book_append_sheet(workbook, aoaSheet([alertHeader, ...orthographyRows], [12, 12, 18, 18, 18, 38, 24, 24, 35, 70, 20, 22, 28, 60, 32, 14, 22, 26, 14, 22, 28, 22]), 'Ortografía');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true, cellDates: true }) as ArrayBuffer;
}
