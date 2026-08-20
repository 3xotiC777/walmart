import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildOutputWorkbook } from './exportWorkbook';
import { generateOrthographyAlerts } from './orthography';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';

describe('Excel de salida', () => {
  it('genera las cuatro hojas requeridas y conserva los identificadores', () => {
    const dataset = makeDataset([
      { codiGo_barras: '00123', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '00123', Descripcion: ' PRODUCTO MARCA ' },
      { codiGo_barras: '00123', Descripcion: 'PRODUCTO MARCAA' },
    ]);
    const validation = validateDataset(dataset, TEST_HIERARCHY, {
      sourceFile: 'facturas.xlsx',
      totalImages: 2,
      urlsByRef: {
        'ID-3': ['https://example.com/factura-1.jpg', 'https://example.com/factura-2.jpg'],
      },
    });
    const orthographyAlerts = generateOrthographyAlerts(dataset);
    const output = buildOutputWorkbook(dataset, validation, new Date('2026-08-18T12:00:00Z'), orthographyAlerts);
    const workbook = XLSX.read(output, { type: 'array' });

    expect(workbook.SheetNames).toEqual(['Resumen', 'Alertas', 'Registros_a_revisar', 'Alertas_Ortografia']);
    const summary = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Resumen, { header: 1 });
    expect(summary.find((row) => row[0] === 'Alertas ortográficas')?.[1]).toBe(2);
    expect(summary[12]).toEqual(['Regla', 'Nombre', 'Estado', 'Registros afectados', 'Alertas', 'Descripción']);
    expect(summary.find((row) => row[0] === 'R01')?.slice(3, 5)).toEqual([3, 1]);
    expect(String(summary.find((row) => row[0] === 'EST-02')?.[5])).toContain('Precio_Total_Preciador');
    expect(String(summary.find((row) => row[0] === 'JER-01')?.[5])).toContain('columna Producto');
    expect(summary.some((row) => row[0] === 'R28')).toBe(true);
    expect(summary.some((row) => row[0] === 'R29')).toBe(true);
    expect(summary.find((row) => row[0] === 'ORT-01')?.slice(1, 5)).toEqual([
      'Ortografía y espacios',
      'Adicional',
      2,
      2,
    ]);
    const alertHeaders = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Alertas, { header: 1 })[0];
    expect(alertHeaders).toContain('Cuartil_1');
    expect(alertHeaders).toContain('Cuartil_3');
    expect(alertHeaders).toContain('Rango_Intercuartil');
    expect(alertHeaders.indexOf('Foto_Factura')).toBe(alertHeaders.indexOf('Limite_Superior') + 1);
    expect(alertHeaders).not.toContain('Promedio');
    expect(alertHeaders).not.toContain('Desviacion_Estandar');
    const alertRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Alertas);
    expect(alertRows[0].Foto_Factura).toBe('https://example.com/factura-1.jpg\nhttps://example.com/factura-2.jpg');
    expect(workbook.Sheets.Alertas.Q2.l?.Target).toBe('https://example.com/factura-1.jpg');
    const orthography = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Alertas_Ortografia);
    expect(orthography).toHaveLength(2);
    expect(orthography[1]).toMatchObject({
      Descripcion: 'PRODUCTO MARCAA',
      'Motivo de Alerta': 'Texto/Ortografía',
      'Descripcion correcta': 'PRODUCTO MARCA',
    });
    const reviewed = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Registros_a_revisar);
    expect(reviewed).toHaveLength(1);
    expect(reviewed[0].codiGo_barras).toBe('00123');
  });
});
