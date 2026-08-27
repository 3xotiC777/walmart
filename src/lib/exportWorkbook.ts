import * as XLSX from 'xlsx';
import { ORTHOGRAPHY_RULE } from './types';
import type { OrthographyAlert, SourceDataset, ValidationResult } from './types';

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
  orthographyAlerts: OrthographyAlert[] = [],
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
    ['Alertas ortográficas', orthographyAlerts.length],
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
    [
      ORTHOGRAPHY_RULE.id,
      ORTHOGRAPHY_RULE.name,
      ORTHOGRAPHY_RULE.status,
      orthographyAlerts.length,
      orthographyAlerts.length,
      ORTHOGRAPHY_RULE.description,
    ],
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
    Promedio_Combinacion: alert.groupAverage ?? null,
    Umbral_15_Por_Ciento: alert.priceThreshold ?? null,
    Porcentaje_Diferencia_Promedio: alert.priceDifferencePercent ?? null,
    Foto_Factura: alert.invoiceUrls?.join('\n') ?? '',
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
      'Promedio_Combinacion',
      'Umbral_15_Por_Ciento',
      'Porcentaje_Diferencia_Promedio',
      'Foto_Factura',
    ],
  });
  result.alerts.forEach((alert, index) => {
    const firstInvoice = alert.invoiceUrls?.[0];
    if (!firstInvoice) return;
    const cell = alertsSheet[XLSX.utils.encode_cell({ r: index + 1, c: 15 })];
    if (cell) cell.l = { Target: firstInvoice, Tooltip: 'Abrir la primera factura asociada' };
  });
  for (let row = 1; row <= alertRows.length; row += 1) {
    const averageCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 12 })];
    const thresholdCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 13 })];
    const differenceCell = alertsSheet[XLSX.utils.encode_cell({ r: row, c: 14 })];
    if (averageCell) averageCell.z = '#,##0.0000';
    if (thresholdCell) thresholdCell.z = '#,##0.0000';
    if (differenceCell) differenceCell.z = '0.00%';
  }
  addAutofilter(alertsSheet);
  setColumns(alertsSheet, [12, 30, 12, 20, 16, 18, 46, 44, 24, 34, 46, 72, 22, 22, 30, 70]);
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

  const orthographyRows = orthographyAlerts.map((alert) => ({
    Marca_Wm: alert.fields.Marca_Wm,
    Tipo_Marca: alert.fields.Tipo_Marca,
    Descripcion: alert.fields.Descripcion,
    'Canasto Wm': alert.fields['Canasto Wm'],
    'Motivo de Alerta': alert.reason,
    'probabilidad de error': alert.probability,
    'Descripcion correcta': alert.correctedDescription,
    Confianza: alert.confidence,
    Método: alert.method,
    Detalle: alert.detail,
    'Palabras dudosas': alert.doubtfulTokens.join(', '),
  }));
  const orthographySheet = XLSX.utils.json_to_sheet(orthographyRows, {
    header: [
      'Marca_Wm',
      'Tipo_Marca',
      'Descripcion',
      'Canasto Wm',
      'Motivo de Alerta',
      'probabilidad de error',
      'Descripcion correcta',
      'Confianza',
      'Método',
      'Detalle',
      'Palabras dudosas',
    ],
  });
  addAutofilter(orthographySheet);
  setColumns(orthographySheet, [24, 18, 54, 24, 32, 22, 54, 14, 28, 70, 36]);
  XLSX.utils.book_append_sheet(workbook, orthographySheet, 'Alertas_Ortografia');

  const bytes = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
    cellDates: true,
  });
  return bytes instanceof ArrayBuffer ? bytes : bytes.buffer;
}
