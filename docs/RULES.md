# LHR Rules

These rules can evolve, but an agent should only drift a little from them before asking the user for explicit permission to change course.

1. Tech stack is Astro + Vercel + Umami — don't swap frameworks/hosting/analytics tooling without asking first.
2. Repo content structure (`content/posts`, `content/products`, `content/affiliate-links`, `content/sets`) is the convention to follow.
3. MCP tool names/contracts (`start_post`, `attach_photo`, `link_kitchenware`, `add_affiliate_link`, `confirm_and_publish`, `start_new_set`) are the established interface — extend rather than rename without discussion.
4. The ~26-posts/6-months set cadence is the default assumption, not a hard limit — an agent can suggest adjusting it but should confirm with the author before changing the pattern.
5. Post frontmatter schema (type, title, date, cover photo + alt, linked kitchenware, linked affiliate links, plus recipe-only ingredients/steps) is the standard shape for new posts.
