import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/serpapiSearch', () => ({ fetchSearchResults: vi.fn() }));
vi.mock('@lhr/db', () => ({ insertCandidateCompetitor: vi.fn() }));

const { fetchSearchResults } = await import('../src/serpapiSearch');
const { insertCandidateCompetitor } = await import('@lhr/db');
const { runDiscovery, DISCOVERY_QUERIES } = await import('../src/competitorDiscovery');

const pool = {} as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('DISCOVERY_QUERIES', () => {
  it('is a small curated, non-empty list', () => {
    expect(DISCOVERY_QUERIES.length).toBeGreaterThan(0);
    expect(DISCOVERY_QUERIES.length).toBeLessThanOrEqual(10);
  });
});

describe('runDiscovery', () => {
  it('runs one search per curated query and inserts each new domain as a candidate', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://a.com/x', domain: 'a.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'a.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    const result = await runDiscovery(pool);

    expect(fetchSearchResults).toHaveBeenCalledTimes(DISCOVERY_QUERIES.length);
    expect(insertCandidateCompetitor).toHaveBeenCalledWith(pool, 'a.com');
    expect(result.newCandidateDomains).toContain('a.com');
  });

  it('does not count a domain as newly discovered when it already existed (insert returns null)', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://already-tracked.com/x', domain: 'already-tracked.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue(null);

    const result = await runDiscovery(pool);
    expect(result.newCandidateDomains).toEqual([]);
  });

  it('dedupes a domain seen across multiple queries within the same run', async () => {
    vi.mocked(fetchSearchResults).mockResolvedValue([
      { position: 1, title: 'T', link: 'https://dupe.com/x', domain: 'dupe.com' },
    ]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'dupe.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    await runDiscovery(pool);
    expect(insertCandidateCompetitor).toHaveBeenCalledTimes(1);
  });

  it('logs and skips a query whose SerpApi call fails, continuing with the rest', async () => {
    vi.mocked(fetchSearchResults)
      .mockRejectedValueOnce(new Error('rate limited'))
      .mockResolvedValue([{ position: 1, title: 'T', link: 'https://ok.com/x', domain: 'ok.com' }]);
    vi.mocked(insertCandidateCompetitor).mockResolvedValue({
      id: 1, domain: 'ok.com', name: null, status: 'candidate', discoveredAt: new Date(), approvedAt: null,
    } as never);

    const result = await runDiscovery(pool);
    expect(result.failedQueries).toEqual([DISCOVERY_QUERIES[0]]);
    expect(result.newCandidateDomains).toContain('ok.com');
  });
});
