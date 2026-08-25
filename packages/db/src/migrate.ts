import type { Pool } from 'pg';
import {
  CANDIDATES_TABLE_SQL,
  DECISION_HISTORY_TABLE_SQL,
  OFFICE_ADMINS_TABLE_SQL,
  OFFICE_SESSIONS_TABLE_SQL,
  TREND_SEED_TOPICS_TABLE_SQL,
  TRENDS_REPORTS_TABLE_SQL,
  COMPETITORS_TABLE_SQL,
} from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
  await pool.query(OFFICE_ADMINS_TABLE_SQL);
  await pool.query(OFFICE_SESSIONS_TABLE_SQL);
  await pool.query(TREND_SEED_TOPICS_TABLE_SQL);
  await pool.query(TRENDS_REPORTS_TABLE_SQL);
  await pool.query(COMPETITORS_TABLE_SQL);
}
