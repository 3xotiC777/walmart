export type CellValue = string | number | boolean | Date | null | undefined;

export interface SourceRecord {
  excelRow: number;
  values: CellValue[];
  fields: Record<string, CellValue>;
}

export interface SourceDataset {
  sourceFile: string;
  headers: string[];
  outputHeaders: string[];
  records: SourceRecord[];
}

export interface InvoiceCatalog {
  sourceFile: string;
  urlsByRef: Record<string, string[]>;
  totalImages: number;
}

export interface OrthographyAlert {
  sourceRow: number;
  rowId: string;
  surveyId: string;
  barcode: string;
  fields: {
    Marca_Wm: string;
    Tipo_Marca: string;
    Descripcion: string;
    'Canasto Wm': string;
  };
  reason: string;
  probability: string;
  correctedDescription: string;
}

export interface HierarchyEntry {
  producto: string;
  categoria: string;
  division: string;
  canasto: string;
}

export interface HierarchyCatalog {
  metadata: {
    sourceSheet: string;
    generatedAt: string;
    products: number;
  };
  entries: Record<string, HierarchyEntry>;
}

export type RuleStatus = 'Automático' | 'Visual no automatizado' | 'Adicional';

export interface RuleDefinition {
  id: string;
  name: string;
  status: RuleStatus;
  description: string;
}

export const ORTHOGRAPHY_RULE = {
  id: 'ORT-01',
  name: 'Ortografía y espacios',
  status: 'Adicional',
  description: 'Detecta posibles errores de texto y espacios sobrantes en la descripción.',
} as const satisfies RuleDefinition;

export interface AlertRecord {
  ruleId: string;
  ruleName: string;
  sourceRow: number;
  rowId: string;
  surveyId: string;
  barcode: string;
  description: string;
  key: string;
  field: string;
  observed: string;
  expected: string;
  detail: string;
  groupAverage?: number;
  priceThreshold?: number;
  priceDifferencePercent?: number;
  invoiceUrls?: string[];
}

export interface RuleSummary extends RuleDefinition {
  affectedRows: number;
  alertCount: number;
}

export interface ValidationMetrics {
  totalRecords: number;
  reviewRecords: number;
  okRecords: number;
  reviewPercent: number;
  totalAlerts: number;
}

export interface ReviewedRecord {
  record: SourceRecord;
  alerts: AlertRecord[];
}

export interface ValidationResult {
  metrics: ValidationMetrics;
  alerts: AlertRecord[];
  ruleSummaries: RuleSummary[];
  reviewedRecords: ReviewedRecord[];
}

export interface WorkerResult {
  metrics: ValidationMetrics;
  alerts: AlertRecord[];
  orthographyAlerts: AlertRecord[];
  ruleSummaries: RuleSummary[];
  sourceFile: string;
  invoiceFile: string;
  invoiceImages: number;
  generatedAt: string;
  hierarchyProducts: number;
  outputBuffer: ArrayBuffer;
}

export type WorkerMessage =
  | { type: 'progress'; message: string; progress: number }
  | { type: 'result'; payload: WorkerResult }
  | { type: 'error'; message: string };

export interface WorkerRequest {
  sourceBuffer: ArrayBuffer;
  sourceFileName: string;
  invoiceBuffer: ArrayBuffer;
  invoiceFileName: string;
  hasBarcode: boolean;
}
