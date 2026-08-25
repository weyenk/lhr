import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { end: vi.fn() };
vi.mock('pg', () => ({ Pool: vi.fn(() => mockPool) }));

const githubMock = { createGitHubClient: vi.fn(() => ({})) };
vi.mock('@lhr/github', () => githubMock);

const dbMock = {
  insertCandidates: vi.fn(),
  getDecidedAsins: vi.fn(),
  getAllDecisionHistory: vi.fn(),
  selectCycle: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const keepaMock = { findTrendingCandidates: vi.fn() };
vi.mock('../src/keepa', () => keepaMock);

const rateMock = { lookupCommissionRate: vi.fn(() => ({ rate: 0.03, isFallback: false })) };
vi.mock('../src/amazonCommissionRates', () => rateMock);

const excludedMock = { getExcludedAsins: vi.fn() };
vi.mock('../src/existingAsins', () => excludedMock);

const reconcileMock = { reconcileApprovedCandidates: vi.fn() };
vi.mock('../src/reconcileApprovedCandidates', () => reconcileMock);

vi.mock('../src/computeCycleId', () => ({ computeCycleId: vi.fn(() => '2026-W35') }));

const { sourceAffiliateCandidates } = await import('../src/sourceAffiliateCandidates');

function keepaCandidate(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    asin: 'B0EXAMPLE1', title: 'Test Item', category: 'Kitchen', priceCents: 2999,
    imageUrl: 'https://example.com/x.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
    bsr: 100, bsrCategory: 'Kitchen', rating: 4.5, reviewCount: 50, estimatedMonthlySales: 200,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.KEEPA_API_KEY = 'test-keepa-key';
  process.env.AUTHOR_GITHUB_TOKEN = 'test-token';
  process.env.DATABASE_URL = 'postgres://test';
  process.env.AMAZON_ASSOCIATES_TAG = 'lhr-20';
  reconcileMock.reconcileApprovedCandidates.mockResolvedValue({ reconciledAsins: [] });
  excludedMock.getExcludedAsins.mockResolvedValue(new Set());
  dbMock.getDecidedAsins.mockResolvedValue(new Set());
  dbMock.getAllDecisionHistory.mockResolvedValue([]);
});

describe('sourceAffiliateCandidates', () => {
  it('returns failure and closes the pool when Keepa fails, without ever calling selectCycle', async () => {
    keepaMock.findTrendingCandidates.mockRejectedValue(new Error('rate limited'));
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('failure');
    expect(result.summary).toContain('Keepa');
    expect(result.summary).toContain('rate limited');
    expect(dbMock.selectCycle).not.toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });

  it('returns success with no candidates written when nothing survives the exclusion filter', async () => {
    keepaMock.findTrendingCandidates.mockResolvedValue([keepaCandidate({ asin: 'B0ALREADY1' })]);
    excludedMock.getExcludedAsins.mockResolvedValue(new Set(['B0ALREADY1']));
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('success');
    expect(result.summary).toContain('No new candidates');
    expect(dbMock.insertCandidates).not.toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });

  it('returns partial when fewer than 20 candidates are selected', async () => {
    const trending = [keepaCandidate({ asin: 'B0NEW1' })];
    keepaMock.findTrendingCandidates.mockResolvedValue(trending);
    dbMock.selectCycle.mockReturnValue([{ ...keepaCandidate({ asin: 'B0NEW1' }), score: 0.5, isWildcard: false }]);
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('Wrote 1 candidate');
    expect(dbMock.insertCandidates).toHaveBeenCalledTimes(1);
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });

  it('returns success when a full cycle (20 candidates) is written', async () => {
    const trending = Array.from({ length: 20 }, (_, i) => keepaCandidate({ asin: `B0NEW${i}` }));
    keepaMock.findTrendingCandidates.mockResolvedValue(trending);
    const scored = trending.map((c) => ({ ...c, score: 0.5, isWildcard: false }));
    dbMock.selectCycle.mockReturnValue(scored);
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('success');
    expect(result.summary).toContain('Wrote 20 candidate');
    const [, insertedCandidates] = dbMock.insertCandidates.mock.calls[0];
    expect(insertedCandidates).toHaveLength(20);
    expect(insertedCandidates[0]).toMatchObject({ cycleId: '2026-W35', asin: 'B0NEW0', commissionRate: 0.03 });
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });

  it('reports the correct non-zero wildcardCount and threads reconciledAsins into details', async () => {
    reconcileMock.reconcileApprovedCandidates.mockResolvedValue({ reconciledAsins: ['B0RECONCILED1'] });
    const trending = [
      keepaCandidate({ asin: 'B0RANKED1' }),
      keepaCandidate({ asin: 'B0WILD1' }),
      keepaCandidate({ asin: 'B0WILD2' }),
    ];
    keepaMock.findTrendingCandidates.mockResolvedValue(trending);
    dbMock.selectCycle.mockReturnValue([
      { ...keepaCandidate({ asin: 'B0RANKED1' }), score: 0.9, isWildcard: false },
      { ...keepaCandidate({ asin: 'B0WILD1' }), score: 0.2, isWildcard: true },
      { ...keepaCandidate({ asin: 'B0WILD2' }), score: 0.1, isWildcard: true },
    ]);
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('partial');
    expect(result.summary).toContain('2 wildcard');
    expect(result.details).toMatchObject({
      count: 3,
      wildcardCount: 2,
      reconciledAsins: ['B0RECONCILED1'],
    });
  });

  it('threads reconciledAsins into details on the no-new-candidates success path', async () => {
    reconcileMock.reconcileApprovedCandidates.mockResolvedValue({ reconciledAsins: ['B0RECONCILED2'] });
    keepaMock.findTrendingCandidates.mockResolvedValue([keepaCandidate({ asin: 'B0ALREADY2' })]);
    excludedMock.getExcludedAsins.mockResolvedValue(new Set(['B0ALREADY2']));
    const result = await sourceAffiliateCandidates();
    expect(result.status).toBe('success');
    expect(result.details).toEqual({ reconciledAsins: ['B0RECONCILED2'] });
  });

  it('throws if a required env var is missing, before constructing a Pool', async () => {
    delete process.env.KEEPA_API_KEY;
    await expect(sourceAffiliateCandidates()).rejects.toThrow('KEEPA_API_KEY');
  });
});
