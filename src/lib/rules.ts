import type {
  AlertRecord,
  HierarchyCatalog,
  InvoiceCatalog,
  RuleDefinition,
  RuleSummary,
  SourceDataset,
  SourceRecord,
  ValidationResult,
} from './types';
import {
  assessDescriptionQuality,
  buildProductDescriptionEvidence,
  descriptionContainsExactBrand,
} from './descriptionQuality';
import { classifyDescriptionGramaje } from './descriptionGramaje';
import { isUnidentifiedBarcode } from './barcode';

interface CardinalityRule {
  id: string;
  keyFields: string[];
  targetField: string;
}

interface GroupData {
  rows: SourceRecord[];
  targets: Map<string, { displayValue: string; rows: SourceRecord[] }>;
}

const BARCODE_BASED_RULE_IDS = new Set([
  'R01', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R10', 'R11', 'R25', 'R29',
]);
const UNIDENTIFIED_BARCODE_NOTE = ' Los registros con codiGo_barras igual a NO IDENTIFICABLE se excluyen de esta revisión.';

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
    'Precio superior en más de 15% al promedio de la misma combinación código-descripción.',
  ],
  ['R26', 'Cantidades por ID', 'La suma de cantidad_comprada debe ser igual al máximo de Cantidad_Productos.'],
  ['R27', 'Montos por ID', 'La suma de Precio_Total_Preciador debe ser igual al máximo de Monto Total Fc.'],
  [
    'R28',
    'Cantidad comprada vs precio total',
    'Si cantidad_comprada es mayor que 1, Precio_Total_Preciador no puede ser igual a Precio_Unidad.',
  ],
  [
    'R29',
    'Gramaje sospechoso en descripción',
    'Compara las descripciones de un mismo código y alerta unidades finales incompletas o cantidades de gramaje distintas; no modifica los registros.',
  ],
  [
    'R30',
    'Calidad de descripción',
    'La descripción debe comenzar con un producto compatible con Producto_Wm, incluir después la marca exacta de Marca_Wm —salvo NO IDENTIFICABLE o SIN MARCA— y ubicar luego el gramaje correspondiente.',
  ],
].map(([id, name, description]) => ({
  id,
  name,
  description: `${description}${BARCODE_BASED_RULE_IDS.has(id) ? UNIDENTIFIED_BARCODE_NOTE : ''}`,
  status: id === 'R21' ? 'Visual no automatizado' : 'Automático',
})) as RuleDefinition[];

const ADDITIONAL_RULES: RuleDefinition[] = [
  {
    id: 'EST-01',
    name: 'Campos críticos vacíos',
    status: 'Adicional',
    description:
      'Revisar campos críticos vacíos: Row-Id, Id_Dn W, codiGo_barras, Descripcion, Producto_Wm, Categoria_Wm, Division_Wm, Marca_Wm, Tipo_Marca o Canasto Wm.',
  },
  {
    id: 'EST-02',
    name: 'Valores numéricos inválidos',
    status: 'Adicional',
    description:
      'Estas columnas deben contener números válidos y no estar vacías: Cantidad_Productos, cantidad_comprada, Precio_Unidad, Precio_Total_Preciador y Monto Total Fc.',
  },
  {
    id: 'EST-03',
    name: 'Row-Id duplicado',
    status: 'Adicional',
    description:
      'El mismo Row-Id aparece en más de una fila; revisar si el registro está duplicado o si el identificador fue reutilizado.',
  },
  {
    id: 'JER-01',
    name: 'Producto sin referencia',
    status: 'Adicional',
    description:
      'Producto_Wm no aparece en la columna Producto del catálogo de Jerarquía; revisar si es un producto nuevo o si debe corregirse.',
  },
  {
    id: 'JER-02',
    name: 'Categoría vs jerarquía',
    status: 'Adicional',
    description:
      'Categoria_Wm no coincide con Categoria WM_Panel, la categoría esperada para ese Producto_Wm en Jerarquía.',
  },
  {
    id: 'JER-03',
    name: 'División vs jerarquía',
    status: 'Adicional',
    description:
      'Division_Wm no coincide con División_wm_Panel, la división esperada para ese Producto_Wm en Jerarquía.',
  },
  {
    id: 'JER-04',
    name: 'Canasto vs jerarquía',
    status: 'Adicional',
    description: 'Canasto Wm no coincide con Canasto, el valor esperado para ese Producto_Wm en Jerarquía.',
  },
];

export const RULE_DEFINITIONS = [...AUTOMATIC_RULES, ...ADDITIONAL_RULES];
const RULE_BY_ID = new Map(RULE_DEFINITIONS.map((rule) => [rule.id, rule]));
const RULE_ORDER = new Map(RULE_DEFINITIONS.map((rule, index) => [rule.id, index]));

export function compareRuleIds(left: string, right: string): number {
  const leftOrder = RULE_ORDER.get(left) ?? (left === 'ORT-01' ? RULE_DEFINITIONS.length : Number.MAX_SAFE_INTEGER);
  const rightOrder = RULE_ORDER.get(right) ?? (right === 'ORT-01' ? RULE_DEFINITIONS.length : Number.MAX_SAFE_INTEGER);
  return leftOrder - rightOrder || left.localeCompare(right, 'es', { numeric: true });
}

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
const DESCRIPTION_ONLY_CARDINALITY_RULES = new Set(['R08', 'R09', 'R10']);
const NO_BARCODE_RULE_OVERRIDES: Partial<Record<string, Partial<RuleDefinition>>> = {
  R08: {
    name: 'Descripción → gramaje',
    description: 'Una descripción solo puede tener un gramaje; se excluyen productos de peso variable en KILOS.',
  },
  R09: {
    name: 'Descripción → unidad',
    description: 'Una descripción solo puede tener una unidad de medida.',
  },
  R10: {
    name: 'Descripción → código estándar',
    description: 'Una descripción solo puede tener un código estándar no vacío.',
  },
  R25: {
    name: 'Precio atípico por descripción',
    description: 'Precio superior en más de 15% al promedio de los registros con la misma descripción.',
  },
  'EST-01': {
    status: 'Omitido por modalidad',
    description: 'Este estudio fue declarado sin código de barras, por lo que EST-01 no se ejecuta.',
  },
};

export function getRuleDefinitions(hasBarcode = true): RuleDefinition[] {
  return hasBarcode
    ? RULE_DEFINITIONS
    : RULE_DEFINITIONS.map((rule) => ({ ...rule, ...NO_BARCODE_RULE_OVERRIDES[rule.id] }));
}

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

export function validateDataset(
  dataset: SourceDataset,
  hierarchy: HierarchyCatalog,
  invoices?: InvoiceCatalog,
  options: { hasBarcode?: boolean } = {},
): ValidationResult {
  const hasBarcode = options.hasBarcode ?? dataset.hasBarcode ?? true;
  const activeRuleDefinitions = getRuleDefinitions(hasBarcode);
  const activeRuleById = new Map(activeRuleDefinitions.map((rule) => [rule.id, rule]));
  const alertsByKey = new Map<string, AlertRecord>();
  const affectedRowsByRule = new Map<string, Set<number>>();

  const markAffected = (ruleId: string, records: SourceRecord[]) => {
    const affectedRows = affectedRowsByRule.get(ruleId) ?? new Set<number>();
    for (const record of records) affectedRows.add(record.excelRow);
    affectedRowsByRule.set(ruleId, affectedRows);
  };

  const addAlert = (alert: AlertRecord) => {
    alertsByKey.set(`${alert.ruleId}|${alert.sourceRow}|${alert.field}`, alert);
    const affectedRows = affectedRowsByRule.get(alert.ruleId) ?? new Set<number>();
    affectedRows.add(alert.sourceRow);
    affectedRowsByRule.set(alert.ruleId, affectedRows);
  };

  for (const record of dataset.records) {
    const missingFields = hasBarcode
      ? CRITICAL_FIELDS.filter((field) => normalizeText(record.fields[field]) === '')
      : [];
    for (const field of missingFields) {
      addAlert({
        ...baseAlert(record, 'EST-01'),
        key: displayValue(record.fields['Row-Id']) || `Fila ${record.excelRow}`,
        field,
        observed: '(vacío)',
        expected: 'Valor requerido',
        detail: `La columna crítica ${field} está vacía; el validador necesita revisar esta celda.`,
      });
    }

    const invalidNumericFields = NUMERIC_FIELDS.filter((field) => numericValue(record.fields[field]) === null);
    for (const field of invalidNumericFields) {
      addAlert({
        ...baseAlert(record, 'EST-02'),
        key: displayValue(record.fields['Row-Id']) || `Fila ${record.excelRow}`,
        field,
        observed: displayValue(record.fields[field]) || '(vacío)',
        expected: 'Valor numérico válido',
        detail: `La columna ${field} debe contener un número válido; revise el valor de esta celda.`,
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
    const keyFields = !hasBarcode && DESCRIPTION_ONLY_CARDINALITY_RULES.has(rule.id)
      ? ['Descripcion']
      : rule.keyFields;
    const groups = new Map<string, GroupData>();
    for (const record of dataset.records) {
      const evaluatesBarcode = BARCODE_BASED_RULE_IDS.has(rule.id)
        && !(!hasBarcode && DESCRIPTION_ONLY_CARDINALITY_RULES.has(rule.id));
      if (evaluatesBarcode && isUnidentifiedBarcode(record.fields.codiGo_barras)) continue;
      if (rule.id === 'R08' && VARIABLE_WEIGHT_UNITS.has(normalizeText(record.fields.unidad_de_Medida))) {
        continue;
      }

      const normalizedKeys = keyFields.map((field) => normalizeText(record.fields[field]));
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
        const key = keyFields
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
    if (!brand || !description || SPECIAL_BRANDS.has(brand) || descriptionContainsExactBrand(description, brand)) continue;
    addAlert({
      ...baseAlert(record, 'R15'),
      key: displayValue(record.fields.codiGo_barras),
      field: 'Descripcion',
      observed: displayValue(record.fields.Descripcion),
      expected: `La descripción debe incluir la marca ${displayValue(record.fields.Marca_Wm)}`,
      detail: `La marca "${displayValue(record.fields.Marca_Wm)}" no aparece en la descripción.`,
    });
  }

  const productEvidenceByRow = buildProductDescriptionEvidence(dataset.records.map((record) => ({
    sourceRow: record.excelRow,
    description: record.fields.Descripcion,
    product: record.fields.Producto_Wm,
  })));

  for (const record of dataset.records) {
    const quality = assessDescriptionQuality({
      description: record.fields.Descripcion,
      product: record.fields.Producto_Wm,
      brand: record.fields.Marca_Wm,
      gramaje: record.fields.Gramaje,
      unit: record.fields.unidad_de_Medida,
      productEvidence: productEvidenceByRow.get(record.excelRow),
    });
    if (!quality) continue;
    const nonBrandIssues = quality.issues.filter((issue) => issue.code !== 'BRAND_MISSING');
    // R15 ya representa una marca ausente. Evitar un segundo evento cuando
    // ese es el único defecto reduce trabajo duplicado para el validador.
    if (nonBrandIssues.length === 0) continue;

    addAlert({
      ...baseAlert(record, 'R30'),
      key: displayValue(record.fields.codiGo_barras)
        || displayValue(record.fields['Row-Id'])
        || `Fila ${record.excelRow}`,
      field: 'Descripcion',
      observed: displayValue(record.fields.Descripcion),
      expected: quality.expectedPattern,
      detail: `${quality.issues.map((issue) => issue.message).join(' ')} Estructura esperada: producto → marca → gramaje.`,
    });
  }

  const descriptionGroups = new Map<
    string,
    Map<string, { displayValue: string; rows: SourceRecord[] }>
  >();
  for (const record of dataset.records) {
    const barcode = normalizeText(record.fields.codiGo_barras);
    const description = normalizeText(record.fields.Descripcion);
    if (!barcode || isUnidentifiedBarcode(record.fields.codiGo_barras) || !description) continue;

    const variants = descriptionGroups.get(barcode) ?? new Map();
    const variant = variants.get(description) ?? {
      displayValue: displayValue(record.fields.Descripcion),
      rows: [],
    };
    variant.rows.push(record);
    variants.set(description, variant);
    descriptionGroups.set(barcode, variants);
  }

  for (const [barcode, variantsMap] of descriptionGroups) {
    if (variantsMap.size <= 1) continue;

    const variants = [...variantsMap.entries()].sort(
      ([, first], [, second]) => second.rows.length - first.rows.length || first.displayValue.localeCompare(second.displayValue, 'es'),
    );
    const highestFrequency = variants[0][1].rows.length;
    const majorityVariants = variants.filter(([, variant]) => variant.rows.length === highestFrequency);
    const majority = majorityVariants.length === 1 ? majorityVariants[0] : null;
    const issuesByVariant = new Map<string, Array<{ reason: string; reference: string }>>();

    const addVariantIssue = (normalizedDescription: string, reason: string, reference: string) => {
      const issues = issuesByVariant.get(normalizedDescription) ?? [];
      if (!issues.some((issue) => issue.reason === reason && issue.reference === reference)) {
        issues.push({ reason, reference });
      }
      issuesByVariant.set(normalizedDescription, issues);
    };

    if (majority) {
      const [majorityKey, majorityVariant] = majority;
      for (const [candidateKey, candidateVariant] of variants) {
        if (candidateKey === majorityKey) continue;
        const issue = classifyDescriptionGramaje(candidateVariant.displayValue, majorityVariant.displayValue);
        if (!issue) continue;
        const suspiciousKey = normalizeText(issue.suspiciousDescription);
        addVariantIssue(suspiciousKey, issue.reason, issue.referenceDescription);
      }
    } else {
      for (let firstIndex = 0; firstIndex < variants.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < variants.length; secondIndex += 1) {
          const [firstKey, firstVariant] = variants[firstIndex];
          const [secondKey, secondVariant] = variants[secondIndex];
          const issue = classifyDescriptionGramaje(firstVariant.displayValue, secondVariant.displayValue);
          if (!issue) continue;

          if (issue.reason === 'Unidad final incompleta') {
            addVariantIssue(
              normalizeText(issue.suspiciousDescription),
              issue.reason,
              issue.referenceDescription,
            );
          } else {
            addVariantIssue(firstKey, issue.reason, secondVariant.displayValue);
            addVariantIssue(secondKey, issue.reason, firstVariant.displayValue);
          }
        }
      }
    }

    if (issuesByVariant.size === 0) continue;
    markAffected('R29', variants.flatMap(([, variant]) => variant.rows));

    for (const [variantKey, issues] of issuesByVariant) {
      const variant = variantsMap.get(variantKey);
      if (!variant) continue;
      const reasons = [...new Set(issues.map((issue) => issue.reason))].join(' y ');
      const references = [...new Set(issues.map((issue) => issue.reference))].join(' | ');
      const majorityDetail = majority
        ? `La descripción de referencia es "${references}".`
        : `No existe una descripción mayoritaria única; comparar con "${references}".`;

      for (const record of variant.rows) {
        addAlert({
          ...baseAlert(record, 'R29'),
          key: `codiGo_barras: ${displayValue(record.fields.codiGo_barras)}`,
          field: 'Descripcion',
          observed: displayValue(record.fields.Descripcion),
          expected: references,
          detail: `Posible ${reasons.toLocaleLowerCase('es')} en la descripción para el código ${barcode}. ${majorityDetail} El registro solo se alerta; no se modifica.`,
        });
      }
    }
  }

  const priceGroups = new Map<string, Array<{ record: SourceRecord; price: number }>>();
  for (const record of dataset.records) {
    const barcode = normalizeText(record.fields.codiGo_barras);
    const description = normalizeText(record.fields.Descripcion);
    const price = numericValue(record.fields.Precio_Unidad);
    if (
      !description
      || price === null
      || (hasBarcode && (!barcode || isUnidentifiedBarcode(record.fields.codiGo_barras)))
    ) continue;

    const groupKey = hasBarcode ? [barcode, description].join(GROUP_SEPARATOR) : description;
    const group = priceGroups.get(groupKey) ?? [];
    group.push({ record, price });
    priceGroups.set(groupKey, group);
  }
  for (const group of priceGroups.values()) {
    const groupAverage = group.reduce((total, item) => total + item.price, 0) / group.length;
    if (groupAverage <= 0) continue;
    const priceThreshold = groupAverage * 1.15;
    for (const { record, price } of group) {
      if (price <= priceThreshold) continue;
      const priceDifferencePercent = (price - groupAverage) / groupAverage;
      const key = hasBarcode
        ? `codiGo_barras: ${displayValue(record.fields.codiGo_barras)} · Descripcion: ${displayValue(
            record.fields.Descripcion,
          )}`
        : `Descripcion: ${displayValue(record.fields.Descripcion)}`;
      const groupLabel = hasBarcode ? 'el mismo código y descripción' : 'la misma descripción';
      addAlert({
        ...baseAlert(record, 'R25'),
        key,
        field: 'Precio_Unidad',
        observed: displayValue(record.fields.Precio_Unidad),
        expected: `Promedio + 15%: ${priceThreshold.toFixed(4)}`,
        detail: `Para ${groupLabel}, el precio ${price} está ${(
          priceDifferencePercent * 100
        ).toFixed(2)}% por encima del promedio ${groupAverage.toFixed(4)} y supera el umbral de 15% (${priceThreshold.toFixed(4)}).`,
        groupAverage,
        priceThreshold,
        priceDifferencePercent,
      });
    }
  }

  for (const record of dataset.records) {
    const quantity = numericValue(record.fields.cantidad_comprada);
    const unitPrice = numericValue(record.fields.Precio_Unidad);
    const totalPrice = numericValue(record.fields.Precio_Total_Preciador);
    if (
      quantity === null ||
      unitPrice === null ||
      totalPrice === null ||
      quantity <= 1 ||
      Math.abs(totalPrice - unitPrice) > 0.01
    ) {
      continue;
    }

    addAlert({
      ...baseAlert(record, 'R28'),
      key: displayValue(record.fields['Row-Id']) || `Fila ${record.excelRow}`,
      field: 'cantidad_comprada / Precio_Unidad / Precio_Total_Preciador',
      observed: `Cantidad: ${displayValue(record.fields.cantidad_comprada)} | Precio unitario: ${displayValue(
        record.fields.Precio_Unidad,
      )} | Precio total: ${displayValue(record.fields.Precio_Total_Preciador)}`,
      expected: 'Con cantidad mayor que 1, el precio total debe ser distinto del precio unitario',
      detail: `Se compraron ${quantity} unidades, pero Precio_Total_Preciador (${totalPrice}) es igual a Precio_Unidad (${unitPrice}).`,
    });
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
          // La evidencia compara el agregado completo, pero la edición manual
          // debe apuntar a una celda real de esta fila.
          field: sumField,
          observed: displayValue(record.fields[sumField]),
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

  const alerts = [...alertsByKey.values()]
    .map((alert) => ({
      ...alert,
      ruleName: activeRuleById.get(alert.ruleId)?.name ?? alert.ruleName,
      invoiceUrls: invoices?.urlsByRef[normalizeText(alert.surveyId)] ?? [],
    }))
    .sort((a, b) => a.sourceRow - b.sourceRow || a.ruleId.localeCompare(b.ruleId, 'es'));
  const alertsPerRow = new Map<number, AlertRecord[]>();
  for (const alert of alerts) {
    const rowAlerts = alertsPerRow.get(alert.sourceRow) ?? [];
    rowAlerts.push(alert);
    alertsPerRow.set(alert.sourceRow, rowAlerts);
  }

  const reviewedRecords = dataset.records
    .filter((record) => alertsPerRow.has(record.excelRow))
    .map((record) => ({ record, alerts: alertsPerRow.get(record.excelRow) ?? [] }));

  const ruleSummaries: RuleSummary[] = activeRuleDefinitions.map((rule) => ({
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
