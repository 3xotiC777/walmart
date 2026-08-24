import Link from 'next/link';
import { TaskReview, type AlertView } from '@/components/task-review';
import { RelatedEditor } from '@/components/related-editor';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Revisar tarea' };

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const viewer = await requireViewer();
  const { taskId } = await params;
  const supabase = await createServerSupabaseClient();
  const { data: task } = await supabase.from('review_tasks').select('id, upload_id, source_row_id, status, version, is_related_only, source_rows(id, excel_row, row_id, id_dn_w, barcode, description, field_values), assignment_blocks(id, version, assigned_to), validation_alerts(*)').eq('id', taskId).maybeSingle();
  if (!task) notFound();
  const source = Array.isArray(task.source_rows) ? task.source_rows[0] : task.source_rows;
  const block = Array.isArray(task.assignment_blocks) ? task.assignment_blocks[0] : task.assignment_blocks;
  const alerts = (task.validation_alerts ?? []) as AlertView[];
  const { data: invoiceRows } = source?.id_dn_w ? await supabase.from('invoice_links').select('external_url').eq('upload_id', task.upload_id).eq('id_dn_w', source.id_dn_w).not('external_url', 'is', null).range(0, 19) : { data: [] };
  const invoices = [...new Set((invoiceRows ?? []).map((item) => item.external_url).filter((url): url is string => Boolean(url)))];
  const { data: upload } = await supabase
    .from('uploads')
    .select('source_headers')
    .eq('id', task.upload_id)
    .maybeSingle();
  const headers = Array.isArray(upload?.source_headers) ? upload.source_headers.map(String) : [];
  return <><header className="page-heading"><div><p className="overline">TAREA · FILA {source?.excel_row}</p><h1>{source?.description || 'Registro sin descripción'}</h1><p>Row-Id <span className="mono">{source?.row_id || '—'}</span> · Código <span className="mono">{source?.barcode || '—'}</span> · Id_Dn W <span className="mono">{source?.id_dn_w || '—'}</span></p></div><Link className="button button-secondary" href="/workspace/tareas">← Volver a la bandeja</Link></header>{task.is_related_only && alerts.length === 0 ? <RelatedEditor taskId={task.id} version={task.version} fields={source?.field_values ?? {}} headers={headers} status={task.status} role={viewer.role}/> : <TaskReview taskId={task.id} blockId={block!.id} blockVersion={block!.version} blockAssignedTo={block!.assigned_to} role={viewer.role} alerts={alerts} invoices={invoices}/>}</>;
}
