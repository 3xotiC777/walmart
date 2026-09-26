import { describe, expect, it } from 'vitest';
import { findSimilarValues } from './similarity';
import { makeDataset, TEST_HIERARCHY } from './testHelpers';
import { validateDataset } from './rules';

describe('R31 y R32, similitud de texto', () => {
  it('alerta valores distintos con 95% o más y conserva el texto coincidente', () => {
    const base = 'GASEOSA COLA MARCA PRESENTACION FAMILIAR';
    const variant = 'GASEOSA COLA MARCA PRESENTACION FAMILIARX';
    const matches = findSimilarValues([base, variant, base]);
    expect(matches.get(base)?.match).toBe(variant);
    expect(matches.get(base)?.similarity).toBeGreaterThanOrEqual(.95);
    const dataset = makeDataset([
      { Descripcion: base, Marca_Wm: 'MARCA INTERNACIONAL X' },
      { Descripcion: variant, Marca_Wm: 'MARCA INTERNACIONAL Y' },
    ]);
    const result = validateDataset(dataset, TEST_HIERARCHY);
    expect(result.alerts.filter((alert) => alert.ruleId === 'R31')).toHaveLength(2);
    expect(result.alerts.filter((alert) => alert.ruleId === 'R32')).toHaveLength(2);
    expect(result.alerts.find((alert) => alert.ruleId === 'R31')?.similarityMatch).toBe(variant);
  });

  it('no compara un valor consigo mismo ni marcas sin identificar', () => {
    expect(findSimilarValues(['MARCA', ' marca ', 'OTRA'])).toEqual(new Map());
    const dataset = makeDataset([
      { Marca_Wm: 'NO IDENTIFICABLE' },
      { Marca_Wm: 'SIN MARCA' },
    ]);
    expect(validateDataset(dataset, TEST_HIERARCHY).alerts.filter((alert) => alert.ruleId === 'R32')).toHaveLength(0);
  });
});
