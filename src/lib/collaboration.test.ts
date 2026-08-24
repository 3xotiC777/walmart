import { describe, expect, it } from 'vitest';
import {
  balanceCollaborationBlocks,
  calculateCollaborationMetrics,
  createCollaborationManifest,
  type CollaborationBlock,
} from './collaboration';
import { generateOrthographyAlerts } from './orthography';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';
import type { ValidationResult } from './types';

function onlyRules(result: ValidationResult, ruleIds: string[]): ValidationResult {
  const alerts = result.alerts.filter((alert) => ruleIds.includes(alert.ruleId));
  const rows = new Set(alerts.map((alert) => alert.sourceRow));
  return {
    ...result,
    alerts,
    reviewedRecords: result.reviewedRecords.filter((reviewed) => rows.has(reviewed.record.excelRow)),
  };
}

describe('manifiesto colaborativo', () => {
  it('mantiene 35 miembros afectados, pero crea una tarea y una alerta para el valor minoritario de R01', () => {
    const dataset = makeDataset([
      ...Array.from({ length: 34 }, () => ({ codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' })),
      { codiGo_barras: '001', Descripcion: 'OTRO PRODUCTO MARCA' },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01']);

    const manifest = createCollaborationManifest(dataset, result);
    const group = manifest.conflictGroups.find((item) => item.ruleId === 'R01');

    expect(group?.members).toHaveLength(35);
    expect(group?.alertSourceRows).toEqual([36]);
    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.metrics).toMatchObject({ reviewTasks: 1, alertEvents: 1 });
    expect(manifest.tasks[0].alerts[0].suggestion).toMatchObject({
      targetField: 'Descripcion',
      value: 'PRODUCTO MARCA',
      method: 'strict-majority',
      confidence: 'high',
      autoApplicable: true,
    });
  });

  it('no habilita aplicación automática cuando la cardinalidad está empatada', () => {
    const dataset = makeDataset([
      { codiGo_barras: '001', Descripcion: 'PRODUCTO A MARCA' },
      { codiGo_barras: '001', Descripcion: 'PRODUCTO B MARCA' },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01']);

    const manifest = createCollaborationManifest(dataset, result);

    expect(manifest.tasks).toHaveLength(2);
    expect(manifest.tasks.every((task) => task.alerts[0].suggestion.autoApplicable === false)).toBe(true);
    expect(manifest.tasks[0].alerts[0].suggestion).toMatchObject({
      value: null,
      method: 'strict-majority',
      confidence: 'none',
    });
    expect(manifest.tasks[0].alerts[0].suggestion.alternatives).toHaveLength(2);
  });

  it('propone la moda única normal para R25 y solo informa la mediana si no hay moda', () => {
    const modeDataset = makeDataset([
      ...[10, 10, 10, 10, 100].map((price) => ({
        codiGo_barras: 'P1',
        Descripcion: 'PRODUCTO MARCA',
        Precio_Unidad: price,
      })),
    ]);
    const modeResult = onlyRules(validateDataset(modeDataset, TEST_HIERARCHY), ['R25']);
    const modeSuggestion = createCollaborationManifest(modeDataset, modeResult).tasks[0].alerts[0].suggestion;

    expect(modeSuggestion).toMatchObject({
      value: 10,
      method: 'normal-price-mode',
      confidence: 'high',
      autoApplicable: true,
      evidence: {
        statistics: {
          groupAverage: 28,
          priceDifferencePercent: 72 / 28,
        },
      },
    });
    expect(modeSuggestion.evidence.statistics?.priceThreshold).toBeCloseTo(32.2);

    const medianDataset = makeDataset([
      ...[10, 20, 30, 40, 1_000].map((price) => ({
        codiGo_barras: 'P2',
        Descripcion: 'PRODUCTO MARCA',
        Precio_Unidad: price,
      })),
    ]);
    const medianResult = onlyRules(validateDataset(medianDataset, TEST_HIERARCHY), ['R25']);
    const medianSuggestion = createCollaborationManifest(medianDataset, medianResult).tasks[0].alerts[0].suggestion;

    expect(medianSuggestion).toMatchObject({
      value: 25,
      method: 'normal-price-median',
      confidence: 'medium',
      autoApplicable: false,
      evidence: {
        statistics: {
          groupAverage: 220,
          priceDifferencePercent: 780 / 220,
        },
      },
    });
    expect(medianSuggestion.evidence.statistics?.priceThreshold).toBeCloseTo(253);
  });

  it('conserva los grupos colaborativos por descripción cuando el estudio no trae código', () => {
    const dataset = makeDataset([
      { codiGo_barras: '', Descripcion: 'PRODUCTO MARCA 500GR', Gramaje: 500, Precio_Unidad: 100 },
      { codiGo_barras: '', Descripcion: 'PRODUCTO MARCA 500GR', Gramaje: 500, Precio_Unidad: 100 },
      { codiGo_barras: '', Descripcion: 'PRODUCTO MARCA 500GR', Gramaje: 750, Precio_Unidad: 200 },
    ]);
    dataset.hasBarcode = false;
    const result = onlyRules(
      validateDataset(dataset, TEST_HIERARCHY, undefined, { hasBarcode: false }),
      ['R08', 'R25'],
    );

    const manifest = createCollaborationManifest(dataset, result);
    const r08Group = manifest.conflictGroups.find((group) => group.ruleId === 'R08');
    const r25Group = manifest.conflictGroups.find((group) => group.ruleId === 'R25');
    const r25Suggestion = manifest.tasks
      .flatMap((task) => task.alerts)
      .find((alert) => alert.ruleId === 'R25')?.suggestion;

    expect(r08Group?.keyFields).toEqual(['Descripcion']);
    expect(r08Group?.members.map((member) => member.sourceRow)).toEqual([2, 3, 4]);
    expect(r25Group?.keyFields).toEqual(['Descripcion']);
    expect(r25Group?.members.map((member) => member.sourceRow)).toEqual([2, 3, 4]);
    expect(r25Suggestion).toMatchObject({
      value: 100,
      method: 'normal-price-mode',
      confidence: 'high',
      evidence: { groupSize: 3 },
    });
  });

  it('calcula la propuesta R28 sobre la columna de precio total', () => {
    const dataset = makeDataset([
      { cantidad_comprada: 3, Precio_Unidad: 125.5, Precio_Total_Preciador: 125.5 },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R28']);

    const suggestion = createCollaborationManifest(dataset, result).tasks[0].alerts[0].suggestion;

    expect(suggestion).toMatchObject({
      targetField: 'Precio_Total_Preciador',
      targetColumnIndex: dataset.headers.indexOf('Precio_Total_Preciador'),
      value: 376.5,
      method: 'calculated-total',
      confidence: 'high',
      autoApplicable: true,
    });
  });

  it('deja R26 y R27 editables sobre la celda sumada sin inventar una sugerencia', () => {
    const dataset = makeDataset([
      { 'Id_Dn W': 'MAL', Cantidad_Productos: 3, cantidad_comprada: 1, Precio_Total_Preciador: 12, 'Monto Total Fc': 30 },
      { 'Id_Dn W': 'MAL', Cantidad_Productos: 3, cantidad_comprada: 1, Precio_Total_Preciador: 12, 'Monto Total Fc': 30 },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R26', 'R27']);
    const alerts = createCollaborationManifest(dataset, result).tasks[0].alerts;

    expect(alerts.find((alert) => alert.ruleId === 'R26')?.suggestion).toMatchObject({
      targetField: 'cantidad_comprada',
      targetColumnIndex: dataset.headers.indexOf('cantidad_comprada'),
      value: null,
      confidence: 'none',
      autoApplicable: false,
    });
    expect(alerts.find((alert) => alert.ruleId === 'R27')?.suggestion).toMatchObject({
      targetField: 'Precio_Total_Preciador',
      targetColumnIndex: dataset.headers.indexOf('Precio_Total_Preciador'),
      value: null,
      confidence: 'none',
      autoApplicable: false,
    });
  });

  it('une ortografía y reglas automáticas de la misma fila en una sola tarea', () => {
    const dataset = makeDataset([
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '001', Descripcion: '  PRODUCTO  MARCAA  ' },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01']);
    const orthography = generateOrthographyAlerts(dataset);

    const manifest = createCollaborationManifest(dataset, result, orthography);

    expect(manifest.tasks).toHaveLength(1);
    expect(manifest.tasks[0].alerts.map((alert) => alert.ruleId)).toEqual(['ORT-01', 'R01']);
    expect(manifest.metrics).toMatchObject({ reviewTasks: 1, alertEvents: 2, orthographyAlerts: 1 });
    expect(manifest.tasks[0].alerts.find((alert) => alert.ruleId === 'ORT-01')?.suggestion).toMatchObject({
      value: 'PRODUCTO MARCA',
      method: 'unique-reference',
      autoApplicable: true,
    });
  });

  it('conecta en un bloque solo tareas alertadas relacionadas y no convierte el contexto en tareas', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'A', Descripcion: 'PRODUCTO A MARCA', Categoria_Wm: 'CATEGORIA A' },
      { codiGo_barras: 'A', Descripcion: 'PRODUCTO A MARCA', Categoria_Wm: 'CATEGORIA B' },
      { codiGo_barras: 'A', Descripcion: 'PRODUCTO X MARCA', Categoria_Wm: 'CATEGORIA A' },
      { codiGo_barras: 'B', Descripcion: 'PRODUCTO B MARCA' },
      { codiGo_barras: 'B', Descripcion: 'PRODUCTO B MARCA' },
      { codiGo_barras: 'B', Descripcion: 'PRODUCTO Y MARCA' },
    ]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R01', 'R02']);

    const manifest = createCollaborationManifest(dataset, result);
    const linked = manifest.blocks.find((block) => block.sourceRows.includes(3));
    const independent = manifest.blocks.find((block) => block.sourceRows.includes(7));

    expect(manifest.tasks.map((task) => task.sourceRow)).toEqual([3, 4, 7]);
    expect(linked?.sourceRows).toEqual([3, 4]);
    expect(linked?.relatedSourceRows).toEqual([2, 3, 4]);
    expect(independent?.sourceRows).toEqual([7]);
    expect(manifest.blocks).toHaveLength(2);
  });

  it('reparte bloques indivisibles con LPT y recalcula métricas sin cifras fijas', () => {
    const block = (id: string, weight: number): CollaborationBlock => ({
      id,
      taskIds: Array.from({ length: weight }, (_, index) => `${id}-task-${index}`),
      sourceRows: Array.from({ length: weight }, (_, index) => index + 2),
      conflictGroupIds: [],
      relatedSourceRows: [],
      taskCount: weight,
      alertCount: weight,
      relatedRecordCount: weight,
      invoiceCount: 0,
      weight,
    });
    const balance = balanceCollaborationBlocks(
      [block('B-8', 8), block('B-7', 7), block('B-6', 6), block('B-5', 5), block('B-4', 4)],
      ['VAL-1', 'VAL-2'],
    );

    expect(balance.assignments.map(({ blockId, validatorId }) => [blockId, validatorId])).toEqual([
      ['B-8', 'VAL-1'],
      ['B-7', 'VAL-2'],
      ['B-6', 'VAL-2'],
      ['B-5', 'VAL-1'],
      ['B-4', 'VAL-1'],
    ]);
    expect(balance.validatorLoads.map((load) => load.totalWeight)).toEqual([17, 13]);

    const dataset = makeDataset([{ cantidad_comprada: 2, Precio_Unidad: 10, Precio_Total_Preciador: 10 }]);
    const result = onlyRules(validateDataset(dataset, TEST_HIERARCHY), ['R28']);
    const manifest = createCollaborationManifest(dataset, result);
    const metrics = calculateCollaborationMetrics(dataset.records.length, manifest.tasks, {
      [manifest.tasks[0].id]: { status: 'resolved', changedCells: 1, confirmedCorrect: false },
    });
    expect(metrics).toMatchObject({
      totalRecords: 1,
      reviewTasks: 1,
      alertEvents: 1,
      pendingTasks: 0,
      resolvedTasks: 1,
      changedCells: 1,
    });
  });
});
