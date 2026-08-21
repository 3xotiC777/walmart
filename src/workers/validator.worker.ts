/// <reference lib="webworker" />

import hierarchyData from '../data/hierarchy.json';
import { buildOutputWorkbook } from '../lib/exportWorkbook';
import { generateOrthographyAlerts } from '../lib/orthography';
import { parseInvoiceWorkbook, parseWorkbook } from '../lib/parser';
import { validateDataset } from '../lib/rules';
import { ORTHOGRAPHY_RULE } from '../lib/types';
import type { AlertRecord, HierarchyCatalog, OrthographyAlert, WorkerMessage, WorkerRequest, WorkerResult } from '../lib/types';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const hierarchy = hierarchyData as HierarchyCatalog;

function progress(message: string, value: number) {
  const response: WorkerMessage = { type: 'progress', message, progress: value };
  worker.postMessage(response);
}

function orthographyAlertRecord(alert: OrthographyAlert, invoiceUrls: string[]): AlertRecord {
  return {
    ruleId: ORTHOGRAPHY_RULE.id,
    ruleName: ORTHOGRAPHY_RULE.name,
    sourceRow: alert.sourceRow,
    rowId: alert.rowId,
    surveyId: alert.surveyId,
    barcode: alert.barcode,
    description: alert.fields.Descripcion,
    key: alert.fields.Descripcion,
    field: 'Descripcion',
    observed: alert.fields.Descripcion,
    expected: alert.correctedDescription,
    detail: `${alert.reason}. Posible corrección: "${alert.correctedDescription}" (${alert.probability}).`,
    invoiceUrls,
  };
}

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    progress('Leyendo el archivo de facturas…', 12);
    const invoices = parseInvoiceWorkbook(event.data.invoiceBuffer, event.data.invoiceFileName);

    progress('Leyendo la base general…', 28);
    const dataset = parseWorkbook(event.data.sourceBuffer, event.data.sourceFileName);

    progress('Cruzando facturas y aplicando las reglas…', 52);
    const validation = validateDataset(dataset, hierarchy, invoices, { hasBarcode: event.data.hasBarcode });

    progress('Revisando ortografía y espacios…', 72);
    const orthographyAlerts = generateOrthographyAlerts(dataset);
    const orthographyDisplayAlerts = orthographyAlerts.map((alert) => orthographyAlertRecord(
      alert,
      invoices.urlsByRef[alert.surveyId.trim().toUpperCase()] ?? [],
    ));

    progress('Construyendo el Excel de alertas…', 86);
    const generatedAt = new Date();
    const outputBuffer = buildOutputWorkbook(dataset, validation, generatedAt, orthographyAlerts);

    progress('Análisis completado.', 100);
    const payload: WorkerResult = {
      metrics: validation.metrics,
      alerts: validation.alerts,
      orthographyAlerts: orthographyDisplayAlerts,
      ruleSummaries: validation.ruleSummaries,
      sourceFile: dataset.sourceFile,
      invoiceFile: invoices.sourceFile,
      invoiceImages: invoices.totalImages,
      generatedAt: generatedAt.toISOString(),
      hierarchyProducts: hierarchy.metadata.products,
      outputBuffer,
    };
    const response: WorkerMessage = { type: 'result', payload };
    worker.postMessage(response, [outputBuffer]);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Ocurrió un error inesperado durante el análisis.';
    const response: WorkerMessage = { type: 'error', message };
    worker.postMessage(response);
  }
});

