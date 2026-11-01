import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '@lhr/jobs';

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

  it('does not register affiliate-sourcing (global constraint)', () => {
    expect(jobs.find((j) => j.name === 'affiliate-sourcing')).toBeUndefined();
  });

  it('registers the trends-watcher job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'trends-watcher');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });

  it('registers the competitor-analysis job on a 7-day cadence', () => {
    const job = jobs.find((j) => j.name === 'competitor-analysis');
    expect(job).toMatchObject({ cadenceDays: 7 });
    expect(job?.run).toBeTypeOf('function');
  });

  it.each([
    ['product-sourcing-criteria', 7],
    ['product-sourcing-search', 1],
    ['product-sourcing-monetize', 1],
    ['product-sourcing-brand', 1],
  ])('registers the %s job on a %i-day cadence', (name, cadenceDays) => {
    const job = jobs.find((j) => j.name === name);
    expect(job).toMatchObject({ cadenceDays });
    expect(job?.run).toBeTypeOf('function');
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
