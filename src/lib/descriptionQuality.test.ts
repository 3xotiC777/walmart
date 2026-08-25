import { describe, expect, it } from 'vitest';
import { assessDescriptionQuality, buildProductDescriptionEvidence } from './descriptionQuality';

describe('calidad de descripción', () => {
  it.each([
    ['ENJUAGUE BUCAL AMALFI 500ML', 'ENJUAGUES BUCALES', 'AMALFI', 0.5, 'LITROS'],
    ['JUGO NARANJA FONTANA 1LT', 'JUGOS', 'FONTANA', 1, 'LITROS'],
    ['GALLETA SARITA SUIZA 8.3GR 12UND', 'GALLETAS DULCES', 'SARITA', 0.0083, 'KILOS'],
  ])('acepta producto compatible, marca exacta y gramaje posterior: %s', (
    description,
    product,
    brand,
    gramaje,
    unit,
  ) => {
    expect(assessDescriptionQuality({ description, product, brand, gramaje, unit })).toBeNull();
  });

  it('detecta un producto incompatible aunque marca y gramaje sean correctos', () => {
    const result = assessDescriptionQuality({
      description: 'JUGO NARANJA FONTANA 1LT',
      product: 'REFRIGERANTES',
      brand: 'FONTANA',
      gramaje: 1,
      unit: 'LITROS',
      productEvidence: {
        prefix: 'JUGO',
        suggestedProduct: 'JUGOS',
        support: 8,
        total: 9,
        share: 8 / 9,
      },
    });

    expect(result?.issues.map((issue) => issue.code)).toEqual(['PRODUCT_MISMATCH']);
  });

  it('aprende una contradicción solo cuando el prefijo apunta repetidamente a otro producto', () => {
    const evidence = buildProductDescriptionEvidence([
      { sourceRow: 2, description: 'JUGO NARANJA FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 3, description: 'JUGO MANZANA FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 4, description: 'JUGO UVA FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 5, description: 'JUGO PERA FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 6, description: 'JUGO MANGO FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 7, description: 'JUGO PIÑA FONTANA 1LT', product: 'JUGOS' },
      { sourceRow: 8, description: 'JUGO NARANJA FONTANA 1LT', product: 'REFRIGERANTES' },
      { sourceRow: 9, description: 'CALAMARES EN TINTA 115GR', product: 'MARISCOS ENLAT.' },
    ]);

    expect(evidence.get(8)).toMatchObject({
      prefix: 'JUGO',
      suggestedProduct: 'JUGOS',
      support: 6,
      total: 7,
    });
    expect(evidence.has(9)).toBe(false);
  });

  it('mantiene prefijos legibles al singularizar palabras terminadas en CES', () => {
    const evidence = buildProductDescriptionEvidence([
      { sourceRow: 2, description: 'GALLETA DULCES MARCA 100GR', product: 'GALLETAS DULCES' },
      { sourceRow: 3, description: 'GALLETA DULCES MARCA 200GR', product: 'GALLETAS DULCES' },
      { sourceRow: 4, description: 'GALLETA DULCES MARCA 300GR', product: 'GALLETAS DULCES' },
      { sourceRow: 5, description: 'GALLETA DULCES MARCA 400GR', product: 'GALLETAS SALADAS' },
    ]);

    expect(evidence.get(5)?.prefix).toBe('GALLETA DULCE');
  });

  it('exige la frase completa de la marca y respeta límites de palabra', () => {
    expect(assessDescriptionQuality({
      description: 'JUGO NARANJA FONTANAX 1LT',
      product: 'JUGOS',
      brand: 'FONTANA',
      gramaje: 1,
      unit: 'LITROS',
    })?.issues.map((issue) => issue.code)).toContain('BRAND_MISSING');

    expect(assessDescriptionQuality({
      description: 'ARROZ HORIZONTE DE ORO 1KG',
      product: 'ARROZ BLANCO',
      brand: 'HORIZONTE DE ORO',
      gramaje: 1,
      unit: 'KILOS',
    })).toBeNull();
  });

  it('acepta las marcas especiales sin exigirlas dentro de la descripción', () => {
    expect(assessDescriptionQuality({
      description: 'JUGO NARANJA 1LT',
      product: 'JUGOS',
      brand: 'NO IDENTIFICABLE',
      gramaje: 1,
      unit: 'LITROS',
    })).toBeNull();
  });

  it('alerta cuando el gramaje correcto está antes de la marca', () => {
    const result = assessDescriptionQuality({
      description: 'JUGO NARANJA 1LT FONTANA',
      product: 'JUGOS',
      brand: 'FONTANA',
      gramaje: 1,
      unit: 'LITROS',
    });

    expect(result?.issues.map((issue) => issue.code)).toContain('GRAMMAGE_BEFORE_BRAND');
  });

  it('compara el valor del gramaje y no solo la familia de la unidad', () => {
    const result = assessDescriptionQuality({
      description: 'JUGO NARANJA FONTANA 2LT',
      product: 'JUGOS',
      brand: 'FONTANA',
      gramaje: 1,
      unit: 'LITROS',
    });

    expect(result?.issues).toEqual([
      expect.objectContaining({
        code: 'GRAMMAGE_MISMATCH',
        message: expect.stringContaining('"2LT"'),
      }),
    ]);
  });

  it('no interpreta una P inicial ni un número final desnudo como cantidad', () => {
    const result = assessDescriptionQuality({
      description: 'PRE ENTRENO C4 PONCHE',
      product: 'PRE ENTRENOS',
      brand: 'SIN MARCA',
      gramaje: 4,
      unit: 'UNIDADES',
    });

    expect(result?.issues.map((issue) => issue.code)).toContain('GRAMMAGE_MISSING');
  });

  it.each([
    ['SET FLOURESCENTE 18 UNID', 'SETS', 18],
    ['MEDIA CORTA CABALLERO 3P', 'MEDIAS', 3],
    ['TOALLAS HUMEDAS BEBE 250U', 'TOALLAS HUMEDAS', 250],
    ['CALCETIN ALGODON 6PAR', 'CALCETINES', 6],
  ])('acepta abreviaturas explícitas de unidades sin confundir palabras: %s', (description, product, gramaje) => {
    expect(assessDescriptionQuality({
      description,
      product,
      brand: 'SIN MARCA',
      gramaje,
      unit: 'UNIDADES',
    })).toBeNull();
  });

  it('acepta peso variable descrito como por kilo', () => {
    expect(assessDescriptionQuality({
      description: 'HUEVOS PASTOREO POR KILO',
      product: 'HUEVOS',
      brand: 'PASTOREO',
      gramaje: 1.73,
      unit: 'KILOS',
    })).toBeNull();
  });

  it('omite el control de gramaje cuando la fuente dice NO ESPECIFICA', () => {
    expect(assessDescriptionQuality({
      description: 'CAMISETA DAMA',
      product: 'ROPA PARA DAMAS',
      brand: 'SIN MARCA',
      gramaje: 'NO ESPECIFICA',
      unit: 'UNIDADES',
    })).toBeNull();
  });
});
