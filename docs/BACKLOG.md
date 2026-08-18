# LHR Backlog

A living punch list of what's left before this site is "live and legit" as a real
business — both code work and non-code business/legal work. Unlike
`docs/superpowers/specs/`, this is not a dated design doc; update it in place as
items are resolved, added, or reprioritized.

## Status to confirm (unclear from the repo alone)

- ~~**Umami analytics server**~~ — confirmed **live**. Verified 2026-07-26 against the
  `lhr` Vercel project's production deployment: `BaseLayout.astro` renders both the
  pageview script and the replay/heatmap recorder script pointed at
  `umami-production-6a93.up.railway.app` with a real website ID, and that host
  responds. `PUBLIC_UMAMI_URL` / `PUBLIC_UMAMI_WEBSITE_ID` are set in Vercel.
- ~~**ConvertKit account/form**~~ — confirmed **live**, now under Kit's rebranded
  domain. Verified 2026-07-26: the footer signup form posts to a real form ID at
  `app.kit.com/forms/9729125/subscriptions`, so `PUBLIC_CONVERTKIT_FORM_ID` is set in
  Vercel.
- **Domain + Vercel connection** — still outstanding. The `lhr` Vercel project exists
  and has a working production deployment, but `loveheatrelationship.com` is not yet
  attached as a custom domain (confirmed via the Vercel project's domain list
  2026-07-26) — the live site is still on Squarespace. DNS cutover is the last manual
  step per `docs/DEPLOYMENT.md`.

## Business & legal (non-code)

These don't live in this repo as specs, but they block treating this as a real
business and are easy to forget while heads-down on code:

- ~~**Business entity formation**~~ — done. LLC + EIN obtained.
- **Business bank account** — kept separate from personal, for sane bookkeeping and
  taxes.
- **Sales tax registration** — only applies if products are sold directly rather than
  via affiliate links; depends on the ecommerce platform decision below.
- **Affiliate program enrollment** — actually signing up for Amazon Associates,
  ShareASale, etc. `monetization-scout` can research which programs fit, but
  enrollment itself is a manual step, and most programs require a live Privacy
  Policy / Terms of Service before they'll approve an application.
- **Business insurance** — mainly relevant if the site ever sells or ships physical
  products directly rather than purely linking out.

## Specs still to write (code/site)

Roughly in priority order — item 1 is the remaining blocker for "live and legit"
status; the rest are polish or growth.

1. **Ecommerce platform** — Shopify vs. a custom cart vs. staying affiliate-only.
   Foundational: it determines what the product/cart UI even needs to be, and
   whether sales tax registration applies.
2. **SEO foundations** — sitemap.xml, robots.txt, Open Graph tags, canonical URLs, and
   the schema.org Recipe markup the original content-platform spec flagged but never
   built.
3. ~~**Email capture / newsletter**~~ — built and live: a Kit-backed signup component
   lives in the site footer and on the `/community/` page, per `docs/BRAND.md`'s
   Community page spec, and the form/account are confirmed provisioned (see above).
4. **Error + uptime monitoring** — nothing currently alerts if the site breaks or a
   deploy fails silently.
5. **Analytics dashboard / conversion review** — Umami is confirmed live; decide what
   "success" looks like (e.g. affiliate click-through rate) and set up a regular
   review; `analytics-reviewer` agent is ready for this now that there's data.
6. **Community features** — forums, giveaways, raffles. `giveaway-compliance-checker`
   agent exists for the legal-risk side, but nothing is built yet.
7. **Content scale-up plan** — once ecommerce and design exist, filling out the
   ~26-posts/6-months cadence for real; `content-strategist` is ready for this.
8. **Instacart "buy the meal" button** — one-click add every recipe ingredient to an
   Instacart cart. Spec drafted:
   `docs/superpowers/specs/active/2026-08-18-instacart-buy-the-meal-design.md`. Blocked
   on confirming Instacart Developer Platform partner API access (reported ~30-40 day
   approval, unconfirmed whether new applications are currently accepted) before an
   implementation plan can be written.
