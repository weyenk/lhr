import { describe, expect, it } from 'vitest';
import { runResultToJobResult } from '../src/generateWeeklyVariantRecipe';
import type { WeeklyRunResult } from '../src/generateWeeklyVariantRecipe';

describe('runResultToJobResult', () => {
  it('reports success with a "nothing due" summary when the run was skipped', () => {
    const result = runResultToJobResult({ skipped: true });
    expect(result.status).toBe('success');
    expect(result.summary).toContain('No unused TheMealDB recipe');
    expect(result.details).toBeUndefined();
  });

  it('reports success when a draft was created and no diets were flagged', () => {
    const run: WeeklyRunResult = {
      skipped: false,
      draftId: 'abc123',
      title: 'Teriyaki Chicken Casserole',
      sourceMealDbId: '52772',
      flaggedDiets: [],
    };
    const result = runResultToJobResult(run);
    expect(result.status).toBe('success');
    expect(result.summary).toContain('Teriyaki Chicken Casserole');
    expect(result.summary).toContain('52772');
    expect(result.summary).toContain('cleanly');
  });

  it('reports partial when a draft was created but some diets were flagged', () => {
    const run: WeeklyRunResult = {
      skipped: false,
      draftId: 'abc123',
      title: 'Lasagne',
      sourceMealDbId: '52844',
      flaggedDiets: ['gluten-free', 'vegan'],
    };
    const result = runResultToJobResult(run);
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('2 diet(s)');
    expect(result.summary).toContain('gluten-free, vegan');
  });

  it('includes draftId/sourceMealDbId/flaggedDiets in details for a created draft', () => {
    const run: WeeklyRunResult = {
      skipped: false,
      draftId: 'abc123',
      title: 'Lasagne',
      sourceMealDbId: '52844',
      flaggedDiets: ['low-fat'],
    };
    const result = runResultToJobResult(run);
    expect(result.details).toEqual({
      draftId: 'abc123',
      sourceMealDbId: '52844',
      flaggedDiets: ['low-fat'],
    });
  });
});
