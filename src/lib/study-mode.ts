import type { SourceRecord } from './types';

export function resolveHasBarcode(requested: boolean, records: readonly Pick<SourceRecord, 'fields'>[]): boolean {
  if (!requested) return false;
  return records.some((record) => String(record.fields.codiGo_barras ?? '').trim() !== '');
}
