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
