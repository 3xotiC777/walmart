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

export function classifyDatabaseError(error: DatabaseErrorLike) {
  const retryable = Boolean(error.code && RETRYABLE_CODES.has(error.code));
  return {
    code: error.code ?? null,
    retryable,
    status: retryable ? 503 : 400,
    message: retryable
      ? 'La base de datos tardó más de lo esperado. Conservamos el avance para reanudarlo automáticamente.'
      : error.message,
  };
}

export function ingestionPayloadSummary(payload: unknown): Record<string, number> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return {};
  return Object.fromEntries(Object.entries(payload as Record<string, unknown>)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, (value as unknown[]).length]));
}
