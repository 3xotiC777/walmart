import type { SourceRecord } from './types';
import { hasUsableBarcode } from './barcode';

export function resolveHasBarcode(requested: boolean, records: readonly Pick<SourceRecord, 'fields'>[]): boolean {
  if (!requested) return false;
  return records.some((record) => hasUsableBarcode(record.fields.codiGo_barras));
}
