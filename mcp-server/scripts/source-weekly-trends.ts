import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { runWeeklyTrendsCycle } from '../src/sourceWeeklyTrends.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, '../..');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });

  const results = await runWeeklyTrendsCycle(pool, repoRoot);
  for (const result of results) {
    console.log(`Wrote a trends report for ${result.category} (${result.topicsUsed.length} topic(s) used).`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
