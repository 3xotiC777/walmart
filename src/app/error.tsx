'use client';

export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <main className="center-page"><section aria-live="assertive" className="auth-box compact"><p className="overline">NO PUDIMOS CONTINUAR</p><h1>Algo salió distinto a lo esperado.</h1><p>Tu información no se perdió. Puedes volver a intentar la última acción.</p><button className="button button-primary" onClick={reset} type="button">Intentar de nuevo</button></section></main>;
}
