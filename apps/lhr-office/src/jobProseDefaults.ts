/**
 * Inline/default persona + task-prompt strings for job runners and the tuning
 * catalog. Kept in a leaf module (no imports of resolveJobTuning / job modules)
 * so jobProseCatalog can reference them without creating a circular TDZ at boot.
 */

export const SUGGEST_TOPICS_PERSONA =
  'You suggest search topics for a Google Trends watch list. Reply with a JSON array of ' +
  'up to 2 short topic strings, nothing else.';

export const MONETIZATION_PERSONA =
  "You analyze a competitor recipe/kitchenware site's homepage text and produce a short, factual snapshot of its monetization and product strategy: what it sells or promotes, any visible price ranges, and any visible affiliate/ad programs or sponsorship disclosures. 2-4 sentences, no speculation beyond what the text shows.";

export const DESIGN_PERSONA =
  "You analyze a competitor site's homepage text (tags stripped, so infer structure from headings, nav labels, and link text) and produce a short, factual description of its apparent layout, prominent calls-to-action, and visual/content style. 2-4 sentences, no speculation beyond what the text shows.";

export const WEEKLY_SUMMARY_PERSONA =
  'Synthesize this week\'s changes for a tracked competitor into a short "what changed this week" summary (2-4 sentences), covering new content, SEO positions, monetization, and design where notable. Skip dimensions with no notable change.';

export const DECISION_PACKAGING_PERSONA =
  'Produce overlap scores and a decision brief for Love Heat Relationship (LHR) — a personal gluten-free / relationship-food recipe blog with kitchenware affiliate sets on ~26-post / 6-month cadence — vs one competitor. Reply with ONLY a JSON object (no markdown fences) of shape: {"market":0-100,"content":0-100,"product":0-100,"threat":0-100,"decisionBrief":"2-4 sentences for the author","suggestedActions":["1-5 concrete LHR-side actions"]}. market=shared audience/niche, content=editorial similarity, product=commerce/affiliate posture vs LHR kitchenware affiliates, threat=urgency to respond this cycle (blend of the three plus SEO presence and change intensity). Never invent traffic, revenue, or MAU. If a dimension is unreachable this cycle, lean on any prior snapshots provided and note thin evidence in decisionBrief.';

export const CRITERIA_TASK_PROMPT =
  `Draft a search brief for sourcing new kitchenware products for this site from wholesale marketplaces. ` +
  `Base it on the brand doc and on gaps in the current product catalog.\n\n` +
  `Reply with JSON only, exactly this shape:\n` +
  `{"keywords": string[] (1-6 short search phrases), ` +
  `"platforms": string[] (hostnames without scheme, e.g. "alibaba.com"), ` +
  `"aestheticNotes": string (free text for the product scout), ` +
  `"categoryHints": string[] (e.g. "serveware", "knives")}`;

export const ANNOTATE_TASK_PROMPT =
  `You are screening wholesale search hits for fit with this brief.\n\n` +
  `You only have each hit's title and URL. Do NOT invent MOQ, unit cost, or any other fact you cannot read ` +
  `from the title/URL — use null for anything unknown. Prefer null over a guess.\n\n` +
  `Reply with JSON only, exactly this shape:\n` +
  `{"annotations": [{"index": number, "notes": string|null (one short sentence on fit), ` +
  `"moq": string|null, "unitCostCents": number|null}]}`;

export const MONETIZE_TASK_PROMPT =
  `Judge each shortlisted wholesale product on wholesale sellability only: is there a realistic path to buying it ` +
  `at wholesale and reselling it profitably (unit cost vs. a plausible retail price, MOQ vs. a small shop's budget, ` +
  `supplier reliability signals, shipping and fragility)? Do not consider affiliate programs or commissions.\n` +
  `Use only the facts given; where MOQ or cost is null, say it is unknown rather than guessing.\n\n` +
  `Reply with JSON only, exactly this shape, with one entry for every candidate id:\n` +
  `{"results": [{"id": number, "pass": boolean, "rationale": string (one or two sentences)}]}`;

export const BRAND_TASK_PROMPT =
  `Judge whether each shortlisted product fits this site's brand and design language (palette, materials, ` +
  `shape, overall aesthetic) as described in the brand doc. You only have a title, source URL, and notes — ` +
  `do not invent visual details you cannot infer from them.\n\n` +
  `Reply with JSON only, exactly this shape, with one entry for every candidate id:\n` +
  `{"results": [{"id": number, "pass": boolean, "rationale": string (one or two sentences)}]}`;
