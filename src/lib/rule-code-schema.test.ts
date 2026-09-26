import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RULE_DEFINITIONS } from './rules';

const migrationPath = fileURLToPath(new URL(
  '../../supabase/migrations/20260926032459_allow_r31_r32_similarity_rules.sql',
  import.meta.url,
));

describe('códigos de reglas admitidos por la base de datos', () => {
  it('acepta todas las reglas publicadas en grupos y alertas, sin admitir códigos futuros', () => {
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const constraints = [...migration.matchAll(/check \(rule_code ~ '([^']+)'\)/g)]
      .map((match) => new RegExp(match[1]));

    expect(constraints).toHaveLength(2);
    for (const constraint of constraints) {
      for (const rule of RULE_DEFINITIONS) {
        expect(constraint.test(rule.id), `${rule.id} debe admitirse en ambas tablas`).toBe(true);
      }
      expect(constraint.test('R33')).toBe(false);
    }
  });
});
