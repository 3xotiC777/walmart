export const TASK_PAGE_SIZE = 50;

export const TASK_SORTS = ['rule_asc', 'rule_desc', 'row_asc', 'row_desc'] as const;
export type TaskSort = (typeof TASK_SORTS)[number];

export interface TaskListState {
  page: number;
  status?: string;
  rule?: string;
  search?: string;
  sort?: TaskSort;
}

export function normalizeTaskPage(value: string | string[] | undefined): number {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 10_000 ? parsed : 1;
}

export function normalizeTaskSort(value: string | string[] | undefined): TaskSort {
  return typeof value === 'string' && TASK_SORTS.includes(value as TaskSort)
    ? value as TaskSort
    : 'rule_asc';
}

export function taskPageBounds(page: number, total: number, pageSize = TASK_PAGE_SIZE) {
  const safeTotal = Math.max(0, Math.trunc(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / pageSize));
  const safePage = Math.min(Math.max(1, Math.trunc(page)), totalPages);
  return {
    totalPages,
    firstResult: safeTotal === 0 ? 0 : ((safePage - 1) * pageSize) + 1,
    lastResult: safeTotal === 0 ? 0 : Math.min(safePage * pageSize, safeTotal),
  };
}

export function buildTaskListHref(state: TaskListState): string {
  const params = new URLSearchParams();
  if (state.status) params.set('status', state.status);
  if (state.rule) params.set('rule', state.rule);
  if (state.search) params.set('q', state.search);
  if (state.sort && state.sort !== 'rule_asc') params.set('sort', state.sort);
  if (state.page > 1) params.set('page', String(state.page));
  const query = params.toString();
  return `/workspace/tareas${query ? `?${query}` : ''}`;
}
