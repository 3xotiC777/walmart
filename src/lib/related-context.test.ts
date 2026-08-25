import { describe, expect, it } from 'vitest';
import { relatedContextItems } from './related-context';

describe('valores de contexto relacionados', () => {
  it('prioriza cantidad y precios con etiquetas comprensibles', () => {
    const items = relatedContextItems({
      Marca_Wm: 'AMALFI',
      Precio_Total_Preciador: 8_800,
      cantidad_comprada: 2,
      Precio_Unidad: 4_400,
      Producto_Wm: 'ENJUAGUES BUCALES',
    });

    expect(items).toEqual([
      { field: 'cantidad_comprada', label: 'Cantidad comprada', tone: 'quantity', value: '2' },
      { field: 'Precio_Unidad', label: 'Precio unidad', tone: 'price', value: '4.400' },
      { field: 'Precio_Total_Preciador', label: 'Precio total del preciador', tone: 'price', value: '8.800' },
      { field: 'Producto_Wm', label: 'Producto Walmart', tone: 'detail', value: 'ENJUAGUES BUCALES' },
      { field: 'Marca_Wm', label: 'Marca Walmart', tone: 'detail', value: 'AMALFI' },
    ]);
  });

  it('conserva ceros y omite valores vacíos', () => {
    const items = relatedContextItems({
      cantidad_comprada: 0,
      Precio_Unidad: null,
      Precio_Total_Preciador: '',
      Gramaje: 0,
    });

    expect(items.map((item) => [item.field, item.value])).toEqual([
      ['cantidad_comprada', '0'],
      ['Gramaje', '0'],
    ]);
  });
});
