import fs from 'node:fs';
import path from 'node:path';
import { it, expect } from 'vitest';
import { parseInvoiceWorkbook, parseWorkbook } from './parser';
import { findSimilarValues } from './similarity';
import { validateDataset } from './rules';
import hierarchyData from '../data/hierarchy.json';
import type { HierarchyCatalog } from './types';
import { createCollaborationManifest } from './collaboration';
import { buildAutomaticDescriptionWorkbook } from './automatic-description';
import * as XLSX from 'xlsx';

const sample = process.env.PQM_SIMILARITY_SAMPLE;
const invoiceSample = process.env.PQM_SIMILARITY_INVOICE_SAMPLE;
it.skipIf(!sample || !fs.existsSync(sample))('compara los valores únicos de una jornada real sin comparar cada par de filas', () => {
  const bytes = fs.readFileSync(sample!);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const dataset = parseWorkbook(buffer, path.basename(sample!));
  const descriptions = dataset.records.map((record) => String(record.fields.Descripcion ?? ''));
  const brands = dataset.records.map((record) => String(record.fields.Marca_Wm ?? ''));
  const descMatches = findSimilarValues(descriptions);
  const brandMatches = findSimilarValues(brands);
  expect(descMatches.size).toBeLessThanOrEqual(new Set(descriptions).size);
  expect(brandMatches.size).toBeLessThanOrEqual(new Set(brands).size);
  const validation = validateDataset(dataset, hierarchyData as HierarchyCatalog);
  expect(validation.ruleSummaries.find((rule) => rule.id === 'R31')?.alertCount).toBeGreaterThan(0);
  expect(validation.ruleSummaries.find((rule) => rule.id === 'R32')).toBeDefined();
  const manifest = createCollaborationManifest(dataset, validation);
  expect(manifest.metrics.reviewTasks).toBeGreaterThan(0);
  expect(manifest.blocks.reduce((total, block) => total + block.taskCount, 0)).toBe(manifest.tasks.length);
  const generated = XLSX.read(buildAutomaticDescriptionWorkbook(dataset), { type: 'array' });
  const sheet = generated.Sheets['pqm consolidado'];
  expect(XLSX.utils.sheet_to_json(sheet, { header: 1 }).length).toBeGreaterThanOrEqual(dataset.records.length);
  if (invoiceSample && fs.existsSync(invoiceSample)) {
    const invoiceBytes = fs.readFileSync(invoiceSample);
    const invoiceBuffer = invoiceBytes.buffer.slice(
      invoiceBytes.byteOffset,
      invoiceBytes.byteOffset + invoiceBytes.byteLength,
    ) as ArrayBuffer;
    const invoices = parseInvoiceWorkbook(invoiceBuffer, path.basename(invoiceSample));
    expect(invoices.totalImages).toBeGreaterThan(0);
  }
}, 120_000);
