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
      { Descripcion: 'PRODUCTO MARCAA' },
    ]);

    const alerts = generateOrthographyAlerts(dataset);

    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      sourceRow: 4,
      reason: 'Texto/Ortografía',
      correctedDescription: 'PRODUCTO MARCA',
    });
    expect(alerts[0].probability).toMatch(/^9\d\.\d%$/);
  });

  it('clasifica espacios y ortografía conjuntamente', () => {
    const dataset = makeDataset([
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
      { Descripcion: 'PRODUCTO 200 GR' },
    ]);

    expect(generateOrthographyAlerts(dataset)).toEqual([]);
  });

  it('reporta espacios aunque no exista una corrección ortográfica', () => {
    const dataset = makeDataset([{ Descripcion: ' PRODUCTO ÚNICO ' }]);

    expect(generateOrthographyAlerts(dataset)[0]).toMatchObject({
      reason: 'Espacios de más',
      probability: '100%',
      correctedDescription: 'PRODUCTO UNICO',
    });
  });
});
