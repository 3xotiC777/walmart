import { describe, expect, it } from 'vitest';
import { buildHistoryHref, describeHistoryEvent, historyEventTypes, normalizeHistoryCursor, normalizeHistoryKind } from './audit-history';

describe('historial de auditoría', () => {
  it('normaliza filtros y construye enlaces estables', () => {
    expect(normalizeHistoryKind('downloads')).toBe('downloads');
    expect(normalizeHistoryKind('desconocido')).toBe('all');
    expect(normalizeHistoryCursor('123')).toBe(123);
    expect(normalizeHistoryCursor('-2')).toBeNull();
    expect(historyEventTypes('downloads')).toEqual(['export.downloaded']);
    expect(buildHistoryHref({ uploadId: 'upload-1', kind: 'reviews', before: 81 })).toBe('/workspace/historia?upload=upload-1&kind=reviews&before=81');
  });

  it('explica una corrección mostrando antes, después y registro', () => {
    expect(describeHistoryEvent({
      eventType: 'alert.resolved',
      payload: { changed: true, decision: 'manual_edit', rule_code: 'R01' },
      decision: {
        decision: 'manual_edit',
        originalValue: 'MANDARINA IMPROTADA',
        resolvedValue: 'MANDARINA IMPORTADA',
        fieldName: 'Descripcion',
        ruleCode: 'R01',
        excelRow: 26,
        rowId: '236166851_1',
      },
    })).toMatchObject({
      category: 'reviews',
      title: 'Editó manualmente una celda',
      detail: 'R01 · Descripcion · fila 26 · Row-Id 236166851_1',
      before: 'MANDARINA IMPROTADA',
      after: 'MANDARINA IMPORTADA',
    });
  });

  it('distingue confirmaciones, cargas y descargas', () => {
    expect(describeHistoryEvent({ eventType: 'alert.resolved', payload: { decision: 'confirmed_correct' } }).title).toContain('Está correcto');
    expect(describeHistoryEvent({ eventType: 'upload.created', payload: {} }).title).toBe('Cargó una nueva jornada');
    expect(describeHistoryEvent({ eventType: 'export.downloaded', payload: { kind: 'corrected', file_name: 'PQM_Final.xlsx', is_draft: false } })).toMatchObject({
      category: 'downloads',
      title: 'Descargó Excel corregido',
      detail: 'PQM_Final.xlsx · Archivo final',
    });
  });
});
