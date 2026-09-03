import type { IngestionBatch } from './ingestion';

export const INGESTION_CONCURRENCY = 4;
// Las alternativas voluminosas se normalizan en conflict_groups, por lo que
// los lotes de alertas ya pueden aprovechar la concurrencia normal sin repetir
// cientos de MB ni competir con transacciones desproporcionadas.
export const ALERT_INGESTION_CONCURRENCY = 4;

const STAGE_BY_PAYLOAD: Record<string, number> = {
  rows: 0,
  groups: 0,
  blocks: 0,
  group_members: 1,
  tasks: 1,
  invoices: 1,
  alerts: 2,
};

export function ingestionBatchStage(item: IngestionBatch): number {
  const keys = Object.keys(item.payload).filter((key) => (item.payload[key]?.length ?? 0) > 0);
  if (keys.length !== 1 || STAGE_BY_PAYLOAD[keys[0]] === undefined) {
    throw new Error('El plan de guardado contiene un lote desconocido.');
  }
  return STAGE_BY_PAYLOAD[keys[0]];
}

export function ingestionStageConcurrency(stage: number, requested: number): number {
  return stage === STAGE_BY_PAYLOAD.alerts
    ? Math.min(requested, ALERT_INGESTION_CONCURRENCY)
    : requested;
}

export async function runIngestionBatches(
  batches: readonly IngestionBatch[],
  ingest: (item: IngestionBatch) => Promise<void>,
  onProgress: (completed: number, total: number) => void,
  concurrency = INGESTION_CONCURRENCY,
): Promise<void> {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('La concurrencia de guardado debe ser un entero positivo.');
  }

  const stages = new Map<number, IngestionBatch[]>();
  for (const item of batches) {
    const stage = ingestionBatchStage(item);
    stages.set(stage, [...(stages.get(stage) ?? []), item]);
  }

  let completed = 0;
  let firstError: unknown;
  for (const stage of [...stages.keys()].sort((left, right) => left - right)) {
    const pending = stages.get(stage) ?? [];
    const stageConcurrency = ingestionStageConcurrency(stage, concurrency);
    let cursor = 0;
    const workers = Array.from({ length: Math.min(stageConcurrency, pending.length) }, async () => {
      while (!firstError) {
        const index = cursor;
        cursor += 1;
        if (index >= pending.length) return;
        try {
          await ingest(pending[index]);
          completed += 1;
          onProgress(completed, batches.length);
        } catch (error) {
          firstError = error;
        }
      }
    });
    await Promise.all(workers);
    if (firstError) throw firstError;
  }
}
