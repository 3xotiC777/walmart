'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getAlertDecisionContext } from '@/lib/alert-decision-context';
import { ArrowIcon, CheckIcon, EyeIcon, SparkIcon } from './icons';
import { RelatedRecords } from './related-records';

export interface AlertView {
  id: string;
  rule_code: string;
  detail: string;
  affected_field: string | null;
  original_value: string | null;
  expected_or_conflicts: string | null;
  suggested_value: string | null;
  suggestion_method: string | null;
  suggestion_confidence: string;
  suggestion_evidence: { summary?: string; groupSize?: number } | null;
  suggestion_alternatives: Array<{ value: unknown; count: number }> | null;
  can_auto_apply: boolean;
  status: string;
  version: number;
  group_id: string | null;
  source_column_index: number | null;
  suggested_column_index: number | null;
}

export interface CellResolutionView {
  column_index: number;
  resolved_value: string;
}

export function TaskReview({
  taskId,
  blockId,
  blockVersion,
  blockAssignedTo,
  role,
  alerts,
  resolutions,
  invoices,
}: {
  taskId: string;
  blockId: string;
  blockVersion: number;
  blockAssignedTo: string | null;
  role: 'leader' | 'validator';
  alerts: AlertView[];
  resolutions: CellResolutionView[];
  invoices: string[];
}) {
  const router = useRouter();
  const [manual, setManual] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [alertStatuses, setAlertStatuses] = useState<Record<string, string>>(
    () => Object.fromEntries(alerts.map((alert) => [alert.id, alert.status])),
  );
  const [currentResolutions, setCurrentResolutions] = useState(resolutions);
  const savingRef = useRef(false);

  useEffect(() => {
    setAlertStatuses(Object.fromEntries(alerts.map((alert) => [alert.id, alert.status])));
    setCurrentResolutions(resolutions);
  }, [alerts, resolutions]);

  async function decide(alert: AlertView, action: 'apply' | 'manual' | 'correct' | 'reopen') {
    if (savingRef.current) return;
    savingRef.current = true;
    setBusy(alert.id);
    setErrors((current) => ({ ...current, [alert.id]: '' }));
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          action,
          value: manual[alert.id],
          expectedVersion: alert.version,
          mutationId: crypto.randomUUID(),
          reason: action === 'reopen' ? 'Revisión solicitada desde la tarea' : undefined,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setErrors((current) => ({
          ...current,
          [alert.id]: result.message ?? 'No fue posible guardar la decisión.',
        }));
        return;
      }
      setAlertStatuses((current) => ({
        ...current,
        [alert.id]: action === 'reopen' ? 'pending' : 'resolved',
      }));
      if (action === 'apply' || action === 'manual') {
        const resolvedValue = action === 'apply' ? alert.suggested_value : manual[alert.id];
        const columnIndex = action === 'apply'
          ? alert.suggested_column_index ?? alert.source_column_index
          : alert.source_column_index;
        if (columnIndex !== null && resolvedValue !== null && resolvedValue !== undefined) {
          setCurrentResolutions((current) => [
            ...current.filter((item) => item.column_index !== columnIndex),
            { column_index: columnIndex, resolved_value: resolvedValue },
          ]);
        }
      }
      router.refresh();
    } catch (caught) {
      const message = caught instanceof DOMException && caught.name === 'AbortError'
        ? 'El guardado tardó demasiado. Intenta nuevamente; el identificador de la operación evita decisiones duplicadas.'
        : 'No fue posible conectar para guardar la decisión.';
      setErrors((current) => ({ ...current, [alert.id]: message }));
    } finally {
      window.clearTimeout(timeout);
      savingRef.current = false;
      setBusy(null);
    }
  }

  return (
    <>
      {alerts.map((alert, index) => {
        const relatedId = `related-${alert.id}`;
        const isExpanded = expanded === alert.id;
        const status = alertStatuses[alert.id] ?? alert.status;
        const decisionContext = getAlertDecisionContext(alert, currentResolutions);
        const isSaving = busy === alert.id;
        const taskIsSaving = busy !== null;
        return (
          <section aria-busy={isSaving} className="panel" key={alert.id}>
            <div className="panel-header">
              <div>
                <span className="rule-badge">{alert.rule_code}</span>
                <h2>{alert.affected_field || 'Revisión manual'}</h2>
                <p>Alerta {index + 1} de {alerts.length} en esta fila</p>
              </div>
              <span className={`status ${status === 'resolved' ? 'resolved' : 'pending'}`}>{status === 'resolved' ? 'Resuelta' : 'Pendiente'}</span>
            </div>
            <div className="panel-body">
              <p>{alert.detail}</p>
              <div className="before-after">
                <article className="value-card">
                  <small>{decisionContext.hasPriorCorrection ? 'Valor vigente' : 'Valor actual'}</small>
                  <strong>{decisionContext.effectiveValue ?? 'Vacío'}</strong>
                  <p>{decisionContext.hasPriorCorrection
                    ? `Original: ${alert.original_value ?? 'Vacío'}. Otra alerta de esta fila ya corrigió esta celda.`
                    : alert.expected_or_conflicts || 'Compara la evidencia antes de decidir.'}</p>
                </article>
                <div className="arrow-well"><ArrowIcon /></div>
                <article className="value-card suggested">
                  <small>Solución propuesta · {alert.suggestion_confidence}</small>
                  <strong>{alert.suggested_value ?? 'Revisión manual'}</strong>
                  <p>{alert.suggestion_evidence?.summary ?? 'No existe una alternativa suficientemente confiable.'}</p>
                </article>
              </div>
              {alert.suggestion_alternatives?.length ? (
                <div className="evidence-grid">
                  {alert.suggestion_alternatives.slice(0, 6).map((alternative) => (
                    <div className="evidence-item" key={`${String(alternative.value)}-${alternative.count}`}>
                      <small>Alternativa</small>
                      <strong>{String(alternative.value ?? 'Vacío')} · {alternative.count} registros</strong>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="decision-actions">
                {status === 'resolved' ? role === 'leader' && (
                  <button className="button button-secondary" disabled={taskIsSaving} onClick={() => void decide(alert, 'reopen')} type="button">{isSaving ? 'Guardando…' : 'Reabrir decisión'}</button>
                ) : decisionContext.confirmationMode === 'reuse-correction' ? (
                  <button className="button button-primary" disabled={taskIsSaving} onClick={() => void decide(alert, 'apply')} type="button"><CheckIcon />{isSaving ? 'Guardando…' : 'Usar corrección ya aplicada'}</button>
                ) : decisionContext.confirmationMode === 'blocked' ? (
                  <p className="form-error decision-inline-message" role="alert">Esta celda ya tiene otra corrección que no coincide con esta sugerencia. Un líder debe reabrir la decisión anterior antes de cambiarla.</p>
                ) : (
                  <>
                    {alert.can_auto_apply && alert.suggestion_confidence === 'high' && (
                      <button className="button button-primary" disabled={taskIsSaving} onClick={() => void decide(alert, 'apply')} type="button"><SparkIcon />{isSaving ? 'Guardando…' : 'Aplicar sugerencia'}</button>
                    )}
                    <input
                      aria-label={`Nuevo valor para ${alert.affected_field ?? 'la alerta'}`}
                      className="form-control"
                      disabled={taskIsSaving}
                      onChange={(event) => setManual((current) => ({ ...current, [alert.id]: event.target.value }))}
                      placeholder="Escribir otro valor…"
                      value={manual[alert.id] ?? ''}
                    />
                    <button className="button button-secondary" disabled={taskIsSaving || manual[alert.id] === undefined} onClick={() => void decide(alert, 'manual')} type="button">{isSaving ? 'Guardando…' : 'Guardar edición'}</button>
                    <button className="button button-secondary" disabled={taskIsSaving} onClick={() => void decide(alert, 'correct')} type="button"><CheckIcon />{isSaving ? 'Guardando…' : 'Está correcto'}</button>
                  </>
                )}
              </div>
              {errors[alert.id] && <p className="form-error decision-inline-message" role="alert">{errors[alert.id]}</p>}
              {alert.group_id && (
                <button
                  aria-controls={relatedId}
                  aria-expanded={isExpanded}
                  className="button button-quiet"
                  disabled={taskIsSaving}
                  onClick={() => setExpanded(isExpanded ? null : alert.id)}
                  type="button"
                >
                  <EyeIcon /> {isExpanded ? 'Ocultar relacionados' : 'Ver registros relacionados'}
                </button>
              )}
              {isExpanded && alert.group_id && (
                <div id={relatedId}>
                  <RelatedRecords
                    blockId={blockId}
                    blockVersion={blockVersion}
                    blockAssignedTo={blockAssignedTo}
                    groupIds={[alert.group_id]}
                    role={role}
                    taskId={taskId}
                  />
                </div>
              )}
            </div>
          </section>
        );
      })}
      {invoices.length > 0 && (
        <section className="panel">
          <div className="panel-header"><div><h2>Facturas vinculadas</h2><p>{invoices.length} imágenes para contrastar el registro.</p></div></div>
          <div className="panel-body invoice-grid">
            {invoices.map((url, index) => (
              <a aria-label={`Abrir factura ${index + 1} en una pestaña nueva`} href={url} target="_blank" rel="noreferrer" key={url}>
                <img src={url} alt={`Factura ${index + 1}`} width={900} height={675} referrerPolicy="no-referrer" loading="lazy" />
              </a>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
