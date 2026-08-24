import 'server-only';

import { createClient } from '@supabase/supabase-js';
import { getSupabasePublicEnvironment, getSupabaseSecretKey } from './env';

export function createAdminSupabaseClient() {
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, getSupabaseSecretKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
