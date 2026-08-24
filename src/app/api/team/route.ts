import { randomBytes, randomUUID } from 'node:crypto';
import { getViewer } from '@/lib/auth';
import { jsonError, normalizeUsername } from '@/lib/http';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';

function temporaryKey() {
  const bytes = randomBytes(10);
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
}

export async function POST(request: Request) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'leader') return jsonError('No autorizado.', 403);
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const displayName = String(body.displayName ?? '').trim();
  const role = body.role === 'leader' ? 'leader' : 'validator';
  if (!username || displayName.length < 2) return jsonError('Nombre y usuario son obligatorios.');

  const admin = createAdminSupabaseClient();
  const email = `pqm-${randomUUID()}@auth.invalid`;
  const password = temporaryKey();
  const { data: created, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (authError || !created.user) return jsonError('No fue posible crear la cuenta. El usuario puede estar repetido.', 400);

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc('register_workspace_member', {
    p_workspace_id: viewer.workspaceId,
    p_user_id: created.user.id,
    p_username: username,
    p_display_name: displayName,
    p_role: role,
    p_auth_email: email,
  });
  if (error) {
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonError(error.message, 400);
  }

  return NextResponse.json({ ok: true, username, temporaryKey: password, role });
}
