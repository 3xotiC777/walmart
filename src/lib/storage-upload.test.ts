import { describe, expect, it } from 'vitest';
import { buildUploadFingerprint, sha256Buffer, snapshotUploadFile } from './storage-upload';

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

  it('toma una sola lectura del archivo original y conserva una copia estable para TUS', async () => {
    const bytes = new TextEncoder().encode('contenido xlsx de prueba');
    let reads = 0;
    const source = {
      name: 'panel.xlsx',
      type: file.type,
      size: bytes.byteLength,
      lastModified: file.lastModified,
      async arrayBuffer() {
        reads += 1;
        if (reads > 1) throw new DOMException('Archivo bloqueado', 'NotReadableError');
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      },
    } as unknown as File;

    const snapshot = await snapshotUploadFile(source, 'el panel maestro PQM');

    expect(reads).toBe(1);
    expect(snapshot.sha256).toBe(await sha256Buffer(snapshot.buffer));
    expect(new Uint8Array(await snapshot.file.arrayBuffer())).toEqual(bytes);
  });

  it('explica cómo recuperar un archivo cuyo permiso perdió el navegador', async () => {
    const source = {
      ...file,
      arrayBuffer: async () => { throw new DOMException('Archivo bloqueado', 'NotReadableError'); },
    } as unknown as File;

    await expect(snapshotUploadFile(source, 'referencias de facturas')).rejects.toThrow(
      'El navegador perdió acceso al archivo: referencias de facturas',
    );
  });
});
