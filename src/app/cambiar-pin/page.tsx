import { PinForm } from '@/components/auth-form';
import { getViewer } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Crear PIN' };
export const dynamic = 'force-dynamic';

export default async function ChangePinPage() {
  const viewer = await getViewer({ allowPendingPin: true });
  if (!viewer) redirect('/login');
  if (!viewer.mustChangePin) redirect('/workspace');
  return <main className="center-page"><section className="auth-box compact"><span className="brand-tile">PQM</span><p className="overline">PRIMER INGRESO</p><h1>Crea tu PIN personal</h1><p>La clave temporal dejará de funcionar cuando guardes el PIN.</p><PinForm /></section></main>;
}
