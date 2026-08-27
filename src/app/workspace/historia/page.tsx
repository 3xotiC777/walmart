import Link from 'next/link';
import { MetricStrip } from '@/components/metrics';
import { requireViewer } from '@/lib/auth';
import {
  buildHistoryHref,
  describeHistoryEvent,
  HISTORY_PAGE_SIZE,
  historyEventTypes,
  normalizeHistoryCursor,
  normalizeHistoryKind,
  type HistoryDecisionDetail,
  type HistoryResolutionDetail,
} from '@/lib/audit-history';
import { validUuid } from '@/lib/http';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Json } from '@/lib/supabase/database.types';
import styles from './history.module.css';

export const metadata = { title: 'Historia' };

type PageSearchParams = Promise<Record<string, string | string[] | undefined>>;
type AuditEvent = {
  id: number;
  actor_user_id: string | null;
  upload_id: string | null;
  event_type: string;
  entity_type: string;
  entity_id: string | null;
  payload: Json;
  occurred_at: string;
};

const REVIEW_EVENTS = historyEventTypes('reviews') ?? [];
const KIND_LABELS = {
  all: 'Toda la actividad',
  uploads: 'Cargas y procesamiento',
  reviews: 'Cambios y revisiones',
  downloads: 'Descargas de Excel',
  assignments: 'Repartos y reasignaciones',
  team: 'Administración del equipo',
} as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? '';
}

function objectPayload(value: Json): Record<string, Json | undefined> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, Json | undefined>
    : {};
}

function formatDate(value: string): { date: string; time: string } {
  const date = new Date(value);
  return {
    date: new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeZone: 'America/Bogota' }).format(date),
    time: new Intl.DateTimeFormat('es-CO', { timeStyle: 'short', timeZone: 'America/Bogota' }).format(date),
  };
}

function closestDecision(event: AuditEvent, decisions: Array<Record<string, unknown>>): Record<string, unknown> | null {
  const candidates = decisions.filter((decision) => decision.alert_id === event.entity_id);
  if (candidates.length === 0) return null;
  const eventTime = new Date(event.occurred_at).getTime();
  return candidates.sort((left, right) => (
    Math.abs(new Date(String(left.decided_at)).getTime() - eventTime)
      - Math.abs(new Date(String(right.decided_at)).getTime() - eventTime)
  ))[0];
}

export default async function HistoryPage({ searchParams }: { searchParams: PageSearchParams }) {
  const viewer = await requireViewer('leader');
  const params = await searchParams;
  const requestedUpload = first(params.upload);
  const requestedActor = first(params.actor);
  const uploadId = validUuid(requestedUpload) ? requestedUpload : '';
  const actorId = validUuid(requestedActor) ? requestedActor : '';
  const kind = normalizeHistoryKind(params.kind);
  const before = normalizeHistoryCursor(params.before);
  const supabase = await createServerSupabaseClient();

  const uploadsRequest = supabase
    .from('uploads')
    .select('id, display_name, status, created_at, total_rows, alert_count, created_by')
    .eq('workspace_id', viewer.workspaceId)
    .order('created_at', { ascending: false });
  const membersRequest = supabase
    .from('workspace_members')
    .select('user_id, role, is_active, profiles!workspace_members_user_id_fkey(username, display_name)')
    .eq('workspace_id', viewer.workspaceId)
    .order('created_at');
  const totalRequest = supabase.from('audit_events').select('id', { count: 'exact', head: true }).eq('workspace_id', viewer.workspaceId);
  const uploadsCountRequest = supabase.from('audit_events').select('id', { count: 'exact', head: true }).eq('workspace_id', viewer.workspaceId).eq('event_type', 'upload.created');
  const reviewsCountRequest = supabase.from('audit_events').select('id', { count: 'exact', head: true }).eq('workspace_id', viewer.workspaceId).in('event_type', [...REVIEW_EVENTS]);
  const downloadsCountRequest = supabase.from('audit_events').select('id', { count: 'exact', head: true }).eq('workspace_id', viewer.workspaceId).eq('event_type', 'export.downloaded');

  let eventRequest = supabase
    .from('audit_events')
    .select('id, actor_user_id, upload_id, event_type, entity_type, entity_id, payload, occurred_at')
    .eq('workspace_id', viewer.workspaceId)
    .order('id', { ascending: false })
    .limit(HISTORY_PAGE_SIZE + 1);
  if (uploadId) eventRequest = eventRequest.eq('upload_id', uploadId);
  if (actorId) eventRequest = eventRequest.eq('actor_user_id', actorId);
  const selectedTypes = historyEventTypes(kind);
  if (selectedTypes) eventRequest = eventRequest.in('event_type', [...selectedTypes]);
  if (before) eventRequest = eventRequest.lt('id', before);

  const [uploadsResponse, membersResponse, totalResponse, uploadsCountResponse, reviewsCountResponse, downloadsCountResponse, eventsResponse] = await Promise.all([
    uploadsRequest,
    membersRequest,
    totalRequest,
    uploadsCountRequest,
    reviewsCountRequest,
    downloadsCountRequest,
    eventRequest,
  ]);
  const pageError = uploadsResponse.error ?? membersResponse.error ?? eventsResponse.error;
  const uploads = uploadsResponse.data ?? [];
  const members = membersResponse.data ?? [];
  const fetchedEvents = (eventsResponse.data ?? []) as AuditEvent[];
  const hasMore = fetchedEvents.length > HISTORY_PAGE_SIZE;
  const events = fetchedEvents.slice(0, HISTORY_PAGE_SIZE);

  const alertIds = [...new Set(events.filter((event) => event.entity_type === 'alert' && event.entity_id).map((event) => event.entity_id!))];
  const resolutionIds = [...new Set(events
    .filter((event) => event.entity_type === 'cell_resolution' && event.entity_id && /^\d+$/.test(event.entity_id))
    .map((event) => Number(event.entity_id)))];
  const [decisionsResponse, alertsResponse, resolutionsResponse] = await Promise.all([
    alertIds.length
      ? supabase.from('alert_decisions').select('id, alert_id, decision, field_name, resolved_value, decided_at, decided_by').in('alert_id', alertIds)
      : Promise.resolve({ data: [], error: null }),
    alertIds.length
      ? supabase.from('validation_alerts').select('id, task_id, original_value, affected_field, rule_code').in('id', alertIds)
      : Promise.resolve({ data: [], error: null }),
    resolutionIds.length
      ? supabase.from('cell_resolutions').select('id, source_row_id, field_name, original_value, resolved_value').in('id', resolutionIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  const decisions = (decisionsResponse.data ?? []) as Array<Record<string, unknown>>;
  const alerts = (alertsResponse.data ?? []) as Array<Record<string, unknown>>;
  const resolutions = (resolutionsResponse.data ?? []) as Array<Record<string, unknown>>;
  const alertById = new Map(alerts.map((alert) => [String(alert.id), alert]));
  const taskIds = new Set(alerts.map((alert) => String(alert.task_id)));
  for (const event of events) {
    if (event.entity_type === 'review_task' && event.entity_id) taskIds.add(event.entity_id);
    const payloadTaskId = objectPayload(event.payload).task_id;
    if (typeof payloadTaskId === 'string') taskIds.add(payloadTaskId);
  }
  const tasksResponse = taskIds.size
    ? await supabase.from('review_tasks').select('id, source_row_id').in('id', [...taskIds])
    : { data: [], error: null };
  const tasks = (tasksResponse.data ?? []) as Array<Record<string, unknown>>;
  const taskById = new Map(tasks.map((task) => [String(task.id), task]));
  const sourceRowIds = new Set(tasks.map((task) => Number(task.source_row_id)).filter(Number.isFinite));
  for (const resolution of resolutions) sourceRowIds.add(Number(resolution.source_row_id));
  const rowsResponse = sourceRowIds.size
    ? await supabase.from('source_rows').select('id, excel_row, row_id, description').in('id', [...sourceRowIds])
    : { data: [], error: null };
  const detailsError = decisionsResponse.error
    ?? alertsResponse.error
    ?? resolutionsResponse.error
    ?? tasksResponse.error
    ?? rowsResponse.error;
  const rows = (rowsResponse.data ?? []) as Array<Record<string, unknown>>;
  const rowById = new Map(rows.map((row) => [Number(row.id), row]));
  const uploadById = new Map(uploads.map((upload) => [upload.id, upload]));
  const actorById = new Map(members.map((member) => {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
    return [member.user_id, {
      displayName: String(profile?.display_name ?? profile?.username ?? 'Usuario'),
      username: String(profile?.username ?? ''),
      role: member.role,
      isActive: member.is_active,
    }];
  }));

  const visibleEvents = events.map((event) => {
    const alert = event.entity_id ? alertById.get(event.entity_id) : null;
    const rawDecision = closestDecision(event, decisions);
    const task = alert ? taskById.get(String(alert.task_id)) : (event.entity_id ? taskById.get(event.entity_id) : null);
    const row = task ? rowById.get(Number(task.source_row_id)) : null;
    const decision: HistoryDecisionDetail | null = rawDecision ? {
      decision: rawDecision.decision as HistoryDecisionDetail['decision'],
      originalValue: alert?.original_value === null || alert?.original_value === undefined ? null : String(alert.original_value),
      resolvedValue: rawDecision.resolved_value === null || rawDecision.resolved_value === undefined ? null : String(rawDecision.resolved_value),
      fieldName: rawDecision.field_name === null || rawDecision.field_name === undefined ? String(alert?.affected_field ?? '') || null : String(rawDecision.field_name),
      ruleCode: alert?.rule_code ? String(alert.rule_code) : null,
      excelRow: row?.excel_row ? Number(row.excel_row) : null,
      rowId: row?.row_id ? String(row.row_id) : null,
    } : null;
    const rawResolution = event.entity_type === 'cell_resolution' ? resolutions.find((item) => String(item.id) === event.entity_id) : null;
    const resolutionRow = rawResolution ? rowById.get(Number(rawResolution.source_row_id)) : null;
    const resolution: HistoryResolutionDetail | null = rawResolution ? {
      originalValue: rawResolution.original_value === null || rawResolution.original_value === undefined ? null : String(rawResolution.original_value),
      resolvedValue: rawResolution.resolved_value === null || rawResolution.resolved_value === undefined ? null : String(rawResolution.resolved_value),
      fieldName: rawResolution.field_name ? String(rawResolution.field_name) : null,
      excelRow: resolutionRow?.excel_row ? Number(resolutionRow.excel_row) : null,
      rowId: resolutionRow?.row_id ? String(resolutionRow.row_id) : null,
    } : null;
    return { event, actor: event.actor_user_id ? actorById.get(event.actor_user_id) : null, upload: event.upload_id ? uploadById.get(event.upload_id) : null, presentation: describeHistoryEvent({ eventType: event.event_type, payload: event.payload, decision, resolution }) };
  });

  const filteredHref = (nextBefore?: number | null) => buildHistoryHref({ uploadId, actorId, kind, before: nextBefore });
  const nextCursor = visibleEvents.at(-1)?.event.id ?? null;

  return <>
    <header className="page-heading"><div><p className="overline">CÁMARA DE AUDITORÍA</p><h1>Historia del equipo</h1><p>Consulta quién cargó cada jornada, qué corrigió o confirmó cada persona y qué archivos Excel descargó. Las acciones se conservan aunque cambie la jornada activa.</p></div></header>
    <MetricStrip items={[
      { label: 'Actividades registradas', value: Number(totalResponse.count ?? 0).toLocaleString('es-CO') },
      { label: 'Jornadas cargadas', value: Number(uploadsCountResponse.count ?? 0).toLocaleString('es-CO'), tone: 'green' },
      { label: 'Acciones de revisión', value: Number(reviewsCountResponse.count ?? 0).toLocaleString('es-CO'), tone: 'orange' },
      { label: 'Excel descargados', value: Number(downloadsCountResponse.count ?? 0).toLocaleString('es-CO'), tone: 'purple' },
    ]}/>

    <section className="panel">
      <div className="panel-header"><div><p className="overline">TRAZABILIDAD</p><h2>Actividad de todas las jornadas</h2><p>Las descargas anteriores a la creación de esta sección no pueden reconstruirse; las nuevas quedan registradas desde ahora.</p></div></div>
      <form className={styles.filters} method="get">
        <label><span>Jornada</span><select className="form-control" defaultValue={uploadId} name="upload"><option value="">Todas las jornadas</option>{uploads.map((upload) => <option key={upload.id} value={upload.id}>{upload.display_name}</option>)}</select></label>
        <label><span>Persona</span><select className="form-control" defaultValue={actorId} name="actor"><option value="">Todas las personas</option>{members.map((member) => { const actor = actorById.get(member.user_id); return <option key={member.user_id} value={member.user_id}>{actor?.displayName}{member.is_active ? '' : ' · inactivo'}</option>; })}</select></label>
        <label><span>Tipo de actividad</span><select className="form-control" defaultValue={kind} name="kind">{Object.entries(KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <div className={styles.filterActions}><button className="button button-primary" type="submit">Aplicar filtros</button><Link className="button button-secondary" href="/workspace/historia" prefetch={false}>Limpiar</Link></div>
      </form>

      {pageError && <p className={`form-error ${styles.error}`}>No fue posible cargar toda la historia: {pageError.message}</p>}
      {!pageError && detailsError && <p className={`form-error ${styles.error}`}>La actividad se cargó, pero faltó parte de su evidencia: {detailsError.message}</p>}
      {!pageError && (visibleEvents.length === 0 ? <div className="empty-state"><h2>No hay actividades con estos filtros</h2><p>Prueba otra jornada, persona o tipo de evento.</p></div> : <div className="data-table-wrap"><table className={`data-table ${styles.table}`}><thead><tr><th>Fecha</th><th>Persona</th><th>Actividad</th><th>Jornada</th><th>Evidencia</th></tr></thead><tbody>{visibleEvents.map(({ event, actor, upload, presentation }) => { const stamp = formatDate(event.occurred_at); return <tr key={event.id}><td className={styles.date}><strong>{stamp.date}</strong><small>{stamp.time}</small><code>#{event.id}</code></td><td><div className={styles.actor}><span>{(actor?.displayName ?? 'S').slice(0, 1).toUpperCase()}</span><div><strong>{actor?.displayName ?? 'Sistema'}</strong><small>{actor ? `${actor.role === 'leader' ? 'Líder' : 'Validador'}${actor.isActive ? '' : ' · inactivo'}` : 'Proceso automático'}</small></div></div></td><td><span className={`${styles.category} ${styles[presentation.category]}`}>{KIND_LABELS[presentation.category as keyof typeof KIND_LABELS] ?? 'Sistema'}</span><strong className={styles.title}>{presentation.title}</strong>{presentation.detail && <small className={styles.detail}>{presentation.detail}</small>}</td><td><strong className={styles.upload}>{upload?.display_name ?? (event.upload_id ? 'Jornada archivada' : 'Espacio general')}</strong>{upload && <small className={styles.detail}>{Number(upload.total_rows).toLocaleString('es-CO')} registros · {Number(upload.alert_count).toLocaleString('es-CO')} alertas</small>}</td><td>{presentation.before !== null || presentation.after !== null ? <div className={styles.change}><span><small>Antes</small><strong>{presentation.before || 'Vacío'}</strong></span><b>→</b><span><small>Después</small><strong>{presentation.after || 'Vacío'}</strong></span></div> : <span className={styles.noChange}>Sin cambio de valor</span>}</td></tr>; })}</tbody></table></div>)}

      <footer className={`page-footer ${styles.pagination}`}><span>Se muestran hasta {HISTORY_PAGE_SIZE} actividades por bloque.</span><nav>{before && <Link className="button button-secondary" href={filteredHref()} prefetch={false}>← Volver al inicio</Link>}{hasMore && nextCursor && <Link className="button button-secondary" href={filteredHref(nextCursor)} prefetch={false}>Ver actividades anteriores →</Link>}</nav></footer>
    </section>
  </>;
}
