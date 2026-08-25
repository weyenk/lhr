import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  isLocked,
  createAdmin,
  getAdminByUsername,
  getAdminById,
  listAdmins,
  recordFailedAttempt,
  resetFailedAttempts,
} from '../src/officeAdmins';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password against its own hash', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects an incorrect password', () => {
    const hash = hashPassword('correct horse battery staple');
    expect(verifyPassword('wrong password', hash)).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    expect(hashPassword('same password')).not.toBe(hashPassword('same password'));
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyPassword('anything', 'not-a-valid-hash')).toBe(false);
  });
});

describe('isLocked', () => {
  it('is false when lockedUntil is null', () => {
    expect(isLocked({ lockedUntil: null })).toBe(false);
  });

  it('is false when lockedUntil is in the past', () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() - 1000) })).toBe(false);
  });

  it('is true when lockedUntil is in the future', () => {
    expect(isLocked({ lockedUntil: new Date(Date.now() + 60_000) })).toBe(true);
  });
});

describe('createAdmin', () => {
  it('inserts a hashed password and returns the created admin', async () => {
    const row = {
      id: 1, username: 'ash', password_hash: 'salt:hash', failed_attempts: 0,
      locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: null,
    };
    const pool = mockPool([row]);
    const result = await createAdmin(pool as never, 'ash', 'hunter2', null);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO office_admins'), [
      'ash', expect.any(String), null,
    ]);
    expect(result).toEqual({
      id: 1, username: 'ash', passwordHash: 'salt:hash', failedAttempts: 0,
      lockedUntil: null, createdAt: new Date('2026-08-24T00:00:00Z'), createdBy: null,
    });
  });
});

describe('getAdminByUsername / getAdminById', () => {
  const row = {
    id: 2, username: 'noah', password_hash: 'salt:hash', failed_attempts: 1,
    locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: 1,
  };

  it('returns null when no admin matches the username', async () => {
    const pool = mockPool([]);
    expect(await getAdminByUsername(pool as never, 'nobody')).toBeNull();
  });

  it('maps a found row to camelCase by username', async () => {
    const pool = mockPool([row]);
    const result = await getAdminByUsername(pool as never, 'noah');
    expect(result?.passwordHash).toBe('salt:hash');
    expect(result?.failedAttempts).toBe(1);
  });

  it('maps a found row to camelCase by id', async () => {
    const pool = mockPool([row]);
    const result = await getAdminById(pool as never, 2);
    expect(result?.username).toBe('noah');
  });
});

describe('listAdmins', () => {
  it('never includes passwordHash in the returned summaries', async () => {
    const row = {
      id: 3, username: 'guest', password_hash: 'salt:hash', failed_attempts: 0,
      locked_until: null, created_at: new Date('2026-08-24T00:00:00Z'), created_by: 1,
    };
    const pool = mockPool([row]);
    const result = await listAdmins(pool as never);
    expect(result).toEqual([{
      id: 3, username: 'guest', failedAttempts: 0, lockedUntil: null,
      createdAt: new Date('2026-08-24T00:00:00Z'), createdBy: 1,
    }]);
    expect(result[0]).not.toHaveProperty('passwordHash');
  });
});

describe('recordFailedAttempt', () => {
  it('increments failed_attempts and does not lock below the threshold', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ failed_attempts: 3 }] }) };
    await recordFailedAttempt(pool as never, 5);
    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(pool.query.mock.calls[0][0]).toContain('failed_attempts = failed_attempts + 1');
  });

  it('locks the account once failed_attempts reaches 5', async () => {
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ failed_attempts: 5 }] }) };
    await recordFailedAttempt(pool as never, 5);
    expect(pool.query).toHaveBeenCalledTimes(2);
    expect(pool.query.mock.calls[1][0]).toContain('locked_until');
  });
});

describe('resetFailedAttempts', () => {
  it('clears failed_attempts and locked_until', async () => {
    const pool = mockPool();
    await resetFailedAttempts(pool as never, 5);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining('failed_attempts = 0'), [5]);
  });
});
