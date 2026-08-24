import { ExportCenter } from '@/components/export-center';
import { FileIcon } from '@/components/icons';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Descargas' };

export default async function ExportPage() {
  const viewer = await requireViewer('leader');
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase.from('uploads').select('id, display_name, panel_object_path, total_rows, task_count, alert_count, orthography_count, pending_task_count, corrected_cell_count, confirmed_correct_count, created_at').eq('workspace_id', viewer.workspaceId).in('status', ['active', 'completed']).order('created_at', { ascending: false }).limit(1);
  const upload = data?.[0];
  return <><header className="page-heading"><div><p className="overline">SALIDAS DE LA JORNADA</p><h1>Tres Excel, tres propósitos</h1><p>Los archivos se generan bajo demanda en tu navegador y no se vuelven a almacenar en Supabase.</p></div></header>{upload ? <ExportCenter upload={upload}/> : <section className="panel empty-state"><FileIcon/><h2>No hay una jornada publicada</h2><p>Publica el reparto para habilitar el reporte, la base con sugerencias y el Excel corregido.</p></section>}</>;
}
