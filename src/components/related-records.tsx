'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { relatedContextItems } from '@/lib/related-context';
import type { RelatedRecordView } from '@/lib/related-pagination';

interface RelatedResponse {
  ok: boolean;
  items?: RelatedRecordView[];
  nextCursor?: string | null;
  hasMore?: boolean;
  message?: string;
}

export function RelatedRecords({
  taskId,
  blockId,
  blockVersion,
  blockAssignedTo,
  groupIds,
  role,
}: {
  taskId: string;
  blockId: string;
  blockVersion: number;
  blockAssignedTo: string | null;
  groupIds: string[];
  role: 'leader' | 'validator';
}) {
  const router = useRouter();
  const groupKey = groupIds.join(',');
  const [items, setItems] = useState<RelatedRecordView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const loadPage = useCallback(async (
    pageCursor: string | null,
    replace: boolean,
    signal?: AbortSignal,
  ) => {
    setLoading(true);
    setError('');
    try {
      const search = new URLSearchParams();
      for (const groupId of groupKey.split(',').filter(Boolean)) search.append('groupId', groupId);
      if (pageCursor) search.set('cursor', pageCursor);
      const response = await fetch(`/api/tasks/${taskId}/related?${search.toString()}`, {
        cache: 'no-store',
        signal,
      });
      const result = await response.json().catch(() => ({})) as RelatedResponse;
      if (!response.ok) {
        setError(result.message ?? 'No fue posible consultar los registros relacionados.');
        return;
      }

      const incoming = result.items ?? [];
      setItems((current) => {
        const merged = new Map((replace ? [] : current).map((item) => [item.id, item]));
        for (const item of incoming) {
          const previous = merged.get(item.id);
          merged.set(item.id, previous ? {
            ...previous,
            ...item,
            is_alert: previous.is_alert || item.is_alert,
            group_ids: [...new Set([...previous.group_ids, ...item.group_ids])].sort(),
          } : item);
        }
        return [...merged.values()].sort((left, right) => left.id - right.id);
      });
      setCursor(result.nextCursor ?? null);
      setHasMore(Boolean(result.hasMore));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === 'AbortError')) {
        setError('No fue posible conectar para consultar los registros relacionados.');
      }
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [groupKey, taskId]);

  useEffect(() => {
    const controller = new AbortController();
    setItems([]);
    setCursor(null);
    setHasMore(false);
    void loadPage(null, true, controller.signal);
    return () => controller.abort();
  }, [blockVersion, loadPage]);

  async function addRelated(sourceRowId: number) {
    setBusy(`row-${sourceRowId}`);
    setError('');
    try {
      const response = await fetch(`/api/blocks/${blockId}/related`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sourceRowId, expectedBlockVersion: blockVersion }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.message ?? 'No fue posible añadir el registro.');
        return;
      }
      const createdTaskId = typeof result.task?.id === 'string' ? result.task.id : null;
      if (createdTaskId) {
        setItems((current) => current.map((item) => item.id === sourceRowId
          ? { ...item, task_id: createdTaskId }
          : item));
      }
      router.refresh();
    } catch {
      setError('No fue posible conectar para añadir el registro.');
    } finally {
      setBusy(null);
    }
  }

  async function reconcileRelated(item: RelatedRecordView, action: 'move' | 'merge') {
    if (!item.block_id || !item.block_version) return;
    const sourceLabel = item.block_key ?? item.block_id;
    const confirmed = window.confirm(action === 'merge'
      ? `Se trasladarán todas las tareas del bloque ${sourceLabel} a este bloque y se eliminará el bloque anterior. ¿Continuar?`
      : `Todas las tareas del bloque ${sourceLabel} pasarán al responsable de este bloque. Los bloques seguirán separados. ¿Continuar?`);
    if (!confirmed) return;

    setBusy(`block-${item.block_id}-${action}`);
    setError('');
    try {
      const response = await fetch(`/api/blocks/${blockId}/reconcile`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action,
          sourceBlockId: item.block_id,
          expectedTargetVersion: blockVersion,
          expectedSourceVersion: item.block_version,
          mutationId: crypto.randomUUID(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.message ?? 'No fue posible actualizar los bloques.');
        return;
      }
      await loadPage(null, true);
      router.refresh();
    } catch {
      setError('No fue posible conectar para actualizar los bloques.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="data-table-wrap">
      {error && <p className="form-error" role="alert">{error}</p>}
      <table aria-label="Registros relacionados" className="data-table">
        <thead>
          <tr><th>Fila</th><th>Row-Id</th><th>Código</th><th>Descripción</th><th>Valores de contexto</th><th>Acción</th></tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const otherBlock = Boolean(item.block_id && item.block_id !== blockId);
            const sameAssignee = item.owner === blockAssignedTo;
            const contextItems = relatedContextItems(item.field_values ?? {});
            return (
            <tr key={item.id}>
              <td>{item.excel_row}</td>
              <td className="mono">{item.row_id || '—'}</td>
              <td className="mono">{item.barcode || '—'}</td>
              <td>{item.description || '—'}</td>
              <td>
                <div className="related-context-list">
                  {contextItems.length > 0
                    ? contextItems.map((context) => (
                      <div className={`related-context-item ${context.tone}`} key={context.field}>
                        <small>{context.label}</small>
                        <strong>{context.value}</strong>
                      </div>
                    ))
                    : <span aria-label="Sin valores de contexto">—</span>}
                </div>
              </td>
              <td>
                <div className="related-actions">
                  {item.task_id
                    ? <Link className="review-link" href={`/workspace/tareas/${item.task_id}`} prefetch={false}>Abrir registro →</Link>
                    : item.is_alert
                      ? <span className="status draft">Otro bloque · solo lectura</span>
                      : <button className="button button-secondary" disabled={busy === `row-${item.id}`} onClick={() => void addRelated(item.id)} type="button">Añadir a mi bloque</button>}
                  {role === 'leader' && item.task_id && otherBlock && (
                    <>
                      {!sameAssignee && (
                        <button className="button button-secondary" disabled={busy !== null} onClick={() => void reconcileRelated(item, 'move')} type="button">Mover bloque al mismo responsable</button>
                      )}
                      <button className="button button-secondary" disabled={busy !== null} onClick={() => void reconcileRelated(item, 'merge')} type="button">Fusionar bloque aquí</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );})}
          {!loading && items.length === 0 && <tr><td colSpan={6}>No hay otros registros en este grupo.</td></tr>}
          {loading && items.length === 0 && <tr><td colSpan={6}>Cargando registros relacionados…</td></tr>}
        </tbody>
      </table>
      {items.length > 0 && (
        <div className="decision-actions">
          <span aria-live="polite">{items.length} registros cargados</span>
          {(hasMore || loading) && (
            <button className="button button-secondary" disabled={loading || !cursor} onClick={() => void loadPage(cursor, false)} type="button">{loading ? 'Cargando…' : 'Cargar 50 más'}</button>
          )}
        </div>
      )}
    </div>
  );
}
