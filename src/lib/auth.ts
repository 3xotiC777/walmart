import 'server-only';

import { redirect } from 'next/navigation';
import { createServerSupabaseClient } from './supabase/server';

export type WorkspaceRole = 'leader' | 'validator';

export interface Viewer {
  id: string;
  username: string;
  displayName: string;
  workspaceId: string;
  workspaceName: string;
  role: WorkspaceRole;
  mustChangePin: boolean;
  pinResetAt: string | null;
  sessionIssuedAt: number;
}

export async function getViewer(options: { allowPendingPin?: boolean } = {}): Promise<Viewer | null> {
  const supabase = await createServerSupabaseClient();
  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;
  if (claimsError || typeof userId !== 'string') return null;

  const { data, error } = await supabase
    .from('workspace_members')
    .select('role, workspace_id, workspaces(name), profiles!workspace_members_user_id_fkey(username, display_name, must_change_pin, pin_reset_at, is_active)')
    .eq('user_id', userId)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  const profile = Array.isArray(data.profiles) ? data.profiles[0] : data.profiles;
  const workspace = Array.isArray(data.workspaces) ? data.workspaces[0] : data.workspaces;
  if (!profile?.is_active) return null;

  const sessionIssuedAt = Number(claimsData?.claims?.iat ?? 0);
  const pinResetAt = profile.pin_reset_at ? String(profile.pin_reset_at) : null;
  const pinResetAtSeconds = pinResetAt
    ? Math.floor(new Date(pinResetAt).getTime() / 1_000)
    : 0;
  if (!sessionIssuedAt || (pinResetAtSeconds > 0 && sessionIssuedAt < pinResetAtSeconds)) {
    return null;
  }

  const viewer: Viewer = {
    id: userId,
    username: String(profile.username),
    displayName: String(profile.display_name),
    workspaceId: String(data.workspace_id),
    workspaceName: String(workspace?.name ?? 'PQM Walmart'),
    role: data.role as WorkspaceRole,
    mustChangePin: Boolean(profile.must_change_pin),
    pinResetAt,
    sessionIssuedAt,
  };
  return viewer.mustChangePin && !options.allowPendingPin ? null : viewer;
}

export async function requireViewer(role?: WorkspaceRole): Promise<Viewer> {
  const viewer = await getViewer({ allowPendingPin: true });
  if (!viewer) redirect('/login');
  if (viewer.mustChangePin) redirect('/cambiar-pin');
  if (role && viewer.role !== role) redirect('/workspace');
  return viewer;
}
