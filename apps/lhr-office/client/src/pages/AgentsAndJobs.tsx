import { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import { deriveChains, type Chain, type ChainGateStage, type ChainJobStage } from '../lib/jobChains';
import type { JobStatusRow, JobTuningSaveResponse, SourcedProductCycleResponse } from '../lib/types';

type PageView = 'chains' | 'jobs';
type JobPanel = 'runs' | 'tune';

interface RelatedKnob {
  label: string;
  href: string;
}

const JOB_GROUPS: { key: string; label: string; jobs: string[] }[] = [
  {
    key: 'sourcing',
    label: 'Product sourcing chain',
    jobs: ['product-sourcing-criteria', 'product-sourcing-search', 'product-sourcing-monetize', 'product-sourcing-brand'],
  },
  { key: 'recipe', label: 'Recipe variants', jobs: ['recipe-variant-generator', 'recipe-variant-finisher'] },
  { key: 'research', label: 'Research', jobs: ['trends-watcher', 'competitor-analysis'] },
];

const RELATED_KNOBS: Record<string, RelatedKnob[]> = {
  'recipe-variant-generator': [{ label: 'Approvals → recipe candidates', href: '/approvals' }],
  'recipe-variant-finisher': [],
  'trends-watcher': [{ label: 'Research → seed topics & digests', href: '/research' }],
  'competitor-analysis': [{ label: 'Research → competitors', href: '/research' }],
  'product-sourcing-criteria': [{ label: 'Approvals → criteria gate', href: '/approvals' }],
  'product-sourcing-search': [{ label: 'Approvals → product picks', href: '/approvals' }],
  'product-sourcing-monetize': [{ label: 'Approvals → monetize gate', href: '/approvals' }],
  'product-sourcing-brand': [{ label: 'Approvals → final gate', href: '/approvals' }],
};

type PillKind = 'ok' | 'partial' | 'fail' | 'run' | 'idle';

function jobPill(job: JobStatusRow): PillKind {
  const latest = job.history[0];
  if (!latest) return 'idle';
  if (latest.status === 'running') return 'run';
  if (latest.status === 'success') return 'ok';
  if (latest.status === 'partial') return 'partial';
  if (latest.status === 'failure') return 'fail';
  return 'idle';
}

function GateLink({ gate }: { gate: ChainGateStage }) {
  const href = gate.gate === 'none' ? null : '/approvals';
  return (
    <div className={`chain-gate ${gate.gateState}`} title={gate.note}>
      {href ? (
        <a className="chain-gate-link" href={href}>
          <span className="chain-gate-arrow" aria-hidden="true" />
          <span className="chain-gate-chip">{gate.gate} → Approvals</span>
        </a>
      ) : (
        <>
          <span className="chain-gate-arrow" aria-hidden="true" />
          <span className="chain-gate-chip">{gate.gate}</span>
        </>
      )}
    </div>
  );
}

function ChainCard({ chain, onSelectJob }: { chain: Chain; onSelectJob: (jobName: string) => void }) {
  let stepNumber = 0;
  return (
    <article className={`chain-card${chain.active ? ' active-cycle' : ''}`}>
      <div className="chain-top">
        <h3>{chain.title}</h3>
        <span className="chain-meta">{chain.meta}</span>
      </div>
      <p className="chain-blurb">{chain.blurb}</p>
      <div className="chain-flow">
        {chain.stages.map((stage, idx) => {
          if (stage.kind === 'job') {
            stepNumber += 1;
            const jobStage = stage as ChainJobStage;
            return (
              <button
                type="button"
                key={`${jobStage.job}-${idx}`}
                className={`chain-node ${jobStage.state}`}
                onClick={() => onSelectJob(jobStage.job)}
              >
                <div className="chain-node-step">stage {stepNumber}</div>
                <div className="chain-node-job">{jobStage.job}</div>
                <div className="chain-node-state">{jobStage.label}</div>
              </button>
            );
          }
          return <GateLink key={`gate-${idx}`} gate={stage as ChainGateStage} />;
        })}
      </div>
      <div className="chain-footer">{chain.footer}</div>
    </article>
  );
}

function ChainsView({
  jobs,
  cycle,
  onSelectJob,
}: {
  jobs: JobStatusRow[];
  cycle: SourcedProductCycleResponse | null;
  onSelectJob: (jobName: string) => void;
}) {
  const chains = deriveChains(jobs, cycle);
  return (
    <section className="chains-view">
      <div className="chain-legend">
        <span className="l-done">done</span>
        <span className="l-current">current stage</span>
        <span className="l-wait">waiting on gate</span>
        <span className="l-blocked">blocked / not yet</span>
      </div>
      <div className="chains-list">
        {chains.map((chain) => (
          <ChainCard key={chain.id} chain={chain} onSelectJob={onSelectJob} />
        ))}
      </div>
    </section>
  );
}

function JobRail({
  jobs,
  selectedJobName,
  onSelect,
}: {
  jobs: JobStatusRow[];
  selectedJobName: string | null;
  onSelect: (jobName: string) => void;
}) {
  const byName = new Map(jobs.map((j) => [j.name, j]));
  return (
    <nav className="job-rail" aria-label="Job rail">
      {JOB_GROUPS.map((group) => (
        <div key={group.key}>
          <div className="job-rail-group-label">{group.label}</div>
          {group.jobs.map((jobName) => {
            const job = byName.get(jobName);
            if (!job) return null;
            const selected = job.name === selectedJobName;
            return (
              <button
                key={job.name}
                type="button"
                className={selected ? 'on' : undefined}
                aria-pressed={selected}
                onClick={() => onSelect(job.name)}
              >
                <span className="job-rail-name">{job.name}</span>
                <span className="job-rail-meta">
                  <span className="job-rail-cadence">every {job.cadenceDays}d</span>
                  <span className={`status-pill ${jobPill(job)}`}>{jobPill(job)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </nav>
  );
}

function RunsPanel({ job }: { job: JobStatusRow }) {
  return (
    <div className="runs-panel">
      {job.history.length === 0 ? (
        <p className="board-intro">No runs recorded yet.</p>
      ) : (
        <ul className="run-log">
          {job.history.map((run) => (
            <li key={run.id} className={`run-log-row ${run.status}`}>
              <span className="run-log-status">{run.status}</span>
              <span className="run-log-summary">{run.summary ?? run.errorMessage ?? ''}</span>
              <span className="run-log-at">{run.startedAt}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TunePanel({ job, onSaved }: { job: JobStatusRow; onSaved: () => void }) {
  const editableProse = job.prose.filter((p) => p.editable);
  const [cadence, setCadence] = useState(job.cadenceDays);
  const [proseDrafts, setProseDrafts] = useState<Record<string, string>>(
    Object.fromEntries(editableProse.map((p) => [p.id, p.text])),
  );
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await apiFetch<JobTuningSaveResponse>(`/api/jobs/${job.name}/tuning`, {
        method: 'PATCH',
        body: JSON.stringify({ cadenceDays: cadence, prose: proseDrafts }),
      });
      setDirty(false);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function resetDrafts() {
    setCadence(job.cadenceDays);
    setProseDrafts(Object.fromEntries(editableProse.map((p) => [p.id, p.text])));
    setDirty(false);
  }

  const related = RELATED_KNOBS[job.name] ?? [];

  return (
    <div className="tune-grid">
      {error && <p role="alert">{error}</p>}
      <div className="tune-card">
        <h3>Schedule</h3>
        <p className="tune-blurb">
          Orchestrator due cadence. Registry default is every {job.defaultCadenceDays} day(s).
        </p>
        <label className="tune-field">
          <span>Cadence (days)</span>
          <input
            type="number"
            min={1}
            max={90}
            value={cadence}
            onChange={(e) => {
              setCadence(Number(e.target.value));
              setDirty(true);
            }}
          />
        </label>
      </div>

      <div className="tune-card">
        <h3>Agent prose</h3>
        <p className="tune-blurb">Personas &amp; prompt scaffolds sent to the LLM.</p>
        {job.prose.length === 0 ? (
          <p className="tune-blurb">No LLM prose on this job.</p>
        ) : (
          <div className="prose-list">
            {job.prose.map((entry) => (
              <details key={entry.id} className="prose-item">
                <summary>
                  {entry.title}
                  <span className={`src-badge ${entry.source}`}>{entry.source === 'repo' ? 'repo .md' : 'inline'}</span>
                </summary>
                <div className="prose-body">
                  {entry.note && <p>{entry.note}</p>}
                  <label>
                    {entry.title}
                    <textarea
                      readOnly={!entry.editable}
                      value={entry.editable ? proseDrafts[entry.id] ?? entry.text : entry.text}
                      onChange={(e) => {
                        if (!entry.editable) return;
                        setProseDrafts((prev) => ({ ...prev, [entry.id]: e.target.value }));
                        setDirty(true);
                      }}
                    />
                  </label>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>

      {related.length > 0 && (
        <div className="tune-card">
          <h3>Related knobs</h3>
          <p className="tune-blurb">Already editable on Research / Approvals.</p>
          <div className="related-chips">
            {related.map((knob) => (
              <a key={knob.label} className="chip" href={knob.href}>
                {knob.label}
              </a>
            ))}
          </div>
        </div>
      )}

      <div className="save-bar">
        <button type="button" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </button>
        <button type="button" className="ghost-btn" onClick={resetDrafts} disabled={!dirty}>
          Reset
        </button>
        {dirty && <span className="dirty-flag">unsaved edits</span>}
      </div>
    </div>
  );
}

function JobPane({
  job,
  onRunNow,
}: {
  job: JobStatusRow;
  onRunNow: (jobName: string) => void;
}) {
  const [panel, setPanel] = useState<JobPanel>('runs');

  return (
    <div className="job-pane">
      <div className="job-pane-header">
        <h2>{job.name}</h2>
        <span className={`status-pill ${jobPill(job)}`}>{jobPill(job)}</span>
        <div className="job-pane-actions">
          <button type="button" onClick={() => onRunNow(job.name)}>
            Run now
          </button>
        </div>
      </div>
      <div className="workshop-tabs job-subtabs" role="tablist" aria-label="Job panel">
        <button type="button" role="tab" aria-selected={panel === 'runs'} className={panel === 'runs' ? 'on' : undefined} onClick={() => setPanel('runs')}>
          Runs
        </button>
        <button type="button" role="tab" aria-selected={panel === 'tune'} className={panel === 'tune' ? 'on' : undefined} onClick={() => setPanel('tune')}>
          Tune
        </button>
      </div>
      {panel === 'runs' ? (
        <RunsPanel job={job} />
      ) : (
        <TunePanel key={job.name} job={job} onSaved={() => undefined} />
      )}
    </div>
  );
}

export function AgentsAndJobs() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  usePolling(jobs.refetch, 5000);

  const cycle = useApiResource<SourcedProductCycleResponse>('/api/sourced-products/cycle');
  usePolling(cycle.refetch, 5000);

  const [view, setView] = useState<PageView>('chains');
  const [selectedJobName, setSelectedJobName] = useState<string | null>(null);

  const jobRows = jobs.data ?? [];

  useEffect(() => {
    if (selectedJobName === null && jobRows.length > 0) {
      setSelectedJobName(jobRows[0].name);
    }
  }, [selectedJobName, jobRows]);

  function goToJob(jobName: string) {
    setSelectedJobName(jobName);
    setView('jobs');
  }

  async function runNow(jobName: string) {
    await apiFetch(`/api/jobs/${jobName}/run`, { method: 'POST' });
    jobs.refetch();
  }

  const selectedJob = jobRows.find((j) => j.name === selectedJobName) ?? null;

  return (
    <div className="panel agents-jobs-panel agents-jobs-workshop">
      <h1>Agents &amp; Jobs</h1>
      {jobs.error && <p role="alert">{jobs.error}</p>}
      {cycle.error && <p role="alert">{cycle.error}</p>}

      <div className="workshop-tabs" role="tablist" aria-label="Agents & Jobs views">
        <button type="button" role="tab" aria-selected={view === 'chains'} className={view === 'chains' ? 'on' : undefined} onClick={() => setView('chains')}>
          Chains
        </button>
        <button type="button" role="tab" aria-selected={view === 'jobs'} className={view === 'jobs' ? 'on' : undefined} onClick={() => setView('jobs')}>
          Jobs
        </button>
      </div>

      {view === 'chains' && <ChainsView jobs={jobRows} cycle={cycle.data ?? null} onSelectJob={goToJob} />}

      {view === 'jobs' && (
        <div className="jobs-view">
          <JobRail jobs={jobRows} selectedJobName={selectedJobName} onSelect={setSelectedJobName} />
          {selectedJob ? (
            <JobPane job={selectedJob} onRunNow={runNow} />
          ) : (
            <div className="job-pane">
              <p className="board-intro">No jobs registered.</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
