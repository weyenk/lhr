# LHR Backlog

A living punch list of what's left before this site is "live and legit" as a real
business — both code work and non-code business/legal work. Unlike
`docs/superpowers/specs/`, this is not a dated design doc; update it in place as
items are resolved, added, or reprioritized.

## Status to confirm (unclear from the repo alone)

- **Umami analytics server** — confirmed **not yet provisioned**. The site's tracking
  code (pageviews, `affiliate-click`, `kitchenware-click` events) is fully wired and
  tested in `BaseLayout.astro` and the link components, but it no-ops until a real
  Umami instance is stood up (Fly.io/Railway, see `docs/DEPLOYMENT.md`) and
  `PUBLIC_UMAMI_URL` / `PUBLIC_UMAMI_WEBSITE_ID` are set in Vercel. `.env.example`
  still shows those values blank — the site is tracking nothing until this happens.
- **ConvertKit account/form** — same situation as Umami: the email signup component
  (footer + `/community/` page) is built and reads `PUBLIC_CONVERTKIT_FORM_ID`, but
  no real ConvertKit account or form exists yet, so it no-ops (renders nothing).
  Creating the account/form and setting the env var in Vercel is a manual step, see
  `docs/DEPLOYMENT.md`.
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
   `/affiliate-disclosure/`, linked from the footer). Governing law in the Terms is
   set to Wisconsin (the LLC's state of formation). Still needs the author's (and
   ideally a lawyer's) review before publishing, plus a real contact inbox at
   `hello@loveheatrelationship.com` — currently a placeholder in the drafts.
4. **SEO foundations** — sitemap.xml, robots.txt, Open Graph tags, canonical URLs, and
   the schema.org Recipe markup the original content-platform spec flagged but never
   built.
5. **Email capture / newsletter** — built: a ConvertKit-backed signup component lives
   in the site footer and on a new `/community/` "coming soon" page, per
   `docs/BRAND.md`'s Community page spec. It no-ops until the ConvertKit account/form
   manual step above is done — see `docs/DEPLOYMENT.md`.
6. **Error + uptime monitoring** — nothing currently alerts if the site breaks or a
   deploy fails silently.
7. **Analytics dashboard / conversion review** — once Umami is confirmed live, decide
   what "success" looks like (e.g. affiliate click-through rate) and set up a regular
   review; `analytics-reviewer` agent is ready for this once there's data.
8. **Community features** — forums, giveaways, raffles. `giveaway-compliance-checker`
   agent exists for the legal-risk side, but nothing is built yet.
9. **Content scale-up plan** — once ecommerce and design exist, filling out the
   ~26-posts/6-months cadence for real; `content-strategist` is ready for this.
