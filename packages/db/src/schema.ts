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

export const OFFICE_ADMINS_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS office_admins (
  id SERIAL PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by INTEGER REFERENCES office_admins(id)
);
`;
