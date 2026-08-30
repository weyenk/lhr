import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/competitorDiscovery', () => ({ runDiscovery: vi.fn() }));
vi.mock('../src/competitorSeoTracking', () => ({ trackSeoPositions: vi.fn() }));
vi.mock('../src/competitorContent', () => ({ fetchCompetitorPosts: vi.fn(), diffNewPosts: vi.fn() }));
vi.mock('../src/competitorSnapshots', () => ({
  fetchHomepageText: vi.fn(),
  summarizeMonetization: vi.fn(),
  summarizeDesign: vi.fn(),
  diffSnapshot: vi.fn(),
}));
vi.mock('../src/openrouter', () => ({ callOpenRouter: vi.fn() }));
vi.mock('@lhr/db', () => ({
  listCompetitorsByStatus: vi.fn(),
  listRecentCompetitorReports: vi.fn(),
  insertCompetitorReport: vi.fn(),
}));

const { runDiscovery } = await import('../src/competitorDiscovery');
const { trackSeoPositions } = await import('../src/competitorSeoTracking');
const { fetchCompetitorPosts, diffNewPosts } = await import('../src/competitorContent');
const { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } = await import('../src/competitorSnapshots');
const { callOpenRouter } = await import('../src/openrouter');
const { listCompetitorsByStatus, listRecentCompetitorReports, insertCompetitorReport } = await import('@lhr/db');
const { runWeeklyCompetitorAnalysis } = await import('../src/analyzeCompetitors');

const pool = {} as never;
const competitor = { id: 1, domain: 'a.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };

function setHappyPathDefaults() {
  vi.mocked(runDiscovery).mockResolvedValue({ newCandidateDomains: [], failedQueries: [] });
  vi.mocked(trackSeoPositions).mockResolvedValue({ positionsByCompetitorId: new Map([[1, []]]), failedKeywords: [] });
  vi.mocked(listCompetitorsByStatus).mockResolvedValue([competitor] as never);
  vi.mocked(listRecentCompetitorReports).mockResolvedValue([]);
  vi.mocked(fetchCompetitorPosts).mockResolvedValue({ posts: [], source: 'rss' });
  vi.mocked(diffNewPosts).mockImplementation((posts) => posts as never);
  vi.mocked(fetchHomepageText).mockResolvedValue('page text');
  vi.mocked(summarizeMonetization).mockResolvedValue('monetization snapshot');
  vi.mocked(summarizeDesign).mockResolvedValue('design snapshot');
  vi.mocked(diffSnapshot).mockResolvedValue('Initial snapshot: x');
  vi.mocked(callOpenRouter).mockResolvedValue('This week: nothing notable.');
  vi.mocked(insertCompetitorReport).mockImplementation(async (_pool, report) => ({ ...report, id: 1, generatedAt: new Date() }) as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  setHappyPathDefaults();
});

describe('runWeeklyCompetitorAnalysis', () => {
  it('runs discovery and SEO tracking exactly once for the whole cycle, not per competitor', async () => {
    await runWeeklyCompetitorAnalysis(pool);
    expect(runDiscovery).toHaveBeenCalledTimes(1);
    expect(trackSeoPositions).toHaveBeenCalledTimes(1);
  });

  it('writes one competitor_reports row per tracked competitor', async () => {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(insertCompetitorReport).toHaveBeenCalledTimes(1);
    expect(summary.reportsWritten).toBe(1);
  });

  it('produces an empty cycle (no reports, no error) when there are no tracked competitors', async () => {
    vi.mocked(listCompetitorsByStatus).mockResolvedValue([]);
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(summary.reportsWritten).toBe(0);
    expect(insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('still writes a report when content fetching throws, noting the content dimension as unreachable', async () => {
    vi.mocked(fetchCompetitorPosts).mockRejectedValue(new Error('network error'));

    await runWeeklyCompetitorAnalysis(pool);

    expect(insertCompetitorReport).toHaveBeenCalledTimes(1);
    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.newContent).toEqual([]);
    const synthesisCall = vi.mocked(callOpenRouter).mock.calls[0][0];
    expect(synthesisCall.some((m) => m.content.includes('unreachable this cycle'))).toBe(true);
  });

  it('still writes a report when the homepage fetch for snapshots throws, noting monetization/design as unreachable', async () => {
    vi.mocked(fetchHomepageText).mockRejectedValue(new Error('network error'));

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.monetizationSnapshot).toBe('unreachable this cycle');
    expect(report.designSnapshot).toBe('unreachable this cycle');
  });

  it('still writes a report with a placeholder summary when the synthesis LLM call fails', async () => {
    vi.mocked(callOpenRouter).mockRejectedValue(new Error('LLM down'));

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.summary).toBe('[Summary generation failed this cycle]');
  });

  it('carries this cycle\'s SEO positions from the shared Phase-C scan into the report', async () => {
    vi.mocked(trackSeoPositions).mockResolvedValue({
      positionsByCompetitorId: new Map([[1, [{ keyword: 'gluten free dinner recipes', position: 4 }]]]),
      failedKeywords: [],
    });

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.seoPositions).toEqual([{ keyword: 'gluten free dinner recipes', position: 4 }]);
  });

  it('reports discovery and SEO failures on the run summary', async () => {
    vi.mocked(runDiscovery).mockResolvedValue({ newCandidateDomains: ['x.com'], failedQueries: ['q1'] });
    vi.mocked(trackSeoPositions).mockResolvedValue({ positionsByCompetitorId: new Map([[1, []]]), failedKeywords: ['k1'] });

    const summary = await runWeeklyCompetitorAnalysis(pool);

    expect(summary.discoveredCandidates).toBe(1);
    expect(summary.failedDiscoveryQueries).toEqual(['q1']);
    expect(summary.failedSeoKeywords).toEqual(['k1']);
  });

  it('builds the content baseline as the UNION of newContent across all recent historical reports, not just the latest one', async () => {
    vi.mocked(listRecentCompetitorReports).mockResolvedValue([
      {
        id: 3,
        competitorId: 1,
        cycleId: 'cycle-3',
        generatedAt: new Date(),
        newContent: [{ title: 'Post C', url: 'https://a.com/c', publishedAt: null }],
        seoPositions: [],
        monetizationSnapshot: 'm3',
        designSnapshot: 'd3',
        summary: 's3',
      },
      {
        id: 2,
        competitorId: 1,
        cycleId: 'cycle-2',
        generatedAt: new Date(),
        newContent: [{ title: 'Post B', url: 'https://a.com/b', publishedAt: null }],
        seoPositions: [],
        monetizationSnapshot: 'm2',
        designSnapshot: 'd2',
        summary: 's2',
      },
      {
        id: 1,
        competitorId: 1,
        cycleId: 'cycle-1',
        generatedAt: new Date(),
        newContent: [{ title: 'Post A', url: 'https://a.com/a', publishedAt: null }],
        seoPositions: [],
        monetizationSnapshot: 'm1',
        designSnapshot: 'd1',
        summary: 's1',
      },
    ] as never);
    vi.mocked(fetchCompetitorPosts).mockResolvedValue({
      posts: [
        { title: 'Post A', url: 'https://a.com/a', publishedAt: null },
        { title: 'Post B', url: 'https://a.com/b', publishedAt: null },
        { title: 'Post C', url: 'https://a.com/c', publishedAt: null },
        { title: 'Post D', url: 'https://a.com/d', publishedAt: null },
      ],
      source: 'rss',
    });
    vi.mocked(diffNewPosts).mockImplementation((posts, priorPosts) =>
      (posts as { url: string }[]).filter((p) => !(priorPosts as { url: string }[]).some((prior) => prior.url === p.url)) as never,
    );

    await runWeeklyCompetitorAnalysis(pool);

    expect(diffNewPosts).toHaveBeenCalledWith(
      expect.any(Array),
      expect.arrayContaining([
        expect.objectContaining({ url: 'https://a.com/a' }),
        expect.objectContaining({ url: 'https://a.com/b' }),
        expect.objectContaining({ url: 'https://a.com/c' }),
      ]),
    );
    const priorPostsArg = vi.mocked(diffNewPosts).mock.calls[0][1];
    expect(priorPostsArg).toHaveLength(3);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.newContent).toEqual([{ title: 'Post D', url: 'https://a.com/d', publishedAt: null }]);
  });

  it('stores the raw current snapshot in monetizationSnapshot/designSnapshot, not the diffSnapshot change description, while the synthesis prompt does receive the diff', async () => {
    vi.mocked(summarizeMonetization).mockResolvedValue('RAW MONETIZATION SNAPSHOT');
    vi.mocked(summarizeDesign).mockResolvedValue('RAW DESIGN SNAPSHOT');
    vi.mocked(diffSnapshot).mockImplementation(async (_previous, current) => `CHANGED: ${current}`);

    await runWeeklyCompetitorAnalysis(pool);

    const [, report] = vi.mocked(insertCompetitorReport).mock.calls[0];
    expect(report.monetizationSnapshot).toBe('RAW MONETIZATION SNAPSHOT');
    expect(report.designSnapshot).toBe('RAW DESIGN SNAPSHOT');

    const synthesisCall = vi.mocked(callOpenRouter).mock.calls[0][0];
    const userMessage = synthesisCall.find((m) => m.role === 'user')!.content;
    expect(userMessage).toContain('CHANGED: RAW MONETIZATION SNAPSHOT');
    expect(userMessage).toContain('CHANGED: RAW DESIGN SNAPSHOT');
    expect(userMessage).not.toContain('Monetization change: RAW MONETIZATION SNAPSHOT\n');
  });

  it('reports competitorsWithIssues as 0 on the happy path', async () => {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(summary.competitorsWithIssues).toBe(0);
  });

  it('reports competitorsWithIssues as 1 when a dimension fails for one competitor', async () => {
    vi.mocked(fetchHomepageText).mockRejectedValue(new Error('network error'));
    const summary = await runWeeklyCompetitorAnalysis(pool);
    expect(summary.competitorsWithIssues).toBe(1);
  });
});
