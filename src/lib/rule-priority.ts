import type { RuleDefinition } from './types';

export interface RuleMetricRecord {
  rule_code: string;
  category: 'validation' | 'orthography' | 'structural' | 'hierarchy';
  alert_count: number;
  pending_alert_count: number;
  affected_task_count: number;
  pending_task_count: number;
}

export interface RulePriority extends RuleMetricRecord {
  name: string;
  description: string;
  relativeLoad: number;
}

export const ORTHOGRAPHY_RULE: RuleDefinition = {
  id: 'ORT-01',
  name: 'Ortografía contextual y espacios',
  description: 'Compara descripciones raras con referencias frecuentes y separa correcciones confiables de palabras que requieren revisión manual.',
  status: 'Adicional',
};

export function buildRulePriorities(
  metrics: RuleMetricRecord[],
  definitions: RuleDefinition[],
): { active: RulePriority[]; inactive: RuleDefinition[] } {
  const allDefinitions = [...definitions.filter((rule) => rule.id !== 'R21'), ORTHOGRAPHY_RULE];
  const definitionById = new Map(allDefinitions.map((rule) => [rule.id, rule]));
  const maxPending = Math.max(1, ...metrics.map((metric) => Number(metric.pending_alert_count)));
  const active = metrics
    .map((metric) => {
      const definition = definitionById.get(metric.rule_code);
      return {
        ...metric,
        alert_count: Number(metric.alert_count),
        pending_alert_count: Number(metric.pending_alert_count),
        affected_task_count: Number(metric.affected_task_count),
        pending_task_count: Number(metric.pending_task_count),
        name: definition?.name ?? metric.rule_code,
        description: definition?.description ?? 'Regla activa en esta jornada.',
        relativeLoad: Number(metric.pending_alert_count) / maxPending,
      };
    })
    .sort((left, right) => (
      right.pending_alert_count - left.pending_alert_count
      || right.alert_count - left.alert_count
      || left.rule_code.localeCompare(right.rule_code, 'es', { numeric: true })
    ));
  const activeCodes = new Set(active.map((rule) => rule.rule_code));
  const inactive = allDefinitions.filter((rule) => !activeCodes.has(rule.id));

  return { active, inactive };
}
