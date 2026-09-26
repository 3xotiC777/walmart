import * as XLSX from 'xlsx';
import { normalizeOrthographyText } from './orthography';
import type { OrthographyLexicon } from './types';

export interface LexiconEntry {
  word: string;
  classification: 'correct' | 'incorrect';
  replacement: string | null;
}

function key(value: unknown): string {
  return String(value ?? '').normalize('NFD').replace(/\p{Mn}/gu, '').trim().toUpperCase().replace(/\s+/g, ' ');
}

/** Acepta los encabezados de las dos plantillas compartidas, independientemente del nombre de archivo. */
export function parseLexiconWorkbook(buffer: ArrayBuffer, classification: LexiconEntry['classification']): LexiconEntry[] {
  let workbook: XLSX.WorkBook;
  try { workbook = XLSX.read(buffer, { type: 'array' }); }
  catch { throw new Error('No fue posible leer el Excel de vocabulario.'); }
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error('El Excel de vocabulario no tiene una hoja válida.');
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
  const headers = (rows[0] ?? []).map(key);
  const wordColumn = classification === 'correct'
    ? headers.indexOf('PALABRAS CORRECTAS')
    : headers.indexOf('PALABRA ERRONEA');
  const replacementColumn = headers.indexOf('PALABRA CORRECTA');
  if (wordColumn < 0 || (classification === 'incorrect' && replacementColumn < 0)) {
    throw new Error(classification === 'correct'
      ? 'Falta la columna “Palabras Correctas”.'
      : 'Faltan las columnas “Palabra Erronea” y “Palabra Correcta”.');
  }
  const entries = new Map<string, LexiconEntry>();
  for (const row of rows.slice(1)) {
    const word = normalizeOrthographyText(String(row[wordColumn] ?? '')) ?? '';
    if (!word) continue;
    if (word.includes(' ') || word.length > 80) throw new Error(`La entrada “${word}” debe ser una sola palabra de hasta 80 caracteres.`);
    const replacement = classification === 'incorrect'
      ? normalizeOrthographyText(String(row[replacementColumn] ?? '')) || null
      : null;
    entries.set(word, { word, classification, replacement });
  }
  return [...entries.values()];
}

export function entriesToLexicon(entries: readonly LexiconEntry[]): OrthographyLexicon {
  const correct: string[] = [];
  const incorrect: Record<string, string | null> = {};
  for (const entry of entries) {
    if (entry.classification === 'correct') correct.push(entry.word);
    else incorrect[entry.word] = entry.replacement;
  }
  return { correct, incorrect };
}
