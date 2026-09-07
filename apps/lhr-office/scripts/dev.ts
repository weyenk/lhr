import { getPool } from '@lhr/db';
import { createApp } from '../src/server.js';

const missing = ['DATABASE_URL', 'SUPABASE_JWT_SECRET'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')}`);
  console.error('Add them to a .env file at the repo root (copy .env.example) and re-run.');
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.warn(
    '[dev] GITHUB_TOKEN is not set. The recipe-candidate ops and "Approve" on affiliate ' +
      'candidates will fail with a clear error instead of writing anywhere. "Deny" and browsing ' +
      'the dashboard both work fine without it. Add GITHUB_TOKEN to .env only once you actually ' +
      'want to test a real commit — see the warning printed below for what that means.',
  );
}
if (!process.env.KEEPA_API_KEY || !process.env.AMAZON_ASSOCIATES_TAG) {
  console.warn(
    '[dev] KEEPA_API_KEY / AMAZON_ASSOCIATES_TAG not set — this only affects running the ' +
      'affiliate-sourcing job itself (npm run source:affiliate-candidates in mcp-server), not ' +
      'browsing/approving/denying candidates already in the database.',
  );
}

const port = Number(process.env.PORT ?? 3001);

createApp(getPool()).listen(port, () => {
  console.log(`\nlhr-office running locally: http://localhost:${port}/`);
  console.log('Sign in with a Supabase Auth user for this project (create one in the Supabase dashboard if needed).');
  if (process.env.GITHUB_TOKEN) {
    console.log(
      '\n⚠️  GITHUB_TOKEN is set — clicking "Approve" (on either the recipe candidate or an ' +
        'affiliate candidate) makes a REAL commit to the REAL weyenk/lhr main branch. There is ' +
        'no sandbox mode; the target repo is hardcoded, not environment-specific. "Deny" is ' +
        'always safe (database-only, no GitHub call).\n',
    );
  }
});
