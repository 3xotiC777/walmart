import { BootstrapForm } from '@/components/auth-form';

export const metadata = { title: 'Configurar primer líder' };

export default async function SetupPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <main className="auth-layout setup-layout"><section className="auth-story"><div className="story-brand"><span>PQM</span><strong>Control Walmart</strong></div><div className="story-copy"><p className="overline light">PRIMER ACCESO</p><h1>Crea la mesa privada del equipo.</h1><p>Este enlace funciona una sola vez. Al terminar podrás crear líderes y validadores desde la plataforma.</p></div></section><section className="auth-panel"><div className="auth-box"><p className="overline">LÍDER INICIAL</p><h2>Configurar cuenta</h2><p>Define tu usuario y un PIN personal de 6 dígitos.</p><BootstrapForm token={token} /></div></section></main>;
}
