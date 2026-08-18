/// <reference lib="webworker" />

import hierarchyData from '../data/hierarchy.json';
import { buildOutputWorkbook } from '../lib/exportWorkbook';
import { parseWorkbook } from '../lib/parser';
import { validateDataset } from '../lib/rules';
import type { HierarchyCatalog, WorkerMessage, WorkerResult } from '../lib/types';

const worker = self as unknown as DedicatedWorkerGlobalScope;
const hierarchy = hierarchyData as HierarchyCatalog;

function progress(message: string, value: number) {
  const response: WorkerMessage = { type: 'progress', message, progress: value };
  worker.postMessage(response);
}

worker.addEventListener('message', (event: MessageEvent<{ buffer: ArrayBuffer; fileName: string }>) => {
  try {
    progress('Leyendo el libro de Excel…', 15);
    const dataset = parseWorkbook(event.data.buffer, event.data.fileName);

    progress('Aplicando las reglas de validación…', 45);
    const validation = validateDataset(dataset, hierarchy);

    progress('Construyendo el Excel de alertas…', 78);
    const generatedAt = new Date();
    const outputBuffer = buildOutputWorkbook(dataset, validation, generatedAt);

    progress('Análisis completado.', 100);
    const payload: WorkerResult = {
      metrics: validation.metrics,
      alerts: validation.alerts,
      ruleSummaries: validation.ruleSummaries,
      sourceFile: dataset.sourceFile,
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

