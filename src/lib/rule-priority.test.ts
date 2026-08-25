import { describe, expect, it } from 'vitest';
import { buildRulePriorities } from './rule-priority';
import type { RuleDefinition } from './types';

const definitions: RuleDefinition[] = [
  { id: 'R01', name: 'Código → descripción', description: 'R01', status: 'Automático' },
  { id: 'R21', name: 'Visual', description: 'Omitida', status: 'Visual no automatizado' },
  { id: 'R30', name: 'Calidad de descripción', description: 'R30', status: 'Automático' },
];

describe('buildRulePriorities', () => {
  it('ordena por alertas pendientes y calcula la carga relativa', () => {
    const result = buildRulePriorities([
      {
        rule_code: 'R01', category: 'validation', alert_count: 35,
        pending_alert_count: 12, affected_task_count: 35, pending_task_count: 12,
      },
      {
        rule_code: 'R30', category: 'validation', alert_count: 1101,
        pending_alert_count: 1000, affected_task_count: 1101, pending_task_count: 1000,
      },
    ], definitions);

    expect(result.active.map((rule) => rule.rule_code)).toEqual(['R30', 'R01']);
    expect(result.active[0].relativeLoad).toBe(1);
    expect(result.active[1].relativeLoad).toBeCloseTo(0.012);
  });

  it('incluye ortografía y agrupa en inactivas las reglas sin alertas, excepto R21', () => {
    const result = buildRulePriorities([
      {
        rule_code: 'ORT-01', category: 'orthography', alert_count: 45,
        pending_alert_count: 45, affected_task_count: 45, pending_task_count: 45,
      },
    ], definitions);

    expect(result.active[0]).toMatchObject({ rule_code: 'ORT-01', name: 'Ortografía y espacios' });
    expect(result.inactive.map((rule) => rule.id)).toEqual(['R01', 'R30']);
  });
});
