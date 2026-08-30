import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Client as PgClient } from 'pg';

const capturedOptions: Record<string, unknown>[] = [];

vi.mock('pg', async () => {
  const actual = await vi.importActual<typeof import('pg')>('pg');
  return {
    ...actual,
    Pool: vi.fn((options: Record<string, unknown>) => {
      capturedOptions.push(options);
      return {};
    }),
  };
});

describe('getPool', () => {
  const originalDatabaseUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    vi.resetModules();
    capturedOptions.length = 0;
    process.env.DATABASE_URL =
      'postgres://user:pass@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=require&supa=base-pooler.x';
  });

  afterEach(() => {
    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  });

  it('resolves to a non-verifying ssl config once pg re-parses the connection string, not just as the option it was handed', async () => {
    // pg's own connection-string parsing re-derives `ssl` from a `sslmode`
    // query param and overwrites whatever `ssl` option was explicitly passed
    // to `Pool`/`Client` (see ConnectionParameters in node-postgres). A test
    // that only inspects the raw options object passed to `Pool` would pass
    // even when this override silently clobbers `rejectUnauthorized: false`
    // back to full chain verification — the exact way the earlier fix here
    // failed in production against Supabase's pooler. Feeding the same
    // options into a real (unmocked) `pg.Client` and reading its resolved
    // `connectionParameters.ssl` is what actually catches that.
    const { getPool } = await import('../src/client');
    const { Client } = await vi.importActual<typeof import('pg')>('pg');

    getPool();

    expect(capturedOptions).toHaveLength(1);
    const client = new Client(capturedOptions[0]) as PgClient & {
      connectionParameters: { ssl: unknown };
    };
    expect(client.connectionParameters.ssl).toEqual({ rejectUnauthorized: false });
  });

  it('preserves non-ssl query params on the connection string', async () => {
    const { getPool } = await import('../src/client');
    getPool();
    const options = capturedOptions[0] as { connectionString: string };
    expect(options.connectionString).toContain('supa=base-pooler.x');
    expect(options.connectionString).not.toContain('sslmode');
  });
});
