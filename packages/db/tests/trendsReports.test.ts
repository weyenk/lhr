import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertTrendsReport, listRecentReports, type NewTrendsReport } from '../src/trendsReports';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewTrendsReport = {
  cycleId: '2026-08-24',
  category: 'cooking',
  topicsUsed: [{ topic: 'air fryer recipes', source: 'curated' }],
  rawFindings: { topics: [], trendingNow: [] },
  summary: 'Air fryer content is trending; we already cover it well.',
};

const reportRow = {
  id: 1, cycle_id: '2026-08-24', category: 'cooking', generated_at: new Date('2026-08-24T00:00:00Z'),
  topics_used: newReport.topicsUsed, raw_findings: newReport.rawFindings, summary: newReport.summary,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertTrendsReport', () => {
  it('inserts JSONB-encoded topics_used and raw_findings and returns the row', async () => {
    const pool = mockPool([reportRow]);
    const result = await insertTrendsReport(pool as never, newReport);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO trends_reports'),
      ['2026-08-24', 'cooking', JSON.stringify(newReport.topicsUsed), JSON.stringify(newReport.rawFindings), newReport.summary],
    );
    expect(result.summary).toBe(newReport.summary);
    expect(result.topicsUsed).toEqual(newReport.topicsUsed);
  });
});

describe('listRecentReports', () => {
  it('queries by category, most recent first, respecting the limit', async () => {
    const pool = mockPool([reportRow]);
    const result = await listRecentReports(pool as never, 'cooking', 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), ['cooking', 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const pool = mockPool([]);
    await listRecentReports(pool as never, 'nutrition');
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), ['nutrition', 10]);
  });
});
