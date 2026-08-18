import type {
  AlertRecord,
  HierarchyCatalog,
  RuleDefinition,
  RuleSummary,
  SourceDataset,
  SourceRecord,
  ValidationResult,
} from './types';

interface CardinalityRule {
  id: string;
  keyFields: string[];
  targetField: string;
}

interface GroupData {
  rows: SourceRecord[];
  targets: Map<string, { displayValue: string; rows: SourceRecord[] }>;
}

const AUTOMATIC_RULES: RuleDefinition[] = [
  ['R01', 'Código → descripción', 'Un código de barras solo puede tener una descripción.'],
  ['R02', 'Código → categoría', 'Un código de barras solo puede tener una categoría.'],
  ['R03', 'Código → producto', 'Un código de barras solo puede tener un producto.'],
  ['R04', 'Código → división', 'Un código de barras solo puede tener una división.'],
  ['R05', 'Código → marca', 'Un código de barras solo puede tener una marca.'],
  ['R06', 'Código → tipo de marca', 'Un código de barras solo puede tener un tipo de marca.'],
  ['R07', 'Código → canasto', 'Un código de barras solo puede tener un canasto.'],
  [
    'R08',
    'Código y descripción → gramaje',
    'La combinación código-descripción solo puede tener un gramaje; se excluyen productos de peso variable en KILOS.',
  ],
  ['R09', 'Código y descripción → unidad', 'La combinación código-descripción solo puede tener una unidad de medida.'],
  ['R10', 'Código y descripción → código estándar', 'La combinación código-descripción solo puede tener un código estándar no vacío.'],
  ['R11', 'Descripción → código', 'Una descripción solo puede tener un código de barras.'],
  ['R12', 'Descripción → producto', 'Una descripción solo puede tener un producto.'],
  ['R13', 'Descripción → categoría', 'Una descripción solo puede tener una categoría.'],
  ['R14', 'Descripción → división', 'Una descripción solo puede tener una división.'],
  ['R15', 'Marca incluida en descripción', 'La marca debe aparecer en la descripción, salvo valores especiales válidos.'],
  ['R16', 'Descripción → tipo de marca', 'Una descripción solo puede tener un tipo de marca.'],
  ['R17', 'Descripción → canasto', 'Una descripción solo puede tener un canasto.'],
  ['R18', 'Producto → categoría', 'Un producto solo puede tener una categoría.'],
  ['R19', 'Producto → división', 'Un producto solo puede tener una división.'],
  ['R20', 'Producto → canasto', 'Un producto solo puede tener un canasto.'],
  ['R21', 'Alineación visual producto-descripción', 'Control visual no automatizado por decisión del equipo.'],
  ['R22', 'Categoría → división', 'Una categoría solo puede tener una división.'],
  ['R23', 'Categoría → canasto', 'Una categoría solo puede tener un canasto.'],
  ['R24', 'Marca → tipo de marca', 'Una marca solo puede tener un tipo de marca.'],
  [
    'R25',
    'Precio atípico por código y descripción',
    'Precio superior a Q3 + 1,5 veces el rango intercuartílico de la misma combinación código-descripción.',
  ],
  ['R26', 'Cantidades por ID', 'La suma de cantidad_comprada debe ser igual al máximo de Cantidad_Productos.'],
  ['R27', 'Montos por ID', 'La suma de Precio_Total_Preciador debe ser igual al máximo de Monto Total Fc.'],
].map(([id, name, description]) => ({
  id,
  name,
  description,
  status: id === 'R21' ? 'Visual no automatizado' : 'Automático',
})) as RuleDefinition[];

const ADDITIONAL_RULES: RuleDefinition[] = [
  {
    id: 'EST-01',
    name: 'Campos críticos vacíos',
    status: 'Adicional',
    description: 'Identificadores y dimensiones necesarias para validar no pueden estar vacíos.',
  },
  {
    id: 'EST-02',
    name: 'Valores numéricos inválidos',
    status: 'Adicional',
    description: 'Los campos numéricos usados por las reglas deben contener números válidos.',
  },
  {
    id: 'EST-03',
    name: 'Row-Id duplicado',
    status: 'Adicional',
    description: 'Row-Id debe identificar una única fila.',
  },
  {
    id: 'JER-01',
    name: 'Producto sin referencia',
    status: 'Adicional',
    description: 'Producto_Wm no existe en el catálogo derivado de Jerarquía.',
  },
  {
    id: 'JER-02',
    name: 'Categoría vs jerarquía',
    status: 'Adicional',
    description: 'Categoria_Wm debe coincidir con la categoría esperada para Producto_Wm.',
  },
  {
    id: 'JER-03',
    name: 'División vs jerarquía',
    status: 'Adicional',
    description: 'Division_Wm debe coincidir con la división esperada para Producto_Wm.',
  },
  {
    id: 'JER-04',
    name: 'Canasto vs jerarquía',
    status: 'Adicional',
    description: 'Canasto Wm debe coincidir con el canasto esperado para Producto_Wm.',
  },
];

export const RULE_DEFINITIONS = [...AUTOMATIC_RULES, ...ADDITIONAL_RULES];
const RULE_BY_ID = new Map(RULE_DEFINITIONS.map((rule) => [rule.id, rule]));

const CARDINALITY_RULES: CardinalityRule[] = [
  { id: 'R01', keyFields: ['codiGo_barras'], targetField: 'Descripcion' },
  { id: 'R02', keyFields: ['codiGo_barras'], targetField: 'Categoria_Wm' },
  { id: 'R03', keyFields: ['codiGo_barras'], targetField: 'Producto_Wm' },
  { id: 'R04', keyFields: ['codiGo_barras'], targetField: 'Division_Wm' },
  { id: 'R05', keyFields: ['codiGo_barras'], targetField: 'Marca_Wm' },
  { id: 'R06', keyFields: ['codiGo_barras'], targetField: 'Tipo_Marca' },
  { id: 'R07', keyFields: ['codiGo_barras'], targetField: 'Canasto Wm' },
  { id: 'R08', keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'Gramaje' },
  { id: 'R09', keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'unidad_de_Medida' },
  { id: 'R10', keyFields: ['codiGo_barras', 'Descripcion'], targetField: 'codiGo_estandar' },
  { id: 'R11', keyFields: ['Descripcion'], targetField: 'codiGo_barras' },
  { id: 'R12', keyFields: ['Descripcion'], targetField: 'Producto_Wm' },
  { id: 'R13', keyFields: ['Descripcion'], targetField: 'Categoria_Wm' },
  { id: 'R14', keyFields: ['Descripcion'], targetField: 'Division_Wm' },
  { id: 'R16', keyFields: ['Descripcion'], targetField: 'Tipo_Marca' },
  { id: 'R17', keyFields: ['Descripcion'], targetField: 'Canasto Wm' },
  { id: 'R18', keyFields: ['Producto_Wm'], targetField: 'Categoria_Wm' },
  { id: 'R19', keyFields: ['Producto_Wm'], targetField: 'Division_Wm' },
  { id: 'R20', keyFields: ['Producto_Wm'], targetField: 'Canasto Wm' },
  { id: 'R22', keyFields: ['Categoria_Wm'], targetField: 'Division_Wm' },
  { id: 'R23', keyFields: ['Categoria_Wm'], targetField: 'Canasto Wm' },
  { id: 'R24', keyFields: ['Marca_Wm'], targetField: 'Tipo_Marca' },
];

const CRITICAL_FIELDS = [
  'Row-Id',
  'Id_Dn W',
  'codiGo_barras',
  'Descripcion',
  'Producto_Wm',
  'Categoria_Wm',
  'Division_Wm',
  'Marca_Wm',
  'Tipo_Marca',
  'Canasto Wm',
];

const NUMERIC_FIELDS = [
  'Cantidad_Productos',
  'cantidad_comprada',
  'Precio_Unidad',
  'Precio_Total_Preciador',
  'Monto Total Fc',
];

const SPECIAL_BRANDS = new Set(['NO IDENTIFICABLE', 'SIN MARCA']);
const VARIABLE_WEIGHT_UNITS = new Set(['KILOS']);
const GROUP_SEPARATOR = '\u241F';

export function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number' && Number.isInteger(value)) return String(value).trim().toUpperCase();
  return String(value).trim().toUpperCase();
}

export function displayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export function numericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim() === '') return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function percentileInclusive(sortedValues: number[], probability: number): number {
  if (sortedValues.length === 0) throw new Error('No se puede calcular un cuartil sin valores.');
  const index = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex) return sortedValues[lowerIndex];
  return (
    sortedValues[lowerIndex] +
    (sortedValues[upperIndex] - sortedValues[lowerIndex]) * (index - lowerIndex)
  );
}

function ruleName(ruleId: string): string {
  return RULE_BY_ID.get(ruleId)?.name ?? ruleId;
}

function baseAlert(record: SourceRecord, ruleId: string): Omit<AlertRecord, 'key' | 'field' | 'observed' | 'expected' | 'detail'> {
  return {
    ruleId,
    ruleName: ruleName(ruleId),
    sourceRow: record.excelRow,
    rowId: displayValue(record.fields['Row-Id']),
    surveyId: displayValue(record.fields['Id_Dn W']),
    barcode: displayValue(record.fields.codiGo_barras),
    description: displayValue(record.fields.Descripcion),
  };
}

export function validateDataset(dataset: SourceDataset, hierarchy: HierarchyCatalog): ValidationResult {
  const alertsByKey = new Map<string, AlertRecord>();
  const affectedRowsByRule = new Map<string, Set<number>>();

  const markAffected = (ruleId: string, records: SourceRecord[]) => {
    const affectedRows = affectedRowsByRule.get(ruleId) ?? new Set<number>();
    for (const record of records) affectedRows.add(record.excelRow);
    affectedRowsByRule.set(ruleId, affectedRows);
  };

  const addAlert = (alert: AlertRecord) => {
    alertsByKey.set(`${alert.ruleId}|${alert.sourceRow}`, alert);
    const affectedRows = affectedRowsByRule.get(alert.ruleId) ?? new Set<number>();
    affectedRows.add(alert.sourceRow);
    affectedRowsByRule.set(alert.ruleId, affectedRows);
  };

  for (const record of dataset.records) {
    const missingFields = CRITICAL_FIELDS.filter((field) => normalizeText(record.fields[field]) === '');
    if (missingFields.length > 0) {
      addAlert({
        ...baseAlert(record, 'EST-01'),
        key: displayValue(record.fields['Row-Id']) || `Fila ${record.excelRow}`,
        field: missingFields.join(', '),
        observed: '(vacío)',
        expected: 'Valor requerido',
        detail: `Campos críticos vacíos: ${missingFields.join(', ')}.`,
      });
    }

    const invalidNumericFields = NUMERIC_FIELDS.filter((field) => numericValue(record.fields[field]) === null);
    if (invalidNumericFields.length > 0) {
      addAlert({
        ...baseAlert(record, 'EST-02'),
        key: displayValue(record.fields['Row-Id']) || `Fila ${record.excelRow}`,
        field: invalidNumericFields.join(', '),
        observed: invalidNumericFields.map((field) => `${field}=${displayValue(record.fields[field]) || '(vacío)'}`).join(' | '),
        expected: 'Valores numéricos válidos',
        detail: `Campos numéricos inválidos: ${invalidNumericFields.join(', ')}.`,
      });
    }
  }

  const rowIdGroups = new Map<string, SourceRecord[]>();
  for (const record of dataset.records) {
    const rowId = normalizeText(record.fields['Row-Id']);
    if (!rowId) continue;
    const group = rowIdGroups.get(rowId) ?? [];
    group.push(record);
    rowIdGroups.set(rowId, group);
  }
  for (const [rowId, rows] of rowIdGroups) {
    if (rows.length <= 1) continue;
    const sourceRows = rows.map((row) => row.excelRow).join(', ');
    for (const record of rows) {
      addAlert({
        ...baseAlert(record, 'EST-03'),
        key: rowId,
        field: 'Row-Id',
        observed: rowId,
        expected: 'Un Row-Id por fila',
        detail: `Row-Id repetido en las filas de Excel: ${sourceRows}.`,
      });
    }
  }

  for (const rule of CARDINALITY_RULES) {
    const groups = new Map<string, GroupData>();
    for (const record of dataset.records) {
      if (rule.id === 'R08' && VARIABLE_WEIGHT_UNITS.has(normalizeText(record.fields.unidad_de_Medida))) {
        continue;
      }

      const normalizedKeys = rule.keyFields.map((field) => normalizeText(record.fields[field]));
      const normalizedTarget = normalizeText(record.fields[rule.targetField]);
      if (normalizedKeys.some((value) => value === '') || normalizedTarget === '') continue;

      const groupKey = normalizedKeys.join(GROUP_SEPARATOR);
      const group = groups.get(groupKey) ?? {
        rows: [],
        targets: new Map<string, { displayValue: string; rows: SourceRecord[] }>(),
      };
      group.rows.push(record);
      const target = group.targets.get(normalizedTarget) ?? {
        displayValue: displayValue(record.fields[rule.targetField]),
        rows: [],
      };
      target.rows.push(record);
      group.targets.set(normalizedTarget, target);
      groups.set(groupKey, group);
    }

    for (const group of groups.values()) {
      if (group.targets.size <= 1) continue;
      markAffected(rule.id, group.rows);

      const targetsByFrequency = [...group.targets.values()].sort(
        (a, b) => b.rows.length - a.rows.length || a.displayValue.localeCompare(b.displayValue, 'es'),
      );
      const highestFrequency = targetsByFrequency[0].rows.length;
      const mostFrequentTargets = targetsByFrequency.filter((target) => target.rows.length === highestFrequency);
      const hasUniqueMajority = mostFrequentTargets.length === 1;
      const majorityTarget = hasUniqueMajority ? mostFrequentTargets[0] : null;
      const rowsToAlert = majorityTarget
        ? targetsByFrequency.filter((target) => target !== majorityTarget).flatMap((target) => target.rows)
        : group.rows;
      const conflictingValues = targetsByFrequency.map((target) => target.displayValue).join(' | ');

      for (const record of rowsToAlert) {
        const key = rule.keyFields
          .map((field) => `${field}: ${displayValue(record.fields[field])}`)
          .join(' · ');
        const majorityDetail = majorityTarget
          ? `El valor mayoritario es "${majorityTarget.displayValue}" (${majorityTarget.rows.length} de ${group.rows.length}); revisar "${displayValue(record.fields[rule.targetField])}".`
          : `No existe un valor mayoritario único entre: ${conflictingValues}.`;
        addAlert({
          ...baseAlert(record, rule.id),
          key,
          field: rule.targetField,
          observed: displayValue(record.fields[rule.targetField]),
          expected: majorityTarget?.displayValue ?? `Sin mayoría: ${conflictingValues}`,
          detail: `${key} afecta ${group.rows.length} registros y tiene ${group.targets.size} valores distintos en ${rule.targetField}. ${majorityDetail}`,
        });
      }
    }
  }

  for (const record of dataset.records) {
    const brand = normalizeText(record.fields.Marca_Wm);
    const description = normalizeText(record.fields.Descripcion);
    if (!brand || !description || SPECIAL_BRANDS.has(brand) || description.includes(brand)) continue;
    addAlert({
      ...baseAlert(record, 'R15'),
      key: displayValue(record.fields.codiGo_barras),
      field: 'Descripcion',
      observed: displayValue(record.fields.Descripcion),
      expected: `La descripción debe incluir la marca ${displayValue(record.fields.Marca_Wm)}`,
      detail: `La marca "${displayValue(record.fields.Marca_Wm)}" no aparece en la descripción.`,
    });
  }

  const priceGroups = new Map<string, Array<{ record: SourceRecord; price: number }>>();
  for (const record of dataset.records) {
    const barcode = normalizeText(record.fields.codiGo_barras);
    const description = normalizeText(record.fields.Descripcion);
    const price = numericValue(record.fields.Precio_Unidad);
    if (!barcode || !description || price === null) continue;

    const groupKey = [barcode, description].join(GROUP_SEPARATOR);
    const group = priceGroups.get(groupKey) ?? [];
    group.push({ record, price });
    priceGroups.set(groupKey, group);
  }
  for (const group of priceGroups.values()) {
    const sortedPrices = group.map((item) => item.price).sort((a, b) => a - b);
    const firstQuartile = percentileInclusive(sortedPrices, 0.25);
    const thirdQuartile = percentileInclusive(sortedPrices, 0.75);
    const interquartileRange = thirdQuartile - firstQuartile;
    const upperLimit = thirdQuartile + 1.5 * interquartileRange;
    for (const { record, price } of group) {
      if (price <= upperLimit) continue;
      addAlert({
        ...baseAlert(record, 'R25'),
        key: `codiGo_barras: ${displayValue(record.fields.codiGo_barras)} · Descripcion: ${displayValue(
          record.fields.Descripcion,
        )}`,
        field: 'Precio_Unidad',
        observed: displayValue(record.fields.Precio_Unidad),
        expected: `Límite superior por cuartiles: ${upperLimit.toFixed(4)}`,
        detail: `Para el mismo código y descripción, precio ${price} > Q3 ${thirdQuartile.toFixed(
          4,
        )} + 1,5 × RIC ${interquartileRange.toFixed(4)} = ${upperLimit.toFixed(4)}.`,
        firstQuartile,
        thirdQuartile,
        interquartileRange,
        upperLimit,
      });
    }
  }

  const surveyGroups = new Map<string, SourceRecord[]>();
  for (const record of dataset.records) {
    const surveyId = normalizeText(record.fields['Id_Dn W']);
    if (!surveyId) continue;
    const group = surveyGroups.get(surveyId) ?? [];
    group.push(record);
    surveyGroups.set(surveyId, group);
  }

  const validateAggregate = (
    ruleId: 'R26' | 'R27',
    sumField: string,
    maxField: string,
    tolerance: number,
  ) => {
    for (const [surveyId, rows] of surveyGroups) {
      const sumValues = rows.map((row) => numericValue(row.fields[sumField]));
      const maxValues = rows.map((row) => numericValue(row.fields[maxField]));
      if (sumValues.some((value) => value === null) || maxValues.some((value) => value === null)) continue;
      const sum = (sumValues as number[]).reduce((total, value) => total + value, 0);
      const maximum = Math.max(...(maxValues as number[]));
      if (Math.abs(sum - maximum) <= tolerance) continue;

      for (const record of rows) {
        addAlert({
          ...baseAlert(record, ruleId),
          key: surveyId,
          field: `${sumField} / ${maxField}`,
          observed: `Suma ${sumField}: ${sum}`,
          expected: `Máximo ${maxField}: ${maximum}`,
          detail: `Para Id_Dn W ${surveyId}, la suma es ${sum} y el máximo esperado es ${maximum}.`,
        });
      }
    }
  };

  validateAggregate('R26', 'cantidad_comprada', 'Cantidad_Productos', 1e-9);
  validateAggregate('R27', 'Precio_Total_Preciador', 'Monto Total Fc', 0.01);

  for (const record of dataset.records) {
    const product = normalizeText(record.fields.Producto_Wm);
    if (!product) continue;
    const expected = hierarchy.entries[product];
    if (!expected) {
      addAlert({
        ...baseAlert(record, 'JER-01'),
        key: displayValue(record.fields.Producto_Wm),
        field: 'Producto_Wm',
        observed: displayValue(record.fields.Producto_Wm),
        expected: 'Producto presente en Jerarquía',
        detail: `El producto "${displayValue(record.fields.Producto_Wm)}" no existe en el catálogo de Jerarquía.`,
      });
      continue;
    }

    const hierarchyChecks = [
      ['JER-02', 'Categoria_Wm', expected.categoria],
      ['JER-03', 'Division_Wm', expected.division],
      ['JER-04', 'Canasto Wm', expected.canasto],
    ] as const;
    for (const [ruleId, field, expectedValue] of hierarchyChecks) {
      if (normalizeText(record.fields[field]) === normalizeText(expectedValue)) continue;
      addAlert({
        ...baseAlert(record, ruleId),
        key: displayValue(record.fields.Producto_Wm),
        field,
        observed: displayValue(record.fields[field]),
        expected: expectedValue,
        detail: `Para ${displayValue(record.fields.Producto_Wm)}, ${field} es "${displayValue(record.fields[field])}" y la jerarquía indica "${expectedValue}".`,
      });
    }
  }

  const alerts = [...alertsByKey.values()].sort(
    (a, b) => a.sourceRow - b.sourceRow || a.ruleId.localeCompare(b.ruleId, 'es'),
  );
  const alertsPerRow = new Map<number, AlertRecord[]>();
  for (const alert of alerts) {
    const rowAlerts = alertsPerRow.get(alert.sourceRow) ?? [];
    rowAlerts.push(alert);
    alertsPerRow.set(alert.sourceRow, rowAlerts);
  }

  const reviewedRecords = dataset.records
    .filter((record) => alertsPerRow.has(record.excelRow))
    .map((record) => ({ record, alerts: alertsPerRow.get(record.excelRow) ?? [] }));

  const ruleSummaries: RuleSummary[] = RULE_DEFINITIONS.map((rule) => ({
    ...rule,
    affectedRows: affectedRowsByRule.get(rule.id)?.size ?? 0,
    alertCount: alerts.filter((alert) => alert.ruleId === rule.id).length,
  }));

  const reviewRecords = reviewedRecords.length;
  const totalRecords = dataset.records.length;
  return {
    metrics: {
      totalRecords,
      reviewRecords,
      okRecords: totalRecords - reviewRecords,
      reviewPercent: totalRecords === 0 ? 0 : (reviewRecords / totalRecords) * 100,
      totalAlerts: alerts.length,
    },
    alerts,
    ruleSummaries,
    reviewedRecords,
  };
}
