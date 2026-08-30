import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SearchIcon, TasksIcon } from '@/components/icons';
import { MetricStrip } from '@/components/metrics';
import { requireViewer } from '@/lib/auth';
import { CURRENT_JOURNEY_STATUSES } from '@/lib/current-journey';
import { RULE_DEFINITIONS } from '@/lib/rules';
import {
  buildTaskListHref,
  normalizeTaskPage,
  normalizeTaskSort,
  TASK_PAGE_SIZE,
  taskPageBounds,
} from '@/lib/task-inbox';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

export const metadata = { title: 'Tareas' };

type ReviewStatus = Database['public']['Enums']['review_status'];
type InboxAlert = { id: string; rule_code: string; status: ReviewStatus };
type InboxTask = Database['public']['Functions']['browse_review_tasks']['Returns'][number];

const FILTER_RULES = [
  ...RULE_DEFINITIONS.filter((item) => item.id !== 'R21').map((item) => item.id),
  'ORT-01',
];
const VALID_STATUSES: ReviewStatus[] = ['pending', 'in_progress', 'resolved', 'reopened'];
const STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pendiente',
  in_progress: 'En revisión',
  resolved: 'Resuelta',
  reopened: 'Reabierta',
};

function taskAlerts(value: unknown): InboxAlert[] {
  return Array.isArray(value)
    ? value.filter((item): item is InboxAlert => Boolean(
      item
      && typeof item === 'object'
      && 'id' in item
      && 'rule_code' in item,
    ))
    : [];
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const viewer = await requireViewer();
  const params = await searchParams;
  const rawStatus = typeof params.status === 'string' ? params.status : '';
  const status = VALID_STATUSES.includes(rawStatus as ReviewStatus)
    ? rawStatus as ReviewStatus
    : '';
  const rawRule = typeof params.rule === 'string' ? params.rule : '';
  const rule = FILTER_RULES.includes(rawRule) ? rawRule : '';
  const search = typeof params.q === 'string'
    ? params.q.trim().replace(/[%_,()]/g, '').slice(0, 120)
    : '';
  const sort = normalizeTaskSort(params.sort);
  const page = normalizeTaskPage(params.page);
  const supabase = await createServerSupabaseClient();
  const { data: uploads } = await supabase
    .from('uploads')
    .select('id, display_name, status, task_count, pending_task_count, alert_count, orthography_count')
    .eq('workspace_id', viewer.workspaceId)
    .in('status', [...CURRENT_JOURNEY_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1);
  const upload = uploads?.[0];

  if (!upload) {
    return <><header className="page-heading"><div><p className="overline">BANDEJA</p><h1>Tareas de revisión</h1></div></header><section className="panel empty-state"><TasksIcon/><h2>No hay tareas disponibles</h2><p>La bandeja aparecerá cuando un líder publique el reparto de una jornada.</p></section></>;
  }

  const [taskResponse, metricResponse] = await Promise.all([
    supabase.rpc('browse_review_tasks', {
      p_upload_id: upload.id,
      p_status: status || null,
      p_rule: rule || null,
      p_search: search || null,
      p_sort: sort,
      p_page: page,
      p_page_size: TASK_PAGE_SIZE,
    }),
    supabase.rpc('get_upload_assignment_metrics', { p_upload_id: upload.id }),
  ]);

  const rows = (taskResponse.data ?? []) as InboxTask[];
  const totalResults = Number(rows[0]?.total_count ?? 0);
  if (!taskResponse.error && rows.length === 0 && page > 1) {
    redirect(buildTaskListHref({ page: 1, status, rule, search, sort }));
  }

  const { totalPages, firstResult, lastResult } = taskPageBounds(page, totalResults);
  const fallbackMetrics = viewer.role === 'leader'
    ? upload
    : { task_count: 0, pending_task_count: 0, alert_count: 0, orthography_count: 0 };
  const metrics = metricResponse.data?.[0] ?? fallbackMetrics;
  const previousHref = buildTaskListHref({ page: page - 1, status, rule, search, sort });
  const nextHref = buildTaskListHref({ page: page + 1, status, rule, search, sort });

  return <>
    <header className="page-heading">
      <div>
        <p className="overline">BANDEJA DE REVISIÓN</p>
        <h1>{viewer.role === 'leader' ? 'Todas las tareas' : 'Mis tareas asignadas'}</h1>
        <p>{upload.display_name}. Una tarea agrupa todas las reglas que afectan la misma fila.</p>
      </div>
    </header>
    <MetricStrip items={[
      {
        label: viewer.role === 'leader' ? 'Tareas de la jornada' : 'Tareas asignadas',
        value: Number(metrics.task_count).toLocaleString('es-CO'),
      },
      {
        label: viewer.role === 'leader' ? 'Pendientes' : 'Pendientes asignadas',
        value: Number(metrics.pending_task_count).toLocaleString('es-CO'),
        tone: 'yellow',
      },
      {
        label: viewer.role === 'leader' ? 'Eventos de alerta' : 'Eventos asignados',
        value: Number(metrics.alert_count).toLocaleString('es-CO'),
        tone: 'orange',
      },
      {
        label: viewer.role === 'leader' ? 'Ortografía' : 'Ortografía asignada',
        value: Number(metrics.orthography_count).toLocaleString('es-CO'),
        tone: 'purple',
      },
      { label: 'Página actual', value: `${page} de ${totalPages}`, tone: 'green' },
    ]} />
    <section className="panel">
      <form className="filters task-filters" method="get">
        <label className="search-control">
          <SearchIcon/>
          <span className="visually-hidden">Buscar</span>
          <input className="form-control" name="q" defaultValue={search} placeholder="Buscar Row-Id, código, descripción o ID…"/>
        </label>
        <select aria-label="Filtrar por estado" className="form-control" name="status" defaultValue={status}>
          <option value="">Todos los estados</option>
          <option value="pending">Pendientes</option>
          <option value="in_progress">En revisión</option>
          <option value="resolved">Resueltas</option>
          <option value="reopened">Reabiertas</option>
        </select>
        <select aria-label="Filtrar por regla" className="form-control" name="rule" defaultValue={rule}>
          <option value="">Todas las reglas</option>
          {FILTER_RULES.map((item) => <option key={item}>{item}</option>)}
        </select>
        <select aria-label="Ordenar tareas" className="form-control" name="sort" defaultValue={sort}>
          <option value="rule_asc">Regla R01 → ORT</option>
          <option value="rule_desc">Regla ORT → R01</option>
          <option value="row_asc">Fila menor → mayor</option>
          <option value="row_desc">Fila mayor → menor</option>
        </select>
        <button className="button button-secondary" type="submit">Aplicar</button>
      </form>
      {metricResponse.error && <p className="form-error" role="status">Los indicadores no pudieron actualizarse; la lista de tareas continúa disponible.</p>}
      {taskResponse.error
        ? <p className="form-error" role="alert">No fue posible cargar toda la bandeja. Intenta nuevamente.</p>
        : <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Fila / Row-Id</th><th>Código</th><th>Descripción</th><th>Reglas</th><th>Estado</th><th>Acción</th></tr></thead>
            <tbody>
              {rows.map((task) => <tr key={task.id}>
                <td><strong>Fila {task.excel_row}</strong><small className="mono">{task.row_id || 'Sin Row-Id'}</small></td>
                <td className="mono">{task.barcode || '—'}</td>
                <td className="row-main"><strong>{task.description || 'Sin descripción'}</strong><small>Id_Dn W: {task.id_dn_w || '—'}</small></td>
                <td>{taskAlerts(task.validation_alerts).map((alert) => <span className="rule-badge" key={alert.id}>{alert.rule_code}</span>)}</td>
                <td><span className={`status ${task.status === 'resolved' ? 'resolved' : 'pending'}`}>{STATUS_LABELS[task.status]}</span></td>
                <td><Link className="review-link" href={`/workspace/tareas/${task.id}`} prefetch={false} transitionTypes={['workspace-detail']}>Revisar <span aria-hidden="true">→</span></Link></td>
              </tr>)}
              {rows.length === 0 && <tr><td colSpan={6}>No hay tareas que coincidan con los filtros.</td></tr>}
            </tbody>
          </table>
        </div>}
      <footer className="page-footer task-pagination">
        <span>{totalResults === 0 ? 'Sin resultados' : `Resultados ${firstResult.toLocaleString('es-CO')}–${lastResult.toLocaleString('es-CO')} de ${totalResults.toLocaleString('es-CO')}`}</span>
        <strong>Página {page} de {totalPages}</strong>
        <nav aria-label="Paginación de tareas">
          {page > 1
            ? <Link className="button button-secondary" href={previousHref} prefetch={false}>← Anterior</Link>
            : <span aria-disabled="true" className="button button-secondary is-disabled">← Anterior</span>}
          {page < totalPages
            ? <Link className="button button-secondary" href={nextHref} prefetch={false}>Siguiente →</Link>
            : <span aria-disabled="true" className="button button-secondary is-disabled">Siguiente →</span>}
        </nav>
      </footer>
    </section>
  </>;
}
