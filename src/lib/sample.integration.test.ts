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
  runIfSampleExists('reconcilia los resultados acordados', () => {
    const bytes = fs.readFileSync(samplePath);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const dataset = parseWorkbook(buffer, path.basename(samplePath));
    const result = validateDataset(dataset, hierarchyData as HierarchyCatalog);

    expect(result.metrics).toEqual({
      totalRecords: 15509,
      reviewRecords: 1135,
      okRecords: 14374,
      reviewPercent: expect.closeTo((1135 / 15509) * 100, 8),
      totalAlerts: 1147,
    });
    expect(result.ruleSummaries.find((rule) => rule.id === 'R08')?.affectedRows).toBe(0);
    expect(result.ruleSummaries.find((rule) => rule.id === 'R25')?.affectedRows).toBe(626);
    expect(result.ruleSummaries.find((rule) => rule.id === 'JER-01')?.affectedRows).toBe(480);
  }, 30_000);
});
