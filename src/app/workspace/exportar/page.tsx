import { ExportCenter } from '@/components/export-center';
import { FileIcon } from '@/components/icons';
import { requireViewer } from '@/lib/auth';
import { CURRENT_JOURNEY_STATUSES } from '@/lib/current-journey';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const metadata = { title: 'Descargas' };

export default async function ExportPage() {
  const viewer = await requireViewer('leader');
  const supabase = await createServerSupabaseClient();
  const { data } = await supabase
    .from('uploads')
    .select('id, display_name, panel_object_path, has_barcode, total_rows, task_count, alert_count, orthography_count, pending_task_count, corrected_cell_count, confirmed_correct_count, created_at')
    .eq('workspace_id', viewer.workspaceId)
    .in('status', [...CURRENT_JOURNEY_STATUSES])
    .order('created_at', { ascending: false })
    .limit(1);
  const upload = data?.[0];
  return <><header className="page-heading"><div><p className="overline">SALIDAS DE LA JORNADA</p><h1>Tres Excel, tres propósitos</h1><p>{upload ? <>Jornada vigente: <strong>{upload.display_name}</strong> · {Number(upload.total_rows).toLocaleString('es-CO')} registros · {Number(upload.alert_count).toLocaleString('es-CO')} alertas.</> : 'Los archivos se generan bajo demanda en tu navegador y no se vuelven a almacenar en Supabase.'}</p></div></header>{upload ? <ExportCenter key={upload.id} upload={upload}/> : <section className="panel empty-state"><FileIcon/><h2>No hay una jornada disponible</h2><p>Crea y procesa una jornada para habilitar el reporte, la base con sugerencias y el Excel corregido.</p></section>}</>;
}
