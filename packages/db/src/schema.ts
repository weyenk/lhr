export const CANDIDATES_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS candidates (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  asin TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  image_url TEXT NOT NULL,
  product_url TEXT NOT NULL,
  commission_rate NUMERIC NOT NULL,
  commission_rate_is_fallback BOOLEAN NOT NULL DEFAULT FALSE,
  estimated_monthly_sales INTEGER,
  bsr INTEGER,
  bsr_category TEXT,
  rating NUMERIC,
  review_count INTEGER,
  score NUMERIC NOT NULL,
  is_wildcard BOOLEAN NOT NULL DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const DECISION_HISTORY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS decision_history (
  id SERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_rate NUMERIC NOT NULL,
  estimated_monthly_sales INTEGER,
  decision TEXT NOT NULL,
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

export const CANDIDATES_CYCLE_ASIN_UNIQUE_INDEX_SQL = `
CREATE UNIQUE INDEX IF NOT EXISTS candidates_cycle_id_asin_key ON candidates (cycle_id, asin);
`;

export const PRODUCT_PLACEMENT_PROPOSALS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS product_placement_proposals (
  id SERIAL PRIMARY KEY,
  cycle_id TEXT NOT NULL,
  affiliate_link_id TEXT NOT NULL,
  post_slug TEXT NOT NULL,
  target_image_kind TEXT NOT NULL,
  target_image_url TEXT NOT NULL,
  target_image_line TEXT,
  match_rationale TEXT NOT NULL,
  composited_image_url TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
