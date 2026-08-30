import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '../src/validateRegistry';

describe('jobs registry', () => {
  it('registers the recipe-variant-generator job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'recipe-variant-generator');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('registers the recipe-variant-finisher job on a daily cadence', () => {
    const job = jobs.find((j) => j.name === 'recipe-variant-finisher');
    expect(job).toMatchObject({ cadenceDays: 1 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
