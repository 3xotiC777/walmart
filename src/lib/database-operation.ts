import { classifyDatabaseError, type DatabaseErrorLike } from './database-error';

interface DatabaseOperationResult<T> {
  data: T | null;
  error: DatabaseErrorLike | null;
}

interface DatabaseOperationOptions {
  attempts?: number;
  signal?: AbortSignal;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

export class DatabaseOperationError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'DatabaseOperationError';
  }
}

function waitWithAbort(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(new DOMException('Carga cancelada.', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/**
 * Ejecuta una operación autenticada directamente contra Supabase. Así los
 * lotes grandes no hacen el viaje navegador -> Vercel -> Supabase y se evita
 * duplicar tanto el tráfico como el tiempo de transferencia.
 */
export async function runDatabaseOperation<T>(
  operation: () => PromiseLike<DatabaseOperationResult<T>>,
  options: DatabaseOperationOptions = {},
): Promise<T | null> {
  const attempts = options.attempts ?? 5;
  const wait = options.wait ?? waitWithAbort;
  let lastError = new DatabaseOperationError('No fue posible guardar el avance.', true);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    options.signal?.throwIfAborted();
    try {
      const result = await operation();
      options.signal?.throwIfAborted();
      if (!result.error) return result.data;
      const classification = classifyDatabaseError(result.error);
      lastError = new DatabaseOperationError(classification.message, classification.retryable);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
      lastError = cause instanceof DatabaseOperationError
        ? cause
        : new DatabaseOperationError('Se interrumpió la conexión. Conservamos el avance para reanudarlo automáticamente.', true);
    }

    if (!lastError.retryable || attempt + 1 >= attempts) break;
    await wait(Math.min(6_000, 750 * (2 ** attempt)), options.signal);
  }

  throw lastError;
}
