import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

const dbMock = {
  getPool: vi.fn(() => ({})),
  insertCandidateCompetitor: vi.fn(),
  listCompetitorsByStatus: vi.fn(),
  listKeywords: vi.fn(),
  listRecentCompetitorReports: vi.fn(),
  insertCompetitorReport: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = { fetchSearchResults: vi.fn() };
vi.mock('../src/serpapiSearch', () => serpapiMock);

const contentMock = { fetchCompetitorPosts: vi.fn(), diffNewPosts: vi.fn() };
vi.mock('../src/competitorContent', () => contentMock);

const llmMock = { callLLM: vi.fn() };
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

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SERPAPI_KEY = 'test-serpapi-key';
  process.env.OPENROUTER_API_KEY = 'test-openrouter-key';

  serpapiMock.fetchSearchResults.mockResolvedValue([]);
  dbMock.insertCandidateCompetitor.mockResolvedValue(null);
  dbMock.listCompetitorsByStatus.mockResolvedValue([]);
  dbMock.listKeywords.mockResolvedValue([]);
  dbMock.listRecentCompetitorReports.mockResolvedValue([]);
  dbMock.insertCompetitorReport.mockImplementation(async (_db, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  contentMock.fetchCompetitorPosts.mockResolvedValue({ posts: [], source: 'rss' });
  contentMock.diffNewPosts.mockReturnValue([]);
  llmMock.callLLM.mockResolvedValue('LLM output');
  // Default homepage fetch (used by the inline fetchHomepageText helper, which has no module
  // boundary of its own to mock) succeeds by default so a "clean cycle" test doesn't depend on
  // real network reachability of a fake competitor domain. Individual tests below override this
  // to exercise the unreachable/failure paths.
  global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body></body></html>' }) as unknown as typeof fetch;
});

afterEach(() => {
  process.env = { ...originalEnv };
  global.fetch = originalFetch;
});

describe('analyzeCompetitors', () => {
  it('reports success and writes no reports when there are no tracked competitors', async () => {
    const result = await analyzeCompetitors();
    expect(result.status).toBe('success');
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('runs discovery against every curated query exactly once, inserting a new domain as a candidate', async () => {
    serpapiMock.fetchSearchResults.mockResolvedValue([
      { position: 1, title: 'T', link: 'https://new-blog.com/x', domain: 'new-blog.com' },
    ]);
    dbMock.insertCandidateCompetitor.mockResolvedValue({
      id: 5, domain: 'new-blog.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    });

    await analyzeCompetitors();

    expect(dbMock.insertCandidateCompetitor).toHaveBeenCalledWith(expect.anything(), 'new-blog.com');
    // Discovery runs once total, not once per tracked competitor.
    const discoveryCallCount = serpapiMock.fetchSearchResults.mock.calls.length;
    expect(discoveryCallCount).toBeGreaterThan(0);
  });

  it('dedupes a domain seen across multiple discovery queries within the same run', async () => {
    serpapiMock.fetchSearchResults.mockResolvedValue([
      { position: 1, title: 'T', link: 'https://dupe.com/x', domain: 'dupe.com' },
    ]);
    dbMock.insertCandidateCompetitor.mockResolvedValue({
      id: 5, domain: 'dupe.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    });

    await analyzeCompetitors();

    expect(dbMock.insertCandidateCompetitor).toHaveBeenCalledTimes(1);
  });

  it('makes exactly one SerpApi call per SEO keyword, regardless of tracked-competitor count', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([
      trackedCompetitor,
      { ...trackedCompetitor, id: 2, domain: 'another.com' },
    ]);
    dbMock.listKeywords.mockResolvedValue([
      { id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() },
      { id: 2, keyword: 'best kitchenware sets', addedAt: new Date() },
    ]);

    await analyzeCompetitors();

    const keywordCalls = serpapiMock.fetchSearchResults.mock.calls.filter(
      (c) => c[0] === 'gluten free dinner recipes' || c[0] === 'best kitchenware sets',
    );
    expect(keywordCalls).toHaveLength(2);
  });

  it('records an SEO position for a tracked competitor whose domain appears in a keyword\'s results', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    dbMock.listKeywords.mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }]);
    serpapiMock.fetchSearchResults.mockImplementation(async (query: string) => {
      if (query === 'gluten free dinner recipes') {
        return [{ position: 3, title: 'T', link: 'https://reliable-recipes.com/x', domain: 'reliable-recipes.com' }];
      }
      return [];
    });

    await analyzeCompetitors();

    const reportCall = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(reportCall.seoPositions).toEqual([{ keyword: 'gluten free dinner recipes', position: 3 }]);
  });

  it('writes one report per tracked competitor and reports success on a clean cycle', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);

    const result = await analyzeCompetitors();

    expect(dbMock.insertCompetitorReport).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('success');
  });

  it('marks content unreachable and still writes a report when fetchCompetitorPosts throws', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    contentMock.fetchCompetitorPosts.mockRejectedValue(new Error('network error'));

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.newContent).toEqual([]);
    const synthesisCall = llmMock.callLLM.mock.calls.find((c) =>
      c[0].some((m: { content: string }) => m.content.includes('New content')),
    );
    expect(synthesisCall![0].some((m: { content: string }) => m.content.includes('unreachable this cycle'))).toBe(true);
    expect(result.status).toBe('partial');
  });

  it('marks monetization/design unreachable and still writes a report when the homepage fetch throws', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.monetizationSnapshot).toBe('unreachable this cycle');
    expect(report.designSnapshot).toBe('unreachable this cycle');
    expect(result.status).toBe('partial');

    global.fetch = originalFetch;
  });

  it('stores the raw current snapshot, not the LLM diff text, in monetizationSnapshot/designSnapshot', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body>Shop the Kitchen</body></html>' }) as unknown as typeof fetch;
    llmMock.callLLM.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const userContent = messages[messages.length - 1].content;
      if (messages[0].content.includes('monetization and product strategy')) return 'Sells a $40 cast-iron pan.';
      if (messages[0].content.includes('layout, prominent calls-to-action')) return 'Grid homepage with a shop CTA.';
      if (messages[0].content.includes('describe what substantively changed')) return 'Added a new spatula set.';
      if (userContent.includes('New content')) return 'Weekly summary text.';
      return 'unused';
    });

    await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.monetizationSnapshot).toBe('Sells a $40 cast-iron pan.');
    expect(report.designSnapshot).toBe('Grid homepage with a shop CTA.');
  });

  it('diffs content against the union of new_content across recent reports, not just the latest row alone', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    dbMock.listRecentCompetitorReports.mockResolvedValue([
      { id: 2, competitorId: 1, cycleId: '2026-08-30', generatedAt: new Date(), newContent: [], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y', summary: 's' },
      { id: 1, competitorId: 1, cycleId: '2026-08-23', generatedAt: new Date(), newContent: [{ title: 'Old Post', url: 'https://reliable-recipes.com/old-post', publishedAt: null }], seoPositions: [], monetizationSnapshot: 'x', designSnapshot: 'y', summary: 's' },
    ]);
    contentMock.fetchCompetitorPosts.mockResolvedValue({
      posts: [{ title: 'Old Post', url: 'https://reliable-recipes.com/old-post', publishedAt: null }],
      source: 'rss',
    });
    contentMock.diffNewPosts.mockImplementation((posts, prior) => {
      const priorUrls = new Set(prior.map((p: { url: string }) => p.url));
      return posts.filter((p: { url: string }) => !priorUrls.has(p.url));
    });

    await analyzeCompetitors();

    // diffNewPosts must have been called with the flattened union of BOTH recent reports'
    // newContent (even though the most recent one is empty) — not just the latest report alone.
    expect(contentMock.diffNewPosts).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ url: 'https://reliable-recipes.com/old-post' })]),
    );
    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.newContent).toEqual([]);
  });

  it('uses the most recent REAL snapshot as the diff baseline, not the "unreachable this cycle" sentinel from a failed prior cycle', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    dbMock.listRecentCompetitorReports.mockResolvedValue([
      {
        id: 2, competitorId: 1, cycleId: '2026-08-30', generatedAt: new Date(),
        newContent: [], seoPositions: [],
        monetizationSnapshot: 'unreachable this cycle', designSnapshot: 'unreachable this cycle', summary: 's',
      },
      {
        id: 1, competitorId: 1, cycleId: '2026-08-23', generatedAt: new Date(),
        newContent: [], seoPositions: [],
        monetizationSnapshot: 'Sells a $40 cast-iron pan.', designSnapshot: 'Grid homepage with a shop CTA.', summary: 's',
      },
    ]);
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body>Shop the Kitchen</body></html>' }) as unknown as typeof fetch;
    llmMock.callLLM.mockImplementation(async (messages: { role: string; content: string }[]) => {
      const systemContent = messages[0].content;
      const userContent = messages[messages.length - 1].content;
      if (systemContent.includes('monetization and product strategy')) return 'Sells a $55 stand mixer.';
      if (systemContent.includes('layout, prominent calls-to-action')) return 'Minimalist homepage with a shop CTA.';
      if (systemContent.includes('describe what substantively changed')) return 'Diff output text.';
      if (userContent.includes('New content')) return 'Weekly summary text.';
      return 'unused';
    });

    await analyzeCompetitors();

    // Find the diff call for the monetization dimension specifically (it's the one whose
    // "Current snapshot:" half matches what summarizeMonetization returned above), then assert
    // its "Previous snapshot:" half is the OLDER real snapshot, not the sentinel from the more
    // recent (but unreachable) report.
    const diffCalls = llmMock.callLLM.mock.calls.filter((c) =>
      c[0][0].content.includes('describe what substantively changed'),
    );
    const monetizationDiffCall = diffCalls.find((c) => c[0][1].content.includes('Sells a $55 stand mixer.'));
    expect(monetizationDiffCall).toBeDefined();
    expect(monetizationDiffCall![0][1].content).toContain('Previous snapshot:\nSells a $40 cast-iron pan.');
    expect(monetizationDiffCall![0][1].content).not.toContain('unreachable this cycle');
  });

  it('writes the placeholder summary when the synthesis LLM call fails, but keeps the report', async () => {
    dbMock.listCompetitorsByStatus.mockResolvedValue([trackedCompetitor]);
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSynthesis = messages.some((m) => m.content.includes('New content'));
      if (isSynthesis) throw new Error('OpenRouter down');
      return 'snapshot text';
    });

    const result = await analyzeCompetitors();

    const report = dbMock.insertCompetitorReport.mock.calls[0][1];
    expect(report.summary).toBe('[Summary generation failed this cycle]');
    expect(result.status).toBe('partial');
  });

  it('reports partial when a discovery query fails, and continues with the rest', async () => {
    serpapiMock.fetchSearchResults.mockRejectedValueOnce(new Error('rate limited'));

    const result = await analyzeCompetitors();
    expect(result.status).toBe('partial');
  });

  it('throws before doing anything when SERPAPI_KEY is missing (fail-fast)', async () => {
    delete process.env.SERPAPI_KEY;
    await expect(analyzeCompetitors()).rejects.toThrow(/SERPAPI_KEY/);
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });

  it('throws before doing anything when OPENROUTER_API_KEY is missing (fail-fast)', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(analyzeCompetitors()).rejects.toThrow(/OPENROUTER_API_KEY/);
    expect(dbMock.insertCompetitorReport).not.toHaveBeenCalled();
  });
});
