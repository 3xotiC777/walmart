import * as XLSX from 'xlsx';
import type { CellValue, SourceDataset, SourceRecord } from './types';

export const SOURCE_SHEET = 'pqm consolidado';

export const REQUIRED_HEADERS = [
  'Row-Id',
  'Id_Dn W',
  'Cantidad_Productos',
  'Producto_Wm',
  'Categoria_Wm',
  'Division_Wm',
  'Marca_Wm',
  'Tipo_Marca',
  'codiGo_barras',
  'codiGo_estandar',
  'Descripcion',
  'Gramaje',
  'unidad_de_Medida',
  'cantidad_comprada',
  'Precio_Unidad',
  'Precio_Total_Preciador',
  'Monto Total Fc',
  'Canasto Wm',
] as const;

const IDENTIFIER_HEADERS = new Set(['Row-Id', 'Id_Dn W', 'codiGo_barras', 'codiGo_estandar']);

export class WorkbookValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkbookValidationError';
  }
}

function isMeaningful(value: unknown): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function makeUniqueHeaders(headers: string[]): string[] {
  const counts = new Map<string, number>();
  return headers.map((header, index) => {
    const base = header || `Columna_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function formattedIdentifier(
  sheet: XLSX.WorkSheet,
  excelRow: number,
  column: number,
  fallback: CellValue,
): CellValue {
  const address = XLSX.utils.encode_cell({ r: excelRow - 1, c: column });
  const cell = sheet[address];
  if (!cell) return fallback;
  if (cell.t === 's' || cell.t === 'str') return String(cell.v ?? '');
  if (cell.w !== undefined && cell.w !== '') return String(cell.w);
  return fallback;
}

export function parseWorkbook(buffer: ArrayBuffer, sourceFile: string): SourceDataset {
  let workbook: XLSX.WorkBook;

  try {
    workbook = XLSX.read(buffer, {
      type: 'array',
      cellDates: true,
      cellText: true,
      dense: false,
    });
  } catch {
    throw new WorkbookValidationError('No fue posible leer el archivo. Verifica que sea un Excel .xlsx válido.');
  }

  const sheet = workbook.Sheets[SOURCE_SHEET];
  if (!sheet) {
    throw new WorkbookValidationError(
      `No se encontró la hoja "${SOURCE_SHEET}". Hojas disponibles: ${workbook.SheetNames.join(', ') || 'ninguna'}.`,
    );
  }

  const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });

  if (matrix.length < 2) {
    throw new WorkbookValidationError(`La hoja "${SOURCE_SHEET}" no contiene registros para analizar.`);
  }

  const headers = matrix[0].map((value) => String(value ?? '').trim());
  const missing = REQUIRED_HEADERS.filter((header) => !headers.includes(header));
  if (missing.length > 0) {
    throw new WorkbookValidationError(`Faltan columnas requeridas: ${missing.join(', ')}.`);
  }

  const outputHeaders = makeUniqueHeaders(headers);
  const firstHeaderIndexes = new Map<string, number>();
  headers.forEach((header, index) => {
    if (header && !firstHeaderIndexes.has(header)) firstHeaderIndexes.set(header, index);
  });

  const records: SourceRecord[] = [];
  for (let matrixIndex = 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const excelRow = matrixIndex + 1;
    const sourceValues = matrix[matrixIndex];
    const values = Array.from({ length: headers.length }, (_, index) => sourceValues[index] ?? null);
    if (!values.some(isMeaningful)) continue;

    const fields: Record<string, CellValue> = {};
    for (const [header, columnIndex] of firstHeaderIndexes) {
      let value = values[columnIndex];
      if (IDENTIFIER_HEADERS.has(header)) {
        value = formattedIdentifier(sheet, excelRow, columnIndex, value) ?? null;
        values[columnIndex] = value;
      }
      fields[header] = value;
    }
    records.push({ excelRow, values, fields });
  }

  if (records.length === 0) {
    throw new WorkbookValidationError(`La hoja "${SOURCE_SHEET}" no contiene registros para analizar.`);
  }

  return { sourceFile, headers, outputHeaders, records };
}
