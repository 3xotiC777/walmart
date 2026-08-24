'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckIcon } from './icons';

export function RelatedEditor({ taskId, version, fields, headers, status, role }: { taskId: string; version: number; fields: Record<string, unknown>; headers: string[]; status: string; role: 'leader' | 'validator' }) {
  const router = useRouter();
  const editable = useMemo(() => Object.keys(fields).filter((field) => headers.includes(field)), [fields, headers]);
  const [field, setField] = useState(editable[0] ?? '');
  const [value, setValue] = useState(() => String(fields[editable[0]] ?? ''));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(action: 'edit' | 'correct' | 'reopen') {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/tasks/${taskId}/related-resolution`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action, expectedVersion: version, mutationId: crypto.randomUUID(), reason: action === 'reopen' ? 'Revisión solicitada por el líder' : undefined, fieldName: field, columnIndex: headers.indexOf(field), originalValue: fields[field] ?? null, resolvedValue: value }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.message ?? 'No fue posible guardar el registro.'); return; }
      if (action === 'reopen') router.refresh();
      else { router.push('/workspace/tareas'); router.refresh(); }
    } catch {
      setError('No fue posible conectar para guardar el registro.');
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel"><div className="panel-header"><div><h2>Registro relacionado añadido</h2><p>Este registro no tenía una alerta propia. Puedes corregir una celda o confirmar que está bien.</p></div><span className={`status ${status === 'resolved' ? 'resolved' : 'pending'}`}>{status === 'resolved' ? 'Resuelto' : 'Pendiente'}</span></div><div className="panel-body"><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Campo</th><th>Valor original</th></tr></thead><tbody>{editable.map((item) => <tr key={item}><td>{item}</td><td>{String(fields[item] ?? '—')}</td></tr>)}</tbody></table></div>{status !== 'resolved' && <div className="team-form"><label className="field"><span>Columna a corregir</span><select className="form-control" value={field} onChange={(event) => { setField(event.target.value); setValue(String(fields[event.target.value] ?? '')); }}>{editable.map((item) => <option key={item}>{item}</option>)}</select></label><label className="field"><span>Valor corregido</span><input className="form-control" value={value} onChange={(event) => setValue(event.target.value)} /></label><button className="button button-primary" disabled={busy || !field} onClick={() => void act('edit')} type="button">Guardar cambio</button><button className="button button-secondary" disabled={busy} onClick={() => void act('correct')} type="button"><CheckIcon/>Está correcto</button></div>}{status === 'resolved' && role === 'leader' && <div className="decision-actions"><p>Al reabrir se retirará del Excel final la corrección o confirmación anterior hasta que el registro vuelva a resolverse.</p><button className="button button-secondary" disabled={busy} onClick={() => void act('reopen')} type="button">Reabrir registro relacionado</button></div>}{error && <p className="form-error" role="alert">{error}</p>}</div></section>;
}
