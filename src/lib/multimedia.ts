import * as XLSX from 'xlsx';
import { normalizeSubjectIdKey } from './multimedia-cross';

export { combineMultimediaCatalogs, normalizeSubjectIdKey } from './multimedia-cross';

export const MULTIMEDIA_REQUIRED_HEADERS = ['SubjectID', 'Name', 'TimeStamp', 'ImageURL'] as const;
export const INTERVIEW_REQUIRED_HEADER = 'SubjectID';

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const AUDIO_EXTENSIONS = new Set(['m4a', 'mp3', 'wav', 'aac', 'ogg']);

type CellValue = string | number | boolean | Date | null | undefined;

export type MultimediaKind = 'image' | 'audio';

export interface MultimediaItem {
  id: string;
  subjectId: string;
  timestamp: string;
  timestampSort: number;
  name: string;
  url: string;
  kind: MultimediaKind;
  available: boolean;
  complete: boolean | null;
  size: number | null;
  questionText: string;
  variableName: string;
}

export interface MultimediaSubject {
  subjectId: string;
  timestamp: string;
  timestampSort: number;
  images: MultimediaItem[];
  audios: MultimediaItem[];
  unavailableCount: number;
}

export interface MultimediaCatalog {
  sourceFile: string;
  sheetName: string;
  groups: MultimediaSubject[];
  totalRows: number;
  ignoredRows: number;
  totalImages: number;
  totalAudios: number;
  unavailableItems: number;
}

export interface InterviewDataField {
  columnIndex: number;
  name: string;
  value: string;
}

export interface InterviewDataRow {
  excelRow: number;
  fields: InterviewDataField[];
}

export interface InterviewDataSubject {
  subjectKey: string;
  subjectId: string;
  rows: InterviewDataRow[];
}

export interface InterviewDataCatalog {
  sourceFile: string;
  sheetName: string;
  columns: Array<{ columnIndex: number; name: string }>;
  groups: InterviewDataSubject[];
  totalRows: number;
  ignoredRows: number;
}

export interface CombinedMultimediaSubject {
  subjectKey: string;
  subjectId: string;
  timestamp: string;
  timestampSort: number;
  images: MultimediaItem[];
  audios: MultimediaItem[];
  unavailableCount: number;
  dataRows: InterviewDataRow[];
}

export class MultimediaWorkbookError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MultimediaWorkbookError';
  }
}

function meaningful(value: CellValue): boolean {
  return value !== null && value !== undefined && String(value).trim() !== '';
}

function extension(name: string): string {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? '';
}

function kindFromName(name: string): MultimediaKind | null {
  const fileExtension = extension(name);
  if (IMAGE_EXTENSIONS.has(fileExtension)) return 'image';
  if (AUDIO_EXTENSIONS.has(fileExtension)) return 'audio';
  return null;
}

function normalizedDoobloUrl(value: CellValue, expectedName: string): string | null {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'stg.dooblo.net') return null;
    if (url.pathname.toLowerCase() !== '/ws/retrieve.aspx') return null;
    if (!url.searchParams.get('Key') || url.searchParams.get('name') !== expectedName || !url.searchParams.get('id')) return null;
    return url.href;
  } catch {
    return null;
  }
}

function normalizeComplete(value: CellValue): boolean | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const text = String(value).trim().toLowerCase();
  if (['true', 'verdadero', 'yes', 'sí', 'si', '1'].includes(text)) return true;
  if (['false', 'falso', 'no', '0'].includes(text)) return false;
  return null;
}

function normalizeSize(value: CellValue): number | null {
  if (value === null || value === undefined || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function timestampFromSerial(serial: number, date1904: boolean): { label: string; sort: number } {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const milliseconds = epoch + serial * 86_400_000;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return { label: String(serial), sort: 0 };
  return {
    label: `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()}, ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
    sort: milliseconds,
  };
}

function normalizeTimestamp(value: CellValue, date1904: boolean): { label: string; sort: number } {
  if (typeof value === 'number' && Number.isFinite(value)) return timestampFromSerial(value, date1904);
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return {
      label: `${pad(value.getDate())}/${pad(value.getMonth() + 1)}/${value.getFullYear()}, ${pad(value.getHours())}:${pad(value.getMinutes())}`,
      sort: value.getTime(),
    };
  }
  const text = String(value ?? '').trim();
  return { label: text || 'Sin fecha', sort: 0 };
}

function formattedCell(
  sheet: XLSX.WorkSheet,
  excelRow: number,
  column: number,
  fallback: CellValue,
): string {
  const cell = sheet[XLSX.utils.encode_cell({ r: excelRow - 1, c: column })];
  if (cell?.w !== undefined && cell.w !== '') return String(cell.w).trim();
  if (typeof fallback === 'number' && Number.isInteger(fallback)) return String(fallback);
  return String(fallback ?? '').trim();
}

function normalizedHeader(value: CellValue): string {
  return String(value ?? '').replace(/^\uFEFF/, '').trim();
}

function findMultimediaSheet(workbook: XLSX.WorkBook): { sheet: XLSX.WorkSheet; sheetName: string; matrix: CellValue[][]; headers: string[] } {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const headers = (matrix[0] ?? []).map((value) => String(value ?? '').trim());
    if (MULTIMEDIA_REQUIRED_HEADERS.every((header) => headers.includes(header))) {
      return { sheet, sheetName, matrix, headers };
    }
  }
  throw new MultimediaWorkbookError(
    `No se encontró una hoja con las columnas requeridas: ${MULTIMEDIA_REQUIRED_HEADERS.join(', ')}.`,
  );
}

export function parseMultimediaWorkbook(buffer: ArrayBuffer, sourceFile: string): MultimediaCatalog {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellText: true, dense: false });
  } catch {
    throw new MultimediaWorkbookError('No fue posible leer el archivo. Verifica que sea un Excel .xlsx válido.');
  }

  const { sheet, sheetName, matrix, headers } = findMultimediaSheet(workbook);
  if (matrix.length < 2) throw new MultimediaWorkbookError('El archivo no contiene adjuntos para visualizar.');

  const headerIndex = new Map(headers.map((header, index) => [header, index]));
  const column = (header: string) => headerIndex.get(header) ?? -1;
  const subjectColumn = column('SubjectID');
  const nameColumn = column('Name');
  const timestampColumn = column('TimeStamp');
  const urlColumn = column('ImageURL');
  const completeColumn = column('Complete');
  const sizeColumn = column('Size');
  const questionColumn = column('QuestionText');
  const variableColumn = column('QuestionVariableName');
  const date1904 = Boolean(workbook.Workbook?.WBProps?.date1904);
  const groups = new Map<string, MultimediaSubject>();
  let ignoredRows = 0;
  let totalImages = 0;
  let totalAudios = 0;
  let unavailableItems = 0;

  for (let matrixIndex = 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const row = matrix[matrixIndex] ?? [];
    if (!row.some(meaningful)) continue;
    const excelRow = matrixIndex + 1;
    const subjectId = formattedCell(sheet, excelRow, subjectColumn, row[subjectColumn]);
    const name = String(row[nameColumn] ?? '').trim();
    const kind = kindFromName(name);
    const url = normalizedDoobloUrl(row[urlColumn], name);
    if (!subjectId || !name || !kind || !url) {
      ignoredRows += 1;
      continue;
    }

    const timestamp = normalizeTimestamp(row[timestampColumn], date1904);
    const complete = completeColumn >= 0 ? normalizeComplete(row[completeColumn]) : null;
    const size = sizeColumn >= 0 ? normalizeSize(row[sizeColumn]) : null;
    const available = complete !== false && size !== 0;
    const item: MultimediaItem = {
      id: `${excelRow}:${name}`,
      subjectId,
      timestamp: timestamp.label,
      timestampSort: timestamp.sort,
      name,
      url,
      kind,
      available,
      complete,
      size,
      questionText: questionColumn >= 0 ? String(row[questionColumn] ?? '').trim() : '',
      variableName: variableColumn >= 0 ? String(row[variableColumn] ?? '').trim() : '',
    };
    const group = groups.get(subjectId) ?? {
      subjectId,
      timestamp: timestamp.label,
      timestampSort: timestamp.sort,
      images: [],
      audios: [],
      unavailableCount: 0,
    };
    if (kind === 'image') {
      group.images.push(item);
      totalImages += 1;
    } else {
      group.audios.push(item);
      totalAudios += 1;
    }
    if (!available) {
      group.unavailableCount += 1;
      unavailableItems += 1;
    }
    if (!group.timestampSort && timestamp.sort) {
      group.timestamp = timestamp.label;
      group.timestampSort = timestamp.sort;
    }
    groups.set(subjectId, group);
  }

  if (groups.size === 0) {
    throw new MultimediaWorkbookError('No se encontraron enlaces multimedia válidos de Dooblo en el archivo.');
  }

  return {
    sourceFile,
    sheetName,
    groups: [...groups.values()].sort((left, right) => (
      right.timestampSort - left.timestampSort
      || left.subjectId.localeCompare(right.subjectId, 'es', { numeric: true })
    )),
    totalRows: matrix.length - 1,
    ignoredRows,
    totalImages,
    totalAudios,
    unavailableItems,
  };
}

function findInterviewSheet(workbook: XLSX.WorkBook): {
  sheet: XLSX.WorkSheet;
  sheetName: string;
  matrix: CellValue[][];
  headerRowIndex: number;
  headers: string[];
  subjectColumn: number;
} {
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = XLSX.utils.sheet_to_json<CellValue[]>(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });
    const scanLimit = Math.min(matrix.length, 25);
    for (let headerRowIndex = 0; headerRowIndex < scanLimit; headerRowIndex += 1) {
      const headers = (matrix[headerRowIndex] ?? []).map(normalizedHeader);
      const subjectColumn = headers.findIndex((header) => header.toLocaleLowerCase('es') === INTERVIEW_REQUIRED_HEADER.toLocaleLowerCase('es'));
      if (subjectColumn >= 0) return { sheet, sheetName, matrix, headerRowIndex, headers, subjectColumn };
    }
  }
  throw new MultimediaWorkbookError(`No se encontró una hoja con la columna obligatoria ${INTERVIEW_REQUIRED_HEADER}.`);
}

export function parseInterviewDataWorkbook(buffer: ArrayBuffer, sourceFile: string): InterviewDataCatalog {
  let workbook: XLSX.WorkBook;
  try {
    workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellText: true, dense: false });
  } catch {
    throw new MultimediaWorkbookError('No fue posible leer el archivo de datos. Verifica que sea un Excel .xlsx válido.');
  }

  const { sheet, sheetName, matrix, headerRowIndex, headers, subjectColumn } = findInterviewSheet(workbook);
  const columns = headers
    .map((name, columnIndex) => ({ columnIndex, name }))
    .filter((column) => column.columnIndex !== subjectColumn && column.name !== '');
  const groups = new Map<string, InterviewDataSubject>();
  let ignoredRows = 0;
  let totalRows = 0;

  for (let matrixIndex = headerRowIndex + 1; matrixIndex < matrix.length; matrixIndex += 1) {
    const row = matrix[matrixIndex] ?? [];
    if (!row.some(meaningful)) continue;
    totalRows += 1;
    const excelRow = matrixIndex + 1;
    const subjectId = formattedCell(sheet, excelRow, subjectColumn, row[subjectColumn]);
    const subjectKey = normalizeSubjectIdKey(subjectId);
    if (!subjectKey) {
      ignoredRows += 1;
      continue;
    }
    const dataRow: InterviewDataRow = {
      excelRow,
      fields: columns.map((column) => ({
        columnIndex: column.columnIndex,
        name: column.name,
        value: formattedCell(sheet, excelRow, column.columnIndex, row[column.columnIndex]),
      })),
    };
    const group = groups.get(subjectKey) ?? { subjectKey, subjectId, rows: [] };
    group.rows.push(dataRow);
    groups.set(subjectKey, group);
  }

  if (groups.size === 0) {
    throw new MultimediaWorkbookError('El archivo de datos no contiene SubjectID para cruzar.');
  }

  return {
    sourceFile,
    sheetName,
    columns,
    groups: [...groups.values()].sort((left, right) => left.subjectId.localeCompare(right.subjectId, 'es', { numeric: true })),
    totalRows,
    ignoredRows,
  };
}
