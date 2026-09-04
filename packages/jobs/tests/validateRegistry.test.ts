import { describe, expect, it } from 'vitest';
import { validateJobRegistrations } from '../src/validateRegistry';
import type { JobRegistration } from '../src/types';

const validJob = (name: string): JobRegistration => ({
  name,
  cadenceDays: 7,
  run: async () => ({ status: 'success', summary: 'ok' }),
});

describe('validateJobRegistrations', () => {
  it('accepts an empty registry', () => {
    expect(() => validateJobRegistrations([])).not.toThrow();
  });

  it('accepts a well-formed registry', () => {
    expect(() => validateJobRegistrations([validJob('a'), validJob('b')])).not.toThrow();
  });

  it('rejects an empty name', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), name: '' }])).toThrow(/name/);
  });

  it('rejects a duplicate name', () => {
    expect(() => validateJobRegistrations([validJob('a'), validJob('a')])).toThrow(/duplicate/);
  });

  it('rejects a non-positive cadenceDays', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), cadenceDays: 0 }])).toThrow(/cadenceDays/);
  });

  it('rejects a non-integer cadenceDays', () => {
    expect(() => validateJobRegistrations([{ ...validJob('a'), cadenceDays: 1.5 }])).toThrow(/cadenceDays/);
  });

  it('rejects a non-function run', () => {
    expect(() =>
      validateJobRegistrations([{ ...validJob('a'), run: 'nope' as unknown as JobRegistration['run'] }]),
    ).toThrow(/run/);
  });
});
