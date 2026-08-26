import { Pool } from 'pg';
import { createAdmin } from '@lhr/db';

async function main() {
  const [username, password] = process.argv.slice(2);
  if (!username || !password) {
    console.error('Usage: tsx scripts/create-office-admin.ts <username> <password>');
    process.exit(1);
  }

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL env var is required.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString });
  const admin = await createAdmin(pool, username, password, null);
  console.log(`Created admin "${admin.username}" (id ${admin.id}).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
