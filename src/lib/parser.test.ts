import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseInvoiceWorkbook, parseWorkbook, WorkbookValidationError } from './parser';
import { TEST_HEADERS } from './testHelpers';

function workbookBuffer(sheetName = 'pqm consolidado') {
  const row = TEST_HEADERS.map((header) => {
    if (header === 'codiGo_barras') return '00123';
    if (header === 'Row-Id') return 'ROW-1';
    if (header === 'Id_Dn W') return 'ID-1';
    if (['Cantidad_Productos', 'cantidad_comprada', 'Precio_Unidad', 'Precio_Total_Preciador', 'Monto Total Fc'].includes(header)) return 1;
    return 'VALOR';
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([TEST_HEADERS, row]), sheetName);
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

function invoiceWorkbookBuffer(headers = ['RefID_STG', 'URL_DN']) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    headers,
    ['ID-1', 'https://example.com/factura-1.jpg'],
    [' id-1 ', 'https://example.com/factura-1.jpg'],
    ['ID-1', 'https://example.com/factura-2.jpg'],
    ['ID-2', 'no-es-una-url'],
  ]), 'Data');
  return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('lector de libros', () => {
  it('lee la hoja requerida y preserva códigos como texto', () => {
    const dataset = parseWorkbook(workbookBuffer(), 'entrada.xlsx');

    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0].fields.codiGo_barras).toBe('00123');
  });

  it('rechaza archivos sin la hoja requerida', () => {
    expect(() => parseWorkbook(workbookBuffer('Otra hoja'), 'entrada.xlsx')).toThrow(WorkbookValidationError);
  });

  it('agrupa y deduplica las facturas por RefID_STG', () => {
    const invoices = parseInvoiceWorkbook(invoiceWorkbookBuffer(), 'facturas.xlsx');

    expect(invoices.urlsByRef['ID-1']).toEqual([
      'https://example.com/factura-1.jpg',
      'https://example.com/factura-2.jpg',
    ]);
    expect(invoices.urlsByRef['ID-2']).toBeUndefined();
    expect(invoices.totalImages).toBe(2);
  });

  it('rechaza un archivo de facturas sin URL_DN', () => {
    expect(() => parseInvoiceWorkbook(invoiceWorkbookBuffer(['RefID_STG', 'Otra']), 'facturas.xlsx'))
      .toThrow('URL_DN');
  });
});

