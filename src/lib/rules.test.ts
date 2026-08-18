import { describe, expect, it } from 'vitest';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';

describe('motor de validación PQM', () => {
  it('normaliza mayúsculas y espacios y alerta todas las filas de un grupo conflictivo', () => {
    const dataset = makeDataset([
      { codiGo_barras: ' 001 ', Descripcion: 'Producto marca' },
      { codiGo_barras: '001', Descripcion: ' PRODUCTO MARCA ' },
      { codiGo_barras: '001', Descripcion: 'OTRO PRODUCTO MARCA' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);
    const alerts = result.alerts.filter((alert) => alert.ruleId === 'R01');

    expect(alerts).toHaveLength(3);
    expect(new Set(alerts.map((alert) => alert.sourceRow))).toEqual(new Set([2, 3, 4]));
  });

  it('reporta campos vacíos sin usarlos como valores de cardinalidad', () => {
    const dataset = makeDataset([
      { codiGo_barras: '' },
      { codiGo_barras: '', Descripcion: 'OTRO PRODUCTO' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);

    expect(result.alerts.filter((alert) => alert.ruleId === 'EST-01')).toHaveLength(2);
    expect(result.alerts.filter((alert) => alert.ruleId === 'R01')).toHaveLength(0);
  });

  it('aplica la regla 15 y excluye marcas especiales válidas', () => {
    const dataset = makeDataset([
      { Marca_Wm: 'BADIA', Descripcion: 'CANELA BADIA 12GR' },
      { Marca_Wm: 'BADIA', Descripcion: 'CANELA MOLIDA 12GR' },
      { Marca_Wm: 'NO IDENTIFICABLE', Descripcion: 'CANELA MOLIDA' },
      { Marca_Wm: 'SIN MARCA', Descripcion: 'CANELA A GRANEL' },
    ]);

    const alerts = validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R15');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].sourceRow).toBe(3);
  });

  it('usa desviación estándar poblacional y solo alerta por encima del límite', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'P1', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Precio_Unidad: 30 },
      { codiGo_barras: 'UNICO', Precio_Unidad: 50 },
    ]);

    const alerts = validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R25');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].observed).toBe('30');
    expect(alerts[0].average).toBeCloseTo(16.6667, 3);
    expect(alerts[0].standardDeviation).toBeCloseTo(9.4281, 3);
  });

  it('valida las sumas de cantidad y monto por ID con sus campos reales', () => {
    const dataset = makeDataset([
      { 'Id_Dn W': 'OK', Cantidad_Productos: 2, cantidad_comprada: 1, Precio_Total_Preciador: 10, 'Monto Total Fc': 20 },
      { 'Id_Dn W': 'OK', Cantidad_Productos: 2, cantidad_comprada: 1, Precio_Total_Preciador: 10, 'Monto Total Fc': 20 },
      { 'Id_Dn W': 'MAL', Cantidad_Productos: 3, cantidad_comprada: 1, Precio_Total_Preciador: 12, 'Monto Total Fc': 30 },
      { 'Id_Dn W': 'MAL', Cantidad_Productos: 3, cantidad_comprada: 1, Precio_Total_Preciador: 12, 'Monto Total Fc': 30 },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);

    expect(result.alerts.filter((alert) => alert.ruleId === 'R26').map((alert) => alert.sourceRow)).toEqual([4, 5]);
    expect(result.alerts.filter((alert) => alert.ruleId === 'R27').map((alert) => alert.sourceRow)).toEqual([4, 5]);
  });

  it('aplica la jerarquía exacta y mantiene la regla 21 como visual', () => {
    const dataset = makeDataset([
      { Producto_Wm: 'PRODUCTO A', Categoria_Wm: 'OTRA', Division_Wm: 'OTRA', 'Canasto Wm': 'OTRO' },
      { Producto_Wm: 'DESCONOCIDO' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);

    expect(result.alerts.some((alert) => alert.ruleId === 'JER-01')).toBe(true);
    expect(result.alerts.some((alert) => alert.ruleId === 'JER-02')).toBe(true);
    expect(result.alerts.some((alert) => alert.ruleId === 'JER-03')).toBe(true);
    expect(result.alerts.some((alert) => alert.ruleId === 'JER-04')).toBe(true);
    expect(result.alerts.some((alert) => alert.ruleId === 'R21')).toBe(false);
    expect(result.ruleSummaries.find((rule) => rule.id === 'R21')?.status).toBe('Visual no automatizado');
  });
});

