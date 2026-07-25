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
4. In the Vercel project's Environment Variables, set `PUBLIC_UMAMI_URL` (the script URL) and `PUBLIC_UMAMI_WEBSITE_ID` (the website ID) to the values from step 3.
5. Create a ConvertKit account and a signup form, then copy the form's numeric **Form ID** (visible in its dashboard URL or embed code). In the Vercel project's Environment Variables, set `PUBLIC_CONVERTKIT_FORM_ID` to that value — this powers the email signup component in the footer and on the `/community/` page, which otherwise renders nothing.
6. Push to `main` — Vercel auto-deploys on every push.
