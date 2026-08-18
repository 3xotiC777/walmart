import type { CellValue, HierarchyCatalog, SourceDataset, SourceRecord } from './types';

export const TEST_HEADERS = [
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
];

const DEFAULT_ROW: Record<string, CellValue> = {
  'Row-Id': 'ROW-1',
  'Id_Dn W': 'ID-1',
  Cantidad_Productos: 1,
  Producto_Wm: 'PRODUCTO A',
  Categoria_Wm: 'CATEGORIA A',
  Division_Wm: 'DIVISION A',
  Marca_Wm: 'MARCA',
  Tipo_Marca: 'COMERCIAL',
  codiGo_barras: '001',
  codiGo_estandar: '',
  Descripcion: 'PRODUCTO MARCA',
  Gramaje: 1,
  unidad_de_Medida: 'UNIDADES',
  cantidad_comprada: 1,
  Precio_Unidad: 10,
  Precio_Total_Preciador: 10,
  'Monto Total Fc': 10,
  'Canasto Wm': 'CANASTO A',
};

export function makeDataset(overrides: Array<Record<string, CellValue>>): SourceDataset {
  const records: SourceRecord[] = overrides.map((override, index) => {
    const fields: Record<string, CellValue> = {
      ...DEFAULT_ROW,
      'Row-Id': `ROW-${index + 1}`,
      'Id_Dn W': `ID-${index + 1}`,
      ...override,
    };
    return {
      excelRow: index + 2,
      fields,
      values: TEST_HEADERS.map((header) => fields[header] ?? null),
    };
  });
  return {
    sourceFile: 'fixture.xlsx',
    headers: TEST_HEADERS,
    outputHeaders: TEST_HEADERS,
    records,
  };
}

export const TEST_HIERARCHY: HierarchyCatalog = {
  metadata: { sourceSheet: 'Jerarquía', generatedAt: '2026-08-18T00:00:00.000Z', products: 2 },
  entries: {
    'PRODUCTO A': {
      producto: 'PRODUCTO A',
      categoria: 'CATEGORIA A',
      division: 'DIVISION A',
      canasto: 'CANASTO A',
    },
    'PRODUCTO B': {
      producto: 'PRODUCTO B',
      categoria: 'CATEGORIA B',
      division: 'DIVISION B',
      canasto: 'CANASTO B',
    },
  },
};
