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
    expect(alertHeaders).toContain('Promedio_Combinacion');
    expect(alertHeaders).toContain('Umbral_15_Por_Ciento');
    expect(alertHeaders).toContain('Porcentaje_Diferencia_Promedio');
    expect(alertHeaders.indexOf('Foto_Factura')).toBe(alertHeaders.indexOf('Porcentaje_Diferencia_Promedio') + 1);
    expect(alertHeaders).not.toContain('Cuartil_1');
    expect(alertHeaders).not.toContain('Limite_Superior');
    const alertRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Alertas);
    expect(alertRows[0].Foto_Factura).toBe('https://example.com/factura-1.jpg\nhttps://example.com/factura-2.jpg');
    expect(workbook.Sheets.Alertas.P2.l?.Target).toBe('https://example.com/factura-1.jpg');
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

  it('exporta el porcentaje de diferencia de R25 como valor porcentual ordenable', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'P1', Descripcion: 'PRODUCTO MARCA', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'PRODUCTO MARCA', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'PRODUCTO MARCA', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'PRODUCTO MARCA', Precio_Unidad: 100 },
    ]);
    const validation = validateDataset(dataset, TEST_HIERARCHY);
    const output = buildOutputWorkbook(dataset, validation);
    const workbook = XLSX.read(output, { type: 'array', cellNF: true });
    const alertRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Alertas);
    const priceAlert = alertRows.find((row) => row.Regla === 'R25');

    expect(priceAlert).toMatchObject({
      Promedio_Combinacion: 32.5,
      Umbral_15_Por_Ciento: 37.375,
    });
    expect(priceAlert?.Porcentaje_Diferencia_Promedio).toBeCloseTo(67.5 / 32.5);
    const priceAlertIndex = alertRows.findIndex((row) => row.Regla === 'R25');
    expect(workbook.Sheets.Alertas[XLSX.utils.encode_cell({ r: priceAlertIndex + 1, c: 14 })].z).toBe('0.00%');
  });
});
