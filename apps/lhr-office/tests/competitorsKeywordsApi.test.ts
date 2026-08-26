import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPool = { query: vi.fn() };
vi.mock('../src/lib/db', () => ({ getPool: () => mockPool }));

const authMock = { requireAdminSession: vi.fn() };
vi.mock('../src/lib/auth', () => authMock);

const dbMock = { addKeyword: vi.fn(), removeKeyword: vi.fn() };
vi.mock('@lhr/db', () => dbMock);

const { POST: addPOST } = await import('../src/pages/api/competitors/keywords/add');
const { POST: removePOST } = await import('../src/pages/api/competitors/keywords/[id]/remove');

const admin = { id: 1, username: 'ash', passwordHash: 'x', failedAttempts: 0, lockedUntil: null, createdAt: new Date(), createdBy: null };

function makeAddContext(keyword: string) {
  const form = new FormData();
  form.set('keyword', keyword);
  return { request: new Request('http://localhost/api/competitors/keywords/add', { method: 'POST', body: form }), cookies: {} } as never;
}

function makeRemoveContext(id: string) {
  return { params: { id }, cookies: {} } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireAdminSession.mockResolvedValue({ admin });
});

describe('POST /api/competitors/keywords/add', () => {
  it('adds a non-empty keyword', async () => {
    dbMock.addKeyword.mockResolvedValue({ id: 1, keyword: 'gluten free dinner recipes', addedAt: new Date() });
    const res = await addPOST(makeAddContext('gluten free dinner recipes'));
    expect(dbMock.addKeyword).toHaveBeenCalledWith(mockPool, 'gluten free dinner recipes');
    expect(res.status).toBe(200);
  });

  it('returns 400 for an empty keyword without calling the database', async () => {
    const res = await addPOST(makeAddContext('   '));
    expect(res.status).toBe(400);
    expect(dbMock.addKeyword).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no valid admin session', async () => {
    authMock.requireAdminSession.mockResolvedValue({ response: new Response(null, { status: 302 }) });
    const res = await addPOST(makeAddContext('anything'));
    expect(res.status).toBe(401);
    expect(dbMock.addKeyword).not.toHaveBeenCalled();
  });
});

describe('POST /api/competitors/keywords/[id]/remove', () => {
  it('removes a keyword by id', async () => {
    const res = await removePOST(makeRemoveContext('7'));
    expect(dbMock.removeKeyword).toHaveBeenCalledWith(mockPool, 7);
    expect(res.status).toBe(200);
  });

  it('returns 400 on a non-numeric id', async () => {
    const res = await removePOST(makeRemoveContext('abc'));
    expect(res.status).toBe(400);
    expect(dbMock.removeKeyword).not.toHaveBeenCalled();
  });
});
