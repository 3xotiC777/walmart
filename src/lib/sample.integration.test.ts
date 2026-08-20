import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import hierarchyData from '../data/hierarchy.json';
import { parseWorkbook } from './parser';
import { validateDataset } from './rules';
import type { HierarchyCatalog } from './types';

const samplePath = path.resolve('ENTREGA PANEL PQM - OLA 1-6 V2- ejemplo plan 0.xlsx');
const runIfSampleExists = fs.existsSync(samplePath) ? it : it.skip;

describe('archivo PQM de referencia', () => {
  runIfSampleExists('procesa el archivo de prueba y separa afectados de alertas', () => {
    const bytes = fs.readFileSync(samplePath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const dataset = parseWorkbook(buffer, path.basename(samplePath));
    const result = validateDataset(dataset, hierarchyData as HierarchyCatalog);
    const uniqueAlertRows = new Set(result.alerts.map((alert) => alert.sourceRow));

    expect(result.metrics.totalRecords).toBe(15509);
    expect(result.metrics.reviewRecords).toBe(uniqueAlertRows.size);
    expect(result.metrics.totalAlerts).toBe(result.alerts.length);
    expect(result.metrics.okRecords).toBe(result.metrics.totalRecords - result.metrics.reviewRecords);
    expect(result.metrics.reviewPercent).toBeCloseTo(
      (result.metrics.reviewRecords / result.metrics.totalRecords) * 100,
    );
    expect(result.ruleSummaries.find((rule) => rule.id === 'R08')?.affectedRows).toBe(0);
    expect(result.ruleSummaries.find((rule) => rule.id === 'R25')?.affectedRows).toBe(207);
    expect(result.ruleSummaries.find((rule) => rule.id === 'R01')).toMatchObject({
      affectedRows: 35,
      alertCount: 1,
    });
  }, 30_000);
});
