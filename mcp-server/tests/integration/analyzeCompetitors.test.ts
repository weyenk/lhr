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
  getLatestReport: vi.fn(async (_pool: unknown, competitorId: number) => {
    const forCompetitor = state.reports.filter((r) => r.competitorId === competitorId);
    return forCompetitor.length > 0 ? forCompetitor[forCompetitor.length - 1] : null;
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
