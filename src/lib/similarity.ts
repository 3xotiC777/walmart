import { sequenceSimilarity } from './orthography';

export interface SimilarValue {
  value: string;
  match: string;
  similarity: number;
}

const MIN_SIMILARITY = 0.95;

function trigrams(value: string): string[] {
  if (value.length < 3) return [value];
  const grams = new Set<string>();
  for (let index = 0; index <= value.length - 3; index += 1) grams.add(value.slice(index, index + 3));
  return [...grams];
}

/** Compara valores únicos, no todas las filas: indexa trigramas para evitar O(filas²). */
export function findSimilarValues(values: readonly string[], threshold = MIN_SIMILARITY): Map<string, SimilarValue> {
  const originals = new Map<string, string>();
  for (const value of values) {
    const key = value.trim().toUpperCase().replace(/\s+/g, ' ');
    if (key && !originals.has(key)) originals.set(key, value.trim());
  }
  const keys = [...originals.keys()];
  const characterCounts = keys.map((key) => {
    const counts = new Map<string, number>();
    for (const character of key) counts.set(character, (counts.get(character) ?? 0) + 1);
    return counts;
  });
  const index = new Map<string, number[]>();
  keys.forEach((key, position) => {
    for (const gram of trigrams(key)) {
      const entries = index.get(gram) ?? [];
      entries.push(position);
      index.set(gram, entries);
    }
  });

  const best = new Map<number, { other: number; ratio: number }>();
  keys.forEach((key, position) => {
    const candidates = new Set<number>();
    for (const gram of trigrams(key)) for (const other of index.get(gram) ?? []) if (other > position) candidates.add(other);
    for (const other of candidates) {
      const candidate = keys[other];
      if (2 * Math.min(key.length, candidate.length) / (key.length + candidate.length) < threshold) continue;
      let shared = 0;
      for (const [character, count] of characterCounts[position]) {
        shared += Math.min(count, characterCounts[other].get(character) ?? 0);
      }
      if (2 * shared / (key.length + candidate.length) < threshold) continue;
      const ratio = sequenceSimilarity(key, candidate);
      if (ratio < threshold) continue;
      if (ratio > (best.get(position)?.ratio ?? 0)) best.set(position, { other, ratio });
      if (ratio > (best.get(other)?.ratio ?? 0)) best.set(other, { other: position, ratio });
    }
  });
  const result = new Map<string, SimilarValue>();
  for (const [position, match] of best) {
    result.set(keys[position], {
      value: originals.get(keys[position])!,
      match: originals.get(keys[match.other])!,
      similarity: match.ratio,
    });
  }
  return result;
}
