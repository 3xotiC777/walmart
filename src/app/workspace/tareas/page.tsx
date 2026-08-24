import Link from 'next/link';
import { SearchIcon, TasksIcon } from '@/components/icons';
import { MetricStrip } from '@/components/metrics';
import { requireViewer } from '@/lib/auth';
import { RULE_DEFINITIONS } from '@/lib/rules';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Tareas' };
const FILTER_RULES = [...RULE_DEFINITIONS.filter((item) => item.id !== 'R21').map((item) => item.id), 'ORT-01'].sort();

export default async function TasksPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const status = typeof params.status === 'string' ? params.status : '';
  const rule = typeof params.rule === 'string' ? params.rule : '';
  const search = typeof params.q === 'string' ? params.q.trim() : '';
  const cursor = typeof params.cursor === 'string' ? params.cursor : '';
  const supabase = await createServerSupabaseClient();
  const { data: uploads } = await supabase.from('uploads').select('id, display_name, status, task_count, pending_task_count, alert_count, orthography_count').in('status', ['active', 'completed', 'ready', 'assigning']).order('created_at', { ascending: false }).limit(1);
  const upload = uploads?.[0];
  if (!upload) return <><header className="page-heading"><div><p className="overline">BANDEJA</p><h1>Tareas de revisión</h1></div></header><section className="panel empty-state"><TasksIcon/><h2>No hay tareas disponibles</h2><p>La bandeja aparecerá cuando un líder publique el reparto de una jornada.</p></section></>;

  const alertRelation = rule ? 'validation_alerts!inner(id, rule_code, status)' : 'validation_alerts(id, rule_code, status)';
  let query = supabase.from('review_tasks').select(`id, status, alert_count, corrected_cell_count, confirmed_correct_count, version, created_at, source_rows!inner(id, excel_row, row_id, id_dn_w, barcode, description), assignment_blocks!inner(id, assigned_to, status), ${alertRelation}`).eq('upload_id', upload.id).order('id', { ascending: true }).limit(51);
  if (cursor) query = query.gt('id', cursor);
  if (status) query = query.eq('status', status);
  if (rule) query = query.eq('validation_alerts.rule_code', rule);
  if (search) {
    const safe = search.replace(/[%_,()]/g, '');
    query = query.or(`row_id.ilike.%${safe}%,id_dn_w.ilike.%${safe}%,barcode.ilike.%${safe}%,description.ilike.%${safe}%`, { referencedTable: 'source_rows' });
  }
  const { data: fetched, error } = await query;
  const rows = (fetched ?? []).slice(0, 50);
  const hasNext = (fetched?.length ?? 0) > 50;
  const nextCursor = hasNext ? rows.at(-1)?.id : null;
  const nextParams = new URLSearchParams();
  if (status) nextParams.set('status', status); if (rule) nextParams.set('rule', rule); if (search) nextParams.set('q', search); if (nextCursor) nextParams.set('cursor', nextCursor);
  return <><header className="page-heading"><div><p className="overline">BANDEJA DE REVISIÓN</p><h1>{viewer.role === 'leader' ? 'Todas las tareas' : 'Mis tareas asignadas'}</h1><p>{upload.display_name}. Una tarea agrupa todas las reglas que afectan la misma fila.</p></div></header><MetricStrip items={[{ label: 'Tareas de la jornada', value: Number(upload.task_count).toLocaleString('es-CO') }, { label: 'Pendientes', value: Number(upload.pending_task_count).toLocaleString('es-CO'), tone: 'yellow' }, { label: 'Eventos de alerta', value: Number(upload.alert_count).toLocaleString('es-CO'), tone: 'orange' }, { label: 'Ortografía', value: Number(upload.orthography_count).toLocaleString('es-CO'), tone: 'purple' }, { label: 'Resultados en página', value: rows.length, tone: 'green' }]} /><section className="panel"><form className="filters" method="get"><label className="search-control"><SearchIcon/><span className="visually-hidden">Buscar</span><input className="form-control" name="q" defaultValue={search} placeholder="Buscar Row-Id, código, descripción o ID…"/></label><select aria-label="Filtrar por estado" className="form-control" name="status" defaultValue={status}><option value="">Todos los estados</option><option value="pending">Pendientes</option><option value="in_progress">En revisión</option><option value="resolved">Resueltas</option><option value="reopened">Reabiertas</option></select><select aria-label="Filtrar por regla" className="form-control" name="rule" defaultValue={rule}><option value="">Todas las reglas</option>{FILTER_RULES.map((item) => <option key={item}>{item}</option>)}</select><button className="button button-secondary" type="submit">Filtrar</button></form>{error ? <p className="form-error" role="alert">No fue posible cargar las tareas. Intenta nuevamente.</p> : <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Fila / Row-Id</th><th>Código</th><th>Descripción</th><th>Reglas</th><th>Estado</th><th>Acción</th></tr></thead><tbody>{rows.map((task) => { const source = Array.isArray(task.source_rows) ? task.source_rows[0] : task.source_rows; return <tr key={task.id}><td><strong>Fila {source?.excel_row}</strong><small className="mono">{source?.row_id || 'Sin Row-Id'}</small></td><td className="mono">{source?.barcode || '—'}</td><td className="row-main"><strong>{source?.description || 'Sin descripción'}</strong><small>Id_Dn W: {source?.id_dn_w || '—'}</small></td><td>{(task.validation_alerts ?? []).map((alert: { id: string; rule_code: string }) => <span className="rule-badge" key={alert.id}>{alert.rule_code}</span>)}</td><td><span className={`status ${task.status === 'resolved' ? 'resolved' : 'pending'}`}>{task.status === 'resolved' ? 'Resuelta' : task.status === 'reopened' ? 'Reabierta' : 'Pendiente'}</span></td><td><Link className="review-link" href={`/workspace/tareas/${task.id}`}>Revisar →</Link></td></tr>; })}{rows.length === 0 && <tr><td colSpan={6}>No hay tareas que coincidan con los filtros.</td></tr>}</tbody></table></div>}<footer className="page-footer"><span>Hasta 50 tareas por página</span>{hasNext && <Link className="button button-secondary" href={`/workspace/tareas?${nextParams}`}>Siguiente página</Link>}</footer></section></>;
}
