import { describe, expect, it, vi } from 'vitest';
import { collectAssignmentBlockPages, type AssignmentBlockRow } from './assignment-block-pagination';

function block(index: number): AssignmentBlockRow {
  return {
    id: `block-${index.toString().padStart(4, '0')}`,
    block_key: `key-${index}`,
    status: 'published',
    alert_count: 1,
    member_count: 1,
    invoice_count: 0,
    weight: 1,
    assigned_to: index % 2 === 0 ? 'validator-1' : 'validator-2',
    version: 3,
    assignment_version: 2,
  };
}

describe('collectAssignmentBlockPages', () => {
  it('recupera los 1.237 bloques sin truncarlos al límite de la Data API', async () => {
    const source = Array.from({ length: 1_237 }, (_, index) => block(index));
    const requestedRanges: Array<[number, number, boolean]> = [];

    const result = await collectAssignmentBlockPages(async (from, to, includeCount) => {
      requestedRanges.push([from, to, includeCount]);
      return {
        rows: source.slice(from, to + 1),
        total: includeCount ? source.length : null,
      };
    });

    expect(requestedRanges).toEqual([
      [0, 499, true],
      [500, 999, false],
      [1_000, 1_499, false],
    ]);
    expect(result.total).toBe(1_237);
    expect(result.blocks).toHaveLength(1_237);
    expect(new Set(result.blocks.map((item) => item.id)).size).toBe(1_237);
  });

  it('se detiene con un total exacto aunque la última página esté llena', async () => {
    const source = Array.from({ length: 1_000 }, (_, index) => block(index));
    const loader = vi.fn(async (from: number, to: number, includeCount: boolean) => ({
      rows: source.slice(from, to + 1),
      total: includeCount ? source.length : null,
    }));

    const result = await collectAssignmentBlockPages(loader);

    expect(result.blocks).toHaveLength(1_000);
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('rechaza una lectura incompleta antes de permitir la publicación', async () => {
    await expect(collectAssignmentBlockPages(async (from, to, includeCount) => ({
      rows: from === 0 ? Array.from({ length: 500 }, (_, index) => block(index)).slice(from, to + 1) : [],
      total: includeCount ? 1_237 : null,
    }))).rejects.toThrow('500 de 1237');
  });
});
