import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildAutomaticDescriptionWorkbook, suggestedDescription } from './automatic-description';
import { makeDataset } from './testHelpers';

describe('descripción automática', () => {
  it('concatena categoría, marca y gramaje con unidad abreviada sin separar la pareja', () => {
    const [record] = makeDataset([{ Categoria_Wm: 'BEBIDAS', Marca_Wm: 'FONTANA', Gramaje: 1, unidad_de_Medida: 'LITROS' }]).records;
    expect(suggestedDescription(record)).toBe('BEBIDAS FONTANA 1L');
  });

  it('omite valores no especificados y no publica medio par de gramaje/unidad', () => {
    const records = makeDataset([
      { Categoria_Wm: 'ALIMENTOS', Marca_Wm: 'NO IDENTIFICABLE', Gramaje: 500, unidad_de_Medida: 'GRAMOS' },
      { Categoria_Wm: 'ALIMENTOS', Marca_Wm: 'ACME', Gramaje: 'NO ESPECIFICA', unidad_de_Medida: 'UNIDADES' },
      { Categoria_Wm: '', Marca_Wm: 'ACME', Gramaje: 2, unidad_de_Medida: '' },
    ]).records;
    expect(records.map(suggestedDescription)).toEqual(['ALIMENTOS 500GR', 'ALIMENTOS ACME', 'ACME']);
  });

  it('genera todas las columnas originales y una columna sugerida junto a Descripcion', () => {
    const dataset = makeDataset([{ Categoria_Wm: 'FRUTAS', Marca_Wm: 'ACME', Gramaje: 2, unidad_de_Medida: 'UNIDADES' }]);
    const book = XLSX.read(buildAutomaticDescriptionWorkbook(dataset), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<unknown[]>(book.Sheets['pqm consolidado'], { header: 1 });
    expect(rows[0][dataset.headers.indexOf('Descripcion') + 1]).toBe('descripción_sugerida');
    expect(rows[1][dataset.headers.indexOf('Descripcion') + 1]).toBe('FRUTAS ACME 2UND');
    expect(rows[1]).toHaveLength(dataset.headers.length + 1);
  });
});
