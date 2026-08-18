import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildOutputWorkbook } from './exportWorkbook';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';

describe('Excel de salida', () => {
  it('genera las tres hojas requeridas y conserva los identificadores', () => {
    const dataset = makeDataset([
      { codiGo_barras: '00123', Descripcion: 'PRODUCTO MARCA' },
      { codiGo_barras: '00123', Descripcion: 'OTRO PRODUCTO MARCA' },
    ]);
    const validation = validateDataset(dataset, TEST_HIERARCHY);
    const output = buildOutputWorkbook(dataset, validation, new Date('2026-08-18T12:00:00Z'));
    const workbook = XLSX.read(output, { type: 'array' });

    expect(workbook.SheetNames).toEqual(['Resumen', 'Alertas', 'Registros_a_revisar']);
    const summary = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Resumen, { header: 1 });
    expect(summary[11]).toEqual(['Regla', 'Nombre', 'Estado', 'Registros afectados', 'Descripción']);
    const alertHeaders = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.Alertas, { header: 1 })[0];
    expect(alertHeaders).toContain('Cuartil_1');
    expect(alertHeaders).toContain('Cuartil_3');
    expect(alertHeaders).toContain('Rango_Intercuartil');
    expect(alertHeaders).not.toContain('Promedio');
    expect(alertHeaders).not.toContain('Desviacion_Estandar');
    const reviewed = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets.Registros_a_revisar);
    expect(reviewed[0].codiGo_barras).toBe('00123');
  });
});
