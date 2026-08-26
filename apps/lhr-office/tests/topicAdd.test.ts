import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { addCuratedTopic: vi.fn(), TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'] };
vi.mock('@lhr/db', () => dbMock);

const { POST } = await import('../src/pages/api/admin/topics/add');

const loggedInAdmin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeContext(category: string, topic: string) {
  const form = new FormData();
  form.set('category', category);
  form.set('topic', topic);
  const redirectResponse = new Response(null, { status: 302 });
  return {
    request: new Request('http://localhost/x', { method: 'POST', body: form }),
    cookies: {},
    redirect: vi.fn(() => redirectResponse),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin: loggedInAdmin });
});

describe('POST /api/admin/topics/add', () => {
  it('adds a curated topic directly and redirects back to /admin', async () => {
    dbMock.addCuratedTopic.mockResolvedValue({ id: 9, category: 'cooking', topic: 'sourdough', status: 'curated', timesSeen: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), promotedAt: new Date() });
    const context = makeContext('cooking', 'Sourdough');
    const res = await POST(context as never);
    expect(dbMock.addCuratedTopic).toHaveBeenCalledWith(mockPool, 'cooking', 'Sourdough');
    expect(context.redirect).toHaveBeenCalledWith('/admin/');
    expect(res.status).toBe(302);
  });

  it('rejects an unknown category', async () => {
    const context = makeContext('not-a-category', 'Sourdough');
    const res = await POST(context as never);
    expect(res.status).toBe(400);
    expect(dbMock.addCuratedTopic).not.toHaveBeenCalled();
  });
});
