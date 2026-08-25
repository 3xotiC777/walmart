'use client';

import * as tus from 'tus-js-client';
import { createBrowserSupabaseClient } from './supabase/client';
import { getSupabasePublicEnvironment } from './supabase/env';

const CHUNK_SIZE = 6 * 1024 * 1024;

export function buildUploadFingerprint(file: Pick<File, 'name' | 'type' | 'size' | 'lastModified'>, objectName: string, endpoint: string): string {
  return ['pqm-tus-v1', objectName, file.name, file.type, file.size, file.lastModified, endpoint].join('|');
}

export async function sha256Buffer(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export interface UploadFileSnapshot {
  buffer: ArrayBuffer;
  file: File;
  sha256: string;
}

export class FileSnapshotError extends Error {
  constructor(message: string, readonly label: string) {
    super(message);
    this.name = 'FileSnapshotError';
  }
}

export async function snapshotUploadFile(source: File, label: string): Promise<UploadFileSnapshot> {
  try {
    // Read the OS-backed handle exactly once. The in-memory File remains stable
    // while the worker analyses a transferred copy and TUS uploads it later.
    const buffer = await source.arrayBuffer();
    const sha256 = await sha256Buffer(buffer);
    const file = new File([buffer], source.name, {
      type: source.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      lastModified: source.lastModified,
    });
    return { buffer, file, sha256 };
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    const inaccessible = cause instanceof DOMException && cause.name === 'NotReadableError';
    throw new FileSnapshotError(inaccessible
      ? `El navegador perdió acceso al archivo: ${label}. Vuelve a seleccionarlo y espera a que termine de descargarse o sincronizarse antes de intentar otra vez.`
      : `No fue posible leer el archivo: ${label}. Vuelve a seleccionarlo e intenta nuevamente.`, label);
  }
}

function storageHostname(projectUrl: string): string {
  const url = new URL(projectUrl);
  url.hostname = url.hostname.replace('.supabase.co', '.storage.supabase.co');
  return url.origin;
}

export async function resumableUpload(
  file: File,
  objectName: string,
  onProgress: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const supabase = createBrowserSupabaseClient();
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('La sesión expiró antes de subir los archivos.');
  const { url } = getSupabasePublicEnvironment();

  await new Promise<void>((resolve, reject) => {
    const endpoint = `${storageHostname(url)}/storage/v1/upload/resumable`;
    const upload = new tus.Upload(file, {
      endpoint,
      // La ruta privada forma parte de la huella: un reintento de otro upload
      // nunca debe reanudar accidentalmente el objeto TUS de una jornada anterior.
      fingerprint: (input) => Promise.resolve(buildUploadFingerprint(input, objectName, endpoint)),
      retryDelays: [0, 1_000, 3_000, 5_000, 10_000],
      chunkSize: CHUNK_SIZE,
      removeFingerprintOnSuccess: true,
      uploadDataDuringCreation: true,
      headers: { authorization: `Bearer ${data.session.access_token}`, 'x-upsert': 'true' },
      metadata: {
        bucketName: 'pqm-private',
        objectName,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        cacheControl: '3600',
      },
      onError: (uploadError) => reject(uploadError),
      onProgress: (uploaded, total) => onProgress(total === 0 ? 0 : (uploaded / total) * 100),
      onSuccess: () => resolve(),
    });
    const abort = () => { void upload.abort(true).finally(() => reject(new DOMException('Carga cancelada.', 'AbortError'))); };
    signal?.addEventListener('abort', abort, { once: true });
    upload.findPreviousUploads()
      .then((previous) => { if (previous[0]) upload.resumeFromPreviousUpload(previous[0]); upload.start(); })
      .catch(reject);
  });
}
