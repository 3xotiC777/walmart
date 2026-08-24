import { describe, expect, it } from 'vitest';
import { createCollaborationManifest } from './collaboration';
import { buildIngestionPlan, type IngestionPlan } from './ingestion';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';
import type { ValidationResult } from './types';

function onlyRules(result: ValidationResult, ruleIds: string[]): ValidationResult {
  const alerts = result.alerts.filter((alert) => ruleIds.includes(alert.ruleId));
  const affectedRows = new Set(alerts.map((alert) => alert.sourceRow));
  return {
    ...result,
    alerts,
    reviewedRecords: result.reviewedRecords.filter(({ record }) => affectedRows.has(record.excelRow)),
  };
}

function items<T extends Record<string, unknown>>(plan: IngestionPlan, key: string): T[] {
  return plan.batches.flatMap((batch) => batch.payload[key] ?? []) as T[];
}

function canonicalPayload(plan: IngestionPlan): string {
  return JSON.stringify(plan.batches.map(({ payload }) => payload));
}

describe('plan de ingesta colaborativa', () => {
  it('mantiene claves externas y hash de manifiesto estables para reintentos idempotentes', async () => {
    const dataset = makeDataset([
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      {
        codiGo_barras: '001',
        Descripcion: 'OTRO PRODUCTO MARCA',
        cantidad_comprada: 2,
        Precio_Unidad: 10,
        Precio_Total_Preciador: 10,
      },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01', 'R28']);
    const manifest = createCollaborationManifest(dataset, result);
    const invoices = {
      sourceFile: 'facturas.xlsx',
      urlsByRef: {
        'ID-3': ['https://facturas.example/ID-3/1.jpg', 'data:image/png;base64,no-se-persiste'],
      },
      totalImages: 2,
    };

    const first = await buildIngestionPlan(dataset, manifest, invoices);
    const rebuilt = await buildIngestionPlan(dataset, manifest, invoices);

    expect(first.manifestHash).toMatch(/^[a-f0-9]{64}$/);
    expect(rebuilt.manifestHash).toBe(first.manifestHash);
    expect(canonicalPayload(rebuilt)).toBe(canonicalPayload(first));
    expect(new Set(first.batches.map((batch) => batch.key)).size).toBe(first.batches.length);

    expect(first).toMatchObject({ storedRowCount: 3, taskCount: 1, alertCount: 2 });
    expect(items(first, 'rows').map((row) => row.external_key)).toEqual(['row-2', 'row-3', 'row-4']);
    expect(items(first, 'tasks')).toEqual([
      expect.objectContaining({
        external_key: 'task-4',
        row_external_key: 'row-4',
        excel_row: 4,
        alert_count: 2,
      }),
    ]);
    const alerts = items(first, 'alerts');
    expect(alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ event_key: 'alert-R01-4', task_external_key: 'task-4', rule_code: 'R01' }),
      expect.objectContaining({
        event_key: 'alert-R28-4',
        task_external_key: 'task-4',
        rule_code: 'R28',
        affected_field: 'Precio_Total_Preciador',
        source_column_index: dataset.headers.indexOf('Precio_Total_Preciador'),
        original_value: '10',
        suggested_value: '20',
      }),
    ]));
    expect(alerts.every((alert) => alert.evidence_fingerprint_hex?.toString().length === 64)).toBe(true);
    expect(items(first, 'invoices')).toEqual([
      expect.objectContaining({
        row_external_key: null,
        external_url: 'https://facturas.example/ID-3/1.jpg',
      }),
    ]);
  });

  it('crea una sola tarea por fila aunque la fila reúna varias alertas', async () => {
    const dataset = makeDataset([
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      {
        codiGo_barras: '001',
        Descripcion: 'OTRO PRODUCTO MARCA',
        cantidad_comprada: 3,
        Precio_Unidad: 25,
        Precio_Total_Preciador: 25,
      },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01', 'R28']);
    const manifest = createCollaborationManifest(dataset, result);
    const plan = await buildIngestionPlan(dataset, manifest, {
      sourceFile: 'facturas.xlsx',
      urlsByRef: {},
      totalImages: 0,
    });
    const tasks = items(plan, 'tasks');
    const alerts = items(plan, 'alerts');

    expect(manifest.tasks).toHaveLength(1);
    expect(tasks).toHaveLength(1);
    expect(new Set(tasks.map((task) => task.excel_row)).size).toBe(tasks.length);
    expect(alerts).toHaveLength(2);
    expect(new Set(alerts.map((alert) => alert.task_external_key))).toEqual(new Set(['task-4']));
  });

  it('persiste promedio, umbral de 15 % y diferencia de R25 en la evidencia', async () => {
    const dataset = makeDataset(
      [10, 10, 10, 10, 100].map((price) => ({
        codiGo_barras: 'P1',
        Descripcion: 'PRODUCTO MARCA',
        Precio_Unidad: price,
      })),
    );
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R25']);
    const plan = await buildIngestionPlan(
      dataset,
      createCollaborationManifest(dataset, result),
      { sourceFile: 'facturas.xlsx', urlsByRef: {}, totalImages: 0 },
    );
    const alert = items(plan, 'alerts').find((item) => item.rule_code === 'R25');

    expect(alert?.suggestion_evidence).toMatchObject({
      statistics: {
        groupAverage: 28,
        priceDifferencePercent: 72 / 28,
      },
    });
    const statistics = (alert?.suggestion_evidence as { statistics?: { priceThreshold?: number } })?.statistics;
    expect(statistics?.priceThreshold).toBeCloseTo(32.2);
  });
});
