import { randomUUID } from 'node:crypto';
import { jsonError, normalizeUsername, validPin } from '@/lib/http';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === 'string' ? body.token : '';
  const username = normalizeUsername(body.username);
  const displayName = String(body.displayName ?? '').trim();
  if (token.length < 32 || !username || displayName.length < 2 || !validPin(body.pin)) {
    return jsonError('Revisa el enlace, el nombre, el usuario y el PIN de 6 dígitos.');
  }

  const email = `pqm-${randomUUID()}@auth.invalid`;
  const admin = createAdminSupabaseClient();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: body.pin,
    email_confirm: true,
  });
  if (createError || !created.user) return jsonError('No fue posible crear el primer líder.', 400);

  const supabase = await createServerSupabaseClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({ email, password: body.pin });
  if (signInError) {
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonError('No fue posible iniciar la sesión inicial.', 500);
  }

  const { error } = await supabase.rpc('claim_bootstrap_leader', {
    p_token: token,
    p_username: username,
    p_display_name: displayName,
  });
  if (error) {
    await supabase.auth.signOut();
    await admin.auth.admin.deleteUser(created.user.id);
    return jsonError('El enlace ya fue usado, venció o no es válido.', 410);
  }
  const { error: stateError } = await admin.rpc('mark_pin_changed_for_user', {
    p_user_id: created.user.id,
  });
  if (stateError) {
    await supabase.auth.signOut();
    return jsonError('La cuenta fue creada, pero no fue posible finalizar su configuración. Inicia sesión para continuar.', 500);
  }

  // La cuenta se insertó después de emitir la primera sesión. Emitimos un JWT
  // nuevo para que su iat quede inequívocamente después del watermark inicial.
  await supabase.auth.signOut();
  const { error: freshSessionError } = await supabase.auth.signInWithPassword({
    email,
    password: body.pin,
  });
  if (freshSessionError) {
    return jsonError('La cuenta quedó configurada. Inicia sesión con el usuario y PIN que acabas de crear.', 500);
  }
  return NextResponse.json({ ok: true });
}
