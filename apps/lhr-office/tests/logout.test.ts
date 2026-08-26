import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const dbMock = { deleteSession: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/logout');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('POST /api/logout', () => {
  it('deletes the session and clears the cookie', async () => {
    const cookies = { get: vi.fn(() => ({ value: 'sess-1' })), delete: vi.fn() };
    const redirectResponse = new Response(null, { status: 302 });
    const context = { cookies, redirect: vi.fn(() => redirectResponse) };

    const res = await POST(context as never);

    expect(dbMock.deleteSession).toHaveBeenCalledWith(mockPool, 'sess-1');
    expect(cookies.delete).toHaveBeenCalledWith('office_session', expect.objectContaining({ path: '/' }));
    expect(context.redirect).toHaveBeenCalledWith('/login');
    expect(res.status).toBe(302);
  });

  it('redirects to /login without erroring when there is no session cookie', async () => {
    const cookies = { get: vi.fn(() => undefined), delete: vi.fn() };
    const redirectResponse = new Response(null, { status: 302 });
    const context = { cookies, redirect: vi.fn(() => redirectResponse) };

    await POST(context as never);

    expect(dbMock.deleteSession).not.toHaveBeenCalled();
    expect(context.redirect).toHaveBeenCalledWith('/login');
  });
});
