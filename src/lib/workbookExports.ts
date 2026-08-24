import { unzipSync, zipSync } from 'fflate';
import * as XLSX from 'xlsx';

/** A structural equivalent of the application's CellValue type. */
export type WorkbookCellValue = string | number | boolean | Date | null | undefined;

/**
 * Structural input accepted by the suggestion exporter. SourceDataset is
 * assignable to this interface without a conversion step.
 */
export interface WorkbookSourceDataset {
  sourceFile?: string;
  headers: readonly string[];
  outputHeaders?: readonly string[];
  records: readonly {
    excelRow: number;
    values: readonly WorkbookCellValue[];
  }[];
}

export type WorkbookSuggestionConfidence = 'high' | 'medium' | 'low';

export interface WorkbookSuggestion {
  /** One-based row number in the original Excel sheet. */
  excelRow: number;
  /** Original field/header name. */
  field: string;
  /** Optional zero-based column index, used to disambiguate duplicate headers. */
  columnIndex?: number;
  proposedValue: WorkbookCellValue;
  autoApplicable: boolean;
  confidence?: WorkbookSuggestionConfidence;
}

export interface SuggestionsWorkbookOptions {
  sheetName?: string;
  /**
   * Every listed field receives an adjacent `<Campo>_Sugerida` column, even
   * when none of its rows currently has a suggestion.
   */
  evaluatedFields?: readonly string[];
}

/** Fields that can receive an actual row/cell correction in the current rules. */
export const DEFAULT_EVALUATED_FIELDS = [
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

export const NUMERIC_EVALUATED_FIELDS = new Set([
  'Cantidad_Productos',
  'cantidad_comprada',
  'Precio_Unidad',
  'Precio_Total_Preciador',
  'Monto Total Fc',
]);
const TEXT_IDENTIFIER_FIELDS = new Set(['Row-Id', 'Id_Dn W', 'codiGo_barras', 'codiGo_estandar']);

export function coerceWorkbookCorrectionValue(
  value: string,
  original: unknown,
  field: string,
): string | number | boolean {
  if (TEXT_IDENTIFIER_FIELDS.has(field)) return value;
  if (NUMERIC_EVALUATED_FIELDS.has(field)) {
    const numeric = Number(value.trim());
    if (value.trim() === '' || !Number.isFinite(numeric)) {
      throw new Error(`La corrección de ${field} debe ser un número válido.`);
    }
    return numeric;
  }
  if (typeof original === 'number' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  if (typeof original === 'boolean') return value.toLowerCase() === 'true';
  return value;
}

export interface WorkbookCellCorrection {
  /** One-based row number in the target Excel sheet. */
  excelRow: number;
  /** Zero-based column index (A = 0, B = 1, ..., XFD = 16383). */
  columnIndex: number;
  value: WorkbookCellValue;
  /** Defaults to the patcher's sheetName option (`pqm consolidado`). */
  sheetName?: string;
}

export interface PatchWorkbookOptions {
  sheetName?: string;
  /** Mark pivot cache definitions to refresh when Excel opens the result. */
  refreshPivotCaches?: boolean;
  /** Compression level for the output ZIP. The uncompressed entry bytes stay intact. */
  compressionLevel?: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

const DEFAULT_SOURCE_SHEET = 'pqm consolidado';
const MAX_EXCEL_COLUMN_INDEX = 16_383;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8');

function copyToArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function displayHeader(dataset: WorkbookSourceDataset, columnIndex: number): string {
  const original = dataset.headers[columnIndex]?.trim();
  if (original) return original;
  return dataset.outputHeaders?.[columnIndex]?.trim() || `Columna_${columnIndex + 1}`;
}

function validateSuggestionRow(recordRows: ReadonlySet<number>, excelRow: number): void {
  if (!Number.isInteger(excelRow) || excelRow < 2) {
    throw new Error(`Fila de sugerencia inválida: ${excelRow}.`);
  }
  if (!recordRows.has(excelRow)) {
    throw new Error(`La sugerencia apunta a la fila ${excelRow}, que no existe en el conjunto de datos.`);
  }
}

function resolveSuggestionColumn(
  dataset: WorkbookSourceDataset,
  suggestion: WorkbookSuggestion,
): number {
  if (suggestion.columnIndex !== undefined) {
    if (
      !Number.isInteger(suggestion.columnIndex)
      || suggestion.columnIndex < 0
      || suggestion.columnIndex >= dataset.headers.length
    ) {
      throw new Error(`Índice de columna inválido para la fila ${suggestion.excelRow}: ${suggestion.columnIndex}.`);
    }
    return suggestion.columnIndex;
  }

  const originalIndex = dataset.headers.indexOf(suggestion.field);
  if (originalIndex >= 0) return originalIndex;
  const outputIndex = dataset.outputHeaders?.indexOf(suggestion.field) ?? -1;
  if (outputIndex >= 0) return outputIndex;
  throw new Error(`La columna de sugerencia "${suggestion.field}" no existe en el conjunto de datos.`);
}

/**
 * Builds the separate "base con sugerencias" workbook. Original values are
 * never modified and only auto-applicable proposals are populated.
 */
export function buildSuggestionsWorkbook(
  dataset: WorkbookSourceDataset,
  suggestions: readonly WorkbookSuggestion[],
  options: SuggestionsWorkbookOptions = {},
): ArrayBuffer {
  if (dataset.headers.length === 0) {
    throw new Error('No se puede generar la base con sugerencias sin encabezados.');
  }

  const evaluatedFields = new Set(options.evaluatedFields ?? DEFAULT_EVALUATED_FIELDS);
  const evaluatedColumns = new Set<number>();
  dataset.headers.forEach((header, columnIndex) => {
    const outputHeader = dataset.outputHeaders?.[columnIndex];
    if (evaluatedFields.has(header) || (outputHeader !== undefined && evaluatedFields.has(outputHeader))) {
      evaluatedColumns.add(columnIndex);
    }
  });

  const proposalsByCell = new Map<string, WorkbookCellValue>();
  const recordRows = new Set(dataset.records.map((record) => record.excelRow));
  for (const suggestion of suggestions) {
    if (!suggestion.autoApplicable) continue;
    validateSuggestionRow(recordRows, suggestion.excelRow);
    const columnIndex = resolveSuggestionColumn(dataset, suggestion);
    if (!evaluatedColumns.has(columnIndex)) continue;
    const key = `${suggestion.excelRow}:${columnIndex}`;
    if (proposalsByCell.has(key)) {
      throw new Error(`Hay más de una sugerencia automática para la celda de la fila ${suggestion.excelRow}.`);
    }
    proposalsByCell.set(key, suggestion.proposedValue);
  }

  const headerRow: WorkbookCellValue[] = [];
  dataset.headers.forEach((_header, columnIndex) => {
    const header = displayHeader(dataset, columnIndex);
    headerRow.push(header);
    if (evaluatedColumns.has(columnIndex)) headerRow.push(`${header}_Sugerida`);
  });

  const recordByExcelRow = new Map(dataset.records.map((record) => [record.excelRow, record]));
  const maxExcelRow = Math.max(1, ...dataset.records.map((record) => record.excelRow));
  const dataRows = Array.from({ length: Math.max(0, maxExcelRow - 1) }, (_unused, offset) => {
    const record = recordByExcelRow.get(offset + 2);
    if (!record) return Array.from({ length: headerRow.length }, () => null);
    const output: WorkbookCellValue[] = [];
    dataset.headers.forEach((_header, columnIndex) => {
      output.push(record.values[columnIndex] ?? null);
      if (evaluatedColumns.has(columnIndex)) {
        const proposalKey = `${record.excelRow}:${columnIndex}`;
        output.push(proposalsByCell.has(proposalKey) ? proposalsByCell.get(proposalKey) : null);
      }
    });
    return output;
  });

  const sheet = XLSX.utils.aoa_to_sheet([headerRow, ...dataRows], {
    cellDates: true,
    sheetStubs: false,
  });
  if (sheet['!ref']) sheet['!autofilter'] = { ref: sheet['!ref'] };
  sheet['!cols'] = headerRow.map((header, index) => ({
    wch: Math.min(48, Math.max(12, String(header ?? '').length + (index % 2 === 1 ? 1 : 2))),
  }));

  const workbook = XLSX.utils.book_new();
  workbook.Props = {
    Title: 'Base PQM con soluciones sugeridas',
    Subject: 'Propuestas automáticas sin modificar los valores originales',
    Author: 'Validador PQM Walmart',
    Company: 'Dichter & Neira',
  };
  XLSX.utils.book_append_sheet(workbook, sheet, options.sheetName ?? DEFAULT_SOURCE_SHEET);
  const bytes = XLSX.write(workbook, {
    type: 'array',
    bookType: 'xlsx',
    compression: true,
    cellDates: true,
  });
  return bytes instanceof ArrayBuffer ? bytes : copyToArrayBuffer(bytes);
}

function xmlDecode(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#([0-9]+);/g, (_match, decimal: string) => String.fromCodePoint(Number.parseInt(decimal, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r/g, '&#13;');
}

function getXmlAttribute(fragment: string, name: string): string | undefined {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = fragment.match(new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i'));
  return match ? xmlDecode(match[2]) : undefined;
}

function getRelationshipId(sheetTag: string): string | undefined {
  const match = sheetTag.match(/(?:^|\s)(?:r:|[A-Za-z_][\w.-]*:)id\s*=\s*(["'])([\s\S]*?)\1/i);
  return match ? xmlDecode(match[2]) : undefined;
}

function normalizeZipPath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.replace(/\\/g, '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

function directoryName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? '' : path.slice(0, slash);
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash < 0 ? path : path.slice(slash + 1);
}

function resolveRelationshipTarget(ownerPath: string, target: string): string {
  if (target.startsWith('/')) return normalizeZipPath(target.slice(1));
  const ownerDirectory = directoryName(ownerPath);
  return normalizeZipPath(`${ownerDirectory}/${target}`);
}

function relationshipsPath(ownerPath: string): string {
  const ownerDirectory = directoryName(ownerPath);
  return normalizeZipPath(`${ownerDirectory}/_rels/${baseName(ownerPath)}.rels`);
}

function findRelationshipTarget(
  relationshipsXml: string,
  predicate: (relationshipTag: string) => boolean,
): string | undefined {
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const tag = match[0];
    if (predicate(tag)) return getXmlAttribute(tag, 'Target');
  }
  return undefined;
}

function findWorkbookPath(entries: Record<string, Uint8Array>): string {
  const rootRelationships = entries['_rels/.rels'];
  if (rootRelationships) {
    const xml = textDecoder.decode(rootRelationships);
    const target = findRelationshipTarget(xml, (tag) =>
      (getXmlAttribute(tag, 'Type') ?? '').endsWith('/officeDocument'));
    if (target) return normalizeZipPath(target);
  }
  if (entries['xl/workbook.xml']) return 'xl/workbook.xml';
  throw new Error('El archivo no contiene la parte OOXML del libro (workbook.xml).');
}

function mapWorksheetPaths(
  entries: Record<string, Uint8Array>,
  workbookPath: string,
): Map<string, string> {
  const workbookBytes = entries[workbookPath];
  const relationshipBytes = entries[relationshipsPath(workbookPath)];
  if (!workbookBytes || !relationshipBytes) {
    throw new Error('El archivo no contiene las relaciones necesarias para localizar sus hojas.');
  }
  const workbookXml = textDecoder.decode(workbookBytes);
  const relationshipsXml = textDecoder.decode(relationshipBytes);
  const targetsById = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<Relationship\b[^>]*\/?\s*>/gi)) {
    const tag = match[0];
    const id = getXmlAttribute(tag, 'Id');
    const target = getXmlAttribute(tag, 'Target');
    const type = getXmlAttribute(tag, 'Type') ?? '';
    if (id && target && type.endsWith('/worksheet')) {
      targetsById.set(id, resolveRelationshipTarget(workbookPath, target));
    }
  }

  const paths = new Map<string, string>();
  for (const match of workbookXml.matchAll(/<sheet\b[^>]*\/?\s*>/gi)) {
    const tag = match[0];
    const name = getXmlAttribute(tag, 'name');
    const relationshipId = getRelationshipId(tag);
    const target = relationshipId ? targetsById.get(relationshipId) : undefined;
    if (name && target) paths.set(name, target);
  }
  return paths;
}

function setTagAttribute(tag: string, name: string, value: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const attribute = new RegExp(`(\\s${escapedName}\\s*=\\s*)(["'])([\\s\\S]*?)\\2`, 'i');
  if (attribute.test(tag)) return tag.replace(attribute, `$1"${value}"`);
  const closeIndex = tag.lastIndexOf('/>') >= 0 ? tag.lastIndexOf('/>') : tag.lastIndexOf('>');
  return `${tag.slice(0, closeIndex)} ${name}="${value}"${tag.slice(closeIndex)}`;
}

function removeTagAttribute(tag: string, name: string): string {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return tag.replace(new RegExp(`\\s${escapedName}\\s*=\\s*(["'])[\\s\\S]*?\\1`, 'i'), '');
}

function markForFullCalculation(workbookXml: string): string {
  const calcPr = /<calcPr\b[^>]*\/?\s*>/i;
  const existing = workbookXml.match(calcPr)?.[0];
  if (existing) {
    let replacement = setTagAttribute(existing, 'calcMode', 'auto');
    replacement = setTagAttribute(replacement, 'fullCalcOnLoad', '1');
    replacement = setTagAttribute(replacement, 'forceFullCalc', '1');
    return workbookXml.replace(existing, replacement);
  }
  return workbookXml.replace(
    /<\/workbook\s*>/i,
    '<calcPr calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/></workbook>',
  );
}

function markPivotCacheForRefresh(xml: string): string {
  return xml.replace(/<pivotCacheDefinition\b[^>]*>/i, (tag) => {
    let replacement = setTagAttribute(tag, 'refreshOnLoad', '1');
    replacement = setTagAttribute(replacement, 'enableRefresh', '1');
    return replacement;
  });
}

function columnIndexToLetters(columnIndex: number): string {
  let current = columnIndex + 1;
  let result = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

function columnLettersToIndex(address: string): number {
  const letters = address.match(/^[A-Za-z]+/)?.[0].toUpperCase();
  if (!letters) return Number.POSITIVE_INFINITY;
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

function cellCoordinates(address: string): { column: number; row: number } {
  const match = address.toUpperCase().match(/^([A-Z]+)(\d+)$/);
  if (!match) throw new Error(`Dirección de celda OOXML inválida: ${address}.`);
  return { column: columnLettersToIndex(match[1]), row: Number(match[2]) };
}

const FORMULA_REFERENCE = /(^|[^._A-Z0-9])(\$?)([A-Z]{1,3})(\$?)([1-9]\d{0,6})(?![_.(A-Z0-9])/gi;

function shiftSharedFormula(formula: string, masterAddress: string, targetAddress: string): string {
  const master = cellCoordinates(masterAddress);
  const target = cellCoordinates(targetAddress);
  const deltaColumn = target.column - master.column;
  const deltaRow = target.row - master.row;
  // No se desplazan referencias que estén dentro de literales de texto.
  return formula.split(/("(?:[^"]|"")*")/).map((fragment, index) => {
    if (index % 2 === 1) return fragment;
    return fragment.replace(FORMULA_REFERENCE, (
      _match,
      prefix: string,
      absoluteColumn: string,
      column: string,
      absoluteRow: string,
      row: string,
    ) => {
      const shiftedColumn = absoluteColumn
        ? column.toUpperCase()
        : columnIndexToLetters(columnLettersToIndex(column) + deltaColumn);
      const shiftedRow = absoluteRow ? Number(row) : Number(row) + deltaRow;
      if (shiftedRow < 1 || columnLettersToIndex(shiftedColumn) < 0) return `${prefix}#REF!`;
      return `${prefix}${absoluteColumn}${shiftedColumn}${absoluteRow}${shiftedRow}`;
    });
  }).join('');
}

function materializeSharedFormulaMasters(
  sheetXml: string,
  correctedAddresses: ReadonlySet<string>,
): string {
  const masters = new Map<string, { address: string; formula: string }>();
  const sharedByAddress = new Map<string, string>();
  for (const match of sheetXml.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi)) {
    const cellXml = match[0];
    const opening = cellXml.match(/^<c\b[^>]*[>]/i)?.[0] ?? cellXml;
    const address = getXmlAttribute(opening, 'r')?.toUpperCase();
    const formulaTag = cellXml.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/i)?.[0];
    if (!address || !formulaTag || getXmlAttribute(formulaTag, 't') !== 'shared') continue;
    const sharedIndex = getXmlAttribute(formulaTag, 'si');
    if (!sharedIndex) continue;
    sharedByAddress.set(address, sharedIndex);
    const formulaMatch = formulaTag.match(/^<f\b[^>]*>([\s\S]*?)<\/f>$/i);
    if (formulaMatch?.[1]) masters.set(sharedIndex, { address, formula: xmlDecode(formulaMatch[1]) });
  }

  const affected = new Set<string>();
  for (const address of correctedAddresses) {
    const sharedIndex = sharedByAddress.get(address);
    if (sharedIndex && masters.get(sharedIndex)?.address === address) affected.add(sharedIndex);
  }
  if (affected.size === 0) return sheetXml;
  for (const sharedIndex of affected) {
    if (!masters.has(sharedIndex)) {
      throw new Error(`La fórmula compartida ${sharedIndex} no contiene una celda maestra válida.`);
    }
  }

  return sheetXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi, (cellXml) => {
    const opening = cellXml.match(/^<c\b[^>]*[>]/i)?.[0] ?? cellXml;
    const address = getXmlAttribute(opening, 'r')?.toUpperCase();
    const formulaTag = cellXml.match(/<f\b[^>]*(?:\/>|>[\s\S]*?<\/f>)/i)?.[0];
    if (!address || !formulaTag) return cellXml;
    const sharedIndex = getXmlAttribute(formulaTag, 'si');
    if (!sharedIndex || !affected.has(sharedIndex) || correctedAddresses.has(address)) return cellXml;
    const master = masters.get(sharedIndex)!;
    const explicitFormula = shiftSharedFormula(master.formula, master.address, address);
    return cellXml.replace(formulaTag, `<f>${xmlEscape(explicitFormula)}</f>`);
  });
}

function correctionRemovesFormula(sheetXml: string, corrections: readonly WorkbookCellCorrection[]): boolean {
  const addresses = new Set(corrections.map((correction) => correctionAddress(correction)));
  return [...sheetXml.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi)].some((match) => {
    const opening = match[0].match(/^<c\b[^>]*[>]/i)?.[0] ?? match[0];
    const address = getXmlAttribute(opening, 'r')?.toUpperCase();
    return Boolean(address && addresses.has(address) && /<f\b/i.test(match[0]));
  });
}

function validateCorrection(correction: WorkbookCellCorrection): void {
  if (!Number.isInteger(correction.excelRow) || correction.excelRow < 1) {
    throw new Error(`Fila de corrección inválida: ${correction.excelRow}.`);
  }
  if (
    !Number.isInteger(correction.columnIndex)
    || correction.columnIndex < 0
    || correction.columnIndex > MAX_EXCEL_COLUMN_INDEX
  ) {
    throw new Error(`Índice de columna de corrección inválido: ${correction.columnIndex}.`);
  }
  if (typeof correction.value === 'number' && !Number.isFinite(correction.value)) {
    throw new Error('Excel no admite NaN ni valores infinitos como corrección numérica.');
  }
  if (correction.value instanceof Date && Number.isNaN(correction.value.getTime())) {
    throw new Error('La fecha propuesta para la corrección no es válida.');
  }
}

function correctionAddress(correction: WorkbookCellCorrection): string {
  return `${columnIndexToLetters(correction.columnIndex)}${correction.excelRow}`;
}

function serializeCorrection(value: WorkbookCellValue): { type?: string; inner: string } {
  if (value === null || value === undefined) return { inner: '' };
  if (typeof value === 'string') {
    return {
      type: 'inlineStr',
      inner: `<is><t xml:space="preserve">${xmlEscape(value)}</t></is>`,
    };
  }
  if (typeof value === 'number') return { inner: `<v>${String(value)}</v>` };
  if (typeof value === 'boolean') return { type: 'b', inner: `<v>${value ? '1' : '0'}</v>` };
  return { type: 'd', inner: `<v>${xmlEscape(value.toISOString())}</v>` };
}

function renderCell(
  address: string,
  value: WorkbookCellValue,
  existingCell?: string,
): string {
  const opening = existingCell?.match(/^<c\b[^>]*>/i)?.[0]
    ?? existingCell?.match(/^<c\b[^>]*\/>/i)?.[0]
    ?? `<c r="${address}">`;
  let normalizedOpening = opening.replace(/\/>\s*$/, '>');
  normalizedOpening = removeTagAttribute(normalizedOpening, 't');
  const serialized = serializeCorrection(value);
  if (serialized.type) normalizedOpening = setTagAttribute(normalizedOpening, 't', serialized.type);
  if (!serialized.inner) return `${normalizedOpening.slice(0, -1)}/>`;
  return `${normalizedOpening}${serialized.inner}</c>`;
}

function insertCellIntoRow(rowXml: string, address: string, cellXml: string): string {
  if (/\/>\s*$/.test(rowXml)) {
    const opening = rowXml.replace(/\/>\s*$/, '>');
    return `${opening}${cellXml}</row>`;
  }
  const openingEnd = rowXml.indexOf('>') + 1;
  const closingStart = rowXml.lastIndexOf('</row>');
  const opening = rowXml.slice(0, openingEnd);
  let body = rowXml.slice(openingEnd, closingStart);
  const targetColumn = columnLettersToIndex(address);
  let insertionIndex = body.length;
  for (const match of body.matchAll(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi)) {
    const existingAddress = getXmlAttribute(match[0].match(/^<c\b[^>]*[>]/i)?.[0] ?? match[0], 'r');
    if (existingAddress && columnLettersToIndex(existingAddress) > targetColumn) {
      insertionIndex = match.index ?? body.length;
      break;
    }
  }
  body = `${body.slice(0, insertionIndex)}${cellXml}${body.slice(insertionIndex)}`;
  return `${opening}${body}${rowXml.slice(closingStart)}`;
}

function insertMissingRows(
  sheetXml: string,
  rows: ReadonlyMap<number, readonly { address: string; correction: WorkbookCellCorrection }[]>,
): string {
  if (rows.size === 0) return sheetXml;
  const newRows = [...rows.entries()]
    .sort(([left], [right]) => left - right)
    .map(([rowNumber, corrections]) => {
      const cells = [...corrections]
        .sort((left, right) => left.correction.columnIndex - right.correction.columnIndex)
        .map(({ address, correction }) => renderCell(address, correction.value))
        .join('');
      return { rowNumber, xml: `<row r="${rowNumber}">${cells}</row>` };
    });

  const sheetDataMatch = sheetXml.match(/<sheetData\b[^>]*\/>|<sheetData\b[^>]*>[\s\S]*?<\/sheetData>/i)?.[0];
  if (!sheetDataMatch) throw new Error('La hoja OOXML no contiene el elemento sheetData.');
  if (/\/>\s*$/.test(sheetDataMatch)) {
    const opening = sheetDataMatch.replace(/\/>\s*$/, '>');
    return sheetXml.replace(sheetDataMatch, `${opening}${newRows.map((row) => row.xml).join('')}</sheetData>`);
  }

  const openingEnd = sheetDataMatch.indexOf('>') + 1;
  const closingStart = sheetDataMatch.lastIndexOf('</sheetData>');
  let body = sheetDataMatch.slice(openingEnd, closingStart);
  for (const newRow of newRows) {
    let insertionIndex = body.length;
    for (const match of body.matchAll(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/gi)) {
      const opening = match[0].match(/^<row\b[^>]*[>]/i)?.[0] ?? match[0];
      const rowNumber = Number(getXmlAttribute(opening, 'r'));
      if (Number.isFinite(rowNumber) && rowNumber > newRow.rowNumber) {
        insertionIndex = match.index ?? body.length;
        break;
      }
    }
    body = `${body.slice(0, insertionIndex)}${newRow.xml}${body.slice(insertionIndex)}`;
  }
  const replacement = `${sheetDataMatch.slice(0, openingEnd)}${body}${sheetDataMatch.slice(closingStart)}`;
  return sheetXml.replace(sheetDataMatch, replacement);
}

function patchWorksheetXml(
  sheetXml: string,
  corrections: readonly WorkbookCellCorrection[],
): string {
  const pending = new Map<string, WorkbookCellCorrection>();
  for (const correction of corrections) {
    const address = correctionAddress(correction);
    if (pending.has(address)) throw new Error(`Hay más de una corrección para la celda ${address}.`);
    pending.set(address, correction);
  }

  sheetXml = materializeSharedFormulaMasters(sheetXml, new Set(pending.keys()));

  let patched = sheetXml.replace(/<c\b[^>]*(?:\/>|>[\s\S]*?<\/c>)/gi, (cellXml) => {
    const opening = cellXml.match(/^<c\b[^>]*[>]/i)?.[0] ?? cellXml;
    const address = getXmlAttribute(opening, 'r')?.toUpperCase();
    if (!address) return cellXml;
    const correction = pending.get(address);
    if (!correction) return cellXml;
    pending.delete(address);
    return renderCell(address, correction.value, cellXml);
  });

  const pendingByRow = new Map<number, Array<{ address: string; correction: WorkbookCellCorrection }>>();
  for (const [address, correction] of pending) {
    const row = pendingByRow.get(correction.excelRow) ?? [];
    row.push({ address, correction });
    pendingByRow.set(correction.excelRow, row);
  }

  patched = patched.replace(/<row\b[^>]*(?:\/>|>[\s\S]*?<\/row>)/gi, (rowXml) => {
    const opening = rowXml.match(/^<row\b[^>]*[>]/i)?.[0] ?? rowXml;
    const rowNumber = Number(getXmlAttribute(opening, 'r'));
    const rowCorrections = pendingByRow.get(rowNumber);
    if (!rowCorrections) return rowXml;
    let result = rowXml;
    for (const { address, correction } of rowCorrections.sort(
      (left, right) => left.correction.columnIndex - right.correction.columnIndex,
    )) {
      result = insertCellIntoRow(result, address, renderCell(address, correction.value));
    }
    pendingByRow.delete(rowNumber);
    return result;
  });

  return insertMissingRows(patched, pendingByRow);
}

function removeCalculationChain(entries: Record<string, Uint8Array>, workbookPath: string): void {
  for (const entryPath of Object.keys(entries)) {
    if (/(^|\/)calcChain\.xml$/i.test(entryPath)) delete entries[entryPath];
  }
  const workbookRelationshipsPath = relationshipsPath(workbookPath);
  if (entries[workbookRelationshipsPath]) {
    const relationshipsXml = textDecoder.decode(entries[workbookRelationshipsPath]);
    entries[workbookRelationshipsPath] = textEncoder.encode(
      relationshipsXml.replace(/<Relationship\b[^>]*(?:\/>|>[\s\S]*?<\/Relationship>)/gi, (tag) => {
        const type = getXmlAttribute(tag, 'Type') ?? '';
        const target = getXmlAttribute(tag, 'Target') ?? '';
        return type.endsWith('/calcChain') || /(^|\/)calcChain\.xml$/i.test(target) ? '' : tag;
      }),
    );
  }
  const contentTypesPath = Object.keys(entries).find((entryPath) => entryPath.toLowerCase() === '[content_types].xml');
  if (contentTypesPath) {
    const contentTypesXml = textDecoder.decode(entries[contentTypesPath]);
    entries[contentTypesPath] = textEncoder.encode(
      contentTypesXml.replace(/<Override\b[^>]*(?:\/>|>[\s\S]*?<\/Override>)/gi, (tag) => {
        const partName = getXmlAttribute(tag, 'PartName') ?? '';
        return /(^|\/)calcChain\.xml$/i.test(partName) ? '' : tag;
      }),
    );
  }
}

/**
 * Applies sparse corrections directly to worksheet XML. All ZIP entries remain
 * present; unrelated sheets, formulas, styles, pivot records and binary parts
 * retain their exact uncompressed bytes.
 */
export function patchOriginalWorkbook(
  originalWorkbook: ArrayBuffer | Uint8Array,
  corrections: readonly WorkbookCellCorrection[],
  options: PatchWorkbookOptions = {},
): ArrayBuffer {
  corrections.forEach(validateCorrection);
  const input = originalWorkbook instanceof Uint8Array
    ? originalWorkbook
    : new Uint8Array(originalWorkbook);
  if (corrections.length === 0) return copyToArrayBuffer(input);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(input);
  } catch {
    throw new Error('No fue posible abrir el contenedor OOXML. Verifica que el archivo sea un .xlsx válido.');
  }

  const workbookPath = findWorkbookPath(entries);
  const worksheetPaths = mapWorksheetPaths(entries, workbookPath);
  const sheetCorrections = new Map<string, WorkbookCellCorrection[]>();
  const correctedCells = new Set<string>();
  let removedFormula = false;
  for (const correction of corrections) {
    const sheetName = correction.sheetName ?? options.sheetName ?? DEFAULT_SOURCE_SHEET;
    const correctedCell = `${sheetName.toLocaleUpperCase()}:${correctionAddress(correction)}`;
    if (correctedCells.has(correctedCell)) {
      throw new Error(`Hay más de una corrección para la celda ${correctionAddress(correction)}.`);
    }
    correctedCells.add(correctedCell);
    const grouped = sheetCorrections.get(sheetName) ?? [];
    grouped.push(correction);
    sheetCorrections.set(sheetName, grouped);
  }

  for (const [requestedSheet, groupedCorrections] of sheetCorrections) {
    const actualSheet = [...worksheetPaths.keys()].find(
      (name) => name.localeCompare(requestedSheet, undefined, { sensitivity: 'accent' }) === 0,
    );
    const sheetPath = actualSheet ? worksheetPaths.get(actualSheet) : undefined;
    if (!sheetPath || !entries[sheetPath]) {
      throw new Error(`No se encontró la hoja "${requestedSheet}" dentro del archivo original.`);
    }
    const originalXml = textDecoder.decode(entries[sheetPath]);
    removedFormula ||= correctionRemovesFormula(originalXml, groupedCorrections);
    entries[sheetPath] = textEncoder.encode(patchWorksheetXml(originalXml, groupedCorrections));
  }

  if (removedFormula) removeCalculationChain(entries, workbookPath);

  entries[workbookPath] = textEncoder.encode(
    markForFullCalculation(textDecoder.decode(entries[workbookPath])),
  );
  if (options.refreshPivotCaches !== false) {
    for (const [entryPath, entryBytes] of Object.entries(entries)) {
      if (/^xl\/pivotCache\/pivotCacheDefinition[^/]*\.xml$/i.test(entryPath)) {
        entries[entryPath] = textEncoder.encode(markPivotCacheForRefresh(textDecoder.decode(entryBytes)));
      }
    }
  }

  const zipped = zipSync(entries, { level: options.compressionLevel ?? 6 });
  return copyToArrayBuffer(zipped);
}

function utcTimestamp(date: Date): string {
  if (Number.isNaN(date.getTime())) throw new Error('La fecha usada en el nombre del archivo no es válida.');
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}`;
}

export function buildDraftWorkbookFileName(generatedAt = new Date()): string {
  return `PQM_Borrador_${utcTimestamp(generatedAt)}.xlsx`;
}

export function buildFinalWorkbookFileName(generatedAt = new Date()): string {
  return `PQM_Final_${utcTimestamp(generatedAt)}.xlsx`;
}

export function buildCorrectedWorkbookFileName(
  pendingItems: number,
  generatedAt = new Date(),
): string {
  if (!Number.isInteger(pendingItems) || pendingItems < 0) {
    throw new Error('La cantidad de pendientes debe ser un entero mayor o igual a cero.');
  }
  return pendingItems === 0
    ? buildFinalWorkbookFileName(generatedAt)
    : buildDraftWorkbookFileName(generatedAt);
}
