CREATE TABLE orchestrator_runs (
  id SERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,          -- 'running' | 'success' | 'partial' | 'failure'
  summary TEXT,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE INDEX orchestrator_runs_job_name_status_idx
  ON orchestrator_runs (job_name, status, started_at DESC);

-- Weekly affiliate-product sourcing candidates awaiting (or past) human review — written by the
-- 'affiliate-sourcing' job and decided on from apps/lhr-office's /status page.
CREATE TABLE candidates (
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
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'denied'
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs insertCandidates' ON CONFLICT (cycle_id, asin) DO NOTHING, so a re-run of the sourcing
-- job within the same ISO week never duplicates a candidate.
CREATE UNIQUE INDEX candidates_cycle_id_asin_key ON candidates (cycle_id, asin);

-- Every approve/deny the author makes, kept permanently: it both excludes an ASIN from future
-- cycles and feeds the preference-learning scorer in scoring.ts.
CREATE TABLE decision_history (
  id SERIAL PRIMARY KEY,
  asin TEXT NOT NULL,
  category TEXT NOT NULL,
  price_cents INTEGER NOT NULL,
  commission_rate NUMERIC NOT NULL,
  estimated_monthly_sales INTEGER,
  decision TEXT NOT NULL,        -- 'approved' | 'denied'
  decided_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
