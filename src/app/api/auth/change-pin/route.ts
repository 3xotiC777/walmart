import { getViewer } from '@/lib/auth';
import { jsonError, validPin } from '@/lib/http';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  const viewer = await getViewer({ allowPendingPin: true });
  if (!viewer) return jsonError('La sesión expiró.', 401);
  if (!viewer.mustChangePin) return jsonError('La cuenta no tiene un cambio de PIN pendiente.', 409);
  const resetAtSeconds = viewer.pinResetAt ? Math.floor(new Date(viewer.pinResetAt).getTime() / 1_000) : 0;
  if (!viewer.sessionIssuedAt || viewer.sessionIssuedAt < resetAtSeconds) {
    return jsonError('Vuelve a iniciar sesión con la clave temporal antes de definir el nuevo PIN.', 401);
  }
  const body = await request.json().catch(() => ({}));
  if (!validPin(body.pin) || body.pin !== body.confirmPin) {
    return jsonError('El PIN debe tener exactamente 6 dígitos y coincidir.');
  }

  const supabase = await createServerSupabaseClient();
  const { error: authError } = await supabase.auth.updateUser({ password: body.pin });
  if (authError) return jsonError('No fue posible guardar el PIN.', 500);
  const { error } = await createAdminSupabaseClient().rpc('mark_pin_changed_for_user', {
    p_user_id: viewer.id,
  });
  if (error) return jsonError('El PIN cambió, pero no se pudo cerrar el paso inicial.', 500);
  return NextResponse.json({ ok: true });
}
