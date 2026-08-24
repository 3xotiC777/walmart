import { AssignmentBoard } from '@/components/assignment-board';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Repartir jornada' };

export default async function AssignmentPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const viewer = await requireViewer('leader');
  const { uploadId } = await params;
  const supabase = await createServerSupabaseClient();
  const [{ data: upload }, { data: blocks }, { data: members }] = await Promise.all([
    supabase.from('uploads').select('id, display_name, status, task_count, alert_count, version').eq('id', uploadId).eq('workspace_id', viewer.workspaceId).maybeSingle(),
    supabase.from('assignment_blocks').select('id, block_key, alert_count, member_count, invoice_count, weight, assigned_to, version').eq('upload_id', uploadId).order('weight', { ascending: false }),
    supabase.from('workspace_members').select('user_id, profiles!workspace_members_user_id_fkey(display_name, username)').eq('workspace_id', viewer.workspaceId).eq('role', 'validator').eq('is_active', true),
  ]);
  if (!upload) notFound();
  const validators = (members ?? []).map((member) => { const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles; return { userId: member.user_id, name: String(profile?.display_name ?? 'Validador'), username: String(profile?.username ?? '') }; });
  const mappedBlocks = (blocks ?? []).map((block) => ({ id: block.id, blockKey: block.block_key, alertCount: block.alert_count, memberCount: block.member_count, invoiceCount: block.invoice_count, weight: Number(block.weight), assignedTo: block.assigned_to, version: block.version }));
  return <><header className="page-heading"><div><p className="overline">REPARTO DE CARGA</p><h1>Distribuir bloques relacionados</h1><p>{upload.display_name} · {Number(upload.task_count).toLocaleString('es-CO')} tareas · {Number(upload.alert_count).toLocaleString('es-CO')} eventos. Primero calcula la propuesta, revísala y luego publícala.</p></div></header>{validators.length === 0 && mappedBlocks.length > 0 ? <section className="panel empty-state"><h2>Primero crea validadores activos</h2><p>Necesitas al menos una persona con rol Validador para repartir los bloques.</p></section> : <AssignmentBoard key={upload.version} uploadId={uploadId} initialUploadVersion={upload.version} initialBlocks={mappedBlocks} validators={validators}/>}</>;
}
