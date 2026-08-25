import { describe, expect, it, vi, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureRepoRoot = path.join(dirname, '../fixtures/trendsRepoRoot');

const dbMock = {
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  getCuratedTopics: vi.fn(),
  upsertSuggestedTopic: vi.fn(),
  promoteEligibleCandidates: vi.fn().mockResolvedValue([]),
  insertTrendsReport: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const serpapiMock = {
  fetchInterestAndRelatedQueries: vi.fn(),
  fetchTrendingNow: vi.fn(),
};
vi.mock('../../src/serpapiTrends', () => serpapiMock);

const openrouterMock = { callOpenRouter: vi.fn() };
vi.mock('../../src/openrouter', () => openrouterMock);

const { runWeeklyTrendsCycle } = await import('../../src/sourceWeeklyTrends');

const pool = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.getCuratedTopics.mockResolvedValue([]);
  dbMock.upsertSuggestedTopic.mockImplementation(async (_pool, category, topic) => ({
    id: 1, category, topic, status: 'candidate', timesSeen: 1,
    firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: null,
  }));
  dbMock.insertTrendsReport.mockImplementation(async (_pool, report) => ({ id: 1, ...report, generatedAt: new Date() }));
  openrouterMock.callOpenRouter.mockImplementation(async (messages: { content: string }[]) => {
    const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
    return isSuggestionCall ? '["sourdough starter"]' : 'This week: sourdough interest is rising.';
  });
  serpapiMock.fetchInterestAndRelatedQueries.mockResolvedValue({
    direction: 'rising', topQueries: [], risingQueries: [{ query: 'sourdough starter jar', value: '80' }],
  });
  serpapiMock.fetchTrendingNow.mockResolvedValue([{ query: 'meal prep', searchVolume: 100, increasePercentage: 10 }]);
});

describe('runWeeklyTrendsCycle', () => {
  it('writes one trends_reports row per category', async () => {
    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);
    expect(dbMock.insertTrendsReport).toHaveBeenCalledTimes(3);
    const categories = dbMock.insertTrendsReport.mock.calls.map((c) => c[1].category);
    expect(categories.sort()).toEqual(['cooking', 'nutrition', 'web-design']);
  });

  it('still writes a partial report when one topic fails SerpApi', async () => {
    dbMock.getCuratedTopics.mockImplementation(async (_pool, category) =>
      category === 'cooking'
        ? [{ id: 1, category, topic: 'air fryer recipes', status: 'curated', timesSeen: 3, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() }]
        : [],
    );
    openrouterMock.callOpenRouter.mockImplementation(async () => '[]');
    serpapiMock.fetchInterestAndRelatedQueries.mockRejectedValueOnce(new Error('rate limited'));

    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);

    const cookingCall = dbMock.insertTrendsReport.mock.calls.find((c) => c[1].category === 'cooking');
    expect(cookingCall).toBeDefined();
    expect(cookingCall![1].topicsUsed).toEqual([]);
  });

  it('writes the placeholder summary when the synthesis LLM call fails', async () => {
    openrouterMock.callOpenRouter.mockImplementation(async (messages: { content: string }[]) => {
      const isSuggestionCall = messages.some((m) => m.content.includes('Suggest up to'));
      if (isSuggestionCall) return '[]';
      throw new Error('OpenRouter down');
    });

    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);

    for (const call of dbMock.insertTrendsReport.mock.calls) {
      expect(call[1].summary).toBe('[Summary generation failed this cycle]');
    }
  });

  it('upserts each suggested topic and runs promotion once per category', async () => {
    await runWeeklyTrendsCycle(pool, fixtureRepoRoot);
    expect(dbMock.upsertSuggestedTopic).toHaveBeenCalledWith(pool, expect.any(String), 'sourdough starter');
    expect(dbMock.promoteEligibleCandidates).toHaveBeenCalledTimes(3);
  });
});
