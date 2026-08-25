import { LoginForm } from '@/components/auth-form';
import { CheckIcon, SparkIcon } from '@/components/icons';
import { getViewer } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const metadata = { title: 'Ingresar' };
export const dynamic = 'force-dynamic';

export default async function LoginPage() {
  const viewer = await getViewer({ allowPendingPin: true });
  if (viewer) redirect(viewer.mustChangePin ? '/cambiar-pin' : '/workspace');
  return (
    <main className="auth-layout">
      <section className="auth-story">
        <div className="story-brand"><span>PQM</span><strong>Control Walmart</strong></div>
        <div className="story-copy"><p className="overline light">VALIDACIÓN COLABORATIVA</p><h1>Las alertas llegan en bloque. La revisión, ahora, también.</h1><p>Reparte la jornada, revisa la evidencia y consolida cada cambio sin perder la trazabilidad de la base original.</p></div>
        <div className="story-proof"><span><CheckIcon /> R01–R30 y jerarquía</span><span><CheckIcon /> Correcciones auditadas</span><span><CheckIcon /> Excel original preservado</span></div>
        <div className="signal-card"><SparkIcon /><div><small>UNA TAREA, UNA FILA</small><strong>Antes <b>→</b> Sugerencia</strong><p>El equipo ve el dato, la evidencia y la alternativa en un mismo lugar.</p></div></div>
      </section>
      <section className="auth-panel"><div className="auth-box"><p className="overline">ACCESO PRIVADO</p><h2>Hola de nuevo</h2><p>Usa el usuario creado por tu líder y tu PIN personal.</p><LoginForm /></div><small className="auth-foot">Los archivos se almacenan de forma privada por 90 días.</small></section>
    </main>
  );
}
