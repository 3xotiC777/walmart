import { describe, expect, it } from 'vitest';
import { classifyDatabaseError, ingestionPayloadSummary } from './database-error';

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

  it('registra solo tipo y cantidad del lote, sin incluir valores de la base', () => {
    expect(ingestionPayloadSummary({
      group_members: [{ description: 'dato privado' }, { description: 'otro' }],
      metadata: { secret: true },
    })).toEqual({ group_members: 2 });
  });
});
