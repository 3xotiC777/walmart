'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
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
}

export function TaskReview({
  taskId,
  blockId,
  blockVersion,
  blockAssignedTo,
  role,
  alerts,
  invoices,
}: {
  taskId: string;
  blockId: string;
  blockVersion: number;
  blockAssignedTo: string | null;
  role: 'leader' | 'validator';
  alerts: AlertView[];
  invoices: string[];
}) {
  const router = useRouter();
  const [manual, setManual] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  async function decide(alert: AlertView, action: 'apply' | 'manual' | 'correct' | 'reopen') {
    setBusy(alert.id);
    setError('');
    try {
      const response = await fetch(`/api/alerts/${alert.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
        setError(result.message ?? 'No fue posible guardar la decisión.');
        return;
      }
      router.refresh();
    } catch {
      setError('No fue posible conectar para guardar la decisión.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      {error && <p className="form-error" role="alert">{error}</p>}
      {alerts.map((alert, index) => {
        const relatedId = `related-${alert.id}`;
        const isExpanded = expanded === alert.id;
        return (
          <section className="panel" key={alert.id}>
            <div className="panel-header">
              <div>
                <span className="rule-badge">{alert.rule_code}</span>
                <h2>{alert.affected_field || 'Revisión manual'}</h2>
                <p>Alerta {index + 1} de {alerts.length} en esta fila</p>
              </div>
              <span className={`status ${alert.status === 'resolved' ? 'resolved' : 'pending'}`}>{alert.status === 'resolved' ? 'Resuelta' : 'Pendiente'}</span>
            </div>
            <div className="panel-body">
              <p>{alert.detail}</p>
              <div className="before-after">
                <article className="value-card">
                  <small>Valor actual</small>
                  <strong>{alert.original_value ?? 'Vacío'}</strong>
                  <p>{alert.expected_or_conflicts || 'Compara la evidencia antes de decidir.'}</p>
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
                {alert.status === 'resolved' ? role === 'leader' && (
                  <button className="button button-secondary" disabled={busy === alert.id} onClick={() => void decide(alert, 'reopen')} type="button">Reabrir decisión</button>
                ) : (
                  <>
                    {alert.can_auto_apply && alert.suggestion_confidence === 'high' && (
                      <button className="button button-primary" disabled={busy === alert.id} onClick={() => void decide(alert, 'apply')} type="button"><SparkIcon />Aplicar sugerencia</button>
                    )}
                    <input
                      aria-label={`Nuevo valor para ${alert.affected_field ?? 'la alerta'}`}
                      className="form-control"
                      onChange={(event) => setManual((current) => ({ ...current, [alert.id]: event.target.value }))}
                      placeholder="Escribir otro valor…"
                      value={manual[alert.id] ?? ''}
                    />
                    <button className="button button-secondary" disabled={busy === alert.id || manual[alert.id] === undefined} onClick={() => void decide(alert, 'manual')} type="button">Guardar edición</button>
                    <button className="button button-secondary" disabled={busy === alert.id} onClick={() => void decide(alert, 'correct')} type="button"><CheckIcon />Está correcto</button>
                  </>
                )}
              </div>
              {alert.group_id && (
                <button
                  aria-controls={relatedId}
                  aria-expanded={isExpanded}
                  className="button button-quiet"
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
