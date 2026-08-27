import { describe, expect, it } from 'vitest';
import { generateOrthographyAlerts, normalizeOrthographyText, sequenceSimilarity } from './orthography';
import { makeDataset } from './testHelpers';

describe('alertas de ortografía y espacios', () => {
  it('normaliza igual que el notebook de referencia', () => {
    expect(normalizeOrthographyText('  PiñA   ÁCIDA  ')).toBe('PINA ACIDA');
    expect(sequenceSimilarity('PRODUCTO MARCAA', 'PRODUCTO MARCA')).toBeGreaterThanOrEqual(0.9);
  });

  it('propone una descripción frecuente para una variante rara', () => {
    const dataset = makeDataset([
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: 'PRODUCTO MARCAA' },
    ]);

    const alerts = generateOrthographyAlerts(dataset);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      sourceRow: 5,
      rowId: 'ROW-4',
      surveyId: 'ID-4',
      barcode: '001',
      reason: 'Texto/Ortografía',
      correctedDescription: 'PRODUCTO MARCA',
      confidence: 'high',
      method: 'frequent-phrase',
    });
    expect(alerts[0].probability).toMatch(/^9\d\.\d%$/);
  });

  it('clasifica espacios y ortografía conjuntamente', () => {
    const dataset = makeDataset([
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: 'PRODUCTO MARCA' },
      { Descripcion: '  PRODUCTO  MARCAA  ' },
    ]);

    const alerts = generateOrthographyAlerts(dataset);

    expect(alerts[0]).toMatchObject({
      reason: 'Espacios de más + Texto/Ortografía',
      correctedDescription: 'PRODUCTO MARCA',
    });
  });

  it('no propone correcciones que cambien números', () => {
    const dataset = makeDataset([
      { Descripcion: 'PRODUCTO 100 GR' },
      { Descripcion: 'PRODUCTO 100 GR' },
      { Descripcion: 'PRODUCTO 100 GR' },
      { Descripcion: 'PRODUCTO 200 GR' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([]);
  });

  it('reporta espacios aunque no exista una corrección ortográfica', () => {
    const dataset = makeDataset([{ Producto_Wm: 'PRODUCTO ÚNICO', Descripcion: ' PRODUCTO ÚNICO ' }]);

    expect(generateOrthographyAlerts(dataset)[0]).toMatchObject({
      reason: 'Espacios de más',
      probability: '100%',
      correctedDescription: 'PRODUCTO ÚNICO',
      confidence: 'high',
      method: 'spacing',
    });
  });

  it('no confunde palabras con significado opuesto', () => {
    const dataset = makeDataset([
      { Descripcion: 'PRODUCTO CON AZUCAR' },
      { Descripcion: 'PRODUCTO CON AZUCAR' },
      { Descripcion: 'PRODUCTO CON AZUCAR' },
      { Descripcion: 'PRODUCTO SIN AZUCAR' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([]);
  });

  it('protege tallas y medidas aunque las frases sean muy parecidas', () => {
    const dataset = makeDataset([
      { Descripcion: 'CAMISA M MARCA' },
      { Descripcion: 'CAMISA M MARCA' },
      { Descripcion: 'CAMISA M MARCA' },
      { Descripcion: 'CAMISA S MARCA' },
      { Descripcion: 'PRODUCTO MARCA 500GR' },
      { Descripcion: 'PRODUCTO MARCA 500GR' },
      { Descripcion: 'PRODUCTO MARCA 500GR' },
      { Descripcion: 'PRODUCTO MARCA 500G' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([]);
  });

  it('no aplica como automática una referencia de otro contexto de producto', () => {
    const dataset = makeDataset([
      { Producto_Wm: 'PRODUCTO A', Descripcion: 'PRODUCTO MARCA' },
      { Producto_Wm: 'PRODUCTO A', Descripcion: 'PRODUCTO MARCA' },
      { Producto_Wm: 'PRODUCTO A', Descripcion: 'PRODUCTO MARCA' },
      { Producto_Wm: 'PRODUCTO B', Descripcion: 'PRODUCTO MARCAA' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([
      expect.objectContaining({
        correctedDescription: 'PRODUCTO MARCAA',
        confidence: 'none',
        method: 'unrecognized-token',
        doubtfulTokens: ['MARCAA'],
      }),
    ]);
  });

  it('respeta decisiones aprendidas válidas y correcciones aprobadas', () => {
    const dataset = makeDataset([
      { Descripcion: 'HELADO DOS PINOS VETEADO CHOCOLATE' },
      { Descripcion: 'CAMINO DE MESA CAFE CIRC' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([
      expect.objectContaining({
        correctedDescription: 'CAMINO DE MESA CAFE CIRCULAR',
        confidence: 'high',
        method: 'learned-decision',
      }),
    ]);
  });

  it('señala palabras raras sin inventar una corrección', () => {
    const dataset = makeDataset([{ Descripcion: 'PRODUCTO XILOFONZ MARCA' }]);

    expect(generateOrthographyAlerts(dataset)).toEqual([
      expect.objectContaining({
        correctedDescription: 'PRODUCTO XILOFONZ MARCA',
        confidence: 'none',
        method: 'unrecognized-token',
        doubtfulTokens: ['XILOFONZ'],
      }),
    ]);
  });
});
