'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowIcon, LockIcon } from './icons';

export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(result.message ?? 'No fue posible iniciar sesión.');
        setBusy(false);
        return;
      }
      router.replace(result.mustChangePin ? '/cambiar-pin' : '/workspace');
      router.refresh();
    } catch {
      setError('No fue posible conectar para iniciar sesión.');
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Usuario<input name="username" autoComplete="username" required placeholder="nombre.apellido" /></label>
      <label>PIN o clave temporal<input name="password" type="password" autoComplete="current-password" minLength={6} maxLength={72} required placeholder="••••••" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy} type="submit">
        {busy ? 'Verificando…' : 'Entrar a la mesa'} <ArrowIcon />
      </button>
      <p className="auth-help"><LockIcon /> Cinco intentos fallidos bloquean el acceso durante 30 minutos.</p>
    </form>
  );
}

export function PinForm() {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/change-pin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin: form.get('pin'), confirmPin: form.get('confirmPin') }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (response.status === 401) {
          await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
          router.replace('/login');
          router.refresh();
          return;
        }
        setError(result.message ?? 'No fue posible guardar el PIN.'); setBusy(false); return;
      }
      router.replace('/workspace');
      router.refresh();
    } catch {
      setError('No fue posible conectar para guardar el PIN.');
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Nuevo PIN<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" required placeholder="6 dígitos" /></label>
      <label>Confirmar PIN<input name="confirmPin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" required placeholder="Repite el PIN" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy} type="submit">{busy ? 'Guardando…' : 'Guardar PIN'} <ArrowIcon /></button>
    </form>
  );
}

export function BootstrapForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/auth/bootstrap', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token, displayName: form.get('displayName'), username: form.get('username'), pin: form.get('pin') }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { setError(result.message ?? 'No fue posible completar la configuración.'); setBusy(false); return; }
      router.replace('/workspace'); router.refresh();
    } catch {
      setError('No fue posible conectar para completar la configuración.');
      setBusy(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={submit}>
      <label>Nombre completo<input name="displayName" autoComplete="name" required minLength={2} /></label>
      <label>Usuario<input name="username" autoComplete="username" required placeholder="nombre.apellido" /></label>
      <label>PIN personal<input name="pin" type="password" inputMode="numeric" pattern="[0-9]{6}" autoComplete="new-password" required placeholder="6 dígitos" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button button-primary button-wide" disabled={busy} type="submit">{busy ? 'Creando espacio…' : 'Crear espacio de trabajo'} <ArrowIcon /></button>
    </form>
  );
}
