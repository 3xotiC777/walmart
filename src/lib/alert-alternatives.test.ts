import { describe, expect, it } from 'vitest';
import { resolveStoredAlertAlternatives } from './alert-alternatives';

describe('alternativas de alertas persistidas', () => {
  it('usa los valores compartidos del grupo en cargas nuevas', () => {
    expect(resolveStoredAlertAlternatives([], [
      { value: 'CORRECTO', count: 34 },
      { value: 'DISTINTO', count: 1 },
    ])).toEqual([
      { value: 'CORRECTO', count: 34 },
      { value: 'DISTINTO', count: 1 },
    ]);
  });

  it('mantiene compatibilidad con cargas antiguas que guardaban alternativas por alerta', () => {
    expect(resolveStoredAlertAlternatives(
      [{ value: 'ANTIGUO', count: 2 }],
      [{ value: 'GRUPO', count: 9 }],
    )).toEqual([{ value: 'ANTIGUO', count: 2 }]);
  });

  it('descarta estructuras inválidas', () => {
    expect(resolveStoredAlertAlternatives(null, [{ value: 'X' }, null])).toEqual([]);
  });
});
