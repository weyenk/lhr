import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { setCompetitorStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/competitors/[id]/[action]');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(id: string, action: string) {
  return { params: { id, action }, cookies: {}, redirect: vi.fn() } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/competitors/[id]/[action]', () => {
  it('approves (tracks) a candidate on action=approve', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'approve'));
    expect(dbMock.setCompetitorStatus).toHaveBeenCalledWith(mockPool, 5, 'tracked');
    expect(res.status).toBe(200);
  });

  it('rejects a candidate on action=reject', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'reject'));
    expect(dbMock.setCompetitorStatus).toHaveBeenCalledWith(mockPool, 5, 'rejected');
    expect(res.status).toBe(200);
  });

  it('returns 400 on an unknown action without touching the database', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('5', 'delete'));
    expect(res.status).toBe(400);
    expect(dbMock.setCompetitorStatus).not.toHaveBeenCalled();
  });

  it('returns 400 on a non-numeric id', async () => {
    authMock.requireAdminSession.mockResolvedValue({ admin });
    const res = await POST(makeContext('abc', 'approve'));
    expect(res.status).toBe(400);
  });

  it('returns 401 and does not mutate when there is no valid admin session', async () => {
    authMock.requireAdminSession.mockResolvedValue({ response: new Response(null, { status: 302 }) });
    const res = await POST(makeContext('5', 'approve'));
    expect(res.status).toBe(401);
    expect(dbMock.setCompetitorStatus).not.toHaveBeenCalled();
  });
});
