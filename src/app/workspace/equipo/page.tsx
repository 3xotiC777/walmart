import { TeamManager } from '@/components/team-manager';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Equipo' };

export default async function TeamPage() {
  const viewer = await requireViewer('leader');
  const supabase = await createServerSupabaseClient();
  const [{ data }, { data: uploads }] = await Promise.all([
    supabase.from('workspace_members').select('user_id, role, is_active, profiles!workspace_members_user_id_fkey(username, display_name, must_change_pin)').eq('workspace_id', viewer.workspaceId).order('created_at'),
    supabase.from('uploads').select('id').eq('workspace_id', viewer.workspaceId).order('created_at', { ascending: false }).limit(1),
  ]);
  const uploadId = uploads?.[0]?.id;
  const { data: productivityRows } = uploadId ? await supabase.from('daily_productivity').select('user_id, tasks_resolved, alerts_resolved, cells_changed, rows_corrected, confirmed_correct').eq('upload_id', uploadId) : { data: [] };
  const productivity = [...new Set((productivityRows ?? []).map((row) => row.user_id))].map((userId) => {
    const rows = (productivityRows ?? []).filter((row) => row.user_id === userId);
    return { userId, tasks: rows.reduce((sum, row) => sum + row.tasks_resolved, 0), alerts: rows.reduce((sum, row) => sum + row.alerts_resolved, 0), cells: rows.reduce((sum, row) => sum + row.cells_changed, 0), rows: rows.reduce((sum, row) => sum + row.rows_corrected, 0), correct: rows.reduce((sum, row) => sum + row.confirmed_correct, 0) };
  });
  return <><header className="page-heading"><div><p className="overline">EQUIPO Y SEGURIDAD</p><h1>Integrantes del espacio</h1><p>Crea validadores y líderes, restablece accesos y desactiva cuentas sin perder la auditoría. El último líder siempre queda protegido.</p></div></header><TeamManager members={(data ?? []) as never} productivity={productivity} /></>;
}
