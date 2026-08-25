import type { Database } from '@/lib/supabase/database.types';

type UploadStatus = Database['public']['Enums']['upload_status'];

/**
 * Estados que ya representan una jornada utilizable por el equipo.
 *
 * `ready` y `assigning` deben participar: durante el primer reparto la nueva
 * jornada ya contiene sus alertas y reemplaza a cualquier jornada histórica.
 */
export const CURRENT_JOURNEY_STATUSES = [
  'ready',
  'assigning',
  'active',
  'completed',
] as const satisfies readonly UploadStatus[];

export function isCurrentJourneyStatus(status: UploadStatus): boolean {
  return CURRENT_JOURNEY_STATUSES.some((candidate) => candidate === status);
}
