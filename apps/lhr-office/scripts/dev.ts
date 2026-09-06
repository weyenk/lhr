import { getPool } from '@lhr/db';
import { createApp } from '../src/server.js';

// Local-only convenience defaults — never used in production (Vercel always sets these as real
// project env vars; requireStatusAuth 401s if either is missing, so leaving them unset there is
// intentional). Set STATUS_AUTH_USER/STATUS_AUTH_PASSWORD in .env yourself if you want different
// local credentials.
process.env.STATUS_AUTH_USER ??= 'dev';
process.env.STATUS_AUTH_PASSWORD ??= 'dev';

const missing = ['DATABASE_URL'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')}`);
  console.error('Add them to a .env file at the repo root (copy .env.example) and re-run.');
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.warn(
    '[dev] GITHUB_TOKEN is not set. The recipe-candidate ops and "Approve" on affiliate ' +
      'candidates will fail with a clear error instead of writing anywhere. "Deny" and viewing ' +
      '/status both work fine without it. Add GITHUB_TOKEN to .env only once you actually want ' +
      'to test a real commit — see the warning printed below for what that means.',
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
  console.log(`\nlhr-office running locally: http://localhost:${port}/status`);
  console.log(`Log in with STATUS_AUTH_USER=${process.env.STATUS_AUTH_USER} / STATUS_AUTH_PASSWORD=${process.env.STATUS_AUTH_PASSWORD}`);
  if (process.env.GITHUB_TOKEN) {
    console.log(
      '\n⚠️  GITHUB_TOKEN is set — clicking "Approve" (on either the recipe candidate or an ' +
        'affiliate candidate) makes a REAL commit to the REAL weyenk/lhr main branch. There is ' +
        'no sandbox mode; the target repo is hardcoded, not environment-specific. "Deny" is ' +
        'always safe (database-only, no GitHub call).\n',
    );
  }
});
