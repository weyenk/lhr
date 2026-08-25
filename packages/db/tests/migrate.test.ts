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

  it('creates the office_admins table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS office_admins'))).toBe(true);
  });

  it('creates the office_sessions table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS office_sessions'))).toBe(true);
  });

  it('creates the trend_seed_topics table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS trend_seed_topics'))).toBe(true);
  });

  it('creates the trends_reports table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS trends_reports'))).toBe(true);
  });

  it('creates the competitors table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS competitors'))).toBe(true);
  });

  it('creates the competitor_seo_keywords table', async () => {
    const pool = { query: vi.fn().mockResolvedValue(undefined) };
    await runMigrations(pool as never);
    const calls = pool.query.mock.calls.map((c) => c[0] as string);
    expect(calls.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS competitor_seo_keywords'))).toBe(true);
  });
});
