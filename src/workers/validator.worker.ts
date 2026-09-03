/// <reference lib="webworker" />

import hierarchyData from '../data/hierarchy.json';
import { createCollaborationManifest } from '../lib/collaboration';
import { buildOutputWorkbook } from '../lib/exportWorkbook';
import { generateOrthographyAlerts } from '../lib/orthography';
import { parseInvoiceWorkbook, parseWorkbook } from '../lib/parser';
import { validateDataset } from '../lib/rules';
import { resolveHasBarcode } from '../lib/study-mode';
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
    detail: alert.confidence === 'none'
      ? `${alert.reason}. ${alert.detail}`
      : `${alert.reason}. ${alert.detail} Posible corrección: "${alert.correctedDescription}" (${alert.probability}, confianza ${alert.confidence}).`,
    invoiceUrls,
  };
}

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    const collaborationIngestion = event.data.purpose === 'collaboration-ingestion';
    progress('Leyendo el archivo de facturas…', 12);
    const invoices = parseInvoiceWorkbook(event.data.invoiceBuffer, event.data.invoiceFileName);

    progress('Leyendo la base general…', 28);
    const dataset = parseWorkbook(event.data.sourceBuffer, event.data.sourceFileName);
    const effectiveHasBarcode = resolveHasBarcode(event.data.hasBarcode, dataset.records);
    dataset.hasBarcode = effectiveHasBarcode;

    progress('Cruzando facturas y aplicando las reglas…', 52);
    const validation = validateDataset(dataset, hierarchy, invoices, { hasBarcode: effectiveHasBarcode });

    progress('Revisando ortografía y espacios…', 72);
    const orthographyAlerts = generateOrthographyAlerts(dataset);
    const orthographyDisplayAlerts = collaborationIngestion
      ? []
      : orthographyAlerts.map((alert) => orthographyAlertRecord(
          alert,
          invoices.urlsByRef[alert.surveyId.trim().toUpperCase()] ?? [],
        ));

    progress('Preparando tareas y sugerencias…', 80);
    const collaboration = createCollaborationManifest(dataset, validation, orthographyAlerts);

    const generatedAt = new Date();
    const outputBuffer = collaborationIngestion
      ? new ArrayBuffer(0)
      : (() => {
          progress('Construyendo el Excel de alertas…', 86);
          return buildOutputWorkbook(dataset, validation, generatedAt, orthographyAlerts);
        })();

    progress('Análisis completado.', 100);
    const payload: WorkerResult = {
      metrics: validation.metrics,
      alerts: collaborationIngestion ? [] : validation.alerts,
      orthographyAlerts: orthographyDisplayAlerts,
      ruleSummaries: collaborationIngestion ? [] : validation.ruleSummaries,
      sourceFile: dataset.sourceFile,
      invoiceFile: invoices.sourceFile,
      invoiceImages: invoices.totalImages,
      generatedAt: generatedAt.toISOString(),
      hierarchyProducts: hierarchy.metadata.products,
      dataset,
      invoiceCatalog: invoices,
      collaboration,
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

