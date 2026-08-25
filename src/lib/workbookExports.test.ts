import { unzipSync, zipSync } from 'fflate';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import {
  buildCorrectedWorkbookFileName,
  buildDraftWorkbookFileName,
  buildFinalWorkbookFileName,
  buildSuggestionsWorkbook,
  coerceWorkbookCorrectionValue,
  patchOriginalWorkbook,
  type WorkbookSourceDataset,
} from './workbookExports';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function asArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

function syntheticXlsx(): { bytes: ArrayBuffer; entries: Record<string, Uint8Array> } {
  const entries: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    ),
    '_rels/.rels': encoder.encode(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>',
    ),
    'xl/workbook.xml': encoder.encode(
      '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
      + 'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="pqm consolidado" sheetId="1" r:id="rId1"/>'
      + '<sheet name="TD" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029"/></workbook>',
    ),
    'xl/_rels/workbook.xml.rels': encoder.encode(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Id="rId1"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
      + '</Relationships>',
    ),
    'xl/worksheets/sheet1.xml': encoder.encode(
      '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
      + '<row r="1"><c r="A1" t="inlineStr"><is><t>codiGo_barras</t></is></c></row>'
      + '<row r="2"><c r="A2" t="inlineStr"><is><t>00123</t></is></c>'
      + '<c r="B2" s="2"><f>1+1</f><v>2</v></c>'
      + '<c r="C2" s="3"><f>B2*2</f><v>4</v></c></row>'
      + '</sheetData></worksheet>',
    ),
    'xl/worksheets/sheet2.xml': encoder.encode(
      '<?xml version="1.0"?><worksheet><sheetData><row r="1"><c r="A1"><f>SUM(1,2)</f><v>3</v></c></row></sheetData></worksheet>',
    ),
    'xl/styles.xml': encoder.encode('<styleSheet><cellXfs count="4"/></styleSheet>'),
    'xl/pivotCache/pivotCacheDefinition1.xml': encoder.encode(
      '<pivotCacheDefinition refreshOnLoad="0" recordCount="2"><cacheSource/></pivotCacheDefinition>',
    ),
    'xl/pivotCache/pivotCacheRecords1.xml': encoder.encode(
      '<pivotCacheRecords count="2"><r><s v="UNO"/></r><r><s v="DOS"/></r></pivotCacheRecords>',
    ),
    'xl/media/image1.png': new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]),
  };
  return { bytes: asArrayBuffer(zipSync(entries)), entries };
}

function sharedFormulaXlsx(): ArrayBuffer {
  const source = syntheticXlsx();
  const entries = { ...source.entries };
  entries['[Content_Types].xml'] = encoder.encode(
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Override PartName="/xl/calcChain.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.calcChain+xml"/>'
    + '</Types>',
  );
  entries['xl/_rels/workbook.xml.rels'] = encoder.encode(
    decoder.decode(entries['xl/_rels/workbook.xml.rels']).replace(
      '</Relationships>',
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/calcChain" Target="calcChain.xml"/></Relationships>',
    ),
  );
  entries['xl/worksheets/sheet1.xml'] = encoder.encode(
    decoder.decode(entries['xl/worksheets/sheet1.xml']).replace(
      '</sheetData>',
      '<row r="3"><c r="A3"><v>3</v></c><c r="B3"><f t="shared" ref="B3:B5" si="7">A3*2</f><v>6</v></c></row>'
      + '<row r="4"><c r="A4"><v>4</v></c><c r="B4"><f t="shared" si="7"/><v>8</v></c></row>'
      + '<row r="5"><c r="A5"><v>5</v></c><c r="B5"><f t="shared" si="7"/><v>10</v></c></row>'
      + '</sheetData>',
    ),
  );
  entries['xl/calcChain.xml'] = encoder.encode(
    '<?xml version="1.0"?><calcChain xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><c r="B3" i="1"/><c r="B4"/><c r="B5"/></calcChain>',
  );
  return asArrayBuffer(zipSync(entries));
}

function traceabilityXlsx(): { bytes: ArrayBuffer; entries: Record<string, Uint8Array> } {
  const source = syntheticXlsx();
  const entries = { ...source.entries };
  entries['xl/workbook.xml'] = encoder.encode(
    decoder.decode(entries['xl/workbook.xml']).replace(
      '<calcPr',
      '<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;pqm consolidado&apos;!$A$1:$C$2</definedName></definedNames><calcPr',
    ),
  );
  let sheet = decoder.decode(entries['xl/worksheets/sheet1.xml']);
  sheet = sheet.replace(
    '<sheetData>',
    '<dimension ref="A1:C2"/><cols><col min="4" max="4" width="0" style="17" hidden="1" customWidth="1"/></cols><sheetData>',
  );
  sheet = sheet.replace(
    '<row r="1"><c r="A1"',
    '<row r="1" spans="1:3"><c r="A1"',
  ).replace(
    '</is></c></row><row r="2">',
    '</is></c><c r="C1" s="16" t="inlineStr"><is><t>Notas</t></is></c></row><row r="2" spans="1:3">',
  ).replace(
    '</sheetData></worksheet>',
    '</sheetData><autoFilter ref="A1:C2"/></worksheet>',
  );
  entries['xl/worksheets/sheet1.xml'] = encoder.encode(sheet);
  return { bytes: asArrayBuffer(zipSync(entries)), entries };
}

describe('base con sugerencias', () => {
  it('inserta columnas adyacentes, conserva originales y omite propuestas no automáticas', () => {
    const dataset: WorkbookSourceDataset = {
      sourceFile: 'panel.xlsx',
      headers: ['Row-Id', 'codiGo_barras', 'Categoria_Wm', 'Precio_Unidad', 'Notas'],
      outputHeaders: ['Row-Id', 'codiGo_barras', 'Categoria_Wm', 'Precio_Unidad', 'Notas'],
      records: [
        { excelRow: 2, values: ['ROW-1', '00123', 'CATEGORIA INCORRECTA', 10_000, 'A'] },
        { excelRow: 3, values: ['ROW-2', '00007', 'OTRA', 2_000, 'B'] },
      ],
    };
    const output = buildSuggestionsWorkbook(dataset, [
      {
        excelRow: 2,
        field: 'Categoria_Wm',
        proposedValue: 'CATEGORIA CORRECTA',
        autoApplicable: true,
        confidence: 'high',
      },
      {
        excelRow: 2,
        field: 'Precio_Unidad',
        proposedValue: 2_000,
        autoApplicable: false,
        confidence: 'medium',
      },
      {
        excelRow: 3,
        field: 'Precio_Unidad',
        proposedValue: 1_900,
        autoApplicable: true,
        confidence: 'high',
      },
    ], { evaluatedFields: ['Categoria_Wm', 'Precio_Unidad'] });

    const workbook = XLSX.read(output, { type: 'array' });
    expect(workbook.SheetNames).toEqual(['pqm consolidado']);
    const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(
      workbook.Sheets['pqm consolidado'],
      { header: 1, raw: true, defval: null },
    );
    expect(rows[0]).toEqual([
      'Row-Id',
      'codiGo_barras',
      'Categoria_Wm',
      'Categoria_Wm_Sugerida',
      'Precio_Unidad',
      'Precio_Unidad_Sugerida',
      'Notas',
    ]);
    expect(rows[1]).toEqual([
      'ROW-1',
      '00123',
      'CATEGORIA INCORRECTA',
      'CATEGORIA CORRECTA',
      10_000,
      null,
      'A',
    ]);
    expect(rows[2]).toEqual(['ROW-2', '00007', 'OTRA', null, 2_000, 1_900, 'B']);
    expect(workbook.Sheets['pqm consolidado'].B2.t).toBe('s');
    expect(workbook.Sheets['pqm consolidado'].B2.v).toBe('00123');
  });

  it('conserva las filas vacías intermedias y agrega sugeridas para identificadores evaluados', () => {
    const dataset: WorkbookSourceDataset = {
      headers: ['Row-Id', 'Id_Dn W', 'Descripcion'],
      outputHeaders: ['Row-Id', 'Id_Dn W', 'Descripcion'],
      records: [
        { excelRow: 2, values: ['ROW-1', 'ID-1', 'UNO'] },
        { excelRow: 4, values: ['ROW-2', 'ID-2', 'DOS'] },
      ],
    };
    const workbook = XLSX.read(buildSuggestionsWorkbook(dataset, []), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<Array<string | null>>(
      workbook.Sheets['pqm consolidado'],
      { header: 1, raw: true, defval: null, blankrows: true },
    );

    expect(rows[0]).toEqual([
      'Row-Id', 'Row-Id_Sugerida', 'Id_Dn W', 'Id_Dn W_Sugerida', 'Descripcion', 'Descripcion_Sugerida',
    ]);
    expect(rows[2]).toEqual([null, null, null, null, null, null]);
    expect(rows[3]).toEqual(['ROW-2', null, 'ID-2', null, 'DOS', null]);
  });
});

describe('parche OOXML del libro original', () => {
  it('convierte una corrección EST-02 a número aunque la celda original fuera texto o vacía', () => {
    expect(coerceWorkbookCorrectionValue('20.5', 'NO NUMÉRICO', 'Precio_Unidad')).toBe(20.5);
    expect(coerceWorkbookCorrectionValue('00123', 123, 'codiGo_barras')).toBe('00123');
    expect(() => coerceWorkbookCorrectionValue('abc', '', 'Precio_Total_Preciador')).toThrow(/número válido/i);
  });

  it('cambia solo celdas objetivo, quita su fórmula y conserva estilos, hojas y pivots', () => {
    const source = syntheticXlsx();
    const output = patchOriginalWorkbook(source.bytes, [
      { excelRow: 2, columnIndex: 0, value: '00077' },
      { excelRow: 2, columnIndex: 1, value: 9 },
      { excelRow: 2, columnIndex: 3, value: 'NUEVO & CORRECTO' },
    ]);
    const patched = unzipSync(new Uint8Array(output));

    expect(Object.keys(patched).sort()).toEqual(Object.keys(source.entries).sort());
    expect(patched['xl/styles.xml']).toEqual(source.entries['xl/styles.xml']);
    expect(patched['xl/worksheets/sheet2.xml']).toEqual(source.entries['xl/worksheets/sheet2.xml']);
    expect(patched['xl/pivotCache/pivotCacheRecords1.xml']).toEqual(
      source.entries['xl/pivotCache/pivotCacheRecords1.xml'],
    );
    expect(patched['xl/media/image1.png']).toEqual(source.entries['xl/media/image1.png']);

    const sheet = decoder.decode(patched['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">00077</t></is></c>');
    expect(sheet).toContain('<c r="B2" s="2"><v>9</v></c>');
    expect(sheet).not.toContain('<f>1+1</f>');
    expect(sheet).toContain('<c r="C2" s="3"><f>B2*2</f><v>4</v></c>');
    expect(sheet).toContain('<c r="D2" t="inlineStr"><is><t xml:space="preserve">NUEVO &amp; CORRECTO</t></is></c>');

    const workbook = decoder.decode(patched['xl/workbook.xml']);
    expect(workbook).toMatch(/<calcPr\b[^>]*calcMode="auto"/);
    expect(workbook).toMatch(/<calcPr\b[^>]*fullCalcOnLoad="1"/);
    expect(workbook).toMatch(/<calcPr\b[^>]*forceFullCalc="1"/);
    const pivotDefinition = decoder.decode(patched['xl/pivotCache/pivotCacheDefinition1.xml']);
    expect(pivotDefinition).toMatch(/refreshOnLoad="1"/);
    expect(pivotDefinition).toMatch(/enableRefresh="1"/);
    expect(pivotDefinition).toContain('recordCount="2"');
  });

  it('rechaza dos correcciones sobre la misma celda', () => {
    const source = syntheticXlsx();
    expect(() => patchOriginalWorkbook(source.bytes, [
      { excelRow: 2, columnIndex: 0, value: 'A' },
      { excelRow: 2, columnIndex: 0, value: 'B' },
    ])).toThrow(/más de una corrección.*A2/i);
  });

  it('retira calcChain completo cuando reemplaza una fórmula dependiente', () => {
    const patched = unzipSync(new Uint8Array(patchOriginalWorkbook(sharedFormulaXlsx(), [
      { excelRow: 4, columnIndex: 1, value: 99 },
    ])));

    expect(patched['xl/calcChain.xml']).toBeUndefined();
    expect(decoder.decode(patched['xl/_rels/workbook.xml.rels'])).not.toContain('calcChain');
    expect(decoder.decode(patched['[Content_Types].xml'])).not.toContain('calcChain');
    const sheet = decoder.decode(patched['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<c r="B3"><f t="shared" ref="B3:B5" si="7">A3*2</f><v>6</v></c>');
    expect(sheet).toContain('<c r="B4"><v>99</v></c>');
  });

  it('materializa los dependientes si la corrección reemplaza el maestro compartido', () => {
    const patched = unzipSync(new Uint8Array(patchOriginalWorkbook(sharedFormulaXlsx(), [
      { excelRow: 3, columnIndex: 1, value: 77 },
    ])));
    const sheet = decoder.decode(patched['xl/worksheets/sheet1.xml']);

    expect(sheet).toContain('<c r="B3"><v>77</v></c>');
    expect(sheet).toContain('<c r="B4"><f>A4*2</f><v>8</v></c>');
    expect(sheet).toContain('<c r="B5"><f>A5*2</f><v>10</v></c>');
    expect(sheet).not.toContain('si="7"');
  });

  it('anexa una columna visible de trazabilidad sin ampliar los orígenes de pivots', () => {
    const source = traceabilityXlsx();
    const patched = unzipSync(new Uint8Array(patchOriginalWorkbook(source.bytes, [
      { excelRow: 2, columnIndex: 0, value: '00999' },
    ], {
      appendedColumn: {
        columnIndex: 3,
        header: 'Trazabilidad_de_cambios',
        values: [{ excelRow: 2, value: 'Categoria_Wm → Diego | Marca_Wm → Mayumi' }],
        width: 42,
      },
    })));

    const sheet = decoder.decode(patched['xl/worksheets/sheet1.xml']);
    expect(sheet).toContain('<dimension ref="A1:D2"/>');
    expect(sheet).toMatch(/<col\b[^>]*min="4"[^>]*max="4"[^>]*width="42"[^>]*\/>/);
    expect(sheet).not.toMatch(/<col\b[^>]*min="4"[^>]*hidden="1"/);
    expect(sheet).toContain('<row r="1" spans="1:4">');
    expect(sheet).toContain('<row r="2" spans="1:4">');
    expect(sheet).toContain('<c r="D1" s="16" t="inlineStr"><is><t xml:space="preserve">Trazabilidad_de_cambios</t></is></c>');
    expect(sheet).toContain('<c r="D2" s="3" t="inlineStr"><is><t xml:space="preserve">Categoria_Wm → Diego | Marca_Wm → Mayumi</t></is></c>');
    expect(sheet).toContain('<autoFilter ref="A1:D2"/>');

    const workbook = decoder.decode(patched['xl/workbook.xml']);
    expect(workbook).toContain("'pqm consolidado'!$A$1:$D$2");
    expect(patched['xl/pivotCache/pivotCacheRecords1.xml']).toEqual(
      source.entries['xl/pivotCache/pivotCacheRecords1.xml'],
    );
    expect(patched['xl/worksheets/sheet2.xml']).toEqual(source.entries['xl/worksheets/sheet2.xml']);
  });

  it('devuelve una copia idéntica cuando no existen cambios aceptados', () => {
    const source = syntheticXlsx();
    expect(new Uint8Array(patchOriginalWorkbook(source.bytes, []))).toEqual(new Uint8Array(source.bytes));
  });
});

describe('nombres del Excel corregido', () => {
  const generatedAt = new Date('2026-08-24T13:05:00.000Z');

  it('distingue claramente borrador y archivo final', () => {
    expect(buildDraftWorkbookFileName(generatedAt)).toBe('PQM_Borrador_20260824_1305.xlsx');
    expect(buildFinalWorkbookFileName(generatedAt)).toBe('PQM_Final_20260824_1305.xlsx');
    expect(buildCorrectedWorkbookFileName(7, generatedAt)).toBe('PQM_Borrador_20260824_1305.xlsx');
    expect(buildCorrectedWorkbookFileName(0, generatedAt)).toBe('PQM_Final_20260824_1305.xlsx');
  });
});
