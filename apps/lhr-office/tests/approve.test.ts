import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = {
  getCandidateById: vi.fn(),
  markCandidateStatus: vi.fn(),
  insertDecisionHistory: vi.fn(),
  buildAffiliateLinkFile: vi.fn(() => ({ path: 'src/content/affiliate-links/test-item-asin.json', content: '{}' })),
};
vi.mock('@lhr/db', () => dbMock);

const githubMock = {
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: vi.fn(),
};
vi.mock('@lhr/github', () => githubMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/affiliate-review/candidates/[id]/approve');

const pendingCandidate = {
  id: 1, asin: 'B0EXAMPLE1', title: 'Test Item', category: 'Kitchen', priceCents: 2999,
  imageUrl: 'https://example.com/x.jpg', productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03, commissionRateIsFallback: false, estimatedMonthlySales: 100,
  status: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
  process.env.AMAZON_ASSOCIATES_TAG = 'lhr-20';
  process.env.AUTHOR_GITHUB_TOKEN = 'test-token';
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/affiliate-review/candidates/[id]/approve', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getCandidateById).not.toHaveBeenCalled();
  });

  it('commits an affiliate-links file, marks approved, and records the decision', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(200);
    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      {},
      [{ path: 'src/content/affiliate-links/test-item-asin.json', content: '{}' }],
      expect.stringContaining('Test Item'),
    );
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(mockPool, 1, 'approved');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(mockPool, {
      asin: 'B0EXAMPLE1', category: 'Kitchen', priceCents: 2999,
      commissionRate: 0.03, estimatedMonthlySales: 100, decision: 'approved',
    });
  });

  it('returns 404 for an unknown candidate', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 409 for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'denied' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
