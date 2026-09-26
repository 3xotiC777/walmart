/// <reference lib="webworker" />
import { parseWorkbook } from '../lib/parser';
import { buildAutomaticDescriptionWorkbook } from '../lib/automatic-description';

const worker = self as unknown as DedicatedWorkerGlobalScope;
worker.addEventListener('message', (event: MessageEvent<{ buffer: ArrayBuffer; filename: string }>) => {
  try {
    const dataset = parseWorkbook(event.data.buffer, event.data.filename);
    const output = buildAutomaticDescriptionWorkbook(dataset);
    worker.postMessage({ type: 'result', buffer: output, rows: dataset.records.length }, [output]);
  } catch (error) {
    worker.postMessage({ type: 'error', message: error instanceof Error ? error.message : 'No fue posible generar las descripciones.' });
  }
});
