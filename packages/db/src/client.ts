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

// pg's own connection-string parsing re-derives `ssl` from a `sslmode` query
// param and, when `connectionString` is passed alongside an explicit `ssl`
// option, that re-derived value silently overwrites ours (see
// ConnectionParameters in node-postgres — parsing the connection string
// happens after the explicit config and is merged on top of it). With
// `sslmode=require` that clobbers `rejectUnauthorized: false` with `{}`,
// which defaults back to full chain verification. Stripping `sslmode` here
// is what makes the explicit `ssl` option below actually take effect.
function stripSslMode(connectionString: string): string {
  const url = new URL(connectionString);
  url.searchParams.delete('sslmode');
  return url.toString();
}

let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: stripSslMode(requireEnv('DATABASE_URL')),
      // Supabase's connection pooler presents a chain Node's default trust
      // store treats as self-signed (SELF_SIGNED_CERT_IN_CHAIN) — this keeps
      // the connection encrypted without full chain verification.
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}
