import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const poolCtor = vi.fn();

vi.mock('pg', () => ({
  Pool: poolCtor,
}));

describe('getPool', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    poolCtor.mockClear();
    process.env.DATABASE_URL = 'postgres://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('disables strict chain verification so poolers presenting an untrusted chain (e.g. Supabase) can connect', async () => {
    const { getPool } = await import('../src/client');
    getPool();
    expect(poolCtor).toHaveBeenCalledWith(
      expect.objectContaining({ ssl: expect.objectContaining({ rejectUnauthorized: false }) }),
    );
  });
});
