import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { buildCollaborativeReportWorkbook } from './collaborative-report';

function rows(sheet: XLSX.WorkSheet): Array<Array<string | number | null>> {
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null });
}

function rowObject(header: Array<string | number | null>, row: Array<string | number | null>) {
  return Object.fromEntries(header.map((name, index) => [String(name), row[index]]));
}

describe('reporte colaborativo de alertas', () => {
  it('se reabre con sus cuatro hojas y conserva sugerencia, responsable y decisión', () => {
    const output = buildCollaborativeReportWorkbook({
      upload: {
        display_name: 'PQM agosto',
        has_barcode: false,
        total_rows: 15_509,
        task_count: 2,
        alert_count: 3,
        orthography_count: 1,
        pending_task_count: 1,
        corrected_cell_count: 1,
        confirmed_correct_count: 1,
        created_at: '2026-08-24T15:30:00.000Z',
      },
      tasks: [
        {
          id: 'task-26',
          status: 'resolved',
          source_rows: {
            excel_row: 26,
            row_id: 'ROW-000025',
            id_dn_w: 'DN-1',
            barcode: '09100055',
            description: 'MANDARINA IMPORTADA 1KG-1',
          },
          assignment_blocks: { assigned_to: 'validator-1' },
        },
        {
          id: 'task-185',
          status: 'pending',
          source_rows: [{
            excel_row: 185,
            row_id: 'ROW-000184',
            id_dn_w: 'DN-2',
            barcode: '09290597',
            description: 'QUESO GOUDA EN PORCIONES',
          }],
          assignment_blocks: null,
        },
      ],
      alerts: [
        {
          id: 'alert-1',
          task_id: 'task-26',
          rule_code: 'R01',
          category: 'validation',
          affected_field: 'Descripcion',
          original_value: 'MANDARINA IMPORTADA 1KG-1',
          expected_or_conflicts: 'MANDARINA IMPORTADA 1KG',
          detail: 'La descripción minoritaria difiere de 34 registros relacionados.',
          suggested_value: 'MANDARINA IMPORTADA 1KG',
          suggestion_confidence: 'high',
          suggestion_method: 'strict-majority',
          status: 'resolved',
        },
        {
          id: 'alert-2',
          task_id: 'task-26',
          rule_code: 'ORT-01',
          category: 'orthography',
          affected_field: 'Descripcion',
          original_value: 'MANDARINA  IMPORTADA 1KG',
          expected_or_conflicts: 'MANDARINA IMPORTADA 1KG',
          detail: 'Hay espacios repetidos.',
          suggested_value: 'MANDARINA IMPORTADA 1KG',
          suggestion_confidence: 'high',
          suggestion_method: 'unique-reference',
          status: 'resolved',
        },
        {
          id: 'alert-3',
          task_id: 'task-185',
          rule_code: 'R25',
          category: 'validation',
          affected_field: 'Precio_Unidad',
          original_value: '10000',
          expected_or_conflicts: '2000',
          detail: 'El precio supera el límite superior del grupo.',
          suggested_value: '2000',
          suggestion_confidence: 'high',
          suggestion_method: 'normal-price-mode',
          suggestion_evidence: {
            statistics: {
              groupAverage: 2_000,
              priceThreshold: 2_300,
              priceDifferencePercent: 4,
            },
          },
          status: 'pending',
        },
      ],
      decisions: [
        {
          alert_id: 'alert-1',
          decision: 'applied_suggestion',
          resolved_value: 'MANDARINA IMPORTADA 1KG',
          decided_by: 'validator-1',
          decided_at: '2026-08-24T16:00:00.000Z',
        },
        {
          alert_id: 'alert-2',
          decision: 'confirmed_correct',
          resolved_value: null,
          decided_by: 'validator-1',
          decided_at: '2026-08-24T16:01:00.000Z',
        },
      ],
      profiles: [{ user_id: 'validator-1', display_name: 'Ana Validadora' }],
      invoices: [{ id_dn_w: 'DN-2', external_url: 'https://example.com/factura-dn-2.jpg' }],
      conflictGroups: [
        { id: 'group-r01', rule_code: 'R01', affected_row_count: 35 },
        { id: 'group-r25', rule_code: 'R25', affected_row_count: 20 },
      ],
      dataset: {
        sourceFile: 'panel.xlsx',
        headers: ['Row-Id', 'Id_Dn W', 'codiGo_barras', 'Descripcion', 'Categoria_Wm'],
        outputHeaders: ['Row-Id', 'Id_Dn W', 'codiGo_barras', 'Descripcion', 'Categoria_Wm'],
        records: [
          { excelRow: 26, values: ['ROW-000025', 'DN-1', '09100055', 'MANDARINA IMPORTADA 1KG-1', 'FRUTAS'], fields: {} },
          { excelRow: 185, values: ['ROW-000184', 'DN-2', '09290597', 'QUESO GOUDA EN PORCIONES', 'LÁCTEOS'], fields: {} },
        ],
      },
    });

    const workbook = XLSX.read(output, { type: 'array', cellNF: true });
    expect(workbook.SheetNames).toEqual(['Resumen', 'Alertas', 'Registros_a_revisar', 'Ortografía']);
    expect(workbook.Props?.Title).toBe('Reporte colaborativo PQM agosto');

    const summary = rows(workbook.Sheets.Resumen);
    const metrics = new Map(summary.slice(1, 11).map((row) => [row[0], row[1]]));
    expect(metrics.get('Registros totales de la base')).toBe(15_509);
    expect(metrics.get('Tareas o filas únicas')).toBe(2);
    expect(metrics.get('Tareas resueltas')).toBe(1);
    expect(summary.some((row) => row[0] === 'R21' && String(row[7]).includes('Control visual no automatizado'))).toBe(true);
    expect(summary.find((row) => row[0] === 'R01')?.slice(3, 5)).toEqual([35, 1]);
    expect(summary.find((row) => row[0] === 'R25')?.slice(3, 5)).toEqual([1, 1]);
    expect(summary.find((row) => row[0] === 'R02')?.slice(3, 5)).toEqual([0, 0]);
    expect(summary.find((row) => row[0] === 'R08')?.[1]).toBe('Descripción → gramaje');
    expect(summary.find((row) => row[0] === 'R25')?.[1]).toBe('Precio atípico por descripción');
    expect(summary.find((row) => row[0] === 'EST-01')?.slice(2, 8)).toEqual([
      'Omitido por modalidad', 0, 0, 0, 0,
      'Este estudio fue declarado sin código de barras, por lo que EST-01 no se ejecuta.',
    ]);

    const alertRows = rows(workbook.Sheets.Alertas);
    expect(alertRows).toHaveLength(4);
    const r01 = rowObject(alertRows[0], alertRows[1]);
    expect(r01).toMatchObject({
      Regla: 'R01',
      Fila_Excel: 26,
      'Row-Id': 'ROW-000025',
      Solución_Propuesta: 'MANDARINA IMPORTADA 1KG',
      Confianza: 'high',
      Método: 'strict-majority',
      Responsable: 'Ana Validadora',
      Estado: 'resolved',
      Decisión: 'applied_suggestion',
      Valor_Final: 'MANDARINA IMPORTADA 1KG',
      Fecha_Decisión: '2026-08-24T16:00:00.000Z',
    });
    const pending = rowObject(alertRows[0], alertRows[3]);
    expect(pending).toMatchObject({
      Regla: 'R25',
      Promedio_Grupo: 2_000,
      Umbral_15_Por_Ciento: 2_300,
      Porcentaje_Diferencia_Promedio: 4,
      Foto_Factura: 'https://example.com/factura-dn-2.jpg',
      Responsable: 'Sin asignar',
      Estado: 'pending',
      Decisión: '',
      Valor_Final: '',
    });
    expect(workbook.Sheets.Alertas.M4?.z).toBe('0.00%');

    const taskRows = rows(workbook.Sheets.Registros_a_revisar);
    expect(taskRows).toHaveLength(3);
    expect(rowObject(taskRows[0], taskRows[1])).toMatchObject({
      Fila_Origen: 26,
      Cantidad_Alertas: 2,
      Reglas_Alerta: 'R01, ORT-01',
      Responsable: 'Ana Validadora',
      Estado: 'resolved',
      Categoria_Wm: 'FRUTAS',
    });

    const orthographyRows = rows(workbook.Sheets.Ortografía);
    expect(orthographyRows).toHaveLength(2);
    expect(rowObject(orthographyRows[0], orthographyRows[1])).toMatchObject({
      Regla: 'ORT-01',
      Decisión: 'confirmed_correct',
      Responsable: 'Ana Validadora',
    });
  });
});
