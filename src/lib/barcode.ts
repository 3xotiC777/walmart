const UNIDENTIFIED_BARCODE = 'NO IDENTIFICABLE';

/**
 * `NO IDENTIFICABLE` es una ausencia conocida de código, no un código real
 * compartido por todos esos registros.
 */
export function isUnidentifiedBarcode(value: unknown): boolean {
  return String(value ?? '').trim().toUpperCase() === UNIDENTIFIED_BARCODE;
}

export function hasUsableBarcode(value: unknown): boolean {
  const normalized = String(value ?? '').trim();
  return normalized !== '' && !isUnidentifiedBarcode(normalized);
}
