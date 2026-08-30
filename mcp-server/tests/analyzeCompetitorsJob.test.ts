import { describe, expect, it } from 'vitest';
import { summaryToJobResult } from '../src/analyzeCompetitors';
import type { WeeklyCompetitorRunSummary } from '../src/analyzeCompetitors';

const baseSummary: WeeklyCompetitorRunSummary = {
  cycleId: '2026-W35',
  discoveredCandidates: 2,
  failedDiscoveryQueries: [],
  failedSeoKeywords: [],
  reportsWritten: 3,
};

describe('summaryToJobResult', () => {
  it('reports success when nothing failed', () => {
    const result = summaryToJobResult(baseSummary);
    expect(result.status).toBe('success');
    expect(result.summary).toContain('2026-W35');
    expect(result.summary).toContain('3');
  });

  it('reports partial when a discovery query failed', () => {
    const result = summaryToJobResult({ ...baseSummary, failedDiscoveryQueries: ['gluten free recipe blog'] });
    expect(result.status).toBe('partial');
  });

  it('reports partial when an SEO keyword lookup failed', () => {
    const result = summaryToJobResult({ ...baseSummary, failedSeoKeywords: ['gluten free dinner recipes'] });
    expect(result.status).toBe('partial');
  });

  it('includes the run counts in details', () => {
    const result = summaryToJobResult(baseSummary);
    expect(result.details).toEqual({
      discoveredCandidates: 2,
      failedDiscoveryQueries: [],
      failedSeoKeywords: [],
      reportsWritten: 3,
    });
  });
});
