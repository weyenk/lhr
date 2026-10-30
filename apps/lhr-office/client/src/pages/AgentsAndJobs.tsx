import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import type { BridgeJob, JobStatusRow } from '../lib/types';

export function AgentsAndJobs() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  usePolling(jobs.refetch, 5000);

  const bridge = useApiResource<{ jobs: BridgeJob[] }>('/api/bridge/jobs');
  usePolling(bridge.refetch, 5000);

  const [goal, setGoal] = useState('');
  const [repoKey, setRepoKey] = useState<'lhr' | 'ecff'>('lhr');
  const [submitError, setSubmitError] = useState<string | null>(null);

  async function enqueueStudio(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    try {
      await apiFetch('/api/bridge/jobs', {
        method: 'POST',
        body: JSON.stringify({ goal, repo_key: repoKey }),
      });
      setGoal('');
      bridge.refetch();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    }
  }

  async function runNow(jobName: string) {
    await apiFetch(`/api/jobs/${jobName}/run`, { method: 'POST' });
    jobs.refetch();
  }

  return (
    <div className="panel agents-jobs-panel">
      <h1>Agents &amp; Jobs</h1>
      <section className="job-card">
        <h2>Studio (Mac)</h2>
        <form onSubmit={enqueueStudio}>
          <label>
            Goal
            <textarea value={goal} onChange={(e) => setGoal(e.target.value)} required />
          </label>
          <label>
            Repo
            <select value={repoKey} onChange={(e) => setRepoKey(e.target.value as 'lhr' | 'ecff')}>
              <option value="lhr">lhr</option>
              <option value="ecff">ecff</option>
            </select>
          </label>
          <button type="submit">Submit</button>
        </form>
        {submitError && <p role="alert">{submitError}</p>}
        {bridge.error && <p role="alert">{bridge.error}</p>}
        <ul>
          {(bridge.data?.jobs ?? []).map((job) => (
            <li key={job.id}>
              <strong>{job.status}</strong> — {job.payload.goal ?? ''}
              {job.status === 'done' && job.result?.final_answer && <p>{job.result.final_answer}</p>}
              {job.status === 'failed' && job.error_message && <p role="alert">{job.error_message}</p>}
            </li>
          ))}
        </ul>
      </section>
      {jobs.error && <p role="alert">{jobs.error}</p>}
      {(jobs.data ?? []).map((job) => (
        <section key={job.name} className="job-card">
          <h2>{job.name}</h2>
          <p>Cadence: every {job.cadenceDays} day(s)</p>
          <button onClick={() => runNow(job.name)}>Run now</button>
          <ul>
            {job.history.map((run) => (
              <li key={run.id}>
                {run.status} — {run.summary ?? run.errorMessage ?? ''} ({run.startedAt})
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
