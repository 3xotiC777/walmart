export interface SupabasePublicEnvironment {
  url: string;
  publishableKey: string;
}

export function hasSupabasePublicEnvironment(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function getSupabasePublicEnvironment(): SupabasePublicEnvironment {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    throw new Error('Falta configurar la conexión pública con Supabase.');
  }
  return { url, publishableKey };
}

export function getSupabaseSecretKey(): string {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('Falta configurar SUPABASE_SECRET_KEY en el servidor.');
  return key;
}
