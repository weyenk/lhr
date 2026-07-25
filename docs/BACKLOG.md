# LHR Backlog

A living punch list of what's left before this site is "live and legit" as a real
business — both code work and non-code business/legal work. Unlike
`docs/superpowers/specs/`, this is not a dated design doc; update it in place as
items are resolved, added, or reprioritized.

## Status to confirm (unclear from the repo alone)

- **Umami analytics server** — the site's tracking code (pageviews, `affiliate-click`,
  `kitchenware-click` events) is fully wired in `BaseLayout.astro` and the link
  components, but it only does anything once a real Umami instance is provisioned
  (Fly.io/Railway, per `docs/DEPLOYMENT.md`) and `PUBLIC_UMAMI_WEBSITE_ID` is set in
  Vercel. `.env.example` still shows that value blank — confirm whether this step has
  actually been done, or the site is tracking nothing.
- **Domain + Vercel connection** — confirm `loveheatrelationship.com` DNS actually
  points at the Vercel project (also a manual step per `docs/DEPLOYMENT.md`).

## Business & legal (non-code)

These don't live in this repo as specs, but they block treating this as a real
business and are easy to forget while heads-down on code:

- **Business entity formation** — LLC or sole proprietorship, plus an EIN. Protects
  you personally and is required to open a business bank account.
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

Roughly in priority order — items 1 and 3 are the two blocking "live and legit"
status; the rest are polish or growth.

1. **Ecommerce platform** — Shopify vs. a custom cart vs. staying affiliate-only.
   Foundational: it determines what the product/cart UI even needs to be, and
   whether sales tax registration applies.
2. **Visual/brand design system** — the site is currently unstyled HTML with no
   branding.
3. **Legal pages** — done in code (`/privacy-policy/`, `/terms-of-service/`,
   `/affiliate-disclosure/`, linked from the footer). Still needs the author's (and
   ideally a lawyer's) review before publishing, plus a real contact inbox at
   `hello@loveheatrelationship.com` and a governing-law jurisdiction in the Terms —
   both are left as placeholders in the drafts.
4. **SEO foundations** — sitemap.xml, robots.txt, Open Graph tags, canonical URLs, and
   the schema.org Recipe markup the original content-platform spec flagged but never
   built.
5. **Email capture / newsletter** — nothing currently converts a reader into a repeat
   visitor; usually the highest-leverage piece for a content site's revenue.
6. **Error + uptime monitoring** — nothing currently alerts if the site breaks or a
   deploy fails silently.
7. **Analytics dashboard / conversion review** — once Umami is confirmed live, decide
   what "success" looks like (e.g. affiliate click-through rate) and set up a regular
   review; `analytics-reviewer` agent is ready for this once there's data.
8. **Community features** — forums, giveaways, raffles. `giveaway-compliance-checker`
   agent exists for the legal-risk side, but nothing is built yet.
9. **Content scale-up plan** — once ecommerce and design exist, filling out the
   ~26-posts/6-months cadence for real; `content-strategist` is ready for this.
