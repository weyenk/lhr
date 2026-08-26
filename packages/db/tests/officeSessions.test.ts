import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createSession, getSession, renewSession, deleteSession } from '../src/officeSessions';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createSession', () => {
  it('inserts a random session id with a 7-day expiry and returns it', async () => {
    const pool = { query: vi.fn().mockImplementation(async (_sql: string, params: unknown[]) => ({
      rows: [{ id: params[0], admin_id: params[1], created_at: new Date('2026-08-24T00:00:00Z'), expires_at: params[2] }],
    })) };
    const before = Date.now();
    const session = await createSession(pool as never, 7);
    expect(session.id).toMatch(/^[0-9a-f]{64}$/);
    expect(session.adminId).toBe(7);
    const expiresInMs = session.expiresAt.getTime() - before;
    expect(expiresInMs).toBeGreaterThan(6.9 * 24 * 60 * 60 * 1000);
    expect(expiresInMs).toBeLessThan(7.1 * 24 * 60 * 60 * 1000);
  });
});

describe('getSession', () => {
  it('returns null when no session matches', async () => {
    const pool = mockPool([]);
    expect(await getSession(pool as never, 'nope')).toBeNull();
  });

  it('maps a found row to camelCase', async () => {
    const row = { id: 'abc', admin_id: 1, created_at: new Date('2026-08-24T00:00:00Z'), expires_at: new Date('2026-08-31T00:00:00Z') };
    const pool = mockPool([row]);
    const result = await getSession(pool as never, 'abc');
    expect(result).toEqual({ id: 'abc', adminId: 1, createdAt: row.created_at, expiresAt: row.expires_at });
  });
});

describe('renewSession', () => {
  it('pushes expires_at forward by 7 days from now', async () => {
    const pool = mockPool();
    await renewSession(pool as never, 'abc');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('UPDATE office_sessions SET expires_at'), [
      expect.any(Date), 'abc',
    ]);
  });
});

describe('deleteSession', () => {
  it('deletes the session row', async () => {
    const pool = mockPool();
    await deleteSession(pool as never, 'abc');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM office_sessions'), ['abc']);
  });
});
