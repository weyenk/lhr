import type { Pool } from 'pg';
import { CANDIDATES_TABLE_SQL, DECISION_HISTORY_TABLE_SQL, CANDIDATES_CYCLE_ASIN_UNIQUE_INDEX_SQL } from './schema.js';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.query(CANDIDATES_TABLE_SQL);
  await pool.query(DECISION_HISTORY_TABLE_SQL);
  await pool.query(CANDIDATES_CYCLE_ASIN_UNIQUE_INDEX_SQL);
}
