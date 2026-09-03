export interface ResumableUploadCandidate {
  id: string;
  panel_object_path: string;
  invoice_object_path: string | null;
  panel_sha256: unknown;
  invoice_sha256: unknown;
  has_barcode: boolean;
  status: string;
}

interface UploadFingerprint {
  panelHash: string;
  invoiceHash: string;
  hasBarcode: boolean;
}

function byteaMatches(value: unknown, expectedHex: string): boolean {
  return String(value ?? '').replace(/^\\x/i, '').toLowerCase() === expectedHex.toLowerCase();
}

export function findResumableUpload(
  candidates: readonly ResumableUploadCandidate[],
  expected: UploadFingerprint,
): ResumableUploadCandidate | undefined {
  return candidates.find((candidate) =>
    (candidate.status === 'uploading' || candidate.status === 'processing')
    && byteaMatches(candidate.panel_sha256, expected.panelHash)
    && byteaMatches(candidate.invoice_sha256, expected.invoiceHash)
    && candidate.has_barcode === expected.hasBarcode);
}
