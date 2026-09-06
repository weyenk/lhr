import { describe, expect, it, vi, beforeEach } from 'vitest';
import { insertCompetitorReport, listRecentCompetitorReports, type NewCompetitorReport } from '../src/competitorReports';

function mockDb(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const newReport: NewCompetitorReport = {
  competitorId: 1,
  cycleId: '2026-09-06',
  newContent: [{ title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: '2026-09-01' }],
  seoPositions: [{ keyword: 'gluten free dinner recipes', position: 4 }],
  monetizationSnapshot: 'Sells a $40 cast-iron pan; runs Amazon affiliate links in most posts.',
  designSnapshot: 'Grid homepage, prominent "Shop the kitchen" CTA above the fold.',
  summary: 'Published one new post this week; no monetization or design changes.',
};

const reportRow = {
  id: 1,
  competitor_id: 1,
  cycle_id: '2026-09-06',
  generated_at: new Date('2026-09-06T00:00:00Z'),
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
    const db = mockDb([reportRow]);
    const result = await insertCompetitorReport(db as never, newReport);
    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO competitor_reports'),
      [
        1,
        '2026-09-06',
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

describe('listRecentCompetitorReports', () => {
  it('queries by competitor, most recent first, respecting the limit', async () => {
    const db = mockDb([reportRow]);
    const result = await listRecentCompetitorReports(db as never, 1, 5);
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining('ORDER BY generated_at DESC'), [1, 5]);
    expect(result).toHaveLength(1);
  });

  it('defaults the limit to 10', async () => {
    const db = mockDb([]);
    await listRecentCompetitorReports(db as never, 1);
    expect(db.query).toHaveBeenCalledWith(expect.any(String), [1, 10]);
  });
});
