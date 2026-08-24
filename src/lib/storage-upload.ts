'use client';

import * as tus from 'tus-js-client';
import { createBrowserSupabaseClient } from './supabase/client';
import { getSupabasePublicEnvironment } from './supabase/env';

const CHUNK_SIZE = 6 * 1024 * 1024;

export function buildUploadFingerprint(file: Pick<File, 'name' | 'type' | 'size' | 'lastModified'>, objectName: string, endpoint: string): string {
  return ['pqm-tus-v1', objectName, file.name, file.type, file.size, file.lastModified, endpoint].join('|');
}

export async function sha256File(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
