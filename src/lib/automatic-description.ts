import * as XLSX from 'xlsx';
import type { SourceDataset, SourceRecord } from './types';

const NOT_SPECIFIED = /^(?:NO\s+ESPECIFIC[AO]?|NO\s+IDENTIFICABLE|SIN\s+(?:MARCA|DATO)|N\/?A|N\.\/?D\.?|NO\s+APLICA)$/i;
const UNIT_SUFFIX: Record<string, string> = {
  KILO: 'KG', KILOS: 'KG', KILOGRAMO: 'KG', KILOGRAMOS: 'KG', KG: 'KG',
  GRAMO: 'GR', GRAMOS: 'GR', GR: 'GR', G: 'GR',
  LITRO: 'L', LITROS: 'L', L: 'L', LT: 'L',
  MILILITRO: 'ML', MILILITROS: 'ML', ML: 'ML', CC: 'ML',
  UNIDAD: 'UND', UNIDADES: 'UND', UND: 'UND', UNID: 'UND',
  ONZA: 'OZ', ONZAS: 'OZ', OZ: 'OZ',
};

function usable(value: unknown): string {
  const text = String(value ?? '').trim().replace(/\s+/g, ' ');
  return !text || NOT_SPECIFIED.test(text) ? '' : text;
}

export function suggestedDescription(record: SourceRecord): string {
  const category = usable(record.fields.Categoria_Wm);
  const brand = usable(record.fields.Marca_Wm);
  const gramaje = usable(record.fields.Gramaje);
  const unit = usable(record.fields.unidad_de_Medida).toUpperCase();
  const suffix = UNIT_SUFFIX[unit];
  const quantityAndUnit = gramaje && suffix ? `${gramaje}${suffix}` : '';
  return [category, brand, quantityAndUnit].filter(Boolean).join(' ');
}

/** Salida independiente: conserva las filas y columnas de la hoja de datos; no toca el original. */
export function buildAutomaticDescriptionWorkbook(dataset: SourceDataset): ArrayBuffer {
  const descriptionIndex = dataset.headers.indexOf('Descripcion');
  if (descriptionIndex < 0) throw new Error('La base no trae la columna Descripcion.');
  const rows: unknown[][] = [];
  const insert = (values: unknown[], suggestion: unknown) => [
    ...values.slice(0, descriptionIndex + 1),
    suggestion,
    ...values.slice(descriptionIndex + 1),
  ];
  rows[0] = insert(dataset.outputHeaders, 'descripción_sugerida');
  for (const record of dataset.records) rows[record.excelRow - 1] = insert(record.values, suggestedDescription(record));
  const sheet = XLSX.utils.aoa_to_sheet(rows, { cellDates: true });
  sheet['!autofilter'] = { ref: sheet['!ref'] ?? 'A1:A1' };
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'pqm consolidado');
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true, cellDates: true }) as ArrayBuffer;
}
