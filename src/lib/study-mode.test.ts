import { describe, expect, it } from 'vitest';
import { resolveHasBarcode } from './study-mode';

describe('modalidad del estudio', () => {
  it('ajusta a sin código cuando toda la columna codiGo_barras está vacía', () => {
    expect(resolveHasBarcode(true, [
      { fields: { codiGo_barras: null } },
      { fields: { codiGo_barras: '   ' } },
    ])).toBe(false);
  });

  it('respeta la modalidad con código cuando existe al menos uno', () => {
    expect(resolveHasBarcode(true, [
      { fields: { codiGo_barras: '' } },
      { fields: { codiGo_barras: '001234' } },
    ])).toBe(true);
  });

  it('respeta la selección explícita sin código aunque existan valores', () => {
    expect(resolveHasBarcode(false, [{ fields: { codiGo_barras: '001234' } }])).toBe(false);
  });
});
