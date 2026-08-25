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
};
vi.mock('@lhr/db', () => dbMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/affiliate-review/candidates/[id]/deny');

const pendingCandidate = {
  id: 2, asin: 'B0EXAMPLE2', title: 'Another Item', category: 'Grocery', priceCents: 1099,
  commissionRate: 0.01, commissionRateIsFallback: false, estimatedMonthlySales: null,
  status: 'pending' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/affiliate-review/candidates/[id]/deny', () => {
  it('returns 503 when the session gate is not configured, without touching the database', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(503);
    expect(dbMock.getCandidateById).not.toHaveBeenCalled();
  });

  it('marks denied and records the decision, with no GitHub write', async () => {
    dbMock.getCandidateById.mockResolvedValue(pendingCandidate);
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(200);
    expect(dbMock.markCandidateStatus).toHaveBeenCalledWith(mockPool, 2, 'denied');
    expect(dbMock.insertDecisionHistory).toHaveBeenCalledWith(mockPool, {
      asin: 'B0EXAMPLE2', category: 'Grocery', priceCents: 1099,
      commissionRate: 0.01, estimatedMonthlySales: null, decision: 'denied',
    });
  });

  it('returns 404 for an unknown candidate', async () => {
    dbMock.getCandidateById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a candidate that is already decided', async () => {
    dbMock.getCandidateById.mockResolvedValue({ ...pendingCandidate, status: 'approved' });
    const res = await POST(makeContext('2'));
    expect(res.status).toBe(409);
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
