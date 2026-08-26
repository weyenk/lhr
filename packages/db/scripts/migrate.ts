import { Pool } from 'pg';
import { runMigrations } from '../src/migrate.js';

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }
  const pool = new Pool({ connectionString });
  await runMigrations(pool);
  console.log('Migrations applied.');
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
