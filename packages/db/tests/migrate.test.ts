import { describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../src/migrate';

describe('runMigrations', () => {
  it('creates the candidates table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS candidates'))).toBe(true);
  });

  it('creates the decision_history table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS decision_history'))).toBe(true);
  });

  it('creates the unique index on (cycle_id, asin)', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE UNIQUE INDEX IF NOT EXISTS candidates_cycle_id_asin_key'))).toBe(true);
  });

  it('creates the product_placement_proposals table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS product_placement_proposals'))).toBe(true);
  });
});
