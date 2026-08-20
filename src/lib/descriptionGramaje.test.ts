import { describe, expect, it } from 'vitest';
import { classifyDescriptionGramaje, parseFinalMeasure } from './descriptionGramaje';

describe('detección de gramaje en descripciones', () => {
  it('extrae cantidad y unidad únicamente cuando aparecen al final', () => {
    expect(parseFinalMeasure('LECHE ENTERA 1,5 LTS')).toEqual({
      product: 'LECHE ENTERA',
      quantity: '1,5',
      unit: 'LTS',
    });
    expect(parseFinalMeasure('LECHE 1L PROMOCIÓN')).toBeNull();
  });

  it('detecta una unidad final incompleta', () => {
    expect(classifyDescriptionGramaje('ARROZ PREMIUM 500G', 'ARROZ PREMIUM 500GR')).toEqual({
      suspiciousDescription: 'ARROZ PREMIUM 500G',
      referenceDescription: 'ARROZ PREMIUM 500GR',
      reason: 'Unidad final incompleta',
    });
    expect(classifyDescriptionGramaje('ACEITE VEGETAL 750M', 'ACEITE VEGETAL 750ML')?.reason)
      .toBe('Unidad final incompleta');
  });

  it('detecta cantidades distintas y descarta productos diferentes', () => {
    expect(classifyDescriptionGramaje('ARROZ PREMIUM 600GR', 'ARROZ PREMIUM 500GR')?.reason)
      .toBe('Gramaje final distinto');
    expect(classifyDescriptionGramaje('AZÚCAR 600GR', 'ARROZ 500GR')).toBeNull();
    expect(classifyDescriptionGramaje('ARROZ PREMIUM 0,5KG', 'ARROZ PREMIUM 0.50KG')).toBeNull();
  });
});
