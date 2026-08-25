import { describe, expect, it } from 'vitest';
import {
  calculateInitialValidatorSelection,
  calculateSelectedValidatorLoads,
  normalizeSelectedValidatorIds,
  requireSelectedValidatorIds,
} from './assignment-selection';

describe('selección de validadores para el reparto', () => {
  it('normaliza, deduplica y conserva el orden elegido por el líder', () => {
    expect(normalizeSelectedValidatorIds([
      ' validator-c ',
      'validator-a',
      'validator-c',
      '',
      null,
      undefined,
      ' validator-b ',
    ])).toEqual(['validator-c', 'validator-a', 'validator-b']);
  });

  it('rechaza una selección vacía en vez de interpretarla como todos los activos', () => {
    expect(() => requireSelectedValidatorIds([' ', '', null, undefined]))
      .toThrow('Selecciona al menos un validador para repartir la jornada.');
  });

  it('selecciona todos los validadores activos en el primer reparto', () => {
    expect(calculateInitialValidatorSelection({
      mode: 'initial',
      validators: [
        { userId: 'validator-a', isActive: true },
        { userId: 'validator-inactive', isActive: false },
        { userId: 'validator-b' },
      ],
    })).toEqual(['validator-a', 'validator-b']);
  });

  it('en un re-reparto selecciona solo responsables activos con trabajo pendiente', () => {
    expect(calculateInitialValidatorSelection({
      mode: 'redistribute',
      validators: [
        { userId: 'validator-a', isActive: true },
        { userId: 'validator-b', isActive: true },
        { userId: 'validator-c', isActive: true },
        { userId: 'validator-inactive', isActive: false },
      ],
      blocks: [
        { assignedTo: 'validator-a', status: 'completed', pendingTaskCount: 0 },
        { assignedTo: 'validator-c', status: 'in_progress', pendingTaskCount: 2 },
        { assignedTo: 'validator-inactive', status: 'published', pendingTaskCount: 4 },
        { assignedTo: 'validator-c', status: 'published', pendingTaskCount: 1 },
        { assignedTo: null, status: 'published', pendingTaskCount: 3 },
      ],
    })).toEqual(['validator-c']);
  });

  it('usa todos los activos si ningún responsable pendiente continúa disponible', () => {
    expect(calculateInitialValidatorSelection({
      mode: 'redistribute',
      validators: [
        { userId: 'validator-a', isActive: true },
        { userId: 'validator-b', isActive: true },
        { userId: 'validator-inactive', isActive: false },
      ],
      blocks: [
        { assignedTo: 'validator-a', status: 'completed', pendingTaskCount: 0 },
        { assignedTo: 'validator-inactive', status: 'published', pendingTaskCount: 5 },
      ],
    })).toEqual(['validator-a', 'validator-b']);
  });

  it('calcula cargas únicamente para el subconjunto seleccionado', () => {
    expect(calculateSelectedValidatorLoads(
      ['validator-c', 'validator-a', 'validator-c'],
      [
        { assignedTo: 'validator-a', alertCount: 3, weight: 2.5 },
        { assignedTo: 'validator-b', alertCount: 100, weight: 100 },
        { assignedTo: 'validator-c', alertCount: 4, weight: 3 },
        { assignedTo: 'validator-c', alertCount: 2, weight: 1.5 },
        { assignedTo: null, alertCount: 20, weight: 20 },
      ],
    )).toEqual([
      { validatorId: 'validator-c', blockCount: 2, alertCount: 6, weight: 4.5 },
      { validatorId: 'validator-a', blockCount: 1, alertCount: 3, weight: 2.5 },
    ]);
  });
});
