import { describe, expect, it } from 'vitest';
import { collaborationAlertEvidenceFingerprint, sha256Hex } from './alert-evidence';
import { createCollaborationManifest } from './collaboration';
import {
  applyOverlayToDataset,
  revalidateExportOverlay,
  type ExportAlertProjection,
  type ExportDecisionProjection,
  type ExportResolutionProjection,
} from './export-revalidation';
import { generateOrthographyAlerts } from './orthography';
import { validateDataset } from './rules';
import type { HierarchyCatalog, SourceDataset } from './types';

const headers = [
  'Row-Id', 'Id_Dn W', 'Cantidad_Productos', 'Producto_Wm', 'Categoria_Wm',
  'Division_Wm', 'Marca_Wm', 'Tipo_Marca', 'codiGo_barras', 'codiGo_estandar',
  'Descripcion', 'Gramaje', 'unidad_de_Medida', 'cantidad_comprada',
  'Precio_Unidad', 'Precio_Total_Preciador', 'Monto Total Fc', 'Canasto Wm',
];

const hierarchy: HierarchyCatalog = {
  metadata: { sourceSheet: 'Jerarquía', generatedAt: '2026-08-24', products: 1 },
  entries: {
    PRODUCTO: { producto: 'PRODUCTO', categoria: 'CATEGORIA', division: 'DIVISION', canasto: 'CANASTO' },
  },
};

function dataset(description = 'PRODUCTO'): SourceDataset {
  const fields: Record<string, string | number> = {
    'Row-Id': 'ROW-1',
    'Id_Dn W': 'DN-1',
    Cantidad_Productos: 1,
    Producto_Wm: 'PRODUCTO',
    Categoria_Wm: 'CATEGORIA',
    Division_Wm: 'DIVISION',
    Marca_Wm: 'ACME',
    Tipo_Marca: 'FABRICANTE',
    codiGo_barras: '001234',
    codiGo_estandar: '001234',
    Descripcion: description,
    Gramaje: 1,
    unidad_de_Medida: 'UNIDADES',
    cantidad_comprada: 1,
    Precio_Unidad: 10,
    Precio_Total_Preciador: 10,
    'Monto Total Fc': 10,
    'Canasto Wm': 'CANASTO',
  };
  return {
    sourceFile: 'panel.xlsx',
    headers,
    outputHeaders: headers,
    records: [{ excelRow: 2, fields, values: headers.map((header) => fields[header]) }],
  };
}

function resolution(value: string): ExportResolutionProjection {
  return {
    column_index: headers.indexOf('Descripcion'),
    field_name: 'Descripcion',
    resolved_value: value,
    source_rows: { excel_row: 2 },
  };
}

async function confirmedCorrectState(source: SourceDataset): Promise<{
  alerts: ExportAlertProjection[];
  decisions: ExportDecisionProjection[];
}> {
  const validation = validateDataset(source, hierarchy);
  const manifest = createCollaborationManifest(source, validation, generateOrthographyAlerts(source));
  const alert = manifest.tasks.flatMap((task) => task.alerts).find((item) => item.ruleId === 'R15');
  if (!alert) throw new Error('El fixture debe producir R15.');
  const fingerprint = await collaborationAlertEvidenceFingerprint(source, alert);
  return {
    alerts: [{
      id: 'db-alert-r15',
      event_key: alert.id,
      rule_code: alert.ruleId,
      evidence_fingerprint: `\\x${fingerprint}`,
    }],
    decisions: [{
      alert_id: 'db-alert-r15',
      decision: 'confirmed_correct',
      evidence_fingerprint: `\\x${fingerprint}`,
      superseded_at: null,
    }],
  };
}

describe('preflight de exportación colaborativa', () => {
  it('conserva la representación textual histórica de números en la huella', async () => {
    const source = dataset();
    source.records[0].fields.Cantidad_Productos = 2;
    source.records[0].fields.cantidad_comprada = 2;
    source.records[0].values[headers.indexOf('Cantidad_Productos')] = 2;
    source.records[0].values[headers.indexOf('cantidad_comprada')] = 2;
    const validation = validateDataset(source, hierarchy);
    const manifest = createCollaborationManifest(source, validation);
    const alert = manifest.tasks.flatMap((task) => task.alerts).find((item) => item.ruleId === 'R28');
    if (!alert) throw new Error('El fixture debe producir R28.');

    const expected = await sha256Hex(JSON.stringify({
      rule: alert.ruleId,
      observed: '10',
      evidence: alert.suggestion.evidence,
      alternatives: alert.suggestion.alternatives,
    }));
    await expect(collaborationAlertEvidenceFingerprint(source, alert)).resolves.toBe(expected);
  });

  it('acepta Está correcto cuando la evidencia permanece idéntica', async () => {
    const source = dataset();
    const state = await confirmedCorrectState(source);
    const result = await revalidateExportOverlay({
      dataset: source,
      resolutions: [],
      alerts: state.alerts,
      decisions: state.decisions,
      hierarchy,
    });

    expect(result.safeForFinal).toBe(true);
    expect(result.acceptedConfirmedCorrect).toBe(1);
    expect(result.remainingAlerts).toEqual([]);
  });

  it('invalida Está correcto cuando otra corrección cambia su evidencia y R15 continúa', async () => {
    const source = dataset();
    const state = await confirmedCorrectState(source);
    const result = await revalidateExportOverlay({
      dataset: source,
      resolutions: [resolution('OTRO PRODUCTO')],
      alerts: state.alerts,
      decisions: state.decisions,
      hierarchy,
    });

    expect(result.safeForFinal).toBe(false);
    expect(result.invalidConfirmedCorrect).toHaveLength(1);
    expect(result.invalidConfirmedCorrect[0]).toMatchObject({
      ruleId: 'R15',
      sourceRow: 2,
      reason: 'confirmed_correct_evidence_changed',
    });
    expect(source.records[0].fields.Descripcion).toBe('PRODUCTO');
    expect(result.overlayDataset.records[0].fields.Descripcion).toBe('OTRO PRODUCTO');
  });

  it('considera segura una corrección que elimina la alerta original', async () => {
    const source = dataset();
    const state = await confirmedCorrectState(source);
    const result = await revalidateExportOverlay({
      dataset: source,
      resolutions: [resolution('PRODUCTO ACME')],
      alerts: state.alerts,
      decisions: state.decisions,
      hierarchy,
    });

    expect(result.safeForFinal).toBe(true);
    expect(result.validationAlertCount).toBe(0);
    expect(result.remainingAlerts).toEqual([]);
  });

  it('detecta una nueva alerta ortográfica creada por el overlay', async () => {
    const source = dataset('PRODUCTO ACME');
    const overlay = applyOverlayToDataset(source, [resolution(' PRODUCTO ACME')]);
    expect(generateOrthographyAlerts(overlay)).toHaveLength(1);

    const result = await revalidateExportOverlay({
      dataset: source,
      resolutions: [resolution(' PRODUCTO ACME')],
      alerts: [],
      decisions: [],
      hierarchy,
    });

    expect(result.safeForFinal).toBe(false);
    expect(result.orthographyAlertCount).toBe(1);
    expect(result.remainingAlerts).toEqual([
      expect.objectContaining({ ruleId: 'ORT-01', sourceRow: 2, reason: 'new_alert' }),
    ]);
  });
});
