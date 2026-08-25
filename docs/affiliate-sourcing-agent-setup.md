# Affiliate Sourcing Agent — Setup

One-time steps to get the weekly candidate-sourcing cron and the `lhr-office`
review app running. Code changes are already in place (see
`docs/superpowers/plans/2026-08-24-affiliate-sourcing-agent.md`); this is the
remaining manual configuration.

## 1. Provision Postgres (Neon, via Vercel Marketplace)

1. In the Vercel dashboard, open the `lhr-office` project (create it first if
   this is also the first feature landing in that shared app — see the
   project's own setup notes for how it's linked to this repo/subdirectory).
2. Storage tab → Marketplace → add a Neon Postgres integration.
3. Copy the resulting connection string into:
   - `apps/lhr-office`'s Vercel project environment variables, as
     `DATABASE_URL` (Production + Preview).
   - Your local `.env` (for running the cron script and `db:migrate`
     locally) as `DATABASE_URL`.
4. Run the migration once against that database:
   ```bash
   cd packages/db && npm run db:migrate
   ```

## 2. Admin access to `/affiliate-review/` — not yet available

`apps/lhr-office` is gated by a **deliberate placeholder** (`requireSession()`
in `apps/lhr-office/src/lib/auth.ts`) that denies every request. This was a
conscious choice made while implementing this plan: the site author decided
`lhr-office` should use real username/password admin accounts instead of a
single shared Vercel Deployment Protection password, but that system
(`requireAdminSession()`, `office_admins`/`office_sessions` tables) is owned
by a separate, not-yet-committed spec (working title "trends-watcher").

**There is nothing to configure here yet.** Once that spec lands:

1. In `apps/lhr-office/src/lib/auth.ts`, replace the stub's `requireSession`
   export with an import of the real `requireAdminSession()`.
2. In each of `apps/lhr-office/src/pages/affiliate-review/index.astro`,
   `apps/lhr-office/src/pages/api/affiliate-review/candidates/[id]/approve.ts`,
   and `.../deny.ts`, the `try { await requireSession(); } catch (err) { if
   (err instanceof AuthNotConfiguredError) {...} }` block can be simplified
   to whatever the real system's error-handling contract calls for.
3. Follow that spec's own setup docs for creating the first admin account.

Until then, the weekly cron (step 4 below) still runs and populates
Postgres normally — only the review UI is inert.

## 3. Environment variables

Set these in the `lhr-office` Vercel project (Production + Preview) and in
your local `.env` for the cron script:

| Var | Used by | Notes |
| --- | --- | --- |
| `DATABASE_URL` | cron script, `lhr-office` | from step 1 |
| `AUTHOR_GITHUB_TOKEN` | cron script, `lhr-office` approve route | a GitHub PAT with `repo` write access — the same one `mcp-server/src/server.ts`'s mobile-upload flow already requires |
| `AMAZON_ASSOCIATES_TAG` | cron script, `lhr-office` approve route | your Amazon Associates tracking ID, e.g. `yoursite-20` |
| `KEEPA_API_KEY` | cron script only | from your Keepa account |

## 4. Run the weekly cron

There's no shared local orchestrator yet (that's a separate, later spec).
Until then, run manually or via your own OS scheduler (cron/launchd):

```bash
cd mcp-server && npm run source:affiliate-candidates
```

## 5. Verify what's available today

1. Run the script once (step 4) and confirm it logs `Wrote N candidate(s)...`.
2. Confirm the rows landed: `SELECT asin, title, status FROM candidates WHERE status = 'pending' LIMIT 5;`
3. Visit `https://<lhr-office-url>/affiliate-review/` and confirm it shows the
   "admin auth isn't wired up yet" message (not a 500 error) — this is the
   expected, fully-functional state of the placeholder gate described in
   step 2 above.

Steps 3-4 as originally planned (approve a candidate via the UI, confirm a
file lands on `main`; deny another, confirm only the decision is recorded)
can't be exercised end-to-end through the UI until the real auth system
lands — do them once step 2's swap is complete.
