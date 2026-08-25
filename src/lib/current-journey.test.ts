import { describe, expect, it } from 'vitest';
import { CURRENT_JOURNEY_STATUSES, isCurrentJourneyStatus } from './current-journey';

describe('current journey statuses', () => {
  it('keeps a newly prepared or assigning upload ahead of historical active uploads', () => {
    expect(CURRENT_JOURNEY_STATUSES).toEqual(['ready', 'assigning', 'active', 'completed']);
    expect(isCurrentJourneyStatus('ready')).toBe(true);
    expect(isCurrentJourneyStatus('assigning')).toBe(true);
  });

  it('excludes incomplete, failed and archived uploads', () => {
    expect(isCurrentJourneyStatus('uploading')).toBe(false);
    expect(isCurrentJourneyStatus('processing')).toBe(false);
    expect(isCurrentJourneyStatus('failed')).toBe(false);
    expect(isCurrentJourneyStatus('archived')).toBe(false);
  });
});
