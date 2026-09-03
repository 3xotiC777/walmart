import { describe, expect, it } from 'vitest';
import { classifyDatabaseError, ingestionPayloadSummary, safeExternalErrorMessage } from './database-error';

describe('errores transitorios de persistencia', () => {
  it('convierte statement_timeout en 503 reintentable', () => {
    expect(classifyDatabaseError({ code: '57014', message: 'canceling statement due to statement timeout' })).toEqual({
      code: '57014',
      retryable: true,
      status: 503,
      message: 'La base de datos tardó más de lo esperado. Conservamos el avance para reanudarlo automáticamente.',
    });
  });

  it('mantiene los errores definitivos como 400', () => {
    expect(classifyDatabaseError({ code: '23505', message: 'duplicado' })).toMatchObject({
      retryable: false,
      status: 400,
      message: 'duplicado',
    });
  });

  it('convierte una página 520 de Cloudflare en un error limpio y reintentable', () => {
    const result = classifyDatabaseError({
      message: '<!DOCTYPE html><html><head><title>supabase.co | 520: Web server is returning an unknown error</title></head></html>',
    });

    expect(result).toMatchObject({
      retryable: true,
      status: 503,
      message: 'La base de datos tardó más de lo esperado. Conservamos el avance para reanudarlo automáticamente.',
    });
  });

  it('nunca expone HTML técnico de un proveedor en la interfaz', () => {
    expect(safeExternalErrorMessage('<html>Error interno</html>', 'Mensaje seguro')).toBe('Mensaje seguro');
  });

  it('registra solo tipo y cantidad del lote, sin incluir valores de la base', () => {
    expect(ingestionPayloadSummary({
      group_members: [{ description: 'dato privado' }, { description: 'otro' }],
      metadata: { secret: true },
    })).toEqual({ group_members: 2 });
  });
});
