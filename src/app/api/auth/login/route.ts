import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { jsonError, normalizeUsername } from '@/lib/http';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const username = normalizeUsername(body.username);
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || password.length < 6 || password.length > 72) {
    return jsonError('Usuario o clave incorrectos.', 401);
  }

  const admin = createAdminSupabaseClient();
  const { data: identities } = await admin.rpc('get_login_identity', { p_username: username });
  const profile = Array.isArray(identities) ? identities[0] : identities;

  if (!profile?.is_active) {
    await admin.rpc('record_login_attempt', { p_username: username, p_succeeded: false });
    return jsonError('Usuario o clave incorrectos.', 401);
  }

  const credentialShapeIsValid = profile.must_change_pin
    ? (/^\d{6}$/.test(password) || /^[A-Za-z0-9]{10}$/.test(password))
    : /^\d{6}$/.test(password);
  if (!credentialShapeIsValid) {
    await admin.rpc('record_login_attempt', { p_username: username, p_succeeded: false });
    return jsonError('Usuario o clave incorrectos.', 401);
  }

  const lockedUntil = profile.locked_until ? new Date(profile.locked_until) : null;
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    return jsonError('El acceso está bloqueado temporalmente. Intenta de nuevo más tarde.', 423);
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: String(profile.auth_email),
    password,
  });

  await admin.rpc('record_login_attempt', { p_username: username, p_succeeded: !error });
  if (error || !data.user) return jsonError('Usuario o clave incorrectos.', 401);

  const { data: member } = await admin
    .from('workspace_members')
    .select('role, is_active')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();
  if (!member?.is_active) {
    await supabase.auth.signOut();
    return jsonError('Esta cuenta está desactivada.', 403);
  }

  return NextResponse.json({
    ok: true,
    mustChangePin: Boolean(profile.must_change_pin),
    role: member.role,
  });
}
