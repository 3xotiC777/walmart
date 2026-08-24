import { getViewer } from '@/lib/auth';
import { hasSupabasePublicEnvironment } from '@/lib/supabase/env';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  if (!hasSupabasePublicEnvironment()) {
    return <main className="config-page"><div className="config-card"><span className="brand-tile">PQM</span><p className="overline">CONFIGURACIÓN</p><h1>La plataforma está lista para conectarse.</h1><p>Configura las variables de Supabase en Vercel para activar el acceso privado del equipo.</p></div></main>;
  }
  const viewer = await getViewer({ allowPendingPin: true });
  redirect(viewer ? (viewer.mustChangePin ? '/cambiar-pin' : '/workspace') : '/login');
}
