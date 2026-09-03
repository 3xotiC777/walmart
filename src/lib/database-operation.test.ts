import { describe, expect, it, vi } from 'vitest';
import { DatabaseOperationError, runDatabaseOperation } from './database-operation';

describe('runDatabaseOperation', () => {
  it('devuelve el resultado al primer intento exitoso', async () => {
    await expect(runDatabaseOperation(async () => ({ data: { ok: true }, error: null })))
      .resolves.toEqual({ ok: true });
  });

  it('reanuda después de un error transitorio de Supabase', async () => {
    const operation = vi.fn()
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'statement timeout' } })
      .mockResolvedValueOnce({ data: 'listo', error: null });
    const wait = vi.fn(async () => undefined);

    await expect(runDatabaseOperation(operation, { wait })).resolves.toBe('listo');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(750, undefined);
  });

  it('no repite un error definitivo', async () => {
    const operation = vi.fn(async () => ({ data: null, error: { code: '22023', message: 'Lote inválido.' } }));

    await expect(runDatabaseOperation(operation, { wait: async () => undefined }))
      .rejects.toMatchObject({ name: 'DatabaseOperationError', retryable: false });
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('convierte fallos de red en errores reanudables', async () => {
    const operation = vi.fn(async () => { throw new TypeError('Failed to fetch'); });

    await expect(runDatabaseOperation(operation, { attempts: 1 }))
      .rejects.toEqual(expect.objectContaining<Partial<DatabaseOperationError>>({ retryable: true }));
  });
});
