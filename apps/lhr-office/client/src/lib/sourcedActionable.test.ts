import { describe, expect, it } from 'vitest';
import { countSourcedActionable } from './sourcedActionable';
import type { SourcedProductCandidate, SourcedProductCycle, SourcedProductCycleResponse } from './types';

function cycle(status: SourcedProductCycle['status']): SourcedProductCycle {
  return { id: 1, startedAt: '2026-10-01T00:00:00.000Z', status, criteriaJson: null, criteriaApprovedAt: null, gatingProfile: 'trust', closedAt: null };
}

function candidate(id: number, status: SourcedProductCandidate['status']): SourcedProductCandidate {
  return {
    id,
    cycleId: 1,
    title: `P${id}`,
    imageUrl: null,
    sourceUrl: 'https://x.test',
    platform: 'etsy.com',
    moq: null,
    unitCostCents: null,
    notes: null,
    status,
    monetizePass: null,
    monetizeRationale: null,
    brandPass: null,
    brandRationale: null,
    decidedAt: null,
    createdAt: '2026-10-01T00:00:00.000Z',
  };
}

function response(status: SourcedProductCycle['status'], candidates: SourcedProductCandidate[] = []): SourcedProductCycleResponse {
  return { cycle: cycle(status), candidates };
}

describe('countSourcedActionable', () => {
  it('is 0 with no data or no open cycle', () => {
    expect(countSourcedActionable(null)).toBe(0);
    expect(countSourcedActionable(undefined)).toBe(0);
    expect(countSourcedActionable({ cycle: null, candidates: [] })).toBe(0);
  });

  it('counts the brief as one decision while awaiting criteria approval', () => {
    expect(countSourcedActionable(response('awaiting_criteria_approval'))).toBe(1);
  });

  it('counts sourced candidates awaiting a pick', () => {
    expect(countSourcedActionable(response('awaiting_product_picks', [candidate(1, 'sourced'), candidate(2, 'sourced'), candidate(3, 'picked')]))).toBe(2);
  });

  it('counts monetize passes only while awaiting monetize approval', () => {
    const candidates = [candidate(1, 'monetize_pass'), candidate(2, 'monetize_pass'), candidate(3, 'monetize_fail')];
    expect(countSourcedActionable(response('awaiting_monetize_approval', candidates))).toBe(2);
    expect(countSourcedActionable(response('monetizing', candidates))).toBe(0);
  });

  it('counts pending_final candidates', () => {
    expect(countSourcedActionable(response('awaiting_final', [candidate(1, 'pending_final'), candidate(2, 'approved')]))).toBe(1);
  });

  it('is 0 for in-flight statuses with nothing awaiting the author', () => {
    expect(countSourcedActionable(response('searching'))).toBe(0);
    expect(countSourcedActionable(response('drafting_criteria'))).toBe(0);
  });
});
