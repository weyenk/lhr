import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '../src/validateRegistry';

describe('jobs registry', () => {
  it('registers the recipe-variant-generator job on a 7-day cadence', () => {
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ name: 'recipe-variant-generator', cadenceDays: 7 });
    expect(jobs[0].run).toBeTypeOf('function');
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
