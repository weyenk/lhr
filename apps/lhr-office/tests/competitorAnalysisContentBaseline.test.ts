import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

interface FakeReportRow {
  id: number;
  competitorId: number;
  cycleId: string;
  generatedAt: Date;
  newContent: { title: string; url: string; publishedAt: string | null }[];
  seoPositions: unknown[];
  monetizationSnapshot: string;
  designSnapshot: string;
  summary: string;
}

let reports: FakeReportRow[];
let nextReportId: number;

const dbMock = {
  getPool: vi.fn(() => ({})),
  insertCandidateCompetitor: vi.fn().mockResolvedValue(null),
  listCompetitorsByStatus: vi.fn(),
  listKeywords: vi.fn().mockResolvedValue([]),
  listRecentCompetitorReports: vi.fn(async (_db: unknown, competitorId: number, limit = 10) =>
    reports.filter((r) => r.competitorId === competitorId).slice(-limit).reverse(),
  ),
  insertCompetitorReport: vi.fn(async (_db: unknown, report: Omit<FakeReportRow, 'id' | 'generatedAt'>) => {
    const row: FakeReportRow = { ...report, id: nextReportId++, generatedAt: new Date() };
    reports.push(row);
    return row;
  }),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = { fetchSearchResults: vi.fn().mockResolvedValue([]) };
vi.mock('../src/serpapiSearch', () => serpapiMock);
// Deliberately NOT mocking '../src/competitorContent' — this test exercises the real
// fetchCompetitorPosts/diffNewPosts, per the spec's own requirement for an integration test
// covering the two-consecutive-cycles content baseline.

const llmMock = { callLLM: vi.fn().mockResolvedValue('unused LLM output') };
vi.mock('@lhr/llm', () => llmMock);

const { analyzeCompetitors } = await import('../src/competitorAnalysis');

const originalEnv = { ...process.env };
const originalFetch = global.fetch;

const trackedCompetitor = {
  id: 1,
  domain: 'reliable-recipes.com',
  name: null,
  status: 'tracked' as const,
  discoveredAt: new Date(),
  approvedAt: new Date(),
};

const HOMEPAGE_WITH_FEED = `
<html><head>
<link rel="alternate" type="application/rss+xml" href="/feed.xml" />
</head><body>Shop the Kitchen</body></html>
`;

const RSS_FEED = `<?xml version="1.0"?>
<rss><channel>
<item><title>Sourdough Focaccia</title><link>https://reliable-recipes.com/sourdough-focaccia</link><pubDate>Thu, 20 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

beforeEach(() => {
  vi.clearAllMocks();
  reports = [];
  nextReportId = 1;
  process.env.SERPAPI_KEY = 'test-serpapi-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';
  dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
  serpapiMock.fetchSearchResults.mockResolvedValue([]);
  llmMock.callLLM.mockResolvedValue('unused LLM output');
  global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
    const u = url.toString();
    if (u === 'https://reliable-recipes.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED };
    if (u === 'https://reliable-recipes.com/feed.xml') return { ok: true, text: async () => RSS_FEED };
    throw new Error(`unexpected fetch ${u}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('analyzeCompetitors (content baseline, real fetchCompetitorPosts/diffNewPosts)', () => {
  it('does not re-report an unchanged RSS feed as new content on a second consecutive cycle', async () => {
    await analyzeCompetitors();
    expect(reports).toHaveLength(1);
    expect(reports[0].newContent).toEqual([
      { title: 'Sourdough Focaccia', url: 'https://reliable-recipes.com/sourdough-focaccia', publishedAt: 'Thu, 20 Aug 2026 00:00:00 GMT' },
    ]);

    await analyzeCompetitors();
    expect(reports).toHaveLength(2);
    expect(reports[1].newContent).toEqual([]);
  });
});
