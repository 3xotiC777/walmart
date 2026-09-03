export interface DatabaseErrorLike {
  code?: string | null;
  message: string;
}

const RETRYABLE_CODES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available
  '57014', // query_canceled / statement_timeout
  '57P01', // admin_shutdown
  '08000', '08003', '08006', '08001', '08004', '08007', '08P01',
]);

const TRANSIENT_MESSAGE = /(?:cloudflare|web server is returning an unknown error|bad gateway|service unavailable|gateway timeout|upstream|fetch failed|connection (?:reset|closed)|\b(?:502|503|504|520|521|522|523|524)\b)/i;
const HTML_DOCUMENT = /<(?:!doctype|html|head|body)\b/i;

export function safeExternalErrorMessage(message: unknown, fallback = 'El servicio tardó más de lo esperado. Conservamos el avance para reintentarlo.') {
  const value = typeof message === 'string' ? message.trim() : '';
  return !value || value.length > 500 || HTML_DOCUMENT.test(value) ? fallback : value;
}

export function isRetryableDatabaseError(error: DatabaseErrorLike): boolean {
  return Boolean(error.code && RETRYABLE_CODES.has(error.code))
    || TRANSIENT_MESSAGE.test(error.message)
    || HTML_DOCUMENT.test(error.message);
}

export function classifyDatabaseError(error: DatabaseErrorLike) {
  const retryable = isRetryableDatabaseError(error);
  return {
    code: error.code ?? null,
    retryable,
    status: retryable ? 503 : 400,
    message: retryable
      ? 'La base de datos tardó más de lo esperado. Conservamos el avance para reanudarlo automáticamente.'
      : safeExternalErrorMessage(error.message, 'La base de datos rechazó la operación.'),
  };
}

export function ingestionPayloadSummary(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return Object.fromEntries(Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, (value as unknown[]).length]));
}
