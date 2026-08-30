import { Pool } from 'pg';

export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: requireEnv('DATABASE_URL'),
      // sslmode=require in the connection string only enables TLS; it does not
      // relax certificate verification. Supabase's connection pooler presents
      // a chain Node's default trust store treats as self-signed
      // (SELF_SIGNED_CERT_IN_CHAIN), so the handshake fails without this —
      // the connection is still encrypted, just not chain-verified.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
