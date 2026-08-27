import learningData from '../data/orthography-learning.json';
import type { CellValue, OrthographyAlert, SourceDataset, SourceRecord } from './types';

const REPORT_FIELDS = ['Marca_Wm', 'Tipo_Marca', 'Descripcion', 'Canasto Wm'] as const;
const VOCABULARY_FIELDS = ['Producto_Wm', 'Marca_Wm', 'Categoria_Wm', 'Division_Wm', 'Canasto Wm'] as const;
const PHRASE_SIMILARITY_CUTOFF = 0.85;
const HIGH_CONFIDENCE_CUTOFF = 0.9;
const VALID_PHRASE_MINIMUM = 3;
const VOCABULARY_PHRASE_MINIMUM = 2;
const MAX_CANDIDATES = 3;

const SIZES = new Set([
  'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', 'P', 'G', 'XG', 'XXG', 'CH', 'EG',
  'RN', 'NB', 'NINA', 'NINO', 'NINAS', 'NINOS',
]);
const CONNECTORS_AND_UNITS = new Set([
  'DE', 'LA', 'EL', 'LOS', 'LAS', 'EN', 'Y', 'O', 'CON', 'SIN', 'PARA', 'POR', 'AL', 'DEL',
  'UND', 'UNID', 'UNIDADES', 'PC', 'PCS', 'GR', 'G', 'ML', 'L', 'LT', 'K', 'KG', 'OZ', 'CC',
  'CM', 'MM', 'M', 'IN', 'PK', 'PACK', 'SET', 'KIT', 'BOTELLA', 'LATA', 'CAJA', 'BOLSA', 'SOBRE',
]);
const SEMANTICALLY_INCOMPATIBLE = new Set([
  'CON\u0000SIN', 'HEMBRA\u0000MACHO', 'HOMBRE\u0000MUJER', 'NINA\u0000NINO', 'NINAS\u0000NINOS',
  'LIGHT\u0000REGULAR', 'REGULAR\u0000ZERO', 'DIET\u0000REGULAR', 'AZUL\u0000ROJO', 'ROJO\u0000VERDE',
  'BLANCO\u0000NEGRO', 'PARED\u0000PIE', 'FRESA\u0000SANDIA', 'ARANDANO\u0000FRESA',
  'ARANDANO\u0000SANDIA', 'FRAMBUESA\u0000FRESA', 'LIMA\u0000LIMON', 'MANDARINA\u0000NARANJA',
  'ARANDA\u0000NARANJA', 'ARANDANO\u0000NARANJA',
].map((pair) => pair.split('\u0000').sort().join('\u0000')));
const UNKNOWN_CONTEXT_VALUES = new Set(['', 'NO IDENTIFICABLE', 'SIN MARCA', 'NO ESPECIFICA']);
const MEASURE_PATTERN = /^\d+(?:[.,]\d+)?(?:ML|LT|L|GR|G|KG|K|OZ|CC|UND|UNID|PK|PACK|CM|MM|M|PCS|PC|IN|MG|HOJAS|HOJA|PARES|PAR)?$/i;
const DIMENSION_PATTERN = /^\d+(?:[.,]\d+)?(?:X\d+(?:[.,]\d+)?)+(?:CM|MM|M|IN)?$/i;
const CODE_PATTERN = /^[A-Z]?\d+(?:[A-Z\d.\-]*)$/i;

interface LearningRecord {
  recomendado: string;
  motivo: string;
  similitud: string;
  detalle: string;
}

interface MatchBlock {
  a: number;
  b: number;
  size: number;
}

interface PhraseCandidate {
  phrase: string;
  ratio: number;
  frequency: number;
}

interface PhraseAnalysis {
  correctedDescription: string;
  reason: string;
  probability: string;
  detail: string;
  confidence: OrthographyAlert['confidence'];
  method: OrthographyAlert['method'];
  doubtfulTokens: string[];
}

function cellText(value: CellValue): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

export function normalizeOrthographyText(value: CellValue): string | null {
  if (value === null || value === undefined) return null;
  return String(value)
    .toUpperCase()
    .replaceAll('Ñ', 'N')
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalized(value: CellValue): string {
  return normalizeOrthographyText(value) ?? '';
}

function indexCharacters(text: string): Map<string, number[]> {
  const indexes = new Map<string, number[]>();
  [...text].forEach((character, index) => {
    const values = indexes.get(character) ?? [];
    values.push(index);
    indexes.set(character, values);
  });

  if (text.length >= 200) {
    const popularityThreshold = Math.floor(text.length / 100) + 1;
    for (const [character, values] of indexes) {
      if (values.length > popularityThreshold) indexes.delete(character);
    }
  }
  return indexes;
}

function longestMatch(
  first: string,
  second: string,
  secondIndexes: Map<string, number[]>,
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
): MatchBlock {
  let bestA = firstStart;
  let bestB = secondStart;
  let bestSize = 0;
  let previousLengths = new Map<number, number>();

  for (let firstIndex = firstStart; firstIndex < firstEnd; firstIndex += 1) {
    const currentLengths = new Map<number, number>();
    for (const secondIndex of secondIndexes.get(first[firstIndex]) ?? []) {
      if (secondIndex < secondStart) continue;
      if (secondIndex >= secondEnd) break;
      const size = (previousLengths.get(secondIndex - 1) ?? 0) + 1;
      currentLengths.set(secondIndex, size);
      if (size > bestSize) {
        bestA = firstIndex - size + 1;
        bestB = secondIndex - size + 1;
        bestSize = size;
      }
    }
    previousLengths = currentLengths;
  }

  while (bestA > firstStart && bestB > secondStart && first[bestA - 1] === second[bestB - 1]) {
    bestA -= 1;
    bestB -= 1;
    bestSize += 1;
  }
  while (
    bestA + bestSize < firstEnd
    && bestB + bestSize < secondEnd
    && first[bestA + bestSize] === second[bestB + bestSize]
  ) {
    bestSize += 1;
  }
  return { a: bestA, b: bestB, size: bestSize };
}

function matchingBlocks(first: string, second: string): MatchBlock[] {
  const secondIndexes = indexCharacters(second);
  const queue: Array<[number, number, number, number]> = [[0, first.length, 0, second.length]];
  const blocks: MatchBlock[] = [];

  while (queue.length > 0) {
    const [firstStart, firstEnd, secondStart, secondEnd] = queue.pop()!;
    const match = longestMatch(first, second, secondIndexes, firstStart, firstEnd, secondStart, secondEnd);
    if (match.size === 0) continue;
    blocks.push(match);
    if (firstStart < match.a && secondStart < match.b) queue.push([firstStart, match.a, secondStart, match.b]);
    if (match.a + match.size < firstEnd && match.b + match.size < secondEnd) {
      queue.push([match.a + match.size, firstEnd, match.b + match.size, secondEnd]);
    }
  }

  blocks.sort((left, right) => left.a - right.a || left.b - right.b);
  const collapsed: MatchBlock[] = [];
  for (const block of blocks) {
    const previous = collapsed.at(-1);
    if (previous && previous.a + previous.size === block.a && previous.b + previous.size === block.b) previous.size += block.size;
    else collapsed.push({ ...block });
  }
  collapsed.push({ a: first.length, b: second.length, size: 0 });
  return collapsed;
}

export function sequenceSimilarity(first: string, second: string): number {
  const totalLength = first.length + second.length;
  if (totalLength === 0) return 1;
  const matches = matchingBlocks(first, second).reduce((total, block) => total + block.size, 0);
  return (2 * matches) / totalLength;
}

function quickSimilarity(first: string, second: string, secondCounts: Map<string, number>): number {
  const totalLength = first.length + second.length;
  if (totalLength === 0) return 1;
  const used = new Map<string, number>();
  let matches = 0;
  for (const character of first) {
    const available = (secondCounts.get(character) ?? 0) - (used.get(character) ?? 0);
    if (available > 0) {
      matches += 1;
      used.set(character, (used.get(character) ?? 0) + 1);
    }
  }
  return (2 * matches) / totalLength;
}

function digits(value: string): string[] {
  return [...value].filter((character) => /\d/.test(character));
}

function selectedTokens(value: string, predicate: (token: string) => boolean): Set<string> {
  return new Set(value.split(' ').filter(predicate));
}

function sameSet(first: Set<string>, second: Set<string>): boolean {
  return first.size === second.size && [...first].every((value) => second.has(value));
}

function hasIncompatibleMeaning(first: string, second: string): boolean {
  const firstTokens = first.split(' ');
  const secondTokens = second.split(' ');
  return firstTokens.some((left) => secondTokens.some((right) => (
    SEMANTICALLY_INCOMPATIBLE.has([left, right].sort().join('\u0000'))
  )));
}

function safeCorrection(suspicious: string, candidate: string): boolean {
  if (digits(suspicious).join('') !== digits(candidate).join('')) return false;
  if (!sameSet(selectedTokens(suspicious, (token) => SIZES.has(token)), selectedTokens(candidate, (token) => SIZES.has(token)))) return false;
  if (!sameSet(
    selectedTokens(suspicious, (token) => /\d/.test(token) && (MEASURE_PATTERN.test(token) || DIMENSION_PATTERN.test(token))),
    selectedTokens(candidate, (token) => /\d/.test(token) && (MEASURE_PATTERN.test(token) || DIMENSION_PATTERN.test(token))),
  )) return false;
  return !hasIncompatibleMeaning(suspicious, candidate);
}

function meaningfulContext(value: CellValue): string | null {
  const valueNormalized = normalized(value);
  return UNKNOWN_CONTEXT_VALUES.has(valueNormalized) ? null : valueNormalized;
}

function recordsShareContext(first: SourceRecord, second: SourceRecord): boolean {
  for (const field of ['Producto_Wm', 'Marca_Wm', 'Categoria_Wm'] as const) {
    const left = meaningfulContext(first.fields[field]);
    const right = meaningfulContext(second.fields[field]);
    if (left && right && left !== right) return false;
  }
  return true;
}

function phraseContextsMatch(suspicious: SourceRecord[], candidates: SourceRecord[]): boolean {
  return suspicious.every((record) => candidates.some((candidate) => recordsShareContext(record, candidate)));
}

function topPhraseCandidates(
  suspicious: string,
  suspiciousFrequency: number,
  suspiciousRecords: SourceRecord[],
  validPhrases: string[],
  frequencies: Map<string, number>,
  recordsByPhrase: Map<string, SourceRecord[]>,
): PhraseCandidate[] {
  const suspiciousCounts = new Map<string, number>();
  for (const character of suspicious) suspiciousCounts.set(character, (suspiciousCounts.get(character) ?? 0) + 1);
  const candidates: PhraseCandidate[] = [];

  for (const phrase of validPhrases) {
    const totalLength = phrase.length + suspicious.length;
    const realQuickRatio = totalLength === 0 ? 1 : (2 * Math.min(phrase.length, suspicious.length)) / totalLength;
    if (realQuickRatio < PHRASE_SIMILARITY_CUTOFF) continue;
    if (quickSimilarity(phrase, suspicious, suspiciousCounts) < PHRASE_SIMILARITY_CUTOFF) continue;
    const ratio = sequenceSimilarity(phrase, suspicious);
    const frequency = frequencies.get(phrase) ?? 0;
    if (ratio < PHRASE_SIMILARITY_CUTOFF || frequency < Math.max(VALID_PHRASE_MINIMUM, suspiciousFrequency * 2)) continue;
    if (!safeCorrection(suspicious, phrase)) continue;
    if (!phraseContextsMatch(suspiciousRecords, recordsByPhrase.get(phrase) ?? [])) continue;
    candidates.push({ phrase, ratio, frequency });
  }

  return candidates
    .sort((left, right) => right.ratio - left.ratio || right.frequency - left.frequency || left.phrase.localeCompare(right.phrase, 'es'))
    .slice(0, MAX_CANDIDATES);
}

function buildVocabulary(
  dataset: SourceDataset,
  frequencies: Map<string, number>,
  learning: Map<string, LearningRecord>,
): Set<string> {
  const vocabulary = new Set(CONNECTORS_AND_UNITS);
  for (const record of dataset.records) {
    for (const field of VOCABULARY_FIELDS) {
      for (const token of normalized(record.fields[field]).split(' ')) {
        if (token.length >= 2) vocabulary.add(token);
      }
    }
  }
  for (const [description, frequency] of frequencies) {
    if (frequency < VOCABULARY_PHRASE_MINIMUM) continue;
    for (const token of description.split(' ')) if (token.length >= 2) vocabulary.add(token);
  }
  for (const item of learning.values()) {
    for (const token of normalized(item.recomendado).split(' ')) if (token.length >= 2) vocabulary.add(token);
  }
  return vocabulary;
}

function validToken(token: string, vocabulary: Set<string>): boolean {
  if (token.length <= 1 || vocabulary.has(token)) return true;
  if (MEASURE_PATTERN.test(token) || DIMENSION_PATTERN.test(token) || CODE_PATTERN.test(token)) return true;
  return !/\p{L}/u.test(token);
}

function differenceDetail(suspicious: string, candidate: string): string {
  const left = suspicious.split(' ');
  const right = candidate.split(' ');
  if (left.length === right.length) {
    const changes = left.flatMap((token, index) => token === right[index] ? [] : [`'${token}' → '${right[index]}'`]);
    if (changes.length > 0) return changes.join('; ');
  }
  return `Comparar "${suspicious}" con la referencia frecuente "${candidate}".`;
}

function normalizedLearning(): Map<string, LearningRecord> {
  const learning = new Map<string, LearningRecord>();
  for (const [description, item] of Object.entries(learningData as Record<string, LearningRecord>)) {
    const key = normalized(description);
    if (key) learning.set(key, item);
  }
  return learning;
}

function analyzePhrase(
  phrase: string,
  frequency: number,
  records: SourceRecord[],
  validPhrases: string[],
  frequencies: Map<string, number>,
  recordsByPhrase: Map<string, SourceRecord[]>,
  vocabulary: Set<string>,
  learning: Map<string, LearningRecord>,
): PhraseAnalysis | null {
  const learned = learning.get(phrase);
  if (learned) {
    const recommendation = normalized(learned.recomendado);
    if (!recommendation || recommendation === phrase) return null;
    return {
      correctedDescription: recommendation,
      reason: 'Texto/Ortografía aprendida',
      probability: learned.similitud || '100%',
      detail: learned.detalle || `Corrección validada previamente: "${recommendation}".`,
      confidence: 'high',
      method: 'learned-decision',
      doubtfulTokens: [],
    };
  }

  const candidate = topPhraseCandidates(phrase, frequency, records, validPhrases, frequencies, recordsByPhrase)[0];
  if (candidate) {
    const sameTokenCount = phrase.split(' ').length === candidate.phrase.split(' ').length;
    const confidence = candidate.ratio >= HIGH_CONFIDENCE_CUTOFF && sameTokenCount ? 'high' : 'medium';
    return {
      correctedDescription: candidate.phrase,
      reason: 'Texto/Ortografía',
      probability: `${(Math.round(candidate.ratio * 1_000) / 10).toFixed(1)}%`,
      detail: differenceDetail(phrase, candidate.phrase),
      confidence,
      method: 'frequent-phrase',
      doubtfulTokens: [],
    };
  }

  const doubtfulTokens = phrase.split(' ').filter((token) => !validToken(token, vocabulary));
  if (doubtfulTokens.length === 0) return null;
  return {
    correctedDescription: phrase,
    reason: 'Texto aparece pocas veces; validar',
    probability: '100%',
    detail: `Palabras no reconocidas en productos, marcas, categorías o descripciones recurrentes: ${doubtfulTokens.map((token) => `"${token}"`).join(', ')}.`,
    confidence: 'none',
    method: 'unrecognized-token',
    doubtfulTokens,
  };
}

export function generateOrthographyAlerts(dataset: SourceDataset, targetColumn = 'Descripcion'): OrthographyAlert[] {
  const frequencies = new Map<string, number>();
  const recordsByPhrase = new Map<string, SourceRecord[]>();
  const normalizedRows = dataset.records.map((record) => {
    const phrase = normalizeOrthographyText(record.fields[targetColumn]);
    if (phrase !== null) {
      frequencies.set(phrase, (frequencies.get(phrase) ?? 0) + 1);
      const records = recordsByPhrase.get(phrase) ?? [];
      records.push(record);
      recordsByPhrase.set(phrase, records);
    }
    return { record, phrase };
  });
  const learning = normalizedLearning();
  const vocabulary = buildVocabulary(dataset, frequencies, learning);
  const validPhrases = [...frequencies]
    .filter(([phrase, count]) => Boolean(phrase) && count >= VALID_PHRASE_MINIMUM)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'es'))
    .map(([phrase]) => phrase);
  const analyses = new Map<string, PhraseAnalysis | null>();
  for (const [phrase, frequency] of frequencies) {
    if (!phrase || frequency >= VALID_PHRASE_MINIMUM) continue;
    analyses.set(phrase, analyzePhrase(
      phrase,
      frequency,
      recordsByPhrase.get(phrase) ?? [],
      validPhrases,
      frequencies,
      recordsByPhrase,
      vocabulary,
      learning,
    ));
  }

  const alerts: OrthographyAlert[] = [];
  for (const { record, phrase } of normalizedRows) {
    const original = cellText(record.fields[targetColumn]);
    const analysis = phrase === null ? null : analyses.get(phrase) ?? null;
    const hasExtraSpaces = original !== original.trim() || /\s{2,}/.test(original);
    if (!analysis && !hasExtraSpaces) continue;

    const reason = [hasExtraSpaces ? 'Espacios de más' : '', analysis?.reason ?? ''].filter(Boolean).join(' + ');
    const detail = [hasExtraSpaces ? 'Se encontraron espacios múltiples o en los bordes.' : '', analysis?.detail ?? ''].filter(Boolean).join(' ');
    const correctedDescription = analysis?.correctedDescription ?? original.replace(/\s+/g, ' ').trim();
    const selectedFields = Object.fromEntries(
      REPORT_FIELDS.map((field) => [field, cellText(record.fields[field])]),
    ) as OrthographyAlert['fields'];
    alerts.push({
      sourceRow: record.excelRow,
      rowId: cellText(record.fields['Row-Id']),
      surveyId: cellText(record.fields['Id_Dn W']),
      barcode: cellText(record.fields.codiGo_barras),
      fields: selectedFields,
      reason,
      probability: analysis?.probability ?? '100%',
      correctedDescription,
      detail,
      confidence: analysis?.confidence ?? 'high',
      method: analysis?.method ?? 'spacing',
      doubtfulTokens: analysis?.doubtfulTokens ?? [],
    });
  }
  return alerts;
}
