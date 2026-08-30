import { describe, expect, it } from 'vitest';
import { jobs } from '../src/registry';
import { validateJobRegistrations } from '../src/validateRegistry';

describe('jobs registry', () => {
  it('starts empty, pending each agent pipeline getting its own implementation plan', () => {
    expect(jobs).toEqual([]);
  });

  it('is always shape-valid', () => {
    expect(() => validateJobRegistrations(jobs)).not.toThrow();
  });
});
