import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/serpapiSearch', () => ({ fetchSearchResults: vi.fn() }));
vi.mock('@lhr/db', () => ({ listCompetitorsByStatus: vi.fn(), listKeywords: vi.fn() }));

const { fetchSearchResults } = await import('../src/serpapiSearch');
const { listCompetitorsByStatus, listKeywords } = await import('@lhr/db');
const { trackSeoPositions } = await import('../src/competitorSeoTracking');

const pool = {} as never;

const competitorA = { id: 1, domain: 'a.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };
const competitorB = { id: 2, domain: 'b.com', name: null, status: 'tracked', discoveredAt: new Date(), approvedAt: new Date() };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listCompetitorsByStatus).mockResolvedValue([competitorA, competitorB] as never);
});

describe('trackSeoPositions', () => {
  it('makes exactly one SerpApi call per keyword, regardless of tracked-competitor count', async () => {
    vi.mocked(listKeywords).mockResolvedValue([
      { id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() },
      { id: 2, keyword: 'best kitchenware sets', addedAt: new Date() },
    ] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([]);

    await trackSeoPositions(pool);
    expect(fetchSearchResults).toHaveBeenCalledTimes(2);
  });

  it('records the position when a tracked competitor domain appears in the results', async () => {
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 3, title: 'T', link: 'https://a.com/x', domain: 'a.com' },
    ]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'gluten free dinner recipes', position: 3 }]);
  });

  it('records position null when a tracked competitor domain does not appear in the results', async () => {
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([{ position: 1, title: 'T', link: 'https://someone-else.com/x', domain: 'someone-else.com' }]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'gluten free dinner recipes', position: null }]);
    expect(result.positionsByCompetitorId.get(2)).toEqual([{ keyword: 'gluten free dinner recipes', position: null }]);
  });

  it('skips a keyword whose SerpApi call fails and continues with the rest', async () => {
    vi.mocked(listKeywords).mockResolvedValue([
      { id: 1, keyword: 'fails', addedAt: new Date() },
      { id: 2, keyword: 'ok keyword', addedAt: new Date() },
    ] as never);
    vi.mocked(fetchSearchResults)
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValueOnce([{ position: 1, title: 'T', link: 'https://a.com/x', domain: 'a.com' }]);

    const result = await trackSeoPositions(pool);
    expect(result.failedKeywords).toEqual(['fails']);
    expect(result.positionsByCompetitorId.get(1)).toEqual([{ keyword: 'ok keyword', position: 1 }]);
  });

  it('returns an empty map when there are no tracked competitors', async () => {
    vi.mocked(listCompetitorsByStatus).mockResolvedValue([]);
    vi.mocked(listKeywords).mockResolvedValue([{ id: 1, keyword: 'anything', addedAt: new Date() }] as never);
    vi.mocked(fetchSearchResults).mockResolvedValue([]);

    const result = await trackSeoPositions(pool);
    expect(result.positionsByCompetitorId.size).toBe(0);
  });
});
