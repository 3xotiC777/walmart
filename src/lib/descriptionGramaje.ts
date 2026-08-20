const ALLOWED_UNITS = new Set([
  'G', 'GR', 'GRS',
  'KG', 'KGS',
  'ML', 'MLS',
  'L', 'LT', 'LTS',
  'UND', 'UNDS',
  'UNIDAD', 'UNIDADES',
  'KILO', 'KILOS',
  'LITRO', 'LITROS',
]);

const PARTIAL_UNITS = new Set(['', 'K', 'M', 'U', 'UN', 'G', 'L']);

interface FinalMeasure {
  product: string;
  quantity: string;
  unit: string;
}

export interface DescriptionGramajeIssue {
  suspiciousDescription: string;
  referenceDescription: string;
  reason: 'Unidad final incompleta' | 'Gramaje final distinto';
}

function normalize(value: string): string {
  return value.trim().toLocaleUpperCase('es');
}

export function parseFinalMeasure(value: string): FinalMeasure | null {
  const description = normalize(value);
  if (!description) return null;

  const match = description.match(/^(.*?)(\d+(?:[.,]\d+)?)\s*([A-Z]*)$/);
  if (!match) return null;

  return {
    product: match[1].trim(),
    quantity: match[2],
    unit: match[3],
  };
}

function quantitiesEqual(first: string, second: string): boolean {
  const firstNumber = Number(first.replace(',', '.'));
  const secondNumber = Number(second.replace(',', '.'));
  if (Number.isFinite(firstNumber) && Number.isFinite(secondNumber)) {
    return firstNumber === secondNumber;
  }
  return first === second;
}

function isPartialUnit(partial: string, complete: string): boolean {
  if (!PARTIAL_UNITS.has(partial) || !ALLOWED_UNITS.has(complete)) return false;
  if (partial.length >= complete.length) return false;
  if (!partial) return true;

  let position = 0;
  for (const letter of complete) {
    if (letter === partial[position]) position += 1;
    if (position === partial.length) return true;
  }
  return false;
}

function looksLikeUnit(unit: string): boolean {
  return ALLOWED_UNITS.has(unit) || PARTIAL_UNITS.has(unit);
}

export function classifyDescriptionGramaje(
  candidateDescription: string,
  referenceDescription: string,
): DescriptionGramajeIssue | null {
  const candidate = normalize(candidateDescription);
  const reference = normalize(referenceDescription);
  if (!candidate || !reference || candidate === reference) return null;

  const candidateMeasure = parseFinalMeasure(candidate);
  const referenceMeasure = parseFinalMeasure(reference);
  if (!candidateMeasure || !referenceMeasure || candidateMeasure.product !== referenceMeasure.product) {
    return null;
  }

  const sameQuantity = quantitiesEqual(candidateMeasure.quantity, referenceMeasure.quantity);
  if (sameQuantity && candidateMeasure.unit !== referenceMeasure.unit) {
    if (isPartialUnit(candidateMeasure.unit, referenceMeasure.unit)) {
      return {
        suspiciousDescription: candidateDescription,
        referenceDescription,
        reason: 'Unidad final incompleta',
      };
    }
    if (isPartialUnit(referenceMeasure.unit, candidateMeasure.unit)) {
      return {
        suspiciousDescription: referenceDescription,
        referenceDescription: candidateDescription,
        reason: 'Unidad final incompleta',
      };
    }
  }

  if (
    !sameQuantity &&
    (candidateMeasure.unit !== '' || referenceMeasure.unit !== '') &&
    looksLikeUnit(candidateMeasure.unit) &&
    looksLikeUnit(referenceMeasure.unit)
  ) {
    return {
      suspiciousDescription: candidateDescription,
      referenceDescription,
      reason: 'Gramaje final distinto',
    };
  }

  return null;
}
