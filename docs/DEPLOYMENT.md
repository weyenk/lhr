# Deployment

Manual, one-time setup (outside this repo's code):

1. In the Vercel dashboard, import this GitHub repository as a new project. Vercel reads `vercel.json` automatically — no further config needed.
2. Add the custom domain `loveheatrelationship.com` to the Vercel project, and update DNS at the domain registrar to point to Vercel per its instructions.
3. Provision the self-hosted Umami instance (not yet done as of this writing — the site is tracking nothing until this happens):
   - Umami needs a Postgres (or MySQL) database to store events in.
   - Deploy the official Docker image — `docker.umami.is/umami-software/umami:postgresql-latest` (mirrored at `ghcr.io/umami-software/umami:postgresql-latest`) — to Fly.io or Railway.
     - **Fly.io**: `fly launch` from that image, attaching a Fly Postgres app when prompted, then `fly secrets set DATABASE_URL=... APP_SECRET=...`.
     - **Railway**: use Railway's Umami template, which provisions the Postgres add-on and env vars for you.
   - Either way, set `DATABASE_URL` (the Postgres connection string) and `APP_SECRET` (a unique random string — signs login session JWTs) as secrets on the host. Don't reuse a secret from anywhere else.
   - Once deployed, log in. **Change the default `admin`/`umami` password immediately** — this is the single biggest footgun in a fresh Umami install.
   - In the Umami dashboard, add a website for `loveheatrelationship.com`. This generates the **Website ID** and the tracking script URL (`https://<your-umami-domain>/script.js`) needed below.
   - Optional: in that website's settings, enable **Replays & Heatmaps** and copy the recorder script URL (`https://<your-umami-domain>/recorder.js`) — same Website ID, different script.
4. In the Vercel project's Environment Variables, set `PUBLIC_UMAMI_URL` (the script URL) and `PUBLIC_UMAMI_WEBSITE_ID` (the website ID) to the values from step 3. If replays/heatmaps are enabled, also set `PUBLIC_UMAMI_RECORDER_URL` (the recorder script URL) to start capturing those too.
5. Create a ConvertKit account and a signup form, then copy the form's numeric **Form ID** (visible in its dashboard URL or embed code). In the Vercel project's Environment Variables, set `PUBLIC_CONVERTKIT_FORM_ID` to that value — this powers the email signup component in the footer and on the `/community/` page, which otherwise renders nothing.
6. Push to `main` — Vercel auto-deploys on every push.
7. Set up the automation orchestrator (`apps/lhr-office`), which runs the site's weekly automation
   jobs on a schedule — currently an empty engine with no jobs registered yet:
   - In the Vercel dashboard, import this same GitHub repository as a **second**, separate Vercel
     project, setting its **Root Directory** to `apps/lhr-office`. Vercel reads that project's own
     `apps/lhr-office/vercel.json` automatically.
   - Add the custom domain `office.loveheatrelationship.com` to this new project.
   - Provision a Postgres database (e.g. Vercel Postgres or Neon) and set `DATABASE_URL` on the
     `apps/lhr-office` Vercel project to its connection string.
   - Run the schema once against that database: `psql "$DATABASE_URL" -f packages/db/src/schema.sql`.
   - Generate a random secret (`openssl rand -hex 32`) and set it as `CRON_SECRET` on the
     `apps/lhr-office` Vercel project. Vercel automatically sends this value as
     `Authorization: Bearer <CRON_SECRET>` on requests it makes to the paths listed under `crons`
     in `vercel.json` — this is what stops `/api/cron/orchestrator` from being triggered by an
     arbitrary public request.
   - Generate credentials for the `/status` dashboard and set `STATUS_AUTH_USER` and
     `STATUS_AUTH_PASSWORD` on the `apps/lhr-office` Vercel project (alongside `DATABASE_URL` and
     `CRON_SECRET` above). These gate `GET /status` and `POST /status/run/:jobName` with HTTP
     Basic Auth — without both set, those routes 401 on every request. When you visit `/status` in
     a browser, it will prompt for this username/password.
   - Confirm the Cron Job appears (enabled by default) in that Vercel project's Cron Jobs tab.
   - Push to `main` — Vercel auto-deploys this project the same way it does the main site.
   - Visit `https://office.loveheatrelationship.com/status` (entering the `STATUS_AUTH_USER` /
     `STATUS_AUTH_PASSWORD` credentials when prompted) to confirm the page loads. Every job will
     show "No jobs registered yet" until agents are added to the registry (next bullet).
   - `packages/jobs/src/registry.ts` ships with zero entries. Each of the five planned automation
     agents (recipe variant generator, affiliate sourcing, trends watcher, competitor analysis,
     product-in-photo placement) is registered later, one at a time, in its own implementation
     plan, by appending a `JobRegistration` entry to that file — no other change to
     `apps/lhr-office` is needed to add a job. Each agent's own plan is also responsible for adding
     whatever env vars its pipeline needs (e.g. `OPENROUTER_API_KEY`, `KEEPA_API_KEY`,
     `SERPAPI_KEY`) to the `apps/lhr-office` Vercel project.
   - The `affiliate-sourcing` agent specifically needs `KEEPA_API_KEY` (Keepa product-finder API
     key) and `AMAZON_ASSOCIATES_TAG` (the Amazon Associates tracking tag stamped onto approved
     product links) set on the `apps/lhr-office` Vercel project, alongside the `GITHUB_TOKEN` the
     other agents already use. Its weekly candidates are approved or denied from the same `/status`
     page, under "Affiliate candidates awaiting review".
   - The function is configured with a 300s `maxDuration` in `apps/lhr-office/vercel.json`
     (matching the plan's assumption of one job per invocation, run against Vercel's 300s default
     function timeout). If a job is shown as "in progress" on `/status` for longer than about 10
     minutes, that almost certainly means its invocation was killed (timeout, crash, deployment)
     partway through rather than that it's still genuinely running — the overlap guard already
     ignores `running` rows older than that 10-minute window, so the job will naturally retry on
     the next due-check. No manual intervention (e.g. editing the database row) is needed.
