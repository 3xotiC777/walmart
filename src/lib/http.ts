import { NextResponse } from 'next/server';

export function jsonError(message: string, status = 400, details?: unknown) {
  return NextResponse.json({ ok: false, message, details }, { status });
}

export function normalizeUsername(value: unknown): string {
  return String(value ?? '').trim().toLocaleLowerCase('es').replace(/\s+/g, '.');
}

export function validPin(value: unknown): value is string {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

export function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function validPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
