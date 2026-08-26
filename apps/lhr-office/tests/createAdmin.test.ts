import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { createAdmin: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/create-admin');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(username: string, password: string) {
  const form = new FormData();
  form.set('username', username);
  form.set('password', password);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    request: new Request('http://localhost/api/admin/create-admin', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/create-admin', () => {
  it('creates a new admin attributed to the logged-in admin and redirects back to /admin', async () => {
    dbMock.createAdmin.mockResolvedValue({ id: 2, username: 'newperson', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: 1 });
    const context = makeContext('newperson', 'a-strong-password');

    const res = await POST(context as never);

    expect(dbMock.createAdmin).toHaveBeenCalledWith(mockPool, 'newperson', 'a-strong-password', 1);
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('redirects to /login instead of creating an admin when not authenticated', async () => {
    const loginRedirect = new Response(null, { status: 302 });
    authMock.requireAdminSession.mockResolvedValue({ response: loginRedirect });
    const context = makeContext('newperson', 'a-strong-password');

    const res = await POST(context as never);

    expect(res).toBe(loginRedirect);
    expect(dbMock.createAdmin).not.toHaveBeenCalled();
  });

  it('redirects with an error and never calls createAdmin when the password is too short', async () => {
    const context = makeContext('newperson', 'short');

    await POST(context as never);

    expect(dbMock.createAdmin).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/\?error=/));
  });

  it('redirects to /admin/?error=... instead of throwing when createAdmin rejects with a unique-violation', async () => {
    dbMock.createAdmin.mockRejectedValue({ code: '23505' });
    const context = makeContext('newperson', 'a-strong-password');

    await POST(context as never);

    expect(context.redirect).toHaveBeenCalledWith(expect.stringMatching(/^\/admin\/\?error=/));
  });
});
