import Link from 'next/link';

export default function NotFound() { return <main className="center-page"><section className="auth-box compact"><p className="overline">404</p><h1>Esta vista no existe.</h1><p>Regresa a tu mesa de control para continuar.</p><Link className="button button-primary" href="/workspace">Volver al tablero</Link></section></main>; }
