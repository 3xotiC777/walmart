import { describe, expect, it } from 'vitest';
import { validateDataset } from './rules';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';

describe('motor de validación PQM', () => {
  it('cuenta todo el grupo como afectado y alerta solo el valor diferente de la mayoría', () => {
    const dataset = makeDataset([
      { codiGo_barras: ' 001 ', Descripcion: 'Producto marca' },
      { codiGo_barras: '001', Descripcion: ' PRODUCTO MARCA ' },
      { codiGo_barras: '001', Descripcion: 'OTRO PRODUCTO MARCA' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);
    const alerts = result.alerts.filter((alert) => alert.ruleId === 'R01');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].sourceRow).toBe(4);
    expect(alerts[0].expected).toBe('Producto marca');
    expect(result.ruleSummaries.find((rule) => rule.id === 'R01')).toMatchObject({
      affectedRows: 3,
      alertCount: 1,
    });
  });

  it('adjunta todas las facturas del Id_Dn W a una alerta R01', () => {
    const dataset = makeDataset([
      { 'Id_Dn W': 'ref-10', codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { 'Id_Dn W': 'REF-10', codiGo_barras: '001', Descripcion: 'PRODUCTO MARCA' },
      { 'Id_Dn W': ' REF-10 ', codiGo_barras: '001', Descripcion: 'OTRO PRODUCTO' },
    ]);
    const result = validateDataset(dataset, TEST_HIERARCHY, {
      sourceFile: 'facturas.xlsx',
      totalImages: 2,
      urlsByRef: {
        'REF-10': ['https://example.com/factura-1.jpg', 'https://example.com/factura-2.jpg'],
      },
    });

    const alert = result.alerts.find((item) => item.ruleId === 'R01');
    expect(alert?.invoiceUrls).toEqual([
      'https://example.com/factura-1.jpg',
      'https://example.com/factura-2.jpg',
    ]);
  });

  it('alerta todas las filas cuando los valores están empatados y no existe mayoría', () => {
    const dataset = makeDataset([
      { codiGo_barras: '001', Descripcion: 'DESCRIPCION A' },
      { codiGo_barras: '001', Descripcion: 'DESCRIPCION B' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);
    const alerts = result.alerts.filter((alert) => alert.ruleId === 'R01');

    expect(alerts.map((alert) => alert.sourceRow)).toEqual([2, 3]);
    expect(result.ruleSummaries.find((rule) => rule.id === 'R01')).toMatchObject({
      affectedRows: 2,
      alertCount: 2,
    });
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

  it('crea una alerta editable por cada celda estructural inválida de la fila', () => {
    const dataset = makeDataset([{
      'Row-Id': '',
      codiGo_barras: '',
      Precio_Unidad: 'NO NUMÉRICO',
      Precio_Total_Preciador: '',
    }]);

    const structural = validateDataset(dataset, TEST_HIERARCHY).alerts
      .filter((alert) => alert.ruleId === 'EST-01' || alert.ruleId === 'EST-02');

    expect(structural.map((alert) => [alert.ruleId, alert.field])).toEqual([
      ['EST-01', 'Row-Id'],
      ['EST-01', 'codiGo_barras'],
      ['EST-02', 'Precio_Unidad'],
      ['EST-02', 'Precio_Total_Preciador'],
    ]);
    expect(new Set(structural.map((alert) => `${alert.ruleId}:${alert.field}`)).size).toBe(4);
  });

  it('omite EST-01 cuando el estudio se declara sin código de barras', () => {
    const dataset = makeDataset([
      { codiGo_barras: '', Producto_Wm: '' },
      { codiGo_barras: '', Descripcion: '' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY, undefined, { hasBarcode: false });

    expect(result.alerts.filter((alert) => alert.ruleId === 'EST-01')).toHaveLength(0);
    expect(result.ruleSummaries.find((rule) => rule.id === 'EST-01')?.alertCount).toBe(0);
  });

  it('usa solo la descripción en R08, R09, R10 y R25 cuando el estudio no trae código', () => {
    const dataset = makeDataset([
      {
        codiGo_barras: '',
        Descripcion: 'PRODUCTO MARCA 500GR',
        Gramaje: 500,
        unidad_de_Medida: 'GRAMOS',
        codiGo_estandar: 'STD-A',
        Precio_Unidad: 100,
      },
      {
        codiGo_barras: '',
        Descripcion: 'PRODUCTO MARCA 500GR',
        Gramaje: 500,
        unidad_de_Medida: 'GRAMOS',
        codiGo_estandar: 'STD-A',
        Precio_Unidad: 100,
      },
      {
        codiGo_barras: '',
        Descripcion: 'PRODUCTO MARCA 500GR',
        Gramaje: 750,
        unidad_de_Medida: 'UNIDADES',
        codiGo_estandar: 'STD-B',
        Precio_Unidad: 200,
      },
    ]);

    const withBarcode = validateDataset(dataset, TEST_HIERARCHY, undefined, { hasBarcode: true });
    const withoutBarcode = validateDataset(dataset, TEST_HIERARCHY, undefined, { hasBarcode: false });
    const adaptedRuleIds = new Set(['R08', 'R09', 'R10', 'R25']);
    const adaptedAlerts = withoutBarcode.alerts.filter((alert) => adaptedRuleIds.has(alert.ruleId));

    expect(withBarcode.alerts.filter((alert) => adaptedRuleIds.has(alert.ruleId))).toHaveLength(0);
    expect(adaptedAlerts.map((alert) => alert.ruleId)).toEqual(['R08', 'R09', 'R10', 'R25']);
    expect(adaptedAlerts.every((alert) => alert.sourceRow === 4)).toBe(true);
    expect(adaptedAlerts.every((alert) => alert.key === 'Descripcion: PRODUCTO MARCA 500GR')).toBe(true);
    expect(adaptedAlerts.find((alert) => alert.ruleId === 'R25')).toMatchObject({
      ruleName: 'Precio atípico por descripción',
      groupAverage: 400 / 3,
    });
    expect(withoutBarcode.ruleSummaries.find((rule) => rule.id === 'R10')).toMatchObject({
      name: 'Descripción → código estándar',
      description: 'Una descripción solo puede tener un código estándar no vacío.',
    });
    expect(withoutBarcode.ruleSummaries.find((rule) => rule.id === 'R25')).toMatchObject({
      name: 'Precio atípico por descripción',
    });
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

  it('excluye de la regla 8 los gramajes variables medidos en kilos', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'PESO', Descripcion: 'HUEVOS POR KILO', Gramaje: 1.5, unidad_de_Medida: 'KILOS' },
      { codiGo_barras: 'PESO', Descripcion: 'HUEVOS POR KILO', Gramaje: 2.1, unidad_de_Medida: ' kilos ' },
      { codiGo_barras: 'FIJO', Descripcion: 'PRODUCTO EMPACADO', Gramaje: 1, unidad_de_Medida: 'UNIDADES' },
      { codiGo_barras: 'FIJO', Descripcion: 'PRODUCTO EMPACADO', Gramaje: 2, unidad_de_Medida: 'UNIDADES' },
    ]);

    const alerts = validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R08');

    expect(alerts.map((alert) => alert.sourceRow)).toEqual([4, 5]);
  });

  it('alerta precios superiores en más de 15% al promedio de la misma combinación código-descripción', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION A', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION A', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION A', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION A', Precio_Unidad: 10 },
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION A', Precio_Unidad: 100 },
      { codiGo_barras: 'P1', Descripcion: 'DESCRIPCION B', Precio_Unidad: 1000 },
      { codiGo_barras: 'UNICO', Descripcion: 'DESCRIPCION A', Precio_Unidad: 50 },
    ]);

    const alerts = validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R25');

    expect(alerts).toHaveLength(1);
    expect(alerts[0].observed).toBe('100');
    expect(alerts[0].key).toContain('DESCRIPCION A');
    expect(alerts[0].groupAverage).toBe(28);
    expect(alerts[0].priceThreshold).toBeCloseTo(32.2);
    expect(alerts[0].priceDifferencePercent).toBeCloseTo(72 / 28);
    expect(alerts[0].detail).toContain('257.14% por encima del promedio');
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
    expect(result.alerts.find((alert) => alert.ruleId === 'R26')).toMatchObject({
      field: 'cantidad_comprada',
      observed: '1',
    });
    expect(result.alerts.find((alert) => alert.ruleId === 'R27')).toMatchObject({
      field: 'Precio_Total_Preciador',
      observed: '12',
    });
  });

  it('aplica R28 cuando una compra múltiple conserva el precio total igual al unitario', () => {
    const dataset = makeDataset([
      { cantidad_comprada: 1, Precio_Unidad: 100, Precio_Total_Preciador: 100 },
      { cantidad_comprada: 2, Precio_Unidad: 100, Precio_Total_Preciador: 100 },
      { cantidad_comprada: 2, Precio_Unidad: 100, Precio_Total_Preciador: 100.005 },
      { cantidad_comprada: 2, Precio_Unidad: 100, Precio_Total_Preciador: 200 },
    ]);

    const alerts = validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R28');

    expect(alerts.map((alert) => alert.sourceRow)).toEqual([3, 4]);
  });

  it('cuenta una sola vez cada registro aunque tenga varias reglas de alerta', () => {
    const dataset = makeDataset([
      { Producto_Wm: 'DESCONOCIDO', Marca_Wm: 'BADIA', Descripcion: 'CANELA MOLIDA 12GR' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);

    expect(result.alerts.map((alert) => alert.ruleId)).toEqual(['JER-01', 'R15']);
    expect(result.metrics.reviewRecords).toBe(1);
    expect(result.metrics.totalAlerts).toBe(2);
    expect(result.metrics.okRecords).toBe(0);
  });

  it('aplica R29 únicamente a la descripción con gramaje sospechoso frente a la mayoría', () => {
    const dataset = makeDataset([
      { codiGo_barras: 'G1', Descripcion: 'ARROZ MARCA 500GR' },
      { codiGo_barras: 'G1', Descripcion: 'ARROZ MARCA 500GR' },
      { codiGo_barras: 'G1', Descripcion: 'ARROZ MARCA 500G' },
      { codiGo_barras: 'G2', Descripcion: 'LECHE MARCA 1L' },
      { codiGo_barras: 'G2', Descripcion: 'LECHE MARCA 2L' },
      { codiGo_barras: 'OTRO', Descripcion: 'PRODUCTO MARCA SIN MEDIDA' },
    ]);

    const result = validateDataset(dataset, TEST_HIERARCHY);
    const alerts = result.alerts.filter((alert) => alert.ruleId === 'R29');

    expect(alerts.map((alert) => alert.sourceRow)).toEqual([4, 5, 6]);
    expect(alerts[0]).toMatchObject({
      observed: 'ARROZ MARCA 500G',
      expected: 'ARROZ MARCA 500GR',
    });
    expect(result.ruleSummaries.find((rule) => rule.id === 'R29')).toMatchObject({
      affectedRows: 5,
      alertCount: 3,
    });
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
