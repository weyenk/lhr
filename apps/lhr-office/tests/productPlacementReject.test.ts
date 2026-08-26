import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireSession: vi.fn() };
vi.mock('../src/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/auth')>('../src/lib/auth');
  return { ...actual, requireSession: authMock.requireSession };
});

const dbMock = { getProposalById: vi.fn(), markProposalStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { AuthNotConfiguredError } = await import('../src/lib/auth');
const { POST } = await import('../src/pages/api/product-placements/[id]/reject');

const pendingProposal = {
  id: 1, cycleId: '2026-08-25', affiliateLinkId: 'wooden-pizza-server-1234', postSlug: 'pizza',
  targetImageKind: 'body' as const, targetImageUrl: 'https://example.com/slice.jpg',
  targetImageLine: '![Slicing the pizza](https://example.com/slice.jpg)',
  matchRationale: 'x', compositedImageUrl: 'https://example.com/composited.jpg',
  status: 'pending' as const, decidedAt: null, createdAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireSession.mockResolvedValue(undefined);
});

function makeContext(id: string) {
  return { params: { id }, request: new Request('http://localhost/x', { method: 'POST' }) } as never;
}

describe('POST /api/product-placements/[id]/reject', () => {
  it('returns 503 when the session gate is not configured', async () => {
    authMock.requireSession.mockRejectedValue(new AuthNotConfiguredError());
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(503);
    expect(dbMock.getProposalById).not.toHaveBeenCalled();
  });

  it('marks the proposal rejected', async () => {
    dbMock.getProposalById.mockResolvedValue(pendingProposal);
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(200);
    expect(dbMock.markProposalStatus).toHaveBeenCalledWith(mockPool, 1, 'rejected');
  });

  it('returns 404 for an unknown proposal', async () => {
    dbMock.getProposalById.mockResolvedValue(null);
    const res = await POST(makeContext('999'));
    expect(res.status).toBe(404);
  });

  it('returns 409 for a proposal that is already decided', async () => {
    dbMock.getProposalById.mockResolvedValue({ ...pendingProposal, status: 'rejected' });
    const res = await POST(makeContext('1'));
    expect(res.status).toBe(409);
    expect(dbMock.markProposalStatus).not.toHaveBeenCalled();
  });

  it('returns 400 for a non-numeric id', async () => {
    const res = await POST(makeContext('not-a-number'));
    expect(res.status).toBe(400);
  });
});
