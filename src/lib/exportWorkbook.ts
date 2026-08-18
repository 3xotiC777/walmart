import * as XLSX from 'xlsx';
import type { SourceDataset, ValidationResult } from './types';

function setColumns(sheet: XLSX.WorkSheet, widths: number[]) {
  sheet['!cols'] = widths.map((wch) => ({ wch }));
}

function addAutofilter(sheet: XLSX.WorkSheet) {
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
}

export function buildOutputWorkbook(
  dataset: SourceDataset,
  result: ValidationResult,
  generatedAt = new Date(),
): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Revisión PQM Walmart',
    Subject: 'Alertas automáticas de calidad',
    Author: 'Validador PQM Walmart',
    Company: 'Dichter & Neira',
    CreatedDate: generatedAt,
  };

  const summaryRows: Array<Array<string | number>> = [
    ['REVISIÓN PQM WALMART', ''],
    ['Archivo analizado', dataset.sourceFile],
    ['Generado', generatedAt.toLocaleString('es-CO')],
    ['', ''],
    ['Métrica', 'Valor'],
    ['Registros totales', result.metrics.totalRecords],
    ['Registros a revisar', result.metrics.reviewRecords],
    ['Registros sin alertas', result.metrics.okRecords],
    ['Porcentaje a revisar', result.metrics.reviewPercent / 100],
    ['Eventos de alerta', result.metrics.totalAlerts],
    ['', ''],
    ['Regla', 'Nombre', 'Estado', 'Registros afectados', 'Alertas', 'Descripción'],
    ...result.ruleSummaries.map((rule) => [
      rule.id,
      rule.name,
      rule.status,
      rule.affectedRows,
      rule.alertCount,
      rule.description,
    ]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryRows, { cellDates: true });
  summarySheet['!merges'] = [XLSX.utils.decode_range('A1:F1')];
  if (summarySheet.B9) summarySheet.B9.z = '0.0%';
  setColumns(summarySheet, [16, 34, 24, 20, 14, 76]);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Resumen');

  const alertRows = result.alerts.map((alert) => ({
    Regla: alert.ruleId,
    Nombre_Regla: alert.ruleName,
    Fila_Origen: alert.sourceRow,
    'Row-Id': alert.rowId,
    'Id_Dn W': alert.surveyId,
    codiGo_barras: alert.barcode,
    Descripcion: alert.description,
    Clave_Validada: alert.key,
    Campo: alert.field,
    Valor_Observado: alert.observed,
    Valor_Esperado_o_Conflictos: alert.expected,
    Detalle: alert.detail,
    Cuartil_1: alert.firstQuartile ?? null,
    Cuartil_3: alert.thirdQuartile ?? null,
    Rango_Intercuartil: alert.interquartileRange ?? null,
    Limite_Superior: alert.upperLimit ?? null,
  }));
  const alertsSheet = XLSX.utils.json_to_sheet(alertRows, {
    header: [
      'Regla',
      'Nombre_Regla',
      'Fila_Origen',
      'Row-Id',
      'Id_Dn W',
      'codiGo_barras',
      'Descripcion',
      'Clave_Validada',
      'Campo',
      'Valor_Observado',
      'Valor_Esperado_o_Conflictos',
      'Detalle',
      'Cuartil_1',
      'Cuartil_3',
      'Rango_Intercuartil',
      'Limite_Superior',
    ],
  });
  addAutofilter(alertsSheet);
  setColumns(alertsSheet, [12, 30, 12, 20, 16, 18, 46, 44, 24, 34, 46, 72, 16, 16, 20, 18]);
  XLSX.utils.book_append_sheet(workbook, alertsSheet, 'Alertas');

  const reviewedHeader = [
    'Cantidad_Alertas',
    'Reglas_Alerta',
    'Motivos_Alerta',
    'Fila_Origen',
    ...dataset.outputHeaders,
  ];
  const reviewedRows = result.reviewedRecords.map(({ record, alerts }) => [
    alerts.length,
    alerts.map((alert) => alert.ruleId).join(', '),
    alerts.map((alert) => `${alert.ruleId}: ${alert.detail}`).join(' | '),
    record.excelRow,
    ...record.values,
  ]);
  const reviewedSheet = XLSX.utils.aoa_to_sheet([reviewedHeader, ...reviewedRows], { cellDates: true });
  addAutofilter(reviewedSheet);
  setColumns(reviewedSheet, [16, 28, 90, 12, ...dataset.outputHeaders.map((header) => Math.min(48, Math.max(12, header.length + 2)))]);
  XLSX.utils.book_append_sheet(workbook, reviewedSheet, 'Registros_a_revisar');

  const bytes = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
    cellDates: true,
  });
  return bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
}
