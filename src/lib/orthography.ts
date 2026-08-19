import type { CellValue, OrthographyAlert, SourceDataset } from './types';

const REPORT_FIELDS = ['Marca_Wm', 'Tipo_Marca', 'Descripcion', 'Canasto Wm'] as const;
const SIMILARITY_CUTOFF = 0.9;

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

interface MatchBlock {
  a: number;
  b: number;
  size: number;
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

  while (
    bestA > firstStart
    && bestB > secondStart
    && first[bestA - 1] === second[bestB - 1]
  ) {
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
    const match = longestMatch(
      first,
      second,
      secondIndexes,
      firstStart,
      firstEnd,
      secondStart,
      secondEnd,
    );
    if (match.size === 0) continue;
    blocks.push(match);
    if (firstStart < match.a && secondStart < match.b) {
      queue.push([firstStart, match.a, secondStart, match.b]);
    }
    if (match.a + match.size < firstEnd && match.b + match.size < secondEnd) {
      queue.push([match.a + match.size, firstEnd, match.b + match.size, secondEnd]);
    }
  }

  blocks.sort((left, right) => left.a - right.a || left.b - right.b);
  const collapsed: MatchBlock[] = [];
  for (const block of blocks) {
    const previous = collapsed.at(-1);
    if (previous && previous.a + previous.size === block.a && previous.b + previous.size === block.b) {
      previous.size += block.size;
    } else {
      collapsed.push({ ...block });
    }
  }
  collapsed.push({ a: first.length, b: second.length, size: 0 });
  return collapsed;
}

export function sequenceSimilarity(first: string, second: string): number {
  const totalLength = first.length + second.length;
  if (totalLength === 0) return 1;
  const matches = matchingBlocks(first, second)
    .reduce((total, block) => total + block.size, 0);
  return (2 * matches) / totalLength;
}

function changesDigits(first: string, second: string): boolean {
  let firstPosition = 0;
  let secondPosition = 0;
  for (const block of matchingBlocks(first, second)) {
    const removed = first.slice(firstPosition, block.a);
    const added = second.slice(secondPosition, block.b);
    if (/\d/.test(removed) || /\d/.test(added)) return true;
    firstPosition = block.a + block.size;
    secondPosition = block.b + block.size;
  }
  return false;
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

function closestValidPhrase(suspicious: string, validPhrases: string[]): { phrase: string; ratio: number } | null {
  let bestPhrase = '';
  let bestRatio = SIMILARITY_CUTOFF;
  const suspiciousCounts = new Map<string, number>();
  for (const character of suspicious) {
    suspiciousCounts.set(character, (suspiciousCounts.get(character) ?? 0) + 1);
  }

  for (const candidate of validPhrases) {
    const totalLength = candidate.length + suspicious.length;
    const realQuickRatio = totalLength === 0
      ? 1
      : (2 * Math.min(candidate.length, suspicious.length)) / totalLength;
    if (realQuickRatio < SIMILARITY_CUTOFF) continue;
    if (quickSimilarity(candidate, suspicious, suspiciousCounts) < SIMILARITY_CUTOFF) continue;
    const ratio = sequenceSimilarity(candidate, suspicious);
    if (ratio < SIMILARITY_CUTOFF) continue;
    if (ratio > bestRatio || (ratio === bestRatio && candidate > bestPhrase)) {
      bestPhrase = candidate;
      bestRatio = ratio;
    }
  }

  return bestPhrase ? { phrase: bestPhrase, ratio: bestRatio } : null;
}

export function generateOrthographyAlerts(
  dataset: SourceDataset,
  targetColumn = 'Descripcion',
): OrthographyAlert[] {
  const frequencies = new Map<string, number>();
  const normalizedRows = dataset.records.map((record) => {
    const normalized = normalizeOrthographyText(record.fields[targetColumn]);
    if (normalized !== null) frequencies.set(normalized, (frequencies.get(normalized) ?? 0) + 1);
    return { record, normalized };
  });

  const validPhrases = [...frequencies]
    .filter(([, count]) => count >= 2)
    .sort((left, right) => right[1] - left[1])
    .map(([phrase]) => phrase);
  const suspiciousPhrases = [...frequencies]
    .filter(([, count]) => count < 5)
    .sort((left, right) => right[1] - left[1])
    .map(([phrase]) => phrase);

  const corrections = new Map<string, { phrase: string; probability: string }>();
  for (const suspicious of suspiciousPhrases) {
    const closest = closestValidPhrase(suspicious, validPhrases);
    if (!closest || changesDigits(suspicious, closest.phrase)) continue;
    const probability = sequenceSimilarity(suspicious, closest.phrase);
    corrections.set(suspicious, {
      phrase: closest.phrase,
      probability: `${(Math.round(probability * 1_000) / 10).toFixed(1)}%`,
    });
  }

  const alerts: OrthographyAlert[] = [];
  for (const { record, normalized } of normalizedRows) {
    const original = cellText(record.fields[targetColumn]);
    const correction = normalized === null ? undefined : corrections.get(normalized);
    const reasons: string[] = [];
    if (original !== original.trim() || original.includes('  ')) reasons.push('Espacios de más');
    if (correction && correction.phrase !== normalized) reasons.push('Texto/Ortografía');
    if (reasons.length === 0) continue;

    const selectedFields = Object.fromEntries(
      REPORT_FIELDS.map((field) => [field, cellText(record.fields[field])]),
    ) as OrthographyAlert['fields'];
    alerts.push({
      sourceRow: record.excelRow,
      rowId: cellText(record.fields['Row-Id']),
      surveyId: cellText(record.fields['Id_Dn W']),
      barcode: cellText(record.fields.codiGo_barras),
      fields: selectedFields,
      reason: reasons.join(' + '),
      probability: correction && reasons.includes('Texto/Ortografía') ? correction.probability : '100%',
      correctedDescription: correction?.phrase ?? normalized ?? '',
    });
  }

  return alerts;
}
