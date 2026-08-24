'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Validator { userId: string; name: string; username: string }
interface Block { id: string; blockKey: string; alertCount: number; memberCount: number; invoiceCount: number; weight: number; assignedTo: string | null; version: number }

export function AssignmentBoard({ uploadId, initialUploadVersion, initialBlocks, validators }: { uploadId: string; initialUploadVersion: number; initialBlocks: Block[]; validators: Validator[] }) {
  const router = useRouter();
  const [blocks, setBlocks] = useState(initialBlocks);
  const [uploadVersion, setUploadVersion] = useState(initialUploadVersion);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loads = useMemo(() => validators.map((validator) => {
    const own = blocks.filter((block) => block.assignedTo === validator.userId);
    return { ...validator, blocks: own.length, alerts: own.reduce((sum, block) => sum + block.alertCount, 0), weight: own.reduce((sum, block) => sum + block.weight, 0) };
  }), [blocks, validators]);

  async function action(body: unknown): Promise<Record<string, unknown> | null> {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/uploads/${uploadId}/assign`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({})) as Record<string, unknown>;
      if (!response.ok) { setError(typeof result.message === 'string' ? result.message : 'No fue posible guardar el reparto.'); return null; }
      return result;
    } catch {
      setError('No fue posible conectar para guardar el reparto.');
      return null;
    } finally {
      setBusy(false);
    }
  }
  async function propose() {
    const result = await action({ action: 'propose', validatorIds: validators.map((item) => item.userId), expectedUploadVersion: uploadVersion });
    if (!result) return;
    const assignments = Array.isArray(result.assignments) ? result.assignments as Array<{ block_id?: string; assigned_to?: string; version?: number }> : [];
    const snapshotByBlock = new Map(assignments.map((item) => [item.block_id, item]));
    setBlocks((current) => current.map((block) => {
      const snapshot = snapshotByBlock.get(block.id);
      return snapshot ? { ...block, assignedTo: snapshot.assigned_to ?? null, version: Number(snapshot.version) } : block;
    }));
    setUploadVersion(Number(result.uploadVersion));
    router.refresh();
  }
  async function publish() {
    if (blocks.some((block) => !block.assignedTo)) { setError('Todos los bloques necesitan un responsable.'); return; }
    const assignments = blocks.map((block) => ({ block_id: block.id, assigned_to: block.assignedTo, expected_version: block.version }));
    if (await action({ action: 'publish', assignments, expectedUploadVersion: uploadVersion })) { router.push('/workspace/tareas'); router.refresh(); }
  }

  if (blocks.length === 0) {
    return <section className="panel empty-state"><h2>La jornada no tiene alertas</h2><p>Publica el resultado para cerrarla como completada y habilitar sus descargas.</p>{error && <p className="form-error" role="alert">{error}</p>}<button className="button button-primary" disabled={busy} onClick={() => void publish()} type="button">Finalizar jornada sin alertas</button></section>;
  }

  return <><div className="metric-strip">{loads.map((load) => <article className="metric" key={load.userId}><i/><small>{load.name}</small><strong>{load.alerts.toLocaleString('es-CO')}</strong><small>{load.blocks} bloques · peso {load.weight.toFixed(1)}</small></article>)}</div><section className="panel"><div className="panel-header"><div><h2>Propuesta de bloques</h2><p>Los relacionados alertados permanecen juntos. Puedes cambiar el responsable del bloque completo antes de publicar.</p></div><div className="heading-actions"><button className="button button-secondary" disabled={busy || validators.length === 0} onClick={() => void propose()} type="button">Recalcular equilibrio</button><button className="button button-primary" disabled={busy || blocks.length === 0} onClick={() => void publish()} type="button">Publicar reparto</button></div></div>{error && <p className="form-error" role="alert">{error}</p>}<div className="data-table-wrap"><table className="data-table"><thead><tr><th>Bloque</th><th>Alertas</th><th>Registros relacionados</th><th>Facturas</th><th>Peso</th><th>Responsable</th></tr></thead><tbody>{blocks.map((block) => <tr key={block.id}><td className="mono">{block.blockKey}</td><td>{block.alertCount}</td><td>{block.memberCount}</td><td>{block.invoiceCount}</td><td>{block.weight.toFixed(1)}</td><td><select aria-label={`Responsable del bloque ${block.blockKey}`} className="form-control" value={block.assignedTo ?? ''} onChange={(event) => setBlocks((current) => current.map((item) => item.id === block.id ? { ...item, assignedTo: event.target.value || null } : item))}><option value="">Sin asignar</option>{validators.map((validator) => <option value={validator.userId} key={validator.userId}>{validator.name}</option>)}</select></td></tr>)}</tbody></table></div></section></>;
}
