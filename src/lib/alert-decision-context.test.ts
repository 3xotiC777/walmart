import { describe, expect, it } from 'vitest';
import {
  alertMutationError,
  getAlertDecisionContext,
  shouldRetryAlertMutation,
} from './alert-decision-context';

const alert = {
  source_column_index: 18,
  original_value: 'CONSUMO 2',
  suggested_value: 'CONSUMO',
  can_auto_apply: true,
  suggestion_confidence: 'high',
};

describe('contexto de decisiones multi-alerta', () => {
  it('permite Está correcto cuando no existe una corrección previa', () => {
    expect(getAlertDecisionContext(alert, [])).toEqual({
      confirmationMode: 'confirm-original',
      effectiveValue: 'CONSUMO 2',
      hasPriorCorrection: false,
    });
  });

  it('reutiliza la corrección previa cuando coincide con la sugerencia', () => {
    expect(getAlertDecisionContext(alert, [{ column_index: 18, resolved_value: 'CONSUMO' }]))
      .toEqual({
        confirmationMode: 'reuse-correction',
        effectiveValue: 'CONSUMO',
        hasPriorCorrection: true,
      });
  });

  it('bloquea una decisión que contradiría la corrección vigente', () => {
    expect(getAlertDecisionContext(alert, [{ column_index: 18, resolved_value: 'OTRA DIVISIÓN' }]))
      .toEqual({
        confirmationMode: 'blocked',
        effectiveValue: 'OTRA DIVISIÓN',
        hasPriorCorrection: true,
      });
  });

  it('traduce y reintenta una sola vez la saturación transitoria del pool', () => {
    expect(shouldRetryAlertMutation('PGRST003', 0)).toBe(true);
    expect(shouldRetryAlertMutation('PGRST003', 1)).toBe(false);
    expect(alertMutationError('PGRST003', 'fallback')).toMatchObject({
      status: 503,
      retryable: true,
    });
  });

  it('reintenta brevemente un bloqueo concurrente sin dejar solicitudes esperando', () => {
    expect(shouldRetryAlertMutation('55P03', 0)).toBe(true);
    expect(shouldRetryAlertMutation('55P03', 1)).toBe(true);
    expect(shouldRetryAlertMutation('55P03', 2)).toBe(false);
    expect(alertMutationError('55P03', 'fallback')).toMatchObject({
      status: 409,
      retryable: true,
    });
  });

  it('explica el conflicto de la misma celda como un 409 no reintentable', () => {
    expect(alertMutationError('40001', 'fallback')).toMatchObject({
      status: 409,
      retryable: false,
    });
  });
});
