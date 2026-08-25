export interface RelatedContextItem {
  field: string;
  label: string;
  value: string;
  tone: 'price' | 'quantity' | 'detail';
}

const CONTEXT_FIELDS = [
  ['cantidad_comprada', 'Cantidad comprada', 'quantity'],
  ['Precio_Unidad', 'Precio unidad', 'price'],
  ['Precio_Total_Preciador', 'Precio total del preciador', 'price'],
  ['Producto_Wm', 'Producto Walmart', 'detail'],
  ['Marca_Wm', 'Marca Walmart', 'detail'],
  ['Gramaje', 'Gramaje', 'detail'],
  ['unidad_de_Medida', 'Unidad de medida', 'detail'],
  ['Canasto Wm', 'Canasto Walmart', 'detail'],
] as const;

const NUMBER_FORMAT = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 4,
});

function contextValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? NUMBER_FORMAT.format(value) : null;
  if (typeof value === 'boolean') return value ? 'Sí' : 'No';
  const text = String(value).trim();
  return text ? text : null;
}

export function relatedContextItems(fieldValues: Record<string, unknown>): RelatedContextItem[] {
  return CONTEXT_FIELDS.flatMap(([field, label, tone]) => {
    const value = contextValue(fieldValues[field]);
    return value === null ? [] : [{ field, label, tone, value }];
  });
}
