import { describe, expect, it, vi, beforeEach } from 'vitest';

const dbMock = {
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  getCuratedTopics: vi.fn(),
  upsertSuggestedTopic: vi.fn(),
  promoteEligibleCandidates: vi.fn().mockResolvedValue([]),
  insertTrendsReport: vi.fn(),
  getPool: vi.fn(() => ({})),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = {
  fetchInterestAndRelatedQueries: vi.fn(),
  fetchTrendingNow: vi.fn(),
};
vi.mock('../src/serpapiTrends', () => serpapiMock);

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  getFile: vi.fn(),
  listFiles: vi.fn(),
};
vi.mock('lhr-authoring-mcp-server/dist-lib/github.js', () => githubMock);

const { sourceWeeklyTrends } = await import('../src/trendsWatcher');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
  dbMock.getCuratedTopics.mockResolvedValue([]);
  dbMock.upsertSuggestedTopic.mockImplementation(async (_db, category, topic) => ({
    id: 1, category, topic, status: 'candidate', timesSeen: 1,
    firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: null,
  }));
  dbMock.insertTrendsReport.mockImplementation(async (_db, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  githubMock.getFile.mockResolvedValue({ content: '# LHR Constitution\n\n1. Never auto-publish.', sha: 'x' });
  githubMock.listFiles.mockResolvedValue([]);
  llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
    const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
    return isSuggestionCall ? '["sourdough starter"]' : 'This week: sourdough interest is rising.';
  });
  serpapiMock.fetchInterestAndRelatedQueries.mockResolvedValue({
    direction: 'rising', topQueries: [], risingQueries: [{ query: 'sourdough starter jar', value: '80' }],
  });
  serpapiMock.fetchTrendingNow.mockResolvedValue([{ query: 'meal prep', searchVolume: 100, increasePercentage: 10 }]);
});

describe('sourceWeeklyTrends', () => {
  it('writes one trends_reports row per category and reports success', async () => {
    const result = await sourceWeeklyTrends();
    expect(dbMock.insertTrendsReport).toHaveBeenCalledTimes(3);
    const categories = dbMock.insertTrendsReport.mock.calls.map((c) => c[1].category);
    expect(categories.sort()).toEqual(['cooking', 'nutrition', 'web-design']);
    expect(result.status).toBe('success');
  });

  it('reports partial and still writes a report when one topic fails SerpApi', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_db, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'air fryer recipes', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      return isSuggestionCall ? '[]' : 'summary text';
    });
    serpapiMock.fetchInterestAndRelatedQueries.mockRejectedValueOnce(new Error('rate limited'));

    const result = await sourceWeeklyTrends();

    const cookingCall = dbMock.insertTrendsReport.mock.calls.find((c) => c[1].category === 'cooking');
    expect(cookingCall![1].topicsUsed).toEqual([]);
    expect(result.status).toBe('partial');
  });

  it('writes the placeholder summary when the synthesis LLM call fails', async () => {
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      if (isSuggestionCall) return '[]';
      throw new Error('OpenRouter down');
    });

    const result = await sourceWeeklyTrends();

    for (const call of dbMock.insertTrendsReport.mock.calls) {
      expect(call[1].summary).toBe('[Summary generation failed this cycle]');
    }
    expect(result.status).toBe('partial');
  });

  it('dedupes a suggested topic already in the curated list — no double SerpApi call, no upsert', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_db, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'sourdough starter', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    llmMock.callLLM.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      return isSuggestionCall ? '["Sourdough Starter"]' : 'summary text';
    });

    await sourceWeeklyTrends();

    const cookingFetchCalls = serpapiMock.fetchInterestAndRelatedQueries.mock.calls.filter((c) => c[0] === 'sourdough starter');
    expect(cookingFetchCalls).toHaveLength(1);
    expect(dbMock.upsertSuggestedTopic).not.toHaveBeenCalledWith(expect.anything(), 'cooking', expect.anything());
  });

  it('throws before any category is attempted when GITHUB_TOKEN is missing (fail-fast, surfaced as a failure by the caller)', async () => {
    // GITHUB_TOKEN is the actual fail-fast trigger this test exercises: sourceWeeklyTrends's first
    // statement is createGitHubClient(requireEnv('GITHUB_TOKEN')), needed before any category's
    // docs/CONSTITUTION.md read. SERPAPI_KEY's equivalent fail-fast is already covered by Task 6's
    // serpapiTrends.test.ts ("throws when SERPAPI_KEY is not set") since that check lives inside
    // fetchInterestAndRelatedQueries/fetchTrendingNow themselves, not in this orchestration layer.
    delete process.env.GITHUB_TOKEN;
    await expect(sourceWeeklyTrends()).rejects.toThrow(/GITHUB_TOKEN/);
    expect(dbMock.insertTrendsReport).not.toHaveBeenCalled();
  });
});
