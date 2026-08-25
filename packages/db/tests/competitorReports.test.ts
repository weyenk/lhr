import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertCompetitorReport, getLatestReport, listRecentReports, type NewCompetitorReport } from '../src/competitorReports';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewCompetitorReport = {
  competitorId: 1,
  cycleId: '2026-W35',
  newContent: [{ title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: '2026-08-20' }],
  seoPositions: [{ keyword: 'gluten free dinner recipes', position: 4 }],
  monetizationSnapshot: 'Sells a $40 cast-iron pan; runs Amazon affiliate links in most posts.',
  designSnapshot: 'Grid homepage, prominent "Shop the kitchen" CTA above the fold.',
  summary: 'Published one new post this week; no monetization or design changes.',
};

const reportRow = {
  id: 1,
  competitor_id: 1,
  cycle_id: '2026-W35',
  generated_at: new Date('2026-08-24T00:00:00Z'),
  new_content: newReport.newContent,
  seo_positions: newReport.seoPositions,
  monetization_snapshot: newReport.monetizationSnapshot,
  design_snapshot: newReport.designSnapshot,
  summary: newReport.summary,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('insertCompetitorReport', () => {
  it('inserts JSONB-encoded new_content and seo_positions and returns the row', async () => {
    const pool = mockPool([reportRow]);
    const result = await insertCompetitorReport(pool as never, newReport);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO competitor_reports'),
      [
        1,
        '2026-W35',
        JSON.stringify(newReport.newContent),
        JSON.stringify(newReport.seoPositions),
        newReport.monetizationSnapshot,
        newReport.designSnapshot,
        newReport.summary,
      ],
    );
    expect(result.summary).toBe(newReport.summary);
    expect(result.newContent).toEqual(newReport.newContent);
  });
});

describe('getLatestReport', () => {
  it('returns null when there is no prior report', async () => {
    const pool = mockPool([]);
    expect(await getLatestReport(pool as never, 999)).toBeNull();
  });

  it('returns the most recent report for the competitor', async () => {
    const pool = mockPool([reportRow]);
    const result = await getLatestReport(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC LIMIT 1'), [1]);
    expect(result?.cycleId).toBe('2026-W35');
  });
});

describe('listRecentReports', () => {
  it('queries by competitor, most recent first, respecting the limit', async () => {
    const pool = mockPool([reportRow]);
    const result = await listRecentReports(pool as never, 1, 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), [1, 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const pool = mockPool([]);
    await listRecentReports(pool as never, 1);
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [1, 10]);
  });
});
