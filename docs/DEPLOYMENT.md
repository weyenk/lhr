# Deployment

Manual, one-time setup (outside this repo's code):

1. In the Vercel dashboard, import this GitHub repository as a new project. Vercel reads `vercel.json` automatically — no further config needed.
2. Add the custom domain `loveheatrelationship.com` to the Vercel project, and update DNS at the domain registrar to point to Vercel per its instructions.
3. Provision the self-hosted Umami instance (e.g. on Fly.io or Railway) and note its script URL and website ID.
4. In the Vercel project's Environment Variables, set `PUBLIC_UMAMI_URL` and `PUBLIC_UMAMI_WEBSITE_ID` to the values from step 3.
5. Push to `main` — Vercel auto-deploys on every push.
