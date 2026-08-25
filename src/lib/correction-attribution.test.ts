import { describe, expect, it } from 'vitest';
import { buildCorrectionTraceabilityValues } from './correction-attribution';

describe('trazabilidad de correcciones', () => {
  it('indica cada campo y actor, ordenados por fila y columna', () => {
    expect(buildCorrectionTraceabilityValues([
      { excelRow: 8, columnIndex: 12, fieldName: 'Marca_Wm', actorUserId: 'user-b' },
      { excelRow: 8, columnIndex: 4, fieldName: 'Categoria_Wm', actorUserId: 'user-a' },
      { excelRow: 3, columnIndex: 2, fieldName: 'Descripcion', actorUserId: 'user-b' },
    ], [
      { userId: 'user-a', displayName: 'Diego', username: 'diego' },
      { userId: 'user-b', displayName: 'Mayumi', username: 'mayumi' },
    ])).toEqual([
      { excelRow: 3, value: 'Descripcion → Mayumi (@mayumi)' },
      { excelRow: 8, value: 'Categoria_Wm → Diego (@diego) | Marca_Wm → Mayumi (@mayumi)' },
    ]);
  });

  it('mantiene una atribución legible si el perfil ya no está disponible', () => {
    expect(buildCorrectionTraceabilityValues([
      { excelRow: 2, columnIndex: 1, fieldName: 'Division_Wm', actorUserId: 'abcdef12-0000' },
      { excelRow: 2, columnIndex: 2, fieldName: '', actorUserId: null },
    ], [])).toEqual([{
      excelRow: 2,
      value: 'Division_Wm → Usuario abcdef12 | Columna 3 → Usuario sin identificar',
    }]);
  });

  it('deduplica de forma estable una celda repetida', () => {
    expect(buildCorrectionTraceabilityValues([
      { excelRow: 2, columnIndex: 1, fieldName: 'Marca_Wm', actorUserId: 'primero' },
      { excelRow: 2, columnIndex: 1, fieldName: 'Marca_Wm', actorUserId: 'segundo' },
    ], [])).toEqual([{ excelRow: 2, value: 'Marca_Wm → Usuario primero' }]);
  });
});
