import Link from 'next/link';
import { AssignmentBoard } from '@/components/assignment-board';
import { fetchAllAssignmentBlocks } from '@/lib/assignment-block-pagination';
import { requireViewer } from '@/lib/auth';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';

export const metadata = { title: 'Repartir jornada' };

export default async function AssignmentPage({ params }: { params: Promise<{ uploadId: string }> }) {
  const viewer = await requireViewer('leader');
  const { uploadId } = await params;
  const supabase = await createServerSupabaseClient();
  const [{ data: upload }, blockCollection, { data: members }] = await Promise.all([
    supabase.from('uploads').select('id, display_name, status, task_count, pending_task_count, alert_count, version, assignment_version').eq('id', uploadId).eq('workspace_id', viewer.workspaceId).maybeSingle(),
    fetchAllAssignmentBlocks(supabase, uploadId),
    supabase.from('workspace_members').select('user_id, profiles!workspace_members_user_id_fkey(display_name, username, must_change_pin)').eq('workspace_id', viewer.workspaceId).eq('role', 'validator').eq('is_active', true),
  ]);
  if (!upload) notFound();

  const status = String(upload.status);
  const mode = status === 'active' ? 'redistribute' : 'initial';
  const supportedStatus = ['ready', 'assigning', 'active'].includes(status);
  const pendingTaskCount = Number(upload.pending_task_count);
  const validators = (members ?? []).map((member) => {
    const profile = Array.isArray(member.profiles) ? member.profiles[0] : member.profiles;
    return {
      userId: member.user_id,
      name: String(profile?.display_name ?? 'Validador'),
      username: String(profile?.username ?? ''),
      mustChangePin: Boolean(profile?.must_change_pin),
    };
  });
  const redistributableBlocks = mode === 'redistribute'
    ? blockCollection.blocks.filter((block) => block.status !== 'completed')
    : blockCollection.blocks;
  const mappedBlocks = redistributableBlocks.map((block) => ({
    id: block.id,
    blockKey: block.block_key,
    alertCount: block.alert_count,
    memberCount: block.member_count,
    invoiceCount: block.invoice_count,
    weight: Number(block.weight),
    assignedTo: block.assigned_to,
    version: mode === 'redistribute' ? block.assignment_version : block.version,
  }));
  const activeValidatorIds = new Set(validators.map((validator) => validator.userId));
  const inactiveAssignmentCount = mappedBlocks.filter((block) => (
    Boolean(block.assignedTo) && !activeValidatorIds.has(block.assignedTo ?? '')
  )).length;
  const completedBlockCount = blockCollection.total - mappedBlocks.length;
  const assignmentVersion = mode === 'redistribute'
    ? Number(upload.assignment_version)
    : Number(upload.version);

  return <>
    <header className="page-heading"><div><p className="overline">{mode === 'redistribute' ? 'AJUSTE DEL EQUIPO' : 'REPARTO DE CARGA'}</p><h1>{mode === 'redistribute' ? 'Repartir nuevamente la carga' : 'Distribuir bloques relacionados'}</h1><p>{upload.display_name} · {Number(upload.task_count).toLocaleString('es-CO')} tareas · {Number(upload.alert_count).toLocaleString('es-CO')} eventos. {mode === 'redistribute' ? 'Elige quiénes trabajarán ahora y calcula una nueva distribución para lo que sigue pendiente.' : 'Elige quiénes trabajarán, calcula la propuesta, revísala y luego publícala.'}</p></div></header>
    {!supportedStatus ? <section className="panel empty-state"><h2>Esta jornada ya no admite cambios de reparto</h2><p>Solo las jornadas listas, en preparación o activas pueden distribuirse.</p><Link className="button button-secondary" href="/workspace" prefetch={false}>Volver al tablero</Link></section> : mode === 'redistribute' && pendingTaskCount === 0 ? <section className="panel empty-state"><h2>La jornada ya está completa</h2><p>No quedan tareas pendientes para repartir nuevamente.</p><Link className="button button-secondary" href="/workspace" prefetch={false}>Volver al tablero</Link></section> : validators.length === 0 && mappedBlocks.length > 0 ? <section className="panel empty-state"><h2>Primero crea o reactiva validadores</h2><p>Necesitas al menos una persona activa con rol Validador para repartir los bloques pendientes.</p><Link className="button button-primary" href="/workspace/equipo" prefetch={false}>Administrar equipo</Link></section> : <AssignmentBoard
      key={`${mode}-${assignmentVersion}`}
      uploadId={uploadId}
      mode={mode}
      initialAssignmentVersion={assignmentVersion}
      initialBlocks={mappedBlocks}
      initialProposalReady={status === 'assigning' && inactiveAssignmentCount === 0}
      expectedBlockCount={mappedBlocks.length}
      pendingTaskCount={pendingTaskCount}
      completedBlockCount={completedBlockCount}
      inactiveAssignmentCount={inactiveAssignmentCount}
      validators={validators}
    />}
  </>;
}
