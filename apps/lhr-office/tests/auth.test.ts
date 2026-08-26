import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = {
  getSession: vi.fn(),
  renewSession: vi.fn(),
  getAdminById: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const { requireAdminSession } = await import('../src/lib/auth');

function makeContext(cookieValue: string | undefined) {
  const redirectResponse = new Response(null, { status: 302 });
  return {
    cookies: { get: vi.fn(() => (cookieValue === undefined ? undefined : { value: cookieValue })) },
    redirect: vi.fn(() => redirectResponse),
  };
}

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

beforeEach(() => {
  vi.clearAllMocks();
});

describe('requireAdminSession', () => {
  it('redirects to /login when there is no session cookie', async () => {
    const context = makeContext(undefined);
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
    expect(dbMock.getSession).not.toHaveBeenCalled();
  });

  it('redirects to /login when the session does not exist', async () => {
    dbMock.getSession.mockResolvedValue(null);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });

  it('redirects to /login when the session is expired', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date(Date.now() - 1000) });
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });

  it('returns the admin and renews the session on a valid session', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    dbMock.getAdminById.mockResolvedValue(admin);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    const { passwordHash: _passwordHash, ...adminSummary } = admin;
    expect('admin' in result && result.admin).toEqual(adminSummary);
    expect('admin' in result && result.admin).not.toHaveProperty('passwordHash');
    expect(dbMock.renewSession).toHaveBeenCalledWith(mockPool, 'sess-1');
    expect(context.redirect).not.toHaveBeenCalled();
  });

  it('redirects to /login when the session references a since-deleted admin', async () => {
    dbMock.getSession.mockResolvedValue({ id: 'sess-1', adminId: 999, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000) });
    dbMock.getAdminById.mockResolvedValue(null);
    const context = makeContext('sess-1');
    const result = await requireAdminSession(context as never);
    expect('response' in result).toBe(true);
  });
});
