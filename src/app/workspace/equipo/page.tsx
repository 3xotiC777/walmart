import { TeamManager } from '@/components/team-manager';
import { requireViewer } from '@/lib/auth';
import { CURRENT_JOURNEY_STATUSES } from '@/lib/current-journey';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

export const metadata = { title: 'Equipo' };

type TeamProductivityRow = Database['public']['Functions']['get_upload_team_productivity']['Returns'][number];

export default async function TeamPage() {
  const viewer = await requireViewer('leader');
  const supabase = await createServerSupabaseClient();
  const [{ data }, { data: uploads }] = await Promise.all([
    supabase.from('workspace_members').select('user_id, role, is_active, profiles!workspace_members_user_id_fkey(username, display_name, must_change_pin)').eq('workspace_id', viewer.workspaceId).order('created_at'),
    supabase.from('uploads').select('id').eq('workspace_id', viewer.workspaceId).in('status', [...CURRENT_JOURNEY_STATUSES]).order('created_at', { ascending: false }).limit(1),
  ]);
  const uploadId = uploads?.[0]?.id;
  const productivityResponse = uploadId
    ? await supabase.rpc('get_upload_team_productivity', { p_upload_id: uploadId })
    : { data: [] as TeamProductivityRow[], error: null };
  const productivity = (productivityResponse.data ?? []).map((row: TeamProductivityRow) => ({
    userId: row.user_id,
    assignedTasks: Number(row.assigned_task_count),
    assignedAlerts: Number(row.assigned_alert_count),
    pendingTasks: Number(row.pending_task_count),
    completedAssignmentTasks: Number(row.completed_assignment_task_count),
    tasks: Number(row.tasks_resolved),
    alerts: Number(row.alerts_resolved),
    cells: Number(row.cells_changed),
    rows: Number(row.rows_corrected),
    correct: Number(row.confirmed_correct),
  }));
  return <><header className="page-heading"><div><p className="overline">EQUIPO Y SEGURIDAD</p><h1>Integrantes del espacio</h1><p>Crea validadores y líderes, restablece accesos y desactiva cuentas sin perder la auditoría. El último líder siempre queda protegido.</p></div></header><TeamManager members={(data ?? []) as never} productivity={productivity} productivityError={productivityResponse.error?.message ?? null} /></>;
}
