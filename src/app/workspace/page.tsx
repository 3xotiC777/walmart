import Link from 'next/link';
import { ArrowIcon, FileIcon, TasksIcon, UploadCloudIcon, UsersIcon } from '@/components/icons';
import { MetricStrip } from '@/components/metrics';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Tablero' };

const format = (value: unknown) => Number(value ?? 0).toLocaleString('es-CO');

export default async function DashboardPage() {
  const viewer = await requireViewer();
  const supabase = await createServerSupabaseClient();
  const { data: uploads } = await supabase.from('uploads').select('*').order('created_at', { ascending: false }).limit(1);
  const upload = uploads?.[0] as Record<string, unknown> | undefined;

  let assignedTasks: number | null = null;
  let assignedPending: number | null = null;
  let assignedAlerts: number | null = null;
  let assignedOrthography: number | null = null;
  if (viewer.role === 'validator' && upload) {
    const [{ count: total }, { count: pending }, { count: alertTotal }, { count: orthographyTotal }] = await Promise.all([
      supabase.from('review_tasks').select('id', { count: 'exact', head: true }).eq('upload_id', upload.id),
      supabase.from('review_tasks').select('id', { count: 'exact', head: true }).eq('upload_id', upload.id).neq('status', 'resolved'),
      supabase.from('validation_alerts').select('id', { count: 'exact', head: true }).eq('upload_id', upload.id),
      supabase.from('validation_alerts').select('id', { count: 'exact', head: true }).eq('upload_id', upload.id).eq('category', 'orthography'),
    ]);
    assignedTasks = total ?? 0; assignedPending = pending ?? 0; assignedAlerts = alertTotal ?? 0; assignedOrthography = orthographyTotal ?? 0;
  }

  const totalRows = Number(upload?.total_rows ?? 0);
  const taskCount = viewer.role === 'validator' ? assignedTasks ?? 0 : Number(upload?.task_count ?? 0);
  const pending = viewer.role === 'validator' ? assignedPending ?? 0 : Number(upload?.pending_task_count ?? 0);
  const alerts = viewer.role === 'validator' ? assignedAlerts ?? 0 : Number(upload?.alert_count ?? 0);
  const resolved = Math.max(0, taskCount - pending);
  const status = String(upload?.status ?? '');

  return (
    <>
      <header className="page-heading"><div><p className="overline">{viewer.role === 'leader' ? 'PANORAMA DE LA JORNADA' : 'MI ASIGNACIÓN'}</p><h1>{viewer.role === 'leader' ? 'Control de la validación' : `Hola, ${viewer.displayName.split(' ')[0]}`}</h1><p>{upload ? `Jornada: ${String(upload.display_name)}. Los números se actualizan al resolver, recuperar el foco y cada 30 segundos.` : 'Todavía no hay una jornada activa en este espacio.'}</p></div>{viewer.role === 'leader' && <div className="heading-actions"><Link className="button button-primary" href="/workspace/cargas/nueva"><UploadCloudIcon/>Nueva jornada</Link></div>}</header>
      <MetricStrip items={[
        { label: 'Registros totales', value: format(totalRows) },
        { label: viewer.role === 'leader' ? 'Tareas o filas únicas' : 'Tareas asignadas', value: format(taskCount), tone: 'orange' },
        { label: viewer.role === 'validator' ? `Eventos · ${format(assignedOrthography)} ortografía` : 'Eventos de alerta', value: format(alerts), tone: 'purple' },
        { label: 'Pendientes', value: format(pending), tone: 'yellow' },
        { label: 'Resueltas', value: format(resolved), tone: 'green' },
      ]} />
      {!upload ? <section className="panel empty-state"><UploadCloudIcon/><h2>Comienza con el panel y sus facturas</h2><p>El líder crea la jornada; después la plataforma prepara tareas por fila y mantiene juntos los grupos relacionados.</p>{viewer.role === 'leader' && <Link className="button button-primary" href="/workspace/cargas/nueva">Crear primera jornada</Link>}</section> : (
        <div className="split-grid">
          <section className="panel"><div className="panel-header"><div><h2>Avance operativo</h2><p>{status === 'ready' || status === 'assigning' ? 'La jornada está lista para repartir.' : status === 'active' ? 'El reparto está publicado.' : 'Estado de la jornada.'}</p></div><span className={`status ${status === 'active' ? 'active' : status === 'completed' ? 'resolved' : 'draft'}`}>{status || 'sin estado'}</span></div><div className="panel-body"><div className="progress-bar"><span style={{ width: `${taskCount ? (resolved / taskCount) * 100 : 0}%` }}/></div><p>{format(resolved)} de {format(taskCount)} tareas resueltas</p><div className="decision-actions">{viewer.role === 'leader' && ['ready', 'assigning'].includes(status) && <Link className="button button-primary" href={`/workspace/reparto/${String(upload.id)}`}><UsersIcon/>Preparar reparto</Link>}<Link className="button button-secondary" href="/workspace/tareas"><TasksIcon/>Abrir revisión</Link></div></div></section>
          <section className="panel"><div className="panel-header"><div><h2>Acciones rápidas</h2><p>Continúa sin perder el contexto de la jornada.</p></div></div><div className="panel-body quick-list"><Link className="quick-row" href="/workspace/tareas"><span><strong>Revisar tareas</strong><small>Dato, sugerencia, relacionados y factura</small></span><ArrowIcon/></Link>{viewer.role === 'leader' && <><Link className="quick-row" href="/workspace/equipo"><span><strong>Ver productividad</strong><small>Trabajo por persona y tipo de decisión</small></span><ArrowIcon/></Link><Link className="quick-row" href="/workspace/exportar"><span><strong>Preparar los Excel</strong><small>Alertas, sugerencias y base corregida</small></span><FileIcon/></Link></>}</div></section>
        </div>
      )}
    </>
  );
}
