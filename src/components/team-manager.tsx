'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';

interface Member { user_id: string; role: 'leader' | 'validator'; is_active: boolean; profiles: { username: string; display_name: string; must_change_pin: boolean } | null }
interface Productivity { userId: string; assignedTasks: number; assignedAlerts: number; pendingTasks: number; completedAssignmentTasks: number; tasks: number; alerts: number; cells: number; rows: number; correct: number }

export function TeamManager({ members, productivity, productivityError = null }: { members: Member[]; productivity: Productivity[]; productivityError?: string | null }) {
  const router = useRouter();
  const [credential, setCredential] = useState<{ username: string; key: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setCredential(null);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const response = await fetch('/api/team', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ displayName: form.get('displayName'), username: form.get('username'), role: form.get('role') }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.message ?? 'No fue posible crear la cuenta.'); return; }
      setCredential({ username: result.username, key: result.temporaryKey });
      formElement.reset(); router.refresh();
    } catch {
      setError('No fue posible conectar para crear la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  async function act(userId: string, body: unknown) {
    setBusy(true); setError(''); setCredential(null);
    try {
      const response = await fetch(`/api/team/${userId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.message ?? 'No fue posible actualizar la cuenta.'); return; }
      if (result.temporaryKey) setCredential({ username: members.find((member) => member.user_id === userId)?.profiles?.username ?? '', key: result.temporaryKey });
      router.refresh();
    } catch {
      setError('No fue posible conectar para actualizar la cuenta.');
    } finally {
      setBusy(false);
    }
  }

  const productivityByUser = new Map(productivity.map((item) => [item.userId, item]));
  return <><section className="panel"><div className="panel-header"><div><h2>Crear integrante</h2><p>La clave temporal se muestra una sola vez. En el primer ingreso se reemplaza por un PIN.</p></div></div><div className="panel-body"><form className="team-form" onSubmit={create}><label className="field"><span>Nombre completo</span><input autoComplete="name" className="form-control" name="displayName" required /></label><label className="field"><span>Usuario</span><input autoComplete="username" className="form-control" name="username" placeholder="nombre.apellido" required /></label><label className="field"><span>Rol</span><select className="form-control" name="role"><option value="validator">Validador</option><option value="leader">Líder</option></select></label><button className="button button-primary" disabled={busy} type="submit">Crear cuenta</button></form>{error && <p className="form-error" role="alert">{error}</p>}{credential && <div className="credential-card" role="status"><strong>Entrega estos datos por un canal seguro</strong><p>Usuario: {credential.username}</p><code>{credential.key}</code><small>No podrás volver a consultar esta clave.</small></div>}</div></section><section className="panel"><div className="panel-header"><div><h2>Productividad de la jornada</h2><p>La asignación y el avance muestran la carga actual; “realizado” conserva el crédito de quien ejecutó cada acción.</p></div></div>{productivityError && <p className="form-error productivity-error" role="status">No fue posible actualizar la productividad. Intenta recargar la página.</p>}<div className="data-table-wrap"><table aria-label="Productividad y asignación por validador" className="data-table productivity-table"><thead><tr><th>Persona</th><th>Asignación actual</th><th>Realizado por la persona</th><th>Pendientes</th><th>Avance de su carga</th><th>Celdas cambiadas</th><th>Filas corregidas</th><th>Está correcto</th></tr></thead><tbody>{members.filter((member) => member.role === 'validator').map((member) => { const item = productivityByUser.get(member.user_id); const assignedTasks = item?.assignedTasks ?? 0; const completedTasks = item?.completedAssignmentTasks ?? 0; const progress = assignedTasks > 0 ? Math.min(100, Math.round((completedTasks / assignedTasks) * 100)) : 0; return <tr key={member.user_id}><td><strong>{member.profiles?.display_name}</strong>{!member.is_active && <small className="productivity-note">Cuenta desactivada</small>}</td><td><span className="productivity-stat"><strong>{assignedTasks.toLocaleString('es-CO')} tareas</strong><small>{(item?.assignedAlerts ?? 0).toLocaleString('es-CO')} alertas</small></span></td><td><span className="productivity-stat"><strong>{(item?.tasks ?? 0).toLocaleString('es-CO')} tareas</strong><small>{(item?.alerts ?? 0).toLocaleString('es-CO')} alertas</small></span></td><td><strong>{(item?.pendingTasks ?? 0).toLocaleString('es-CO')}</strong></td><td><div className="productivity-progress"><span><strong>{progress}%</strong><small>{completedTasks.toLocaleString('es-CO')} de {assignedTasks.toLocaleString('es-CO')}</small></span><div aria-label={`Avance actual de ${member.profiles?.display_name ?? member.profiles?.username}: ${progress}%`} aria-valuemax={100} aria-valuemin={0} aria-valuenow={progress} className="progress-bar" role="progressbar"><span style={{ width: `${progress}%` }} /></div></div></td><td>{(item?.cells ?? 0).toLocaleString('es-CO')}</td><td>{(item?.rows ?? 0).toLocaleString('es-CO')}</td><td>{(item?.correct ?? 0).toLocaleString('es-CO')}</td></tr>; })}</tbody></table></div></section><section className="panel"><div className="panel-header"><div><h2>Personas y accesos</h2><p>{members.length} integrantes registrados.</p></div></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Persona</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Acciones</th></tr></thead><tbody>{members.map((member) => <tr key={member.user_id}><td><strong>{member.profiles?.display_name}</strong></td><td className="mono">{member.profiles?.username}</td><td>{member.role === 'leader' ? 'Líder' : 'Validador'}</td><td><span className={`status ${member.is_active ? 'resolved' : 'pending'}`}>{member.is_active ? (member.profiles?.must_change_pin ? 'Clave temporal' : 'Activo') : 'Desactivado'}</span></td><td><div className="heading-actions"><button aria-label={`Restablecer PIN de ${member.profiles?.display_name ?? member.profiles?.username}`} className="button button-secondary" disabled={busy || !member.is_active} onClick={() => void act(member.user_id, { action: 'reset-pin' })} type="button">Restablecer PIN</button><button aria-label={`${member.is_active ? 'Desactivar' : 'Reactivar'} a ${member.profiles?.display_name ?? member.profiles?.username}`} className={`button ${member.is_active ? 'button-danger' : 'button-secondary'}`} disabled={busy} onClick={() => void act(member.user_id, { action: 'set-active', active: !member.is_active })} type="button">{member.is_active ? 'Desactivar' : 'Reactivar'}</button></div></td></tr>)}</tbody></table></div></section></>;
}
