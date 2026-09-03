import { describe, expect, it } from 'vitest';
import { findResumableUpload, type ResumableUploadCandidate } from './upload-resume';

const fingerprint = {
  panelHash: 'a'.repeat(64),
  invoiceHash: 'b'.repeat(64),
  hasBarcode: true,
};

function candidate(overrides: Partial<ResumableUploadCandidate> = {}): ResumableUploadCandidate {
  return {
    id: 'upload-1',
    panel_object_path: 'workspace/upload-1/panel/panel.xlsx',
    invoice_object_path: 'workspace/upload-1/invoices/facturas.xlsx',
    panel_sha256: `\\x${fingerprint.panelHash}`,
    invoice_sha256: `\\x${fingerprint.invoiceHash}`,
    has_barcode: true,
    status: 'processing',
    ...overrides,
  };
}

describe('reanudación de cargas repetidas', () => {
  it('reanuda una carga incompleta con los mismos dos archivos y modalidad', () => {
    expect(findResumableUpload([candidate()], fingerprint)?.id).toBe('upload-1');
  });

  it('no reutiliza una jornada ya terminada, permitiendo crear otra con los mismos archivos', () => {
    expect(findResumableUpload([candidate({ status: 'ready' })], fingerprint)).toBeUndefined();
  });

  it('no mezcla archivos de facturas o modalidades diferentes', () => {
    expect(findResumableUpload([
      candidate({ invoice_sha256: `\\x${'c'.repeat(64)}` }),
      candidate({ has_barcode: false }),
    ], fingerprint)).toBeUndefined();
  });
});
