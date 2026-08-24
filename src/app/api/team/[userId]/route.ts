import { randomBytes } from 'node:crypto';
import { getViewer } from '@/lib/auth';
import { jsonError } from '@/lib/http';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const temporaryKey = () => Array.from(randomBytes(10), (byte) => ALPHABET[byte % ALPHABET.length]).join('');

export async function PATCH(request: Request, context: { params: Promise<{ userId: string }> }) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const { userId } = await context.params;
  const body = await request.json().catch(() => ({}));
  const admin = createAdminSupabaseClient();

  if (body.action === 'reset-pin') {
    const { data: membership, error: membershipError } = await admin
      .from('workspace_members')
      .select('user_id')
      .eq('workspace_id', viewer.workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (membershipError || !membership) return jsonError('El usuario no pertenece a este equipo.', 404);
    const supabase = await createServerSupabaseClient();
    const { error: stateError } = await supabase.rpc('reset_member_pin_state', {
      p_workspace_id: viewer.workspaceId,
      p_user_id: userId,
    });
    if (stateError) return jsonError(stateError.message, 400);
    const password = temporaryKey();
    const { error } = await admin.auth.admin.updateUserById(userId, { password });
    if (error) return jsonError('La cuenta quedó pendiente de cambio, pero no fue posible generar una clave temporal. El PIN anterior sigue funcionando.', 502);
    return NextResponse.json({ ok: true, temporaryKey: password });
  }

  if (body.action === 'set-active' && typeof body.active === 'boolean') {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.rpc('set_workspace_member_active', {
      p_workspace_id: viewer.workspaceId,
      p_user_id: userId,
      p_is_active: body.active,
    });
    if (error) return jsonError(error.message, 400);
    return NextResponse.json({ ok: true });
  }

  return jsonError('Acción no reconocida.');
}
