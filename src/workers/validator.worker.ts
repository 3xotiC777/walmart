/// <reference lib="webworker" />

import hierarchyData from '../data/hierarchy.json';
import { buildOutputWorkbook } from '../lib/exportWorkbook';
import { generateOrthographyAlerts } from '../lib/orthography';
import { parseInvoiceWorkbook, parseWorkbook } from '../lib/parser';
import { validateDataset } from '../lib/rules';
import type { HierarchyCatalog, WorkerMessage, WorkerRequest, WorkerResult } from '../lib/types';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const hierarchy = hierarchyData as HierarchyCatalog;

function progress(message: string, value: number) {
  const response: WorkerMessage = { type: 'progress', message, progress: value };
  worker.postMessage(response);
}

worker.addEventListener('message', (event: MessageEvent<WorkerRequest>) => {
  try {
    progress('Leyendo el archivo de facturas…', 12);
    const invoices = parseInvoiceWorkbook(event.data.invoiceBuffer, event.data.invoiceFileName);

    progress('Leyendo el panel PQM…', 28);
    const dataset = parseWorkbook(event.data.sourceBuffer, event.data.sourceFileName);

    progress('Cruzando facturas y aplicando las reglas…', 52);
    const validation = validateDataset(dataset, hierarchy, invoices);

    progress('Revisando ortografía y espacios…', 72);
    const orthographyAlerts = generateOrthographyAlerts(dataset);

    progress('Construyendo el Excel de alertas…', 86);
    const generatedAt = new Date();
    const outputBuffer = buildOutputWorkbook(dataset, validation, generatedAt, orthographyAlerts);

    progress('Análisis completado.', 100);
    const payload: WorkerResult = {
      metrics: validation.metrics,
      alerts: validation.alerts,
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

