import { describe, expect, it } from 'vitest';
import { createCollaborationManifest } from './collaboration';
import {
  buildIngestionPlan,
  ingestionBatchRequestByteLength,
  MAX_INGESTION_REQUEST_BYTES,
  packIngestionBatches,
  type IngestionPlan,
} from './ingestion';
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
  it('divide por bytes sin perder ni duplicar elementos cuando el contenido es voluminoso', () => {
    const values = Array.from({ length: 9 }, (_, index) => ({
      id: index,
      detail: `${index}-` + 'á'.repeat(300_000),
    }));
    const batches = packIngestionBatches('alerts', values, 800);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((item) => item.payload.alerts)).toEqual(values);
    expect(batches.every((item) => ingestionBatchRequestByteLength(item) <= MAX_INGESTION_REQUEST_BYTES)).toBe(true);
  });

  it('rechaza un elemento individual que no se pueda guardar con seguridad', () => {
    expect(() => packIngestionBatches('alerts', [{ detail: 'x'.repeat(MAX_INGESTION_REQUEST_BYTES) }], 800))
      .toThrow('Un elemento de alerts supera por sí solo el tamaño seguro de guardado.');
  });

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
    expect(items(first, 'rows')).toContainEqual(expect.objectContaining({
      external_key: 'row-4',
      field_values: expect.objectContaining({
        cantidad_comprada: 2,
        Precio_Unidad: 10,
        Precio_Total_Preciador: 10,
      }),
    }));
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

  it('persiste una sola copia de las filas relacionadas aunque un grupo produzca muchas alertas', async () => {
    const dataset = makeDataset(Array.from({ length: 1_000 }, (_, index) => ({
      codiGo_barras: 'GRUPO-GRANDE',
      Descripcion: index % 2 === 0 ? 'PRODUCTO MARCA 1' : 'PRODUCTO MARCA 2',
    })));
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01']);
    const manifest = createCollaborationManifest(dataset, result);
    const plan = await buildIngestionPlan(dataset, manifest, {
      sourceFile: 'facturas.xlsx',
      urlsByRef: {},
      totalImages: 0,
    });
    const alerts = items<{
      suggestion_evidence: Record<string, unknown>;
      suggestion_alternatives: Array<Record<string, unknown>>;
    }>(plan, 'alerts');
    const groups = items<{
      observed_values: Array<Record<string, unknown>>;
    }>(plan, 'groups');
    const members = items(plan, 'group_members');

    expect(alerts).toHaveLength(1_000);
    expect(members).toHaveLength(1_000);
    expect(alerts.every((alert) => !('sourceRows' in alert.suggestion_evidence))).toBe(true);
    expect(alerts.every((alert) => alert.suggestion_alternatives.length === 0)).toBe(true);
    expect(groups).toHaveLength(1);
    expect(groups[0].observed_values).toEqual(expect.arrayContaining([
      expect.objectContaining({ value: 'PRODUCTO MARCA 1', count: 500 }),
      expect.objectContaining({ value: 'PRODUCTO MARCA 2', count: 500 }),
    ]));
    expect(plan.batches.every((item) => ingestionBatchRequestByteLength(item) <= MAX_INGESTION_REQUEST_BYTES)).toBe(true);
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

  it('persiste R30 como alerta manual editable sobre Descripcion', async () => {
    const dataset = makeDataset([{
      Producto_Wm: 'PRODUCTO A',
      Marca_Wm: 'MARCA',
      Descripcion: 'MARCA PRODUCTO A 1LT',
      Gramaje: 1,
      unidad_de_Medida: 'LITROS',
    }]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R30']);
    const plan = await buildIngestionPlan(
      dataset,
      createCollaborationManifest(dataset, result),
      { sourceFile: 'facturas.xlsx', urlsByRef: {}, totalImages: 0 },
    );

    expect(plan).toMatchObject({ storedRowCount: 1, taskCount: 1, alertCount: 1 });
    expect(items(plan, 'groups')).toEqual([
      expect.objectContaining({
        rule_code: 'R30',
        affected_field: 'Descripcion',
        affected_row_count: 1,
        alert_count: 1,
      }),
    ]);
    expect(items(plan, 'group_members')).toEqual([
      expect.objectContaining({ rule_code: 'R30', excel_row: 2, is_alert: true, is_related_context: false }),
    ]);
    expect(items(plan, 'alerts')).toEqual([
      expect.objectContaining({
        event_key: 'alert-R30-2',
        rule_code: 'R30',
        category: 'validation',
        affected_field: 'Descripcion',
        source_column_index: dataset.headers.indexOf('Descripcion'),
        original_value: 'MARCA PRODUCTO A 1LT',
        suggested_column_name: 'Descripcion',
        suggested_column_index: dataset.headers.indexOf('Descripcion'),
        suggested_value: null,
        suggestion_method: 'manual-review',
        suggestion_confidence: 'none',
        suggestion_evidence: expect.objectContaining({
          inputs: {
            Producto_Wm: 'PRODUCTO A',
            Marca_Wm: 'MARCA',
            Gramaje: 1,
            unidad_de_Medida: 'LITROS',
          },
        }),
        can_auto_apply: false,
        evidence_fingerprint_hex: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
  });
});
