import { describe, expect, it } from 'vitest';
import { computeCycleId } from '../src/computeCycleId';

describe('computeCycleId', () => {
  it('formats a mid-year Monday as its ISO week', () => {
    expect(computeCycleId(new Date('2026-08-24T12:00:00Z'))).toBe('2026-W35');
  });

  it('formats the first week of January correctly', () => {
    expect(computeCycleId(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });

  it('assigns the last days of December to week 53 when the ISO year rolls over', () => {
    expect(computeCycleId(new Date('2026-12-31T00:00:00Z'))).toBe('2026-W53');
  });
});
