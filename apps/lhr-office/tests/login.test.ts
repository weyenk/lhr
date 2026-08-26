import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = {
  getAdminByUsername: vi.fn(),
  isLocked: vi.fn(() => false),
  verifyPassword: vi.fn(),
  recordFailedAttempt: vi.fn(),
  resetFailedAttempts: vi.fn(),
  createSession: vi.fn(),
};
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/login');

const admin = { id: 1, username: 'ash', passwordHash: 'stored-hash', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(username: string, password: string) {
  const form = new FormData();
  form.set('username', username);
  form.set('password', password);
  const cookies = { set: vi.fn() };
  const redirectResponse = new Response(null, { status: 302 });
  return { request: new Request('http://localhost/api/login', { method: 'POST', body: form }), cookies, redirect: vi.fn(() => redirectResponse) };
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMock.isLocked.mockReturnValue(false);
});

describe('POST /api/login', () => {
  it('creates a session and sets the cookie on correct credentials', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.verifyPassword.mockReturnValue(true);
    dbMock.createSession.mockResolvedValue({ id: 'sess-1', adminId: 1, createdAt: new Date(), expiresAt: new Date() });

    const context = makeContext('ash', 'correct-password');
    const res = await POST(context as never);

    expect(dbMock.resetFailedAttempts).toHaveBeenCalledWith(mockPool, 1);
    expect(context.cookies.set).toHaveBeenCalledWith(
      'office_session', 'sess-1',
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: 'lax', path: '/' }),
    );
    expect(context.redirect).toHaveBeenCalledWith('/');
    expect(res.status).toBe(302);
  });

  it('redirects to the login page with an error and records a failed attempt on wrong password', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.verifyPassword.mockReturnValue(false);

    const context = makeContext('ash', 'wrong-password');
    await POST(context as never);

    expect(context.redirect).toHaveBeenCalledWith('/login?error=' + encodeURIComponent('Invalid username or password'));
    expect(dbMock.recordFailedAttempt).toHaveBeenCalledWith(mockPool, 1);
    expect(dbMock.createSession).not.toHaveBeenCalled();
  });

  it('redirects to the login page with an error for an unknown username without leaking which part was wrong', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(null);
    const context = makeContext('nobody', 'anything');
    await POST(context as never);
    expect(context.redirect).toHaveBeenCalledWith('/login?error=' + encodeURIComponent('Invalid username or password'));
  });

  it('redirects to the login page with an error when the account is locked', async () => {
    dbMock.getAdminByUsername.mockResolvedValue(admin);
    dbMock.isLocked.mockReturnValue(true);
    const context = makeContext('ash', 'correct-password');
    await POST(context as never);
    expect(context.redirect).toHaveBeenCalledWith('/login?error=' + encodeURIComponent('Account locked. Try again in 15 minutes.'));
    expect(dbMock.verifyPassword).not.toHaveBeenCalled();
  });
});
