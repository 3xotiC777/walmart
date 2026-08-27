import { describe, expect, it } from 'vitest';
import { parseExportAuditPayload } from './export-audit';

describe('auditoría de descargas', () => {
  it('acepta una descarga completa y normalizada', () => {
    expect(parseExportAuditPayload({
      kind: 'corrected',
      fileName: ' PQM_Final.xlsx ',
      isDraft: false,
      pendingTasks: 0,
      remainingAlerts: 0,
      uploadVersion: 7,
    })).toEqual({
      kind: 'corrected',
      fileName: 'PQM_Final.xlsx',
      isDraft: false,
      pendingTasks: 0,
      remainingAlerts: 0,
      uploadVersion: 7,
    });
  });

  it('rechaza formatos o conteos inválidos', () => {
    expect(parseExportAuditPayload({ kind: 'csv', fileName: 'datos.csv' })).toBeNull();
    expect(parseExportAuditPayload({ kind: 'report', fileName: 'datos.xlsx', isDraft: false, pendingTasks: -1, remainingAlerts: 0, uploadVersion: 1 })).toBeNull();
  });
});
