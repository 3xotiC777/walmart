import { describe, expect, it } from 'vitest';
import { buildUploadFingerprint } from './storage-upload';

const file = {
  name: 'panel.xlsx',
  type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  size: 8_000_000,
  lastModified: 1_777_000_000_000,
};

describe('huella de carga reanudable', () => {
  it('solo reanuda el mismo archivo en la misma ruta privada', () => {
    const endpoint = 'https://example.storage.supabase.co/storage/v1/upload/resumable';
    const first = buildUploadFingerprint(file, 'workspace/upload-a/panel.xlsx', endpoint);
    const retry = buildUploadFingerprint(file, 'workspace/upload-a/panel.xlsx', endpoint);
    const anotherUpload = buildUploadFingerprint(file, 'workspace/upload-b/panel.xlsx', endpoint);

    expect(retry).toBe(first);
    expect(anotherUpload).not.toBe(first);
  });
});
