import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { setTopicStatus: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/topics/[id]/status');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(id: string, status: string) {
  const form = new FormData();
  form.set('status', status);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    params: { id },
    request: new Request('http://localhost/x', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/topics/[id]/status', () => {
  it('sets the topic status and redirects back to /admin', async () => {
    const context = makeContext('4', 'curated');
    const res = await POST(context as never);
    expect(dbMock.setTopicStatus).toHaveBeenCalledWith(mockPool, 4, 'curated');
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('rejects an invalid status value', async () => {
    const context = makeContext('4', 'not-a-real-status');
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    expect(dbMock.setTopicStatus).not.toHaveBeenCalled();
  });

  it('redirects to /login instead of updating when not authenticated', async () => {
    const loginRedirect = new Response(null, { status: 302 });
    authMock.requireAdminSession.mockResolvedValue({ response: loginRedirect });
    const context = makeContext('4', 'curated');
    const res = await POST(context as never);
    expect(res).toBe(loginRedirect);
    expect(dbMock.setTopicStatus).not.toHaveBeenCalled();
  });
});
