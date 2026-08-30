import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

process.env.SERPAPI_KEY = 'test-key';
process.env.OPENROUTER_API_KEY = 'test-key';

vi.mock('../../src/openrouter', () => ({ callOpenRouter: vi.fn().mockResolvedValue('Nothing notable this week.') }));

interface FakeDbState {
  competitors: { id: number; domain: string; name: string | null; status: string; discoveredAt: Date; approvedAt: Date | null }[];
  reports: { id: number; competitorId: number; cycleId: string; newContent: unknown; seoPositions: unknown; monetizationSnapshot: string; designSnapshot: string; summary: string }[];
  keywords: { id: number; keyword: string; addedAt: Date }[];
  nextCompetitorId: number;
  nextReportId: number;
}

let state: FakeDbState;

vi.mock('@lhr/db', () => ({
  insertCandidateCompetitor: vi.fn(async (_pool: unknown, domain: string) => {
    if (state.competitors.some((c) => c.domain === domain)) return null;
    const row = { id: state.nextCompetitorId++, domain, name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null };
    state.competitors.push(row);
    return row;
  }),
  listCompetitorsByStatus: vi.fn(async (_pool: unknown, status: string) => state.competitors.filter((c) => c.status === status)),
  listKeywords: vi.fn(async () => state.keywords),
  listRecentCompetitorReports: vi.fn(async (_pool: unknown, competitorId: number, limit = 10) => {
    return state.reports
      .filter((r) => r.competitorId === competitorId)
      .slice()
      .reverse()
      .slice(0, limit);
  }),
  insertCompetitorReport: vi.fn(async (_pool: unknown, report: Record<string, unknown>) => {
    const row = { ...report, id: state.nextReportId++ } as FakeDbState['reports'][number];
    state.reports.push(row);
    return { ...row, generatedAt: new Date() };
  }),
}));

const fakePool = { end: async () => {} };
vi.mock('pg', () => ({ Pool: vi.fn().mockImplementation(() => fakePool) }));

const { runWeeklyCompetitorAnalysis, analyzeCompetitors } = await import('../../src/analyzeCompetitors');

const originalFetch = global.fetch;
const originalDatabaseUrl = process.env.DATABASE_URL;

beforeEach(() => {
  state = {
    competitors: [
      { id: 1, domain: 'reliable-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
      { id: 2, domain: 'flaky-recipes.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ],
    reports: [],
    keywords: [{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }],
    nextCompetitorId: 3,
    nextReportId: 1,
  };
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env.DATABASE_URL = originalDatabaseUrl;
});

describe('analyzeCompetitors (Job-contract entry point, integration)', () => {
  it('constructs its own pool from DATABASE_URL, delegates to the real pipeline, and closes the pool', async () => {
    process.env.DATABASE_URL = 'postgres://test/db';
    state.competitors = [];
    state.keywords = [];
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic_results: [] }) }) as unknown as typeof fetch;

    const result = await analyzeCompetitors();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('wrote 0 report(s)');
  });

  it('throws when DATABASE_URL is missing, rather than swallowing the error into a failure JobResult', async () => {
    delete process.env.DATABASE_URL;
    await expect(analyzeCompetitors()).rejects.toThrow(/DATABASE_URL/);
  });
});

describe('runWeeklyCompetitorAnalysis (integration)', () => {
  it('writes a full report for a reachable competitor and a partial report for an unreachable one, without crashing the run', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();

      if (u.includes('serpapi.com')) {
        return { ok: true, json: async () => ({ organic_results: [{ position: 2, title: 'T', link: 'https://reliable-recipes.com/x' }] }) };
      }
      if (u === 'https://reliable-recipes.com') {
        return { ok: true, text: async () => '<html><body><h1>Shop the Kitchen</h1></body></html>' };
      }
      if (u === 'https://flaky-recipes.com') {
        throw new Error('connection refused');
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const summary = await runWeeklyCompetitorAnalysis({} as never);

    expect(summary.reportsWritten).toBe(2);
    expect(state.reports).toHaveLength(2);

    const reliableReport = state.reports.find((r) => r.competitorId === 1)!;
    expect(reliableReport.monetizationSnapshot).not.toBe('unreachable this cycle');

    const flakyReport = state.reports.find((r) => r.competitorId === 2)!;
    expect(flakyReport.monetizationSnapshot).toBe('unreachable this cycle');
    expect(flakyReport.designSnapshot).toBe('unreachable this cycle');
    expect(flakyReport.summary).toBeTruthy();
  });
});

describe('runWeeklyCompetitorAnalysis (integration): cumulative content baseline across cycles', () => {
  const STEADY_DOMAIN = 'steady-recipes.com';

  const HOMEPAGE_WITH_FEED = `
<html><head>
<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />
</head><body><h1>Shop the Kitchen</h1></body></html>
`;

  const RSS_FEED = `<?xml version="1.0"?>
<rss><channel>
<item><title>Sourdough Focaccia</title><link>https://steady-recipes.com/sourdough-focaccia</link><pubDate>Thu, 20 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

  function mockSteadyFetch() {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u.includes('serpapi.com')) {
        return { ok: true, json: async () => ({ organic_results: [] }) };
      }
      if (u === `https://${STEADY_DOMAIN}`) {
        return { ok: true, text: async () => HOMEPAGE_WITH_FEED };
      }
      if (u === `https://${STEADY_DOMAIN}/feed.xml`) {
        return { ok: true, text: async () => RSS_FEED };
      }
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;
  }

  it('does not re-flag an unchanged RSS feed as new content on the second consecutive cycle', async () => {
    state.competitors = [
      { id: 1, domain: STEADY_DOMAIN, name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() },
    ];
    state.keywords = [];

    mockSteadyFetch();
    const cycle1 = await runWeeklyCompetitorAnalysis({} as never);
    expect(cycle1.reportsWritten).toBe(1);
    const cycle1Report = state.reports.find((r) => r.competitorId === 1)!;
    expect(cycle1Report.newContent).toHaveLength(1);

    mockSteadyFetch();
    const cycle2 = await runWeeklyCompetitorAnalysis({} as never);
    expect(cycle2.reportsWritten).toBe(1);
    const cycle2Report = state.reports.filter((r) => r.competitorId === 1).slice(-1)[0]!;
    expect(cycle2Report.newContent).toEqual([]);
  });
});
