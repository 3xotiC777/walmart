import { describe, expect, it, vi } from 'vitest';
import type { IngestionBatch } from './ingestion';
import {
  ALERT_INGESTION_CONCURRENCY,
  ingestionBatchStage,
  ingestionStageConcurrency,
  runIngestionBatches,
} from './ingestion-runner';

function item(key: string, id: number): IngestionBatch {
  return { key: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`, payload: { [key]: [{ id }] } };
}

describe('guardado concurrente de la ingesta', () => {
  it('clasifica los lotes según sus dependencias', () => {
    expect(ingestionBatchStage(item('rows', 1))).toBe(0);
    expect(ingestionBatchStage(item('group_members', 2))).toBe(1);
    expect(ingestionBatchStage(item('alerts', 3))).toBe(2);
    expect(() => ingestionBatchStage(item('desconocido', 4))).toThrow(/desconocido/i);
  });

  it('limita solo la etapa pesada de alertas', () => {
    expect(ingestionStageConcurrency(0, 4)).toBe(4);
    expect(ingestionStageConcurrency(1, 4)).toBe(4);
    expect(ingestionStageConcurrency(2, 4)).toBe(ALERT_INGESTION_CONCURRENCY);
    expect(ingestionStageConcurrency(2, 1)).toBe(1);
  });

  it('procesa en paralelo sin adelantar etapas dependientes', async () => {
    const batches = [
      item('alerts', 7), item('rows', 1), item('groups', 2), item('blocks', 3),
      item('tasks', 5), item('group_members', 4), item('invoices', 6),
    ];
    const activeStages = new Set<number>();
    let active = 0;
    let maximumActive = 0;
    const completed: number[] = [];

    await runIngestionBatches(batches, async (batch) => {
      const stage = ingestionBatchStage(batch);
      activeStages.add(stage);
      expect(activeStages.size).toBe(1);
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      if (active === 0) activeStages.delete(stage);
    }, (count) => completed.push(count), 3);

    expect(maximumActive).toBe(3);
    expect(completed).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('espera los trabajos activos y detiene nuevos lotes tras el primer error', async () => {
    const failure = new Error('falló');
    const ingest = vi.fn(async (batch: IngestionBatch) => {
      if (batch.key.endsWith('000000000002')) throw failure;
      await new Promise((resolve) => setTimeout(resolve, 2));
    });
    const batches = [item('rows', 1), item('rows', 2), item('rows', 3), item('rows', 4)];

    await expect(runIngestionBatches(batches, ingest, () => undefined, 2)).rejects.toBe(failure);
    expect(ingest.mock.calls.length).toBeLessThan(batches.length);
  });

  it('no ejecuta más de dos lotes de alertas simultáneos', async () => {
    const batches = Array.from({ length: 6 }, (_, index) => item('alerts', index + 1));
    let active = 0;
    let maximumActive = 0;

    await runIngestionBatches(batches, async () => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
    }, () => undefined, 4);

    expect(maximumActive).toBe(ALERT_INGESTION_CONCURRENCY);
  });
});
