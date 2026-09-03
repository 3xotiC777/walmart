import type { CollaborationManifest, CollaborationValue } from './collaboration';
import { collaborationAlertEvidenceFingerprint, sha256Hex } from './alert-evidence';
import type { InvoiceCatalog, SourceDataset } from './types';

const STORED_FIELDS = [
  'Row-Id', 'Id_Dn W', 'Cantidad_Productos', 'Producto_Wm', 'Categoria_Wm',
  'Division_Wm', 'Marca_Wm', 'Tipo_Marca', 'codiGo_barras', 'codiGo_estandar',
  'Descripcion', 'Gramaje', 'unidad_de_Medida', 'cantidad_comprada',
  'Precio_Unidad', 'Precio_Total_Preciador', 'Monto Total Fc', 'Canasto Wm',
] as const;

export interface IngestionBatch {
  key: string;
  payload: Record<string, unknown[]>;
}

export interface IngestionPlan {
  batches: IngestionBatch[];
  storedRowCount: number;
  taskCount: number;
  alertCount: number;
  manifestHash: string;
}

// Vercel rechaza cuerpos mayores a 4,5 MB. Mantener cada lote por debajo de
// 2 MB deja margen para encabezados y cambios futuros en la estructura.
export const MAX_INGESTION_REQUEST_BYTES = 2_000_000;
const BATCH_KEY_PLACEHOLDER = '00000000-0000-4000-8000-000000000000';
const textEncoder = new TextEncoder();

function jsonValue(value: unknown): CollaborationValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

function display(value: unknown): string | null {
  const normalized = jsonValue(value);
  return normalized === null ? null : String(normalized);
}

function persistedEvidence(evidence: CollaborationManifest['tasks'][number]['alerts'][number]['suggestion']['evidence']) {
  const { sourceRows: _sourceRows, ...compact } = evidence;
  return compact;
}

function persistedAlternatives(alternatives: CollaborationManifest['tasks'][number]['alerts'][number]['suggestion']['alternatives']) {
  return alternatives.map(({ value, count }) => ({ value, count }));
}

function batch(payload: Record<string, unknown[]>): IngestionBatch {
  return { key: crypto.randomUUID(), payload };
}

export function ingestionBatchRequestByteLength(item: IngestionBatch): number {
  return textEncoder.encode(JSON.stringify({ batchKey: item.key, payload: item.payload })).byteLength;
}

export function packIngestionBatches<T>(payloadKey: string, values: readonly T[], maxItems: number): IngestionBatch[] {
  if (values.length === 0) return [];
  const emptyEnvelopeBytes = textEncoder.encode(JSON.stringify({
    batchKey: BATCH_KEY_PLACEHOLDER,
    payload: { [payloadKey]: [] },
  })).byteLength;
  const batches: IngestionBatch[] = [];
  let current: T[] = [];
  let currentBytes = emptyEnvelopeBytes;

  const flush = () => {
    if (current.length === 0) return;
    const item = batch({ [payloadKey]: current });
    if (ingestionBatchRequestByteLength(item) > MAX_INGESTION_REQUEST_BYTES) {
      throw new Error(`El lote ${payloadKey} supera el tamaño seguro de guardado.`);
    }
    batches.push(item);
    current = [];
    currentBytes = emptyEnvelopeBytes;
  };

  for (const value of values) {
    const serializedValue = JSON.stringify(value) ?? 'null';
    const valueBytes = textEncoder.encode(serializedValue).byteLength;
    const separatorBytes = current.length > 0 ? 1 : 0;
    if (current.length > 0 && (current.length >= maxItems || currentBytes + separatorBytes + valueBytes > MAX_INGESTION_REQUEST_BYTES)) {
      flush();
    }
    if (currentBytes + valueBytes > MAX_INGESTION_REQUEST_BYTES) {
      throw new Error(`Un elemento de ${payloadKey} supera por sí solo el tamaño seguro de guardado.`);
    }
    current.push(value);
    currentBytes += (current.length > 1 ? 1 : 0) + valueBytes;
  }
  flush();
  return batches;
}

export async function buildIngestionPlan(
  dataset: SourceDataset,
  manifest: CollaborationManifest,
  invoices: InvoiceCatalog,
): Promise<IngestionPlan> {
  const rowNumbers = new Set<number>();
  for (const group of manifest.conflictGroups) for (const member of group.members) rowNumbers.add(member.sourceRow);
  for (const task of manifest.tasks) rowNumbers.add(task.sourceRow);
  const recordByRow = new Map(dataset.records.map((record) => [record.excelRow, record]));
  const rows = [...rowNumbers].sort((left, right) => left - right).map((excelRow) => {
    const record = recordByRow.get(excelRow);
    const fieldValues = Object.fromEntries(STORED_FIELDS.map((field) => [field, jsonValue(record?.fields[field])])) as Record<string, CollaborationValue>;
    return {
      external_key: `row-${excelRow}`,
      excel_row: excelRow,
      row_id: display(record?.fields['Row-Id']),
      id_dn_w: display(record?.fields['Id_Dn W']),
      barcode: display(record?.fields.codiGo_barras),
      description: display(record?.fields.Descripcion),
      field_values: fieldValues,
      source_fingerprint_hex: null,
    };
  });

  const collaborationAlerts = manifest.tasks.flatMap((task) => task.alerts);
  const collaborationAlertById = new Map(collaborationAlerts.map((alert) => [alert.id, alert]));
  const groups = manifest.conflictGroups.map((group) => {
    const alternatives = group.alertIds
      .map((id) => collaborationAlertById.get(id)?.suggestion.alternatives ?? [])
      .flat();
    const values = [...new Map(alternatives.map((alternative) => [String(alternative.value), {
      value: alternative.value,
      count: alternative.count,
    }])).values()];
    return {
      external_key: group.id,
      rule_code: group.ruleId,
      group_key: group.id,
      normalized_key: group.key,
      affected_field: group.targetField,
      observed_values: values,
      affected_row_count: group.members.length,
      alert_count: group.alertIds.length,
    };
  });

  const groupMembers = manifest.conflictGroups.flatMap((group) => {
    const frequencies = new Map<string, number>();
    const target = group.targetField;
    if (target) for (const member of group.members) {
      const value = String(member.fields[target] ?? '');
      frequencies.set(value, (frequencies.get(value) ?? 0) + 1);
    }
    return group.members.map((member) => ({
      group_external_key: group.id,
      row_external_key: `row-${member.sourceRow}`,
      rule_code: group.ruleId,
      group_key: group.id,
      excel_row: member.sourceRow,
      is_alert: group.alertSourceRows.includes(member.sourceRow),
      is_related_context: !group.alertSourceRows.includes(member.sourceRow),
      observed_value: target ? display(member.fields[target]) : null,
      value_frequency: target ? frequencies.get(String(member.fields[target] ?? '')) ?? 1 : null,
    }));
  });

  const blocks = manifest.blocks.map((item) => ({
    external_key: item.id,
    block_key: item.id,
    alert_count: item.alertCount,
    member_count: item.relatedRecordCount,
    invoice_count: item.invoiceCount,
    weight: item.weight,
    priority: 0,
  }));
  const blockByTask = new Map(manifest.blocks.flatMap((item) => item.taskIds.map((taskId) => [taskId, item.id])));
  const tasks = manifest.tasks.map((task) => ({
    external_key: task.id,
    row_external_key: `row-${task.sourceRow}`,
    block_external_key: blockByTask.get(task.id),
    excel_row: task.sourceRow,
    block_key: blockByTask.get(task.id),
    is_related_only: false,
    alert_count: task.alerts.length,
  }));

  const fingerprintByEvidence = new Map<string, Promise<string>>();
  const alerts = await Promise.all(manifest.tasks.flatMap((task) => task.alerts.map(async (alert) => {
    const suggestion = alert.suggestion;
    const sourceRecord = recordByRow.get(alert.sourceRow);
    const targetField = suggestion.targetField && dataset.headers.includes(suggestion.targetField)
      ? suggestion.targetField
      : null;
    const originalValue = targetField
      ? display(sourceRecord?.fields[targetField])
      : alert.observed || null;
    const fingerprintKey = JSON.stringify({
      group: alert.conflictGroupId,
      rule: alert.ruleId,
      observed: originalValue,
      method: suggestion.method,
      evidence: persistedEvidence(suggestion.evidence),
      alternatives: persistedAlternatives(suggestion.alternatives),
    });
    let fingerprint = fingerprintByEvidence.get(fingerprintKey);
    if (!fingerprint) {
      fingerprint = collaborationAlertEvidenceFingerprint(dataset, alert, sourceRecord);
      fingerprintByEvidence.set(fingerprintKey, fingerprint);
    }
    return {
      event_key: alert.id,
      task_external_key: task.id,
      group_external_key: alert.conflictGroupId,
      excel_row: alert.sourceRow,
      rule_code: alert.ruleId,
      group_key: alert.conflictGroupId,
      category: alert.ruleId === 'ORT-01' ? 'orthography' : alert.ruleId.startsWith('EST-') ? 'structural' : alert.ruleId.startsWith('JER-') ? 'hierarchy' : 'validation',
      affected_field: targetField ?? alert.field,
      source_column_index: suggestion.targetColumnIndex ?? (dataset.headers.indexOf(alert.field) >= 0 ? dataset.headers.indexOf(alert.field) : null),
      original_value: originalValue,
      expected_or_conflicts: alert.expected || null,
      detail: alert.detail,
      severity: 1,
      suggested_column_name: suggestion.targetField,
      suggested_column_index: suggestion.targetColumnIndex,
      suggested_value: suggestion.value === null ? null : String(suggestion.value),
      suggestion_method: suggestion.method,
      suggestion_confidence: suggestion.confidence,
      // Las filas relacionadas ya se persisten una sola vez en group_members.
      // Repetirlas dentro de cada alerta hace crecer una jornada de forma
      // cuadrática y puede superar el límite de cadenas del navegador.
      suggestion_evidence: persistedEvidence(suggestion.evidence),
      suggestion_alternatives: persistedAlternatives(suggestion.alternatives),
      can_auto_apply: suggestion.autoApplicable && suggestion.confidence === 'high',
      evidence_fingerprint_hex: await fingerprint,
    };
  })));

  const invoiceLinksByIdentity = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const reference = String(row.id_dn_w ?? '').trim().toUpperCase();
    for (const url of (invoices.urlsByRef[reference] ?? []).filter((value) => value.startsWith('https://'))) {
      invoiceLinksByIdentity.set(`${reference}\u0000${url}`, {
        row_external_key: null,
        excel_row: null,
        id_dn_w: row.id_dn_w,
        ref_id_stg: row.id_dn_w,
        external_url: url,
        storage_object_path: null,
        metadata: {},
      });
    }
  }
  const invoiceLinks = [...invoiceLinksByIdentity.values()];

  const batches: IngestionBatch[] = [
    ...packIngestionBatches('rows', rows, 800),
    ...packIngestionBatches('groups', groups, 500),
    ...packIngestionBatches('group_members', groupMembers, 1_500),
    ...packIngestionBatches('blocks', blocks, 500),
    ...packIngestionBatches('tasks', tasks, 800),
    ...packIngestionBatches('alerts', alerts, 800),
    ...packIngestionBatches('invoices', invoiceLinks, 800),
  ];
  // El hash solo necesita representar de manera estable el manifiesto que se
  // guardó. Evitar serializar nuevamente las sugerencias y todos sus miembros
  // relacionados mantiene el uso de memoria lineal en bases grandes.
  const manifestHash = await sha256Hex(JSON.stringify({
    source: manifest.sourceFile,
    headers: manifest.headers,
    rows: rows.map((row) => row.external_key),
    groups: groups.map((group) => [group.external_key, group.affected_row_count, group.alert_count]),
    blocks: blocks.map((item) => [item.external_key, item.alert_count, item.member_count, item.invoice_count]),
    tasks: tasks.map((task) => [task.external_key, task.row_external_key, task.block_external_key, task.alert_count]),
    alerts: alerts.map((alert) => [alert.event_key, alert.evidence_fingerprint_hex]),
    invoices: invoiceLinks.map((invoice) => [invoice.ref_id_stg, invoice.external_url]),
  }));
  return { batches, storedRowCount: rows.length, taskCount: tasks.length, alertCount: alerts.length, manifestHash };
}
