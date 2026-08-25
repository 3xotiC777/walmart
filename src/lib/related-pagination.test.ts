import { describe, expect, it } from 'vitest';
import { buildRelatedPage, parseRelatedCursor, type RelatedRowProjection } from './related-pagination';

function row(id: number, members: RelatedRowProjection['group_members']): RelatedRowProjection {
  return {
    id,
    excel_row: id + 1,
    row_id: `ROW-${id}`,
    barcode: `00${id}`,
    description: `Producto ${id}`,
    field_values: { Categoria_Wm: 'ABARROTES' },
    group_members: members,
  };
}

describe('paginación de registros relacionados', () => {
  it('deduplica filas, reúne múltiples grupos y conserva is_alert', () => {
    const page = buildRelatedPage([
      row(10, [{ group_id: 'G-1', is_alert: false }]),
      row(10, [{ group_id: 'G-2', is_alert: true }]),
      row(11, [
        { group_id: 'G-1', is_alert: false },
        { group_id: 'G-2', is_alert: false },
      ]),
    ], [{
      id: 'TASK-10',
      source_row_id: 10,
      version: 4,
      assignment_blocks: { id: 'BLOCK-1', assigned_to: 'USER-1', block_key: 'block-1', version: 7 },
    }]);

    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      id: 10,
      group_ids: ['G-1', 'G-2'],
      is_alert: true,
      task_id: 'TASK-10',
      task_version: 4,
      block_id: 'BLOCK-1',
      block_key: 'block-1',
      block_version: 7,
      owner: 'USER-1',
    });
  });

  it('entrega 50 filas y un cursor estable basado en source_row_id', () => {
    const rows = Array.from({ length: 51 }, (_, index) => row(index + 100, {
      group_id: 'G-1',
      is_alert: index % 2 === 0,
    }));
    const page = buildRelatedPage(rows, []);

    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(page.nextCursor).toBe('149');
  });

  it('conserva cantidad y precios en los valores de contexto paginados', () => {
    const related = row(25, { group_id: 'G-PRECIO', is_alert: false });
    related.field_values = {
      cantidad_comprada: 3,
      Precio_Unidad: 2_600,
      Precio_Total_Preciador: 7_800,
    };

    const page = buildRelatedPage([related], []);

    expect(page.items[0]?.field_values).toEqual({
      cantidad_comprada: 3,
      Precio_Unidad: 2_600,
      Precio_Total_Preciador: 7_800,
    });
  });

  it('rechaza cursores ambiguos o fuera del rango seguro', () => {
    expect(parseRelatedCursor('149')).toBe(149);
    expect(parseRelatedCursor('149.5')).toBeNull();
    expect(parseRelatedCursor('-1')).toBeNull();
    expect(parseRelatedCursor('9007199254740993')).toBeNull();
  });
});
