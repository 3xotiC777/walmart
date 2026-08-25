export interface AlertDecisionContextInput {
  source_column_index: number | null;
  original_value: string | null;
  suggested_value: string | null;
  can_auto_apply: boolean;
  suggestion_confidence: string;
}

export interface CellResolutionContextInput {
  column_index: number;
  resolved_value: string;
}

export type ConfirmationMode = 'confirm-original' | 'reuse-correction' | 'blocked';

export interface AlertDecisionContext {
  confirmationMode: ConfirmationMode;
  effectiveValue: string | null;
  hasPriorCorrection: boolean;
}

export function getAlertDecisionContext(
  alert: AlertDecisionContextInput,
  resolutions: ReadonlyArray<CellResolutionContextInput>,
): AlertDecisionContext {
  const resolution = alert.source_column_index === null
    ? undefined
    : resolutions.find((item) => item.column_index === alert.source_column_index);
  const effectiveValue = resolution?.resolved_value ?? alert.original_value;
  const hasPriorCorrection = Boolean(
    resolution && resolution.resolved_value !== alert.original_value,
  );

  if (!hasPriorCorrection) {
    return {
      confirmationMode: 'confirm-original',
      effectiveValue,
      hasPriorCorrection: false,
    };
  }

  const canReuseCorrection = alert.can_auto_apply
    && alert.suggestion_confidence === 'high'
    && alert.suggested_value !== null
    && alert.suggested_value === effectiveValue;

  return {
    confirmationMode: canReuseCorrection ? 'reuse-correction' : 'blocked',
    effectiveValue,
    hasPriorCorrection: true,
  };
}

export function alertMutationError(code: string | undefined, fallback: string) {
  if (code === 'PGRST003') {
    return {
      status: 503,
      message: 'La plataforma está atendiendo varias revisiones al mismo tiempo. Espera unos segundos e intenta nuevamente; no se perdió ninguna decisión.',
      retryable: true,
    };
  }
  if (code === '55P03') {
    return {
      status: 409,
      message: 'Otra revisión se está guardando en este momento. Espera un instante e intenta nuevamente; tu decisión no se perdió.',
      retryable: true,
    };
  }
  if (code === '40001') {
    return {
      status: 409,
      message: 'Otra alerta ya corrigió esta misma celda. Usa la corrección ya aplicada si coincide, o pide a un líder reabrir la decisión anterior.',
      retryable: false,
    };
  }
  return { status: 400, message: fallback, retryable: false };
}

export function shouldRetryAlertMutation(code: string | undefined, attempt: number) {
  if (code === 'PGRST003') return attempt === 0;
  return code === '55P03' && attempt < 2;
}
