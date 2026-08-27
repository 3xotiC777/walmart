import { displayValue, normalizeText, numericValue } from './rules';
import type {
  AlertRecord,
  CellValue,
  OrthographyAlert,
  SourceDataset,
  SourceRecord,
  ValidationResult,
} from './types';

export type CollaborationValue = string | number | boolean | null;
export type CollaborationConfidence = 'high' | 'medium' | 'none';
export type CollaborationTaskStatus = 'pending' | 'resolved';
export type CollaborationSuggestionMethod =
  | 'strict-majority'
  | 'hierarchy-reference'
  | 'normal-price-mode'
  | 'normal-price-median'
  | 'calculated-total'
  | 'unique-reference'
  | 'orthography-frequency'
  | 'orthography-learning'
  | 'orthography-spacing'
  | 'orthography-unrecognized-token'
  | 'manual-review';

export interface CollaborationAlternative {
  value: CollaborationValue;
  count: number;
  sourceRows: number[];
}

export interface CollaborationEvidence {
  summary: string;
  groupSize: number;
  sourceRows: number[];
  inputs?: Record<string, CollaborationValue>;
  statistics?: {
    groupAverage: number;
    priceThreshold: number;
    priceDifferencePercent?: number;
  };
}

export interface CollaborationSuggestion {
  targetField: string | null;
  /** Índice de columna basado en cero dentro de `SourceDataset.headers`. */
  targetColumnIndex: number | null;
  value: CollaborationValue;
  method: CollaborationSuggestionMethod;
  confidence: CollaborationConfidence;
  alternatives: CollaborationAlternative[];
  autoApplicable: boolean;
  evidence: CollaborationEvidence;
}

export interface CollaborationAlert {
  id: string;
  ruleId: string;
  ruleName: string;
  sourceRow: number;
  field: string;
  observed: string;
  expected: string;
  detail: string;
  conflictGroupId: string;
  suggestion: CollaborationSuggestion;
}

export interface CollaborationGroupMember {
  sourceRow: number;
  rowId: string;
  surveyId: string;
  barcode: string;
  description: string;
  fields: Record<string, CollaborationValue>;
  isAlerted: boolean;
}

export interface CollaborationConflictGroup {
  id: string;
  ruleId: string;
  key: string;
  keyFields: string[];
  keyValues: Record<string, CollaborationValue>;
  targetField: string | null;
  alertIds: string[];
  alertSourceRows: number[];
  members: CollaborationGroupMember[];
}

export interface CollaborationTask {
  id: string;
  sourceRow: number;
  rowId: string;
  surveyId: string;
  barcode: string;
  description: string;
  alerts: CollaborationAlert[];
  conflictGroupIds: string[];
  invoiceUrls: string[];
  status: CollaborationTaskStatus;
}

export interface CollaborationBlock {
  id: string;
  taskIds: string[];
  sourceRows: number[];
  conflictGroupIds: string[];
  relatedSourceRows: number[];
  taskCount: number;
  alertCount: number;
  relatedRecordCount: number;
  invoiceCount: number;
  weight: number;
}

export interface CollaborationTaskProgress {
  status?: CollaborationTaskStatus;
  changedCells?: number;
  confirmedCorrect?: boolean;
}

export interface CollaborationMetrics {
  totalRecords: number;
  recordsWithoutAlerts: number;
  reviewTasks: number;
  alertEvents: number;
  orthographyAlerts: number;
  pendingTasks: number;
  resolvedTasks: number;
  pendingAlerts: number;
  resolvedAlerts: number;
  changedCells: number;
  confirmedCorrect: number;
  reviewPercent: number;
}

export interface CollaborationManifest {
  sourceFile: string;
  headers: string[];
  tasks: CollaborationTask[];
  conflictGroups: CollaborationConflictGroup[];
  blocks: CollaborationBlock[];
  metrics: CollaborationMetrics;
}

export interface CollaborationValidator {
  id: string;
  existingLoad?: number;
}

export interface CollaborationAssignment {
  blockId: string;
  validatorId: string;
  weight: number;
  taskIds: string[];
  sourceRows: number[];
}

export interface CollaborationValidatorLoad {
  validatorId: string;
  initialWeight: number;
  assignedWeight: number;
  totalWeight: number;
  blockCount: number;
  taskCount: number;
  alertCount: number;
}

export interface CollaborationBalance {
  assignments: CollaborationAssignment[];
  validatorLoads: CollaborationValidatorLoad[];
  unassignedBlockIds: string[];
}

interface CardinalityDefinition {
  keyFields: string[];
  targetField: string;
}

const CARDINALITY_DEFINITIONS: Record<string, CardinalityDefinition> = {
  R01: { keyFields: ['codiGo_barras'], targetField: 'Descripcion' },
  R02: { keyFields: ['codiGo_barras'], targetField: 'Categoria_Wm' },
  R03: { keyFields: ['codiGo_barras'], targetField: 'Producto_Wm' },
  R04: { keyFields: ['codiGo_barras'], targetField: 'Division_Wm' },
  R05: { keyFields: ['codiGo_barras'], targetField: 'Marca_Wm' },
  R06: { keyFields: ['codiGo_barras'], targetField: 'Tipo_Marca' },
  R07: { keyFields: ['codiGo_barras'], targetField: 'Canasto Wm' },
  R08: { keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'Gramaje' },
  R09: { keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'unidad_de_Medida' },
  R10: { keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'codiGo_estandar' },
  R11: { keyFields: ['Descripcion'], targetField: 'codiGo_barras' },
  R12: { keyFields: ['Descripcion'], targetField: 'Producto_Wm' },
  R13: { keyFields: ['Descripcion'], targetField: 'Categoria_Wm' },
  R14: { keyFields: ['Descripcion'], targetField: 'Division_Wm' },
  R16: { keyFields: ['Descripcion'], targetField: 'Tipo_Marca' },
  R17: { keyFields: ['Descripcion'], targetField: 'Canasto Wm' },
  R18: { keyFields: ['Producto_Wm'], targetField: 'Categoria_Wm' },
  R19: { keyFields: ['Producto_Wm'], targetField: 'Division_Wm' },
  R20: { keyFields: ['Producto_Wm'], targetField: 'Canasto Wm' },
  R22: { keyFields: ['Categoria_Wm'], targetField: 'Division_Wm' },
  R23: { keyFields: ['Categoria_Wm'], targetField: 'Canasto Wm' },
  R24: { keyFields: ['Marca_Wm'], targetField: 'Tipo_Marca' },
};
const DESCRIPTION_ONLY_CARDINALITY_RULES = new Set(['R08', 'R09', 'R10']);

const HIERARCHY_TARGETS: Record<string, string> = {
  'JER-02': 'Categoria_Wm',
  'JER-03': 'Division_Wm',
  'JER-04': 'Canasto Wm',
};

interface InternalAlert {
  id: string;
  source: AlertRecord;
  orthography?: OrthographyAlert;
}

interface GroupDescriptor {
  id: string;
  ruleId: string;
  key: string;
  keyFields: string[];
  keyValues: Record<string, CollaborationValue>;
  targetField: string | null;
  records: SourceRecord[];
  sourceRows: number[];
}

interface GroupBuilder extends GroupDescriptor {
  alertIds: Set<string>;
  alertSourceRows: Set<number>;
}

function collaborationValue(value: CellValue): CollaborationValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function stableHash(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of value) {
    hash ^= BigInt(character.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(36);
}

function stableId(prefix: string, value: string): string {
  return `${prefix}-${stableHash(value)}`;
}

function sortedNumbers(values: Iterable<number>): number[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function recordMatches(record: SourceRecord, fields: string[], expected: string[]): boolean {
  return fields.every((field, index) => normalizeText(record.fields[field]) === expected[index]);
}

function targetColumnIndex(dataset: SourceDataset, field: string | null): number | null {
  if (!field) return null;
  const index = dataset.headers.indexOf(field);
  return index < 0 ? null : index;
}

function normalizeAlertInput(
  alert: AlertRecord | OrthographyAlert,
  recordsByRow: Map<number, SourceRecord>,
): InternalAlert {
  if ('ruleId' in alert) {
    return {
      id: ['EST-01', 'EST-02'].includes(alert.ruleId)
        ? `alert-${alert.ruleId}-${alert.sourceRow}-${stableHash(alert.field)}`
        : `alert-${alert.ruleId}-${alert.sourceRow}`,
      source: alert,
    };
  }

  const record = recordsByRow.get(alert.sourceRow);
  const source: AlertRecord = {
    ruleId: 'ORT-01',
    ruleName: 'Ortografía contextual y espacios',
    sourceRow: alert.sourceRow,
    rowId: alert.rowId,
    surveyId: alert.surveyId,
    barcode: alert.barcode,
    description: alert.fields.Descripcion,
    key: alert.rowId || `Fila ${alert.sourceRow}`,
    field: 'Descripcion',
    observed: displayValue(record?.fields.Descripcion ?? alert.fields.Descripcion),
    expected: alert.correctedDescription,
    detail: alert.confidence === 'none'
      ? `${alert.reason}. ${alert.detail}`
      : `${alert.reason}. ${alert.detail} Posible corrección: "${alert.correctedDescription}" (${alert.probability}, confianza ${alert.confidence}).`,
  };
  return {
    id: `alert-ORT-01-${alert.sourceRow}`,
    source,
    orthography: alert,
  };
}

function groupDescriptor(
  dataset: SourceDataset,
  alert: InternalAlert,
  recordsByRow: Map<number, SourceRecord>,
): GroupDescriptor {
  const sourceRecord = recordsByRow.get(alert.source.sourceRow);
  const cardinality = CARDINALITY_DEFINITIONS[alert.source.ruleId];
  let keyFields: string[];
  let targetField: string | null;
  let keyNormalized: string[];
  let records: SourceRecord[];
  let keyValues: Record<string, CollaborationValue>;

  if (cardinality && sourceRecord) {
    keyFields = dataset.hasBarcode === false && DESCRIPTION_ONLY_CARDINALITY_RULES.has(alert.source.ruleId)
      ? ['Descripcion']
      : cardinality.keyFields;
    targetField = cardinality.targetField;
    keyNormalized = keyFields.map((field) => normalizeText(sourceRecord.fields[field]));
    records = dataset.records.filter((record) => {
      if (!recordMatches(record, keyFields, keyNormalized)) return false;
      if (!normalizeText(record.fields[targetField!])) return false;
      return alert.source.ruleId !== 'R08' || normalizeText(record.fields.unidad_de_Medida) !== 'KILOS';
    });
    keyValues = Object.fromEntries(keyFields.map((field) => [field, collaborationValue(sourceRecord.fields[field])]));
  } else if (alert.source.ruleId === 'R25' && sourceRecord) {
    keyFields = dataset.hasBarcode === false ? ['Descripcion'] : ['codiGo_barras', 'Descripcion'];
    targetField = 'Precio_Unidad';
    keyNormalized = keyFields.map((field) => normalizeText(sourceRecord.fields[field]));
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = Object.fromEntries(keyFields.map((field) => [field, collaborationValue(sourceRecord.fields[field])]));
  } else if (alert.source.ruleId === 'R29' && sourceRecord) {
    keyFields = ['codiGo_barras'];
    targetField = 'Descripcion';
    keyNormalized = keyFields.map((field) => normalizeText(sourceRecord.fields[field]));
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = { codiGo_barras: collaborationValue(sourceRecord.fields.codiGo_barras) };
  } else if (alert.source.ruleId === 'ORT-01' && sourceRecord) {
    keyFields = ['Descripcion'];
    targetField = 'Descripcion';
    const variants = new Set([normalizeText(alert.source.observed), normalizeText(alert.source.expected)].filter(Boolean));
    keyNormalized = [...variants].sort();
    records = dataset.records.filter((record) => variants.has(normalizeText(record.fields.Descripcion)));
    keyValues = { Descripcion: `${alert.source.observed} → ${alert.source.expected}` };
  } else if (HIERARCHY_TARGETS[alert.source.ruleId] && sourceRecord) {
    keyFields = ['Producto_Wm'];
    targetField = HIERARCHY_TARGETS[alert.source.ruleId];
    keyNormalized = [normalizeText(sourceRecord.fields.Producto_Wm)];
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = { Producto_Wm: collaborationValue(sourceRecord.fields.Producto_Wm) };
  } else if (['JER-01'].includes(alert.source.ruleId) && sourceRecord) {
    keyFields = ['Producto_Wm'];
    targetField = 'Producto_Wm';
    keyNormalized = [normalizeText(sourceRecord.fields.Producto_Wm)];
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = { Producto_Wm: collaborationValue(sourceRecord.fields.Producto_Wm) };
  } else if (['R26', 'R27'].includes(alert.source.ruleId) && sourceRecord) {
    keyFields = ['Id_Dn W'];
    targetField = alert.source.ruleId === 'R26' ? 'cantidad_comprada' : 'Precio_Total_Preciador';
    keyNormalized = [normalizeText(sourceRecord.fields['Id_Dn W'])];
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = { 'Id_Dn W': collaborationValue(sourceRecord.fields['Id_Dn W']) };
  } else if (alert.source.ruleId === 'EST-03' && sourceRecord) {
    keyFields = ['Row-Id'];
    targetField = 'Row-Id';
    keyNormalized = [normalizeText(sourceRecord.fields['Row-Id'])];
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = { 'Row-Id': collaborationValue(sourceRecord.fields['Row-Id']) };
  } else if (alert.source.ruleId === 'R15' && sourceRecord) {
    keyFields = dataset.hasBarcode === false ? ['Descripcion'] : ['codiGo_barras'];
    targetField = 'Descripcion';
    keyNormalized = keyFields.map((field) => normalizeText(sourceRecord.fields[field]));
    records = dataset.records.filter((record) => recordMatches(record, keyFields, keyNormalized));
    keyValues = Object.fromEntries(keyFields.map((field) => [field, collaborationValue(sourceRecord.fields[field])]));
  } else {
    keyFields = ['__sourceRow'];
    targetField = dataset.headers.includes(alert.source.field) ? alert.source.field : null;
    keyNormalized = [String(alert.source.sourceRow)];
    records = sourceRecord ? [sourceRecord] : [];
    keyValues = { __sourceRow: alert.source.sourceRow };
  }

  if (keyFields[0] !== '__sourceRow' && keyNormalized.every((value) => !value)) {
    keyFields = ['__sourceRow'];
    targetField = dataset.headers.includes(alert.source.field) ? alert.source.field : targetField;
    keyNormalized = [String(alert.source.sourceRow)];
    records = sourceRecord ? [sourceRecord] : [];
    keyValues = { __sourceRow: alert.source.sourceRow };
  }

  const signature = `${alert.source.ruleId}\u241f${keyNormalized.join('\u241f')}${keyFields[0] === '__sourceRow' ? `\u241f${targetField ?? alert.source.field}` : ''}`;
  const sourceRows = sortedNumbers([
    ...records.map((record) => record.excelRow),
    alert.source.sourceRow,
  ]);
  return {
    id: stableId('group', signature),
    ruleId: alert.source.ruleId,
    key: keyFields.map((field) => `${field}: ${String(keyValues[field] ?? '')}`).join(' · '),
    keyFields,
    keyValues,
    targetField,
    records,
    sourceRows,
  };
}

function alternativeDistribution(records: SourceRecord[], field: string): CollaborationAlternative[] {
  const values = new Map<string, { value: CollaborationValue; rows: number[] }>();
  for (const record of records) {
    const normalized = normalizeText(record.fields[field]);
    if (!normalized) continue;
    const current = values.get(normalized) ?? {
      value: collaborationValue(record.fields[field]),
      rows: [],
    };
    current.rows.push(record.excelRow);
    values.set(normalized, current);
  }
  return [...values.values()]
    .map(({ value, rows }) => ({ value, count: rows.length, sourceRows: sortedNumbers(rows) }))
    .sort((left, right) => right.count - left.count || String(left.value).localeCompare(String(right.value), 'es'));
}

function numericDistribution(values: Array<{ value: number; sourceRow: number }>): CollaborationAlternative[] {
  const groups = new Map<number, number[]>();
  for (const item of values) {
    const rows = groups.get(item.value) ?? [];
    rows.push(item.sourceRow);
    groups.set(item.value, rows);
  }
  return [...groups]
    .map(([value, rows]) => ({ value, count: rows.length, sourceRows: sortedNumbers(rows) }))
    .sort((left, right) => right.count - left.count || Number(left.value) - Number(right.value));
}

function manualSuggestion(
  dataset: SourceDataset,
  descriptor: GroupDescriptor,
  alert: InternalAlert,
  alternatives: CollaborationAlternative[] = [],
  method: CollaborationSuggestionMethod = 'manual-review',
  summary = 'La regla no ofrece una solución automática confiable; requiere revisión humana.',
): CollaborationSuggestion {
  return {
    targetField: descriptor.targetField,
    targetColumnIndex: targetColumnIndex(dataset, descriptor.targetField),
    value: null,
    method,
    confidence: 'none',
    alternatives,
    autoApplicable: false,
    evidence: {
      summary,
      groupSize: descriptor.sourceRows.length,
      sourceRows: descriptor.sourceRows,
    },
  };
}

function splitReferences(value: string): string[] {
  const references = value
    .split(/\s+\|\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const unique = new Map<string, string>();
  for (const reference of references) unique.set(normalizeText(reference), reference);
  return [...unique.values()];
}

function buildSuggestion(
  dataset: SourceDataset,
  alert: InternalAlert,
  descriptor: GroupDescriptor,
  groupAlerts: InternalAlert[],
): CollaborationSuggestion {
  const cardinality = CARDINALITY_DEFINITIONS[alert.source.ruleId];
  if (cardinality) {
    const alternatives = alternativeDistribution(descriptor.records, cardinality.targetField);
    const total = alternatives.reduce((sum, alternative) => sum + alternative.count, 0);
    const first = alternatives[0];
    const second = alternatives[1];
    const strictMajority = first && first.count > total / 2 && (!second || first.count > second.count);
    if (!strictMajority) {
      return manualSuggestion(
        dataset,
        descriptor,
        alert,
        alternatives,
        'strict-majority',
        `No existe una mayoría estricta superior al 50% entre ${total} registros relacionados.`,
      );
    }
    return {
      targetField: cardinality.targetField,
      targetColumnIndex: targetColumnIndex(dataset, cardinality.targetField),
      value: first.value,
      method: 'strict-majority',
      confidence: 'high',
      alternatives,
      autoApplicable: normalizeText(first.value) !== normalizeText(alert.source.observed),
      evidence: {
        summary: `"${String(first.value)}" aparece en ${first.count} de ${total} registros (${((first.count / total) * 100).toFixed(1)}%).`,
        groupSize: descriptor.sourceRows.length,
        sourceRows: descriptor.sourceRows,
      },
    };
  }

  if (HIERARCHY_TARGETS[alert.source.ruleId]) {
    const field = HIERARCHY_TARGETS[alert.source.ruleId];
    return {
      targetField: field,
      targetColumnIndex: targetColumnIndex(dataset, field),
      value: alert.source.expected,
      method: 'hierarchy-reference',
      confidence: 'high',
      alternatives: [{ value: alert.source.expected, count: 1, sourceRows: [alert.source.sourceRow] }],
      autoApplicable: normalizeText(alert.source.expected) !== normalizeText(alert.source.observed),
      evidence: {
        summary: `El catálogo de Jerarquía define "${alert.source.expected}" para ${field}.`,
        groupSize: descriptor.sourceRows.length,
        sourceRows: descriptor.sourceRows,
      },
    };
  }

  if (alert.source.ruleId === 'R25') {
    const prices = descriptor.records
      .map((record) => ({ value: numericValue(record.fields.Precio_Unidad), sourceRow: record.excelRow }))
      .filter((item): item is { value: number; sourceRow: number } => item.value !== null);
    if (prices.length === 0) return manualSuggestion(dataset, descriptor, alert);
    const groupAverage = alert.source.groupAverage
      ?? prices.reduce((sum, item) => sum + item.value, 0) / prices.length;
    const priceThreshold = alert.source.priceThreshold ?? groupAverage * 1.15;
    const normalPrices = prices.filter((item) => item.value <= priceThreshold);
    if (normalPrices.length === 0) {
      return manualSuggestion(dataset, descriptor, alert, [], 'manual-review', 'No hay precios normales para proponer un reemplazo.');
    }
    const alternatives = numericDistribution(normalPrices);
    const first = alternatives[0];
    const second = alternatives[1];
    const uniqueMode = first && (!second || first.count > second.count);
    if (uniqueMode) {
      return {
        targetField: 'Precio_Unidad',
        targetColumnIndex: targetColumnIndex(dataset, 'Precio_Unidad'),
        value: first.value,
        method: 'normal-price-mode',
        confidence: 'high',
        alternatives,
        autoApplicable: numericValue(alert.source.observed) !== Number(first.value),
        evidence: {
          summary: `La moda única de los ${normalPrices.length} precios dentro del umbral promedio + 15 % (${priceThreshold}) es ${first.value}.`,
          groupSize: descriptor.sourceRows.length,
          sourceRows: descriptor.sourceRows,
          statistics: {
            groupAverage,
            priceThreshold,
            priceDifferencePercent: alert.source.priceDifferencePercent,
          },
        },
      };
    }
    const values = normalPrices.map((item) => item.value).sort((left, right) => left - right);
    const middle = Math.floor(values.length / 2);
    const median = values.length % 2 === 0 ? (values[middle - 1] + values[middle]) / 2 : values[middle];
    return {
      targetField: 'Precio_Unidad',
      targetColumnIndex: targetColumnIndex(dataset, 'Precio_Unidad'),
      value: median,
      method: 'normal-price-median',
      confidence: 'medium',
      alternatives,
      autoApplicable: false,
      evidence: {
        summary: `Los precios normales no tienen una moda única; la mediana informativa es ${median}.`,
        groupSize: descriptor.sourceRows.length,
        sourceRows: descriptor.sourceRows,
        statistics: {
          groupAverage,
          priceThreshold,
          priceDifferencePercent: alert.source.priceDifferencePercent,
        },
      },
    };
  }

  if (alert.source.ruleId === 'R28') {
    const record = descriptor.records.find((item) => item.excelRow === alert.source.sourceRow);
    const quantity = numericValue(record?.fields.cantidad_comprada);
    const unitPrice = numericValue(record?.fields.Precio_Unidad);
    if (quantity === null || unitPrice === null) return manualSuggestion(dataset, descriptor, alert);
    const total = Math.round(quantity * unitPrice * 10_000) / 10_000;
    return {
      targetField: 'Precio_Total_Preciador',
      targetColumnIndex: targetColumnIndex(dataset, 'Precio_Total_Preciador'),
      value: total,
      method: 'calculated-total',
      confidence: 'high',
      alternatives: [{ value: total, count: 1, sourceRows: [alert.source.sourceRow] }],
      autoApplicable: numericValue(record?.fields.Precio_Total_Preciador) !== total,
      evidence: {
        summary: `${quantity} × ${unitPrice} = ${total}.`,
        groupSize: 1,
        sourceRows: [alert.source.sourceRow],
      },
    };
  }

  if (alert.source.ruleId === 'R29' || alert.source.ruleId === 'ORT-01') {
    const references = alert.source.ruleId === 'R29'
      ? [...new Set(groupAlerts.flatMap((item) => splitReferences(item.source.expected)).map(normalizeText))]
          .map((normalized) => groupAlerts
            .flatMap((item) => splitReferences(item.source.expected))
            .find((reference) => normalizeText(reference) === normalized)!)
      : splitReferences(alert.source.expected);
    const alternatives: CollaborationAlternative[] = references.map((reference) => ({
      value: reference,
      count: descriptor.records.filter((record) => normalizeText(record.fields.Descripcion) === normalizeText(reference)).length,
      sourceRows: descriptor.records
        .filter((record) => normalizeText(record.fields.Descripcion) === normalizeText(reference))
        .map((record) => record.excelRow),
    }));
    if (alert.source.ruleId === 'ORT-01' && alert.orthography?.confidence === 'none') {
      return manualSuggestion(
        dataset,
        descriptor,
        alert,
        alternatives,
        'orthography-unrecognized-token',
        alert.orthography.detail,
      );
    }
    if (references.length !== 1) {
      return manualSuggestion(
        dataset,
        descriptor,
        alert,
        alternatives,
        'unique-reference',
        'No existe una única descripción de referencia confiable.',
      );
    }
    const reference = references[0];
    const confidence = alert.source.ruleId === 'ORT-01'
      ? alert.orthography?.confidence ?? 'none'
      : 'high';
    const orthographyMethods: Record<OrthographyAlert['method'], CollaborationSuggestionMethod> = {
      'frequent-phrase': 'orthography-frequency',
      'learned-decision': 'orthography-learning',
      spacing: 'orthography-spacing',
      'unrecognized-token': 'orthography-unrecognized-token',
    };
    return {
      targetField: 'Descripcion',
      targetColumnIndex: targetColumnIndex(dataset, 'Descripcion'),
      value: reference,
      method: alert.source.ruleId === 'ORT-01' && alert.orthography
        ? orthographyMethods[alert.orthography.method]
        : 'unique-reference',
      confidence,
      alternatives,
      autoApplicable: confidence === 'high' && reference !== alert.source.observed,
      evidence: {
        summary: alert.source.ruleId === 'ORT-01' && alert.orthography
          ? `${alert.orthography.detail} Confianza ${confidence}; similitud ${alert.orthography.probability}.`
          : `Se encontró una única descripción de referencia: "${reference}".`,
        groupSize: descriptor.sourceRows.length,
        sourceRows: descriptor.sourceRows,
        inputs: alert.source.ruleId === 'ORT-01' && alert.orthography
          ? {
              motivo: alert.orthography.reason,
              metodo: alert.orthography.method,
              palabras_dudosas: alert.orthography.doubtfulTokens.join(', ') || null,
            }
          : undefined,
      },
    };
  }

  if (alert.source.ruleId === 'R30') {
    const record = descriptor.records.find((item) => item.excelRow === alert.source.sourceRow);
    return {
      targetField: 'Descripcion',
      targetColumnIndex: targetColumnIndex(dataset, 'Descripcion'),
      value: null,
      method: 'manual-review',
      confidence: 'none',
      alternatives: [],
      autoApplicable: false,
      evidence: {
        summary: `${alert.source.detail} ${alert.source.expected}`,
        groupSize: 1,
        sourceRows: [alert.source.sourceRow],
        inputs: {
          Producto_Wm: collaborationValue(record?.fields.Producto_Wm),
          Marca_Wm: collaborationValue(record?.fields.Marca_Wm),
          Gramaje: collaborationValue(record?.fields.Gramaje),
          unidad_de_Medida: collaborationValue(record?.fields.unidad_de_Medida),
        },
      },
    };
  }

  return manualSuggestion(dataset, descriptor, alert);
}

function selectedMemberFields(descriptor: GroupDescriptor): string[] {
  return [...new Set([
    'Row-Id',
    'Id_Dn W',
    'codiGo_barras',
    'Descripcion',
    ...descriptor.keyFields.filter((field) => field !== '__sourceRow'),
    ...(descriptor.targetField ? [descriptor.targetField] : []),
  ])];
}

function makeGroupMember(
  sourceRow: number,
  descriptor: GroupDescriptor,
  recordsByRow: Map<number, SourceRecord>,
  taskRows: Set<number>,
): CollaborationGroupMember {
  const record = recordsByRow.get(sourceRow);
  const fields = selectedMemberFields(descriptor);
  return {
    sourceRow,
    rowId: displayValue(record?.fields['Row-Id']),
    surveyId: displayValue(record?.fields['Id_Dn W']),
    barcode: displayValue(record?.fields.codiGo_barras),
    description: displayValue(record?.fields.Descripcion),
    fields: Object.fromEntries(fields.map((field) => [field, collaborationValue(record?.fields[field])])),
    isAlerted: taskRows.has(sourceRow),
  };
}

class UnionFind {
  private readonly parent = new Map<number, number>();

  add(value: number): void {
    if (!this.parent.has(value)) this.parent.set(value, value);
  }

  find(value: number): number {
    const parent = this.parent.get(value);
    if (parent === undefined) {
      this.add(value);
      return value;
    }
    if (parent === value) return value;
    const root = this.find(parent);
    this.parent.set(value, root);
    return root;
  }

  union(first: number, second: number): void {
    const firstRoot = this.find(first);
    const secondRoot = this.find(second);
    if (firstRoot === secondRoot) return;
    this.parent.set(Math.max(firstRoot, secondRoot), Math.min(firstRoot, secondRoot));
  }
}

function buildBlocks(
  tasks: CollaborationTask[],
  groups: CollaborationConflictGroup[],
): CollaborationBlock[] {
  const taskByRow = new Map(tasks.map((task) => [task.sourceRow, task]));
  const unionFind = new UnionFind();
  for (const task of tasks) unionFind.add(task.sourceRow);

  for (const group of groups) {
    const alertedMembers = group.members
      .map((member) => member.sourceRow)
      .filter((sourceRow) => taskByRow.has(sourceRow));
    for (let index = 1; index < alertedMembers.length; index += 1) {
      unionFind.union(alertedMembers[0], alertedMembers[index]);
    }
  }

  const rowsByRoot = new Map<number, number[]>();
  for (const task of tasks) {
    const root = unionFind.find(task.sourceRow);
    const rows = rowsByRoot.get(root) ?? [];
    rows.push(task.sourceRow);
    rowsByRoot.set(root, rows);
  }

  return [...rowsByRoot.values()]
    .map((rows) => {
      const sourceRows = sortedNumbers(rows);
      const blockTasks = sourceRows.map((sourceRow) => taskByRow.get(sourceRow)!);
      const blockGroups = groups.filter((group) => group.members.some((member) => sourceRows.includes(member.sourceRow)));
      const relatedSourceRows = sortedNumbers(blockGroups.flatMap((group) => group.members.map((member) => member.sourceRow)));
      const invoiceUrls = new Set(blockTasks.flatMap((task) => task.invoiceUrls));
      const alertCount = blockTasks.reduce((sum, task) => sum + task.alerts.length, 0);
      return {
        id: stableId('block', sourceRows.join(',')),
        taskIds: blockTasks.map((task) => task.id),
        sourceRows,
        conflictGroupIds: blockGroups.map((group) => group.id).sort(),
        relatedSourceRows,
        taskCount: blockTasks.length,
        alertCount,
        relatedRecordCount: relatedSourceRows.length,
        invoiceCount: invoiceUrls.size,
        weight: Math.max(1, alertCount),
      };
    })
    .sort((left, right) => left.sourceRows[0] - right.sourceRows[0]);
}

export function calculateCollaborationMetrics(
  totalRecords: number,
  tasks: readonly CollaborationTask[],
  progress: Readonly<Record<string, CollaborationTaskProgress>> = {},
): CollaborationMetrics {
  let pendingTasks = 0;
  let resolvedTasks = 0;
  let pendingAlerts = 0;
  let resolvedAlerts = 0;
  let changedCells = 0;
  let confirmedCorrect = 0;

  for (const task of tasks) {
    const taskProgress = progress[task.id];
    const status = taskProgress?.status ?? task.status;
    if (status === 'resolved') {
      resolvedTasks += 1;
      resolvedAlerts += task.alerts.length;
    } else {
      pendingTasks += 1;
      pendingAlerts += task.alerts.length;
    }
    changedCells += Math.max(0, taskProgress?.changedCells ?? 0);
    if (taskProgress?.confirmedCorrect) confirmedCorrect += 1;
  }

  const alertEvents = tasks.reduce((sum, task) => sum + task.alerts.length, 0);
  const reviewTasks = tasks.length;
  return {
    totalRecords,
    recordsWithoutAlerts: Math.max(0, totalRecords - reviewTasks),
    reviewTasks,
    alertEvents,
    orthographyAlerts: tasks.reduce(
      (sum, task) => sum + task.alerts.filter((alert) => alert.ruleId === 'ORT-01').length,
      0,
    ),
    pendingTasks,
    resolvedTasks,
    pendingAlerts,
    resolvedAlerts,
    changedCells,
    confirmedCorrect,
    reviewPercent: totalRecords === 0 ? 0 : (reviewTasks / totalRecords) * 100,
  };
}

export function createCollaborationManifest(
  dataset: SourceDataset,
  result: ValidationResult,
  orthographyAlerts: ReadonlyArray<OrthographyAlert | AlertRecord> = [],
): CollaborationManifest {
  const recordsByRow = new Map(dataset.records.map((record) => [record.excelRow, record]));
  const internalById = new Map<string, InternalAlert>();
  for (const source of result.alerts) {
    const internal = normalizeAlertInput(source, recordsByRow);
    internalById.set(internal.id, internal);
  }
  for (const source of orthographyAlerts) {
    const internal = normalizeAlertInput(source, recordsByRow);
    internalById.set(internal.id, internal);
  }
  const internalAlerts = [...internalById.values()].sort(
    (left, right) => left.source.sourceRow - right.source.sourceRow
      || left.source.ruleId.localeCompare(right.source.ruleId, 'es'),
  );

  const descriptorByAlert = new Map<string, GroupDescriptor>();
  const groupBuilders = new Map<string, GroupBuilder>();
  for (const alert of internalAlerts) {
    const descriptor = groupDescriptor(dataset, alert, recordsByRow);
    descriptorByAlert.set(alert.id, descriptor);
    const builder = groupBuilders.get(descriptor.id) ?? {
      ...descriptor,
      alertIds: new Set<string>(),
      alertSourceRows: new Set<number>(),
    };
    builder.alertIds.add(alert.id);
    builder.alertSourceRows.add(alert.source.sourceRow);
    groupBuilders.set(descriptor.id, builder);
  }

  const internalByGroup = new Map<string, InternalAlert[]>();
  for (const alert of internalAlerts) {
    const descriptor = descriptorByAlert.get(alert.id)!;
    const values = internalByGroup.get(descriptor.id) ?? [];
    values.push(alert);
    internalByGroup.set(descriptor.id, values);
  }

  const collaborationAlerts = internalAlerts.map((alert): CollaborationAlert => {
    const descriptor = descriptorByAlert.get(alert.id)!;
    return {
      id: alert.id,
      ruleId: alert.source.ruleId,
      ruleName: alert.source.ruleName,
      sourceRow: alert.source.sourceRow,
      field: alert.source.field,
      observed: alert.source.observed,
      expected: alert.source.expected,
      detail: alert.source.detail,
      conflictGroupId: descriptor.id,
      suggestion: buildSuggestion(dataset, alert, descriptor, internalByGroup.get(descriptor.id) ?? [alert]),
    };
  });

  const alertsByRow = new Map<number, CollaborationAlert[]>();
  for (const alert of collaborationAlerts) {
    const values = alertsByRow.get(alert.sourceRow) ?? [];
    values.push(alert);
    alertsByRow.set(alert.sourceRow, values);
  }
  const taskRows = new Set(alertsByRow.keys());

  const conflictGroups: CollaborationConflictGroup[] = [...groupBuilders.values()]
    .map((builder) => ({
      id: builder.id,
      ruleId: builder.ruleId,
      key: builder.key,
      keyFields: builder.keyFields,
      keyValues: builder.keyValues,
      targetField: builder.targetField,
      alertIds: [...builder.alertIds].sort(),
      alertSourceRows: sortedNumbers(builder.alertSourceRows),
      members: builder.sourceRows.map((sourceRow) => makeGroupMember(sourceRow, builder, recordsByRow, taskRows)),
    }))
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId, 'es') || left.key.localeCompare(right.key, 'es'));

  const groupsByTaskRow = new Map<number, string[]>();
  for (const group of conflictGroups) {
    for (const member of group.members) {
      if (!taskRows.has(member.sourceRow)) continue;
      const ids = groupsByTaskRow.get(member.sourceRow) ?? [];
      ids.push(group.id);
      groupsByTaskRow.set(member.sourceRow, ids);
    }
  }

  const sourceAlertsById = new Map(internalAlerts.map((alert) => [alert.id, alert.source]));
  const tasks: CollaborationTask[] = [...alertsByRow]
    .sort(([left], [right]) => left - right)
    .map(([sourceRow, alerts]) => {
      const record = recordsByRow.get(sourceRow);
      const sourceAlerts = alerts.map((alert) => sourceAlertsById.get(alert.id)!);
      return {
        id: `task-${sourceRow}`,
        sourceRow,
        rowId: displayValue(record?.fields['Row-Id'] ?? sourceAlerts[0]?.rowId),
        surveyId: displayValue(record?.fields['Id_Dn W'] ?? sourceAlerts[0]?.surveyId),
        barcode: displayValue(record?.fields.codiGo_barras ?? sourceAlerts[0]?.barcode),
        description: displayValue(record?.fields.Descripcion ?? sourceAlerts[0]?.description),
        alerts,
        conflictGroupIds: [...new Set(groupsByTaskRow.get(sourceRow) ?? [])].sort(),
        invoiceUrls: [...new Set(sourceAlerts.flatMap((alert) => alert.invoiceUrls ?? []))],
        status: 'pending',
      };
    });
  const blocks = buildBlocks(tasks, conflictGroups);

  return {
    sourceFile: dataset.sourceFile,
    headers: [...dataset.headers],
    tasks,
    conflictGroups,
    blocks,
    metrics: calculateCollaborationMetrics(dataset.records.length, tasks),
  };
}

export function balanceCollaborationBlocks(
  blocks: readonly CollaborationBlock[],
  validators: ReadonlyArray<string | CollaborationValidator>,
): CollaborationBalance {
  const normalizedValidators = validators.map((validator) => (
    typeof validator === 'string' ? { id: validator, existingLoad: 0 } : validator
  ));
  if (normalizedValidators.length === 0) {
    return {
      assignments: [],
      validatorLoads: [],
      unassignedBlockIds: blocks.map((block) => block.id),
    };
  }

  const loads = normalizedValidators.map((validator, order) => {
    const initialWeight = Number.isFinite(validator.existingLoad)
      ? Math.max(0, validator.existingLoad ?? 0)
      : 0;
    return {
      order,
      validatorId: validator.id,
      initialWeight,
      assignedWeight: 0,
      totalWeight: initialWeight,
      blockCount: 0,
      taskCount: 0,
      alertCount: 0,
    };
  });
  const sortedBlocks = [...blocks].sort(
    (left, right) => right.weight - left.weight
      || right.taskCount - left.taskCount
      || right.relatedRecordCount - left.relatedRecordCount
      || right.invoiceCount - left.invoiceCount
      || left.id.localeCompare(right.id),
  );
  const assignments: CollaborationAssignment[] = [];

  for (const block of sortedBlocks) {
    const target = [...loads].sort(
      (left, right) => left.totalWeight - right.totalWeight
        || left.blockCount - right.blockCount
        || left.order - right.order,
    )[0];
    target.assignedWeight += block.weight;
    target.totalWeight += block.weight;
    target.blockCount += 1;
    target.taskCount += block.taskCount;
    target.alertCount += block.alertCount;
    assignments.push({
      blockId: block.id,
      validatorId: target.validatorId,
      weight: block.weight,
      taskIds: [...block.taskIds],
      sourceRows: [...block.sourceRows],
    });
  }

  return {
    assignments,
    validatorLoads: loads
      .sort((left, right) => left.order - right.order)
      .map(({ order: _order, ...load }) => load),
    unassignedBlockIds: [],
  };
}
