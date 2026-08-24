'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getSupabasePublicEnvironment } from './env';

let browserClient: SupabaseClient | undefined;

export function createBrowserSupabaseClient(): SupabaseClient {
  if (browserClient) return browserClient;
  const { url, publishableKey } = getSupabasePublicEnvironment();
  browserClient = createBrowserClient(url, publishableKey);
  return browserClient;
}
