const SPECIAL_BRANDS = new Set(['NO IDENTIFICABLE', 'SIN MARCA']);

const PRODUCT_STOP_WORDS = new Set([
  'A', 'AL', 'CON', 'DE', 'DEL', 'EL', 'EN', 'LA', 'LAS', 'LOS', 'PARA', 'POR', 'SIN', 'Y',
]);

const MEASURE_PATTERN = /(\d+(?:[.,]\d+)?)\s*(KILOGRAMOS?|KILOS?|KGS?|KG|GRAMOS?|GRS?|GR|G|MILILITROS?|MLS?|ML|LITROS?|LTS?|LT|L|UNIDAD(?:ES)?|UNIDS?|UNDS?|UND|UN|PIEZAS?|PZAS?|PZS?|PZ|PCS?|PACKS?|PACK|PK|PAR(?:ES)?|HOJAS?|ROLLOS?|U|P)\b/giu;

type MeasureFamily = 'mass' | 'volume' | 'count';

export type DescriptionQualityIssueCode =
  | 'PRODUCT_MISMATCH'
  | 'PRODUCT_AFTER_BRAND'
  | 'BRAND_MISSING'
  | 'GRAMMAGE_MISSING'
  | 'GRAMMAGE_MISMATCH'
  | 'GRAMMAGE_BEFORE_BRAND';

export interface DescriptionQualityIssue {
  code: DescriptionQualityIssueCode;
  message: string;
}

export interface DescriptionQualityInput {
  description: unknown;
  product: unknown;
  brand: unknown;
  gramaje: unknown;
  unit: unknown;
  productEvidence?: ProductDescriptionEvidence | null;
}

export interface DescriptionQualityResult {
  issues: DescriptionQualityIssue[];
  expectedPattern: string;
}

export interface ProductDescriptionEvidence {
  prefix: string;
  suggestedProduct: string;
  support: number;
  total: number;
  share: number;
}

export interface ProductDescriptionRecord {
  sourceRow: number;
  description: unknown;
  product: unknown;
}

interface TextToken {
  value: string;
  start: number;
  end: number;
}

interface MeasureCandidate {
  start: number;
  end: number;
  text: string;
  family: MeasureFamily;
  baseValue: number;
}

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .toLocaleUpperCase('es')
    .replaceAll('Ñ', 'N')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function textTokens(value: string): TextToken[] {
  return [...value.matchAll(/[A-Z0-9]+/gu)].map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
}

function tokenVariants(token: string): Set<string> {
  const variants = new Set([token]);
  if (token.length > 4 && token.endsWith('S')) variants.add(token.slice(0, -1));
  if (token.length > 5 && token.endsWith('ES')) variants.add(token.slice(0, -2));
  return variants;
}

function canonicalToken(token: string): string {
  if (token.length > 5 && /(?:ALES|ELES|ILES|OLES|ULES)$/u.test(token)) return token.slice(0, -2);
  if (token.length > 4 && token.endsWith('S')) return token.slice(0, -1);
  return token;
}

function tokensMatch(first: string, second: string): boolean {
  const firstVariants = tokenVariants(first);
  return [...tokenVariants(second)].some((variant) => firstVariants.has(variant));
}

function significantProductTokens(product: string): string[] {
  return textTokens(product)
    .map((token) => token.value)
    .filter((token) => token.length >= 3 && !PRODUCT_STOP_WORDS.has(token));
}

function findTokenSequence(haystack: TextToken[], needle: TextToken[]): { start: number; end: number } | null {
  if (needle.length === 0 || haystack.length < needle.length) return null;
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (!needle.every((token, index) => haystack[start + index].value === token.value)) continue;
    return {
      start: haystack[start].start,
      end: haystack[start + needle.length - 1].end,
    };
  }
  return null;
}

export function descriptionContainsExactBrand(descriptionValue: unknown, brandValue: unknown): boolean {
  const description = normalizedText(descriptionValue);
  const brand = normalizedText(brandValue);
  if (!description || !brand) return false;
  if (SPECIAL_BRANDS.has(brand)) return true;
  return findTokenSequence(textTokens(description), textTokens(brand)) !== null;
}

function measureUnit(unit: string): { family: MeasureFamily; factor: number } | null {
  if (/^(?:KILOGRAMOS?|KILOS?|KGS?|KG)$/u.test(unit)) return { family: 'mass', factor: 1 };
  if (/^(?:GRAMOS?|GRS?|GR|G)$/u.test(unit)) return { family: 'mass', factor: 0.001 };
  if (/^(?:LITROS?|LTS?|LT|L)$/u.test(unit)) return { family: 'volume', factor: 1 };
  if (/^(?:MILILITROS?|MLS?|ML)$/u.test(unit)) return { family: 'volume', factor: 0.001 };
  if (/^(?:UNIDAD(?:ES)?|UNIDS?|UNDS?|UND|UN|PIEZAS?|PZAS?|PZS?|PZ|PCS?|PACKS?|PACK|PK|PAR(?:ES)?|HOJAS?|ROLLOS?|U|P)$/u.test(unit)) {
    return { family: 'count', factor: 1 };
  }
  return null;
}

function expectedMeasureFamily(unit: string): MeasureFamily | null {
  if (/^(?:KILOGRAMOS?|KILOS?|KGS?|KG|GRAMOS?|GRS?|GR|G)$/u.test(unit)) return 'mass';
  if (/^(?:LITROS?|LTS?|LT|L|MILILITROS?|MLS?|ML)$/u.test(unit)) return 'volume';
  if (/^(?:UNIDAD(?:ES)?|UNIDS?|UNDS?|UND|UN|PIEZAS?|PZAS?|PZS?|PZ|PCS?|PACKS?|PACK|PK|PAR(?:ES)?|HOJAS?|ROLLOS?|U|P)$/u.test(unit)) return 'count';
  return null;
}

function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value ?? '').trim().replace(',', '.');
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function measuresIn(description: string): MeasureCandidate[] {
  const measures = [...description.matchAll(MEASURE_PATTERN)].flatMap((match) => {
    const value = Number(match[1].replace(',', '.'));
    const unit = measureUnit(match[2]);
    if (!Number.isFinite(value) || !unit) return [];
    return [{
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      family: unit.family,
      baseValue: value * unit.factor,
    }];
  });
  const bareUnit = [...description.matchAll(/\b(?:UNIDAD(?:ES)?|UNIDS?|UNDS?|UND|UN|PCS?|PZAS?|PZS?|PZ|PACKS?|PACK|PK|PAR(?:ES)?|HOJAS?|ROLLOS?)\b/giu)];
  for (const match of bareUnit) {
    if (match.index > 0 && /\d\s*$/u.test(description.slice(0, match.index))) continue;
    measures.push({
      start: match.index,
      end: match.index + match[0].length,
      text: match[0],
      family: 'count',
      baseValue: 1,
    });
  }
  return measures.sort((left, right) => left.start - right.start || left.end - right.end);
}

function sameMeasureValue(actual: number, expected: number): boolean {
  // Un gramo/mililitro o 0,5 % absorbe redondeos normales del archivo sin
  // convertir diferencias materiales de empaque en coincidencias.
  const tolerance = Math.max(0.001, Math.abs(expected) * 0.005);
  return Math.abs(actual - expected) <= tolerance;
}

function matchingProductToken(
  descriptionTokens: TextToken[],
  productTokens: string[],
  before: number,
): TextToken | null {
  return descriptionTokens.find((token, index) => (
    index < 4
    && token.end <= before
    && productTokens.some((productToken) => tokensMatch(token.value, productToken))
  )) ?? null;
}

function productEvidenceMessage(input: DescriptionQualityInput): string {
  const evidence = input.productEvidence!;
  return `Posible inconsistencia: el prefijo "${evidence.prefix}" se asocia a Producto_Wm "${evidence.suggestedProduct}" en ${evidence.support} de ${evidence.total} registros (${(evidence.share * 100).toFixed(1)}%), no a "${String(input.product).trim()}".`;
}

function leadingSignatures(description: string): string[] {
  const leading = textTokens(description)
    .map((token) => token.value)
    .filter((token) => /[A-Z]/u.test(token))
    .slice(0, 2)
    .map(canonicalToken);
  if (leading.length === 0) return [];
  return leading.length === 1 ? [leading[0]] : [`${leading[0]} ${leading[1]}`, leading[0]];
}

function dominantProduct(
  counts: Map<string, number>,
  minimumSupport: number,
  minimumShare: number,
  minimumLead: number,
): { product: string; support: number; total: number; share: number } | null {
  const ordered = [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'));
  const [first, second] = ordered;
  if (!first) return null;
  const total = ordered.reduce((sum, [, count]) => sum + count, 0);
  const share = first[1] / total;
  if (first[1] < minimumSupport || share < minimumShare || first[1] < (second?.[1] ?? 0) * minimumLead) return null;
  return { product: first[0], support: first[1], total, share };
}

/**
 * Aprende alias de producto únicamente desde la base cargada. Solo devuelve
 * evidencia cuando un prefijo se repite y apunta con amplia mayoría a otro
 * Producto_Wm; los prefijos ambiguos no generan alerta.
 */
export function buildProductDescriptionEvidence(
  records: readonly ProductDescriptionRecord[],
): Map<number, ProductDescriptionEvidence> {
  const countsBySignature = new Map<string, Map<string, number>>();
  const normalizedRows = records.map((record) => {
    const description = normalizedText(record.description);
    const product = normalizedText(record.product);
    const signatures = leadingSignatures(description);
    if (product) {
      for (const signature of signatures) {
        const counts = countsBySignature.get(signature) ?? new Map<string, number>();
        counts.set(product, (counts.get(product) ?? 0) + 1);
        countsBySignature.set(signature, counts);
      }
    }
    return { sourceRow: record.sourceRow, product, signatures };
  });
  const result = new Map<number, ProductDescriptionEvidence>();

  for (const row of normalizedRows) {
    for (const [index, signature] of row.signatures.entries()) {
      const dominant = dominantProduct(
        countsBySignature.get(signature) ?? new Map(),
        index === 0 && row.signatures.length > 1 ? 3 : 5,
        index === 0 && row.signatures.length > 1 ? 0.75 : 0.85,
        index === 0 && row.signatures.length > 1 ? 2 : 3,
      );
      if (!dominant) continue;
      if (dominant.product === row.product) break;
      result.set(row.sourceRow, {
        prefix: signature,
        suggestedProduct: dominant.product,
        support: dominant.support,
        total: dominant.total,
        share: dominant.share,
      });
      break;
    }
  }
  return result;
}

export function assessDescriptionQuality(input: DescriptionQualityInput): DescriptionQualityResult | null {
  const description = normalizedText(input.description);
  const product = normalizedText(input.product);
  const brand = normalizedText(input.brand);
  if (!description || !product) return null;

  const specialBrand = SPECIAL_BRANDS.has(brand);
  const expectedPattern = specialBrand
    ? `Producto compatible con "${String(input.product).trim()}" → gramaje o medida compatible después del producto`
    : `Producto compatible con "${String(input.product).trim()}" → marca exacta "${String(input.brand).trim()}" → gramaje o medida compatible`;
  const issues: DescriptionQualityIssue[] = [];
  const descriptionTokens = textTokens(description);
  const productTokens = significantProductTokens(product);
  const brandMatch = specialBrand || !brand
    ? null
    : findTokenSequence(descriptionTokens, textTokens(brand));
  const gramaje = parseNumber(input.gramaje);
  const unit = normalizedText(input.unit);
  const family = gramaje === null ? null : expectedMeasureFamily(unit);
  const measures = measuresIn(description);
  const matchingMeasures = family === null
    ? []
    : measures.filter((measure) => measure.family === family);
  const expectedMeasures = gramaje === null
    ? []
    : family === 'count'
      ? matchingMeasures
      : matchingMeasures.filter((measure) => sameMeasureValue(measure.baseValue, gramaje));
  const variableWeight = family === 'mass'
    ? description.match(/\bPOR\s+(?:KILOGRAMO|KILOGRAMOS|KILO|KILOS|KG)\b/u)
    : null;
  const measureBoundary = matchingMeasures[0]?.start ?? variableWeight?.index ?? description.length;
  const productBoundary = brandMatch?.start ?? measureBoundary;
  const productMatch = productTokens.length === 0
    ? null
    : matchingProductToken(descriptionTokens, productTokens, productBoundary);

  if (productTokens.length > 0 && !productMatch) {
    const matchAnywhere = matchingProductToken(descriptionTokens, productTokens, description.length);
    const brandStartsDescription = Boolean(brandMatch && !descriptionTokens.some((token) => token.end <= brandMatch.start));
    if (brandMatch && ((matchAnywhere && matchAnywhere.start >= brandMatch.end) || brandStartsDescription)) {
      issues.push({
        code: 'PRODUCT_AFTER_BRAND',
        message: `El producto aparece después de la marca; debe ir primero y ser compatible con Producto_Wm "${String(input.product).trim()}".`,
      });
    } else if (input.productEvidence) {
      issues.push({
        code: 'PRODUCT_MISMATCH',
        message: productEvidenceMessage(input),
      });
    }
  }

  if (!specialBrand && brand) {
    if (!brandMatch) {
      issues.push({
        code: 'BRAND_MISSING',
        message: `La descripción no contiene la marca exacta "${String(input.brand).trim()}" indicada en Marca_Wm.`,
      });
    }
  }

  if (family !== null) {
    const orderBoundary = brandMatch?.end ?? productMatch?.end ?? 0;
    const measureAfterBoundary = expectedMeasures.some((measure) => measure.start >= orderBoundary)
      || Boolean(variableWeight && (variableWeight.index ?? 0) >= orderBoundary);
    if (!measureAfterBoundary) {
      const measureBeforeBoundary = expectedMeasures.length > 0 || Boolean(variableWeight);
      const incompatibleAfterBoundary = matchingMeasures.filter((measure) => measure.start >= orderBoundary);
      const mismatchedValues = [...new Set(incompatibleAfterBoundary.map((measure) => measure.text.trim()))];
      // En UNIDADES, una cifra puede representar materias, hojas, tallas u
      // otras dimensiones; allí solo exigimos un conteo explícito y su orden.
      const mismatch = family !== 'count' && !measureBeforeBoundary && mismatchedValues.length > 0;
      issues.push({
        code: measureBeforeBoundary
          ? 'GRAMMAGE_BEFORE_BRAND'
          : mismatch ? 'GRAMMAGE_MISMATCH' : 'GRAMMAGE_MISSING',
        message: measureBeforeBoundary
          ? 'El gramaje aparece antes de la marca o del producto; debe ubicarse después.'
          : mismatch
            ? `La medida ${mismatchedValues.map((value) => `"${value}"`).join(', ')} no coincide con Gramaje ${String(input.gramaje).trim()} ${String(input.unit).trim()}.`
            : `No aparece después de la marca una medida compatible con Gramaje ${String(input.gramaje).trim()} ${String(input.unit).trim()}.`,
      });
    }
  }

  return issues.length > 0 ? { issues, expectedPattern } : null;
}
