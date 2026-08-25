import Link from 'next/link';
import { ArrowIcon, FileIcon, TasksIcon, UploadCloudIcon, UsersIcon } from '@/components/icons';
import { MetricStrip } from '@/components/metrics';
import { requireViewer } from '@/lib/auth';
import { buildRulePriorities } from '@/lib/rule-priority';
import { getRuleDefinitions } from '@/lib/rules';
import type { Database } from '@/lib/supabase/database.types';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Tablero' };

const format = (value: unknown) => Number(value ?? 0).toLocaleString('es-CO');
type AssignmentMetrics = Database['public']['Functions']['get_upload_assignment_metrics']['Returns'][number];
type RuleMetrics = Database['public']['Functions']['get_upload_rule_metrics']['Returns'][number];

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ assignment?: string | string[] }> }) {
  const query = await searchParams;
  const viewer = await requireViewer();
  const supabase = await createServerSupabaseClient();
  const { data: uploads } = await supabase
    .from('uploads')
    .select('id, display_name, status, total_rows, task_count, pending_task_count, alert_count, orthography_count, has_barcode')
    .order('created_at', { ascending: false })
    .limit(1);
  const upload = uploads?.[0];

  let scopedMetrics: AssignmentMetrics | null = null;
  let ruleMetrics: RuleMetrics[] = [];
  let ruleMetricsFailed = false;
  if (upload) {
    const [metricResponse, ruleResponse] = await Promise.all([
      supabase.rpc('get_upload_assignment_metrics', { p_upload_id: upload.id }),
      supabase.rpc('get_upload_rule_metrics', { p_upload_id: upload.id }),
    ]);
    scopedMetrics = metricResponse.data?.[0] ?? null;
    ruleMetrics = ruleResponse.data ?? [];
    ruleMetricsFailed = Boolean(ruleResponse.error);
  }

  const fallbackMetrics = viewer.role === 'leader'
    ? upload
    : { task_count: 0, pending_task_count: 0, alert_count: 0, orthography_count: 0 };
  const metrics = scopedMetrics ?? fallbackMetrics;
  const totalRows = Number(upload?.total_rows ?? 0);
  const taskCount = Number(metrics?.task_count ?? 0);
  const pending = Number(metrics?.pending_task_count ?? 0);
  const alerts = Number(metrics?.alert_count ?? 0);
  const orthography = Number(metrics?.orthography_count ?? 0);
  const resolved = Math.max(0, taskCount - pending);
  const status = String(upload?.status ?? '');
  const rulePriority = buildRulePriorities(
    ruleMetrics,
    getRuleDefinitions(Boolean(upload?.has_barcode ?? true)),
  );

  return (
    <>
      <header className="page-heading"><div><p className="overline">{viewer.role === 'leader' ? 'PANORAMA DE LA JORNADA' : 'MI ASIGNACIÓN'}</p><h1>{viewer.role === 'leader' ? 'Control de la validación' : `Hola, ${viewer.displayName.split(' ')[0]}`}</h1><p>{upload ? `Jornada: ${String(upload.display_name)}. Los números se actualizan al resolver, recuperar el foco y cada 30 segundos.` : 'Todavía no hay una jornada activa en este espacio.'}</p></div>{viewer.role === 'leader' && <div className="heading-actions"><Link className="button button-primary" href="/workspace/cargas/nueva" prefetch={false}><UploadCloudIcon/>Nueva jornada</Link></div>}</header>
      {query.assignment === 'updated' && <div className="assignment-success" role="status"><span aria-hidden="true">✓</span><div><strong>Reparto actualizado</strong><p>Los validadores ya pueden ver su nueva carga pendiente.</p></div></div>}
      <MetricStrip items={[
        { label: 'Registros totales', value: format(totalRows) },
        { label: viewer.role === 'leader' ? 'Tareas o filas únicas' : 'Tareas asignadas', value: format(taskCount), tone: 'orange' },
        { label: viewer.role === 'validator' ? `Eventos · ${format(orthography)} ortografía` : 'Eventos de alerta', value: format(alerts), tone: 'purple' },
        { label: 'Pendientes', value: format(pending), tone: 'yellow' },
        { label: 'Resueltas', value: format(resolved), tone: 'green' },
      ]} />
      {!upload ? <section className="panel empty-state"><UploadCloudIcon/><h2>Comienza con el panel y sus facturas</h2><p>El líder crea la jornada; después la plataforma prepara tareas por fila y mantiene juntos los grupos relacionados.</p>{viewer.role === 'leader' && <Link className="button button-primary" href="/workspace/cargas/nueva" prefetch={false}>Crear primera jornada</Link>}</section> : <>
        <div className="split-grid">
          <section className="panel">
            <div className="panel-header"><div><h2>Avance operativo</h2><p>{status === 'ready' || status === 'assigning' ? 'La jornada está lista para repartir.' : status === 'active' ? 'El reparto está publicado; puedes ajustar quién trabajará en lo pendiente.' : 'Estado de la jornada.'}</p></div><span className={`status ${status === 'active' ? 'active' : status === 'completed' ? 'resolved' : 'draft'}`}>{status || 'sin estado'}</span></div>
            <div className="panel-body">
              <div className="progress-bar"><span style={{ width: `${taskCount ? (resolved / taskCount) * 100 : 0}%` }}/></div>
              <p>{format(resolved)} de {format(taskCount)} tareas resueltas</p>
              <div className="decision-actions">
                {viewer.role === 'leader' && ['ready', 'assigning'].includes(status) && <Link className="button button-primary" href={`/workspace/reparto/${String(upload.id)}`} prefetch={false}><UsersIcon/>Preparar reparto</Link>}
                {viewer.role === 'leader' && status === 'active' && pending > 0 && <Link className="button button-primary" href={`/workspace/reparto/${String(upload.id)}`} prefetch={false}><UsersIcon/>Repartir nuevamente</Link>}
                <Link className="button button-secondary" href="/workspace/tareas" prefetch={false}><TasksIcon/>Abrir revisión</Link>
              </div>
            </div>
          </section>
          <section className="panel"><div className="panel-header"><div><h2>Acciones rápidas</h2><p>Continúa sin perder el contexto de la jornada.</p></div></div><div className="panel-body quick-list"><Link className="quick-row" href="/workspace/tareas" prefetch={false}><span><strong>Revisar tareas</strong><small>Dato, sugerencia, relacionados y factura</small></span><ArrowIcon/></Link>{viewer.role === 'leader' && <><Link className="quick-row" href="/workspace/equipo" prefetch={false}><span><strong>Ver productividad</strong><small>Trabajo por persona y tipo de decisión</small></span><ArrowIcon/></Link><Link className="quick-row" href="/workspace/exportar" prefetch={false}><span><strong>Preparar los Excel</strong><small>Alertas, sugerencias y base corregida</small></span><FileIcon/></Link></>}</div></section>
        </div>
        <section className="panel rule-priority-panel">
          <div className="panel-header">
            <div>
              <p className="overline">PRIORIDAD DE REVISIÓN</p>
              <h2>Alertas por regla</h2>
              <p>Ordenadas por alertas pendientes. {viewer.role === 'validator' ? 'Solo se cuenta tu asignación.' : 'Se cuenta toda la jornada.'}</p>
            </div>
            {!ruleMetricsFailed && <span className="status active">{rulePriority.active.length} reglas activas</span>}
          </div>
          {ruleMetricsFailed ? <p className="form-error rule-priority-error" role="status">El desglose por regla no pudo actualizarse en este momento.</p> : rulePriority.active.length === 0 ? <div className="panel-body rule-priority-empty"><strong>No hay alertas en esta jornada.</strong><p>Cuando aparezca una alerta, aquí verás la regla y su carga.</p></div> : <div className="rule-priority-list">
            {rulePriority.active.map((rule, index) => {
              const pendingHref = rule.pending_alert_count > 0 ? '&status=pending' : '';
              return <Link
                aria-label={`Abrir ${rule.rule_code}: ${format(rule.pending_alert_count)} alertas pendientes`}
                className={`rule-priority-row ${rule.category === 'orthography' ? 'orthography' : ''}`}
                href={`/workspace/tareas?rule=${encodeURIComponent(rule.rule_code)}${pendingHref}&sort=rule_asc`}
                key={`${rule.rule_code}-${rule.category}`}
                prefetch={false}
              >
                <span className="rule-priority-rank">{String(index + 1).padStart(2, '0')}</span>
                <span className="rule-priority-code">{rule.rule_code}</span>
                <span className="rule-priority-copy">
                  <strong>{rule.name}</strong>
                  <small>{rule.description}</small>
                  <span aria-hidden="true" className="rule-load-track"><i style={{ width: `${rule.relativeLoad * 100}%` }}/></span>
                </span>
                <span className="rule-priority-stats">
                  <strong>{format(rule.pending_alert_count)}</strong>
                  <small>pendientes</small>
                  <span>{format(rule.alert_count)} total · {format(rule.affected_task_count)} tareas</span>
                </span>
                <ArrowIcon/>
              </Link>;
            })}
          </div>}
          {!ruleMetricsFailed && rulePriority.inactive.length > 0 && <details className="inactive-rules">
            <summary>{rulePriority.inactive.length} reglas sin alertas en esta jornada</summary>
            <div>{rulePriority.inactive.map((rule) => <span key={rule.id} title={rule.name}>{rule.id}</span>)}</div>
          </details>}
        </section>
      </>}
    </>
  );
}
