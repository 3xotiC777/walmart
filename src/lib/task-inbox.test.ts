import { describe, expect, it } from 'vitest';
import {
  buildTaskListHref,
  normalizeTaskPage,
  normalizeTaskSort,
  taskPageBounds,
} from './task-inbox';

describe('task inbox pagination', () => {
  it('calculates nine pages for 414 assigned tasks', () => {
    expect(taskPageBounds(9, 414)).toEqual({
      totalPages: 9,
      firstResult: 401,
      lastResult: 414,
    });
  });

  it('normalizes invalid page and sort values', () => {
    expect(normalizeTaskPage('-2')).toBe(1);
    expect(normalizeTaskPage('abc')).toBe(1);
    expect(normalizeTaskPage('2147483647')).toBe(1);
    expect(normalizeTaskPage('3')).toBe(3);
    expect(normalizeTaskSort('unknown')).toBe('rule_asc');
    expect(normalizeTaskSort('rule_desc')).toBe('rule_desc');
  });

  it('preserves filters and sorting in pagination links', () => {
    const href = buildTaskListHref({
      page: 4,
      status: 'pending',
      rule: 'R25',
      search: '09010055',
      sort: 'rule_desc',
    });
    expect(href).toContain('page=4');
    expect(href).toContain('status=pending');
    expect(href).toContain('rule=R25');
    expect(href).toContain('q=09010055');
    expect(href).toContain('sort=rule_desc');
  });
});
