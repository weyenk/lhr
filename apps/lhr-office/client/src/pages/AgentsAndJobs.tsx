import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import type { JobStatusRow } from '../lib/types';

export function AgentsAndJobs() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  usePolling(jobs.refetch, 5000);

  async function runNow(jobName: string) {
    await apiFetch(`/api/jobs/${jobName}/run`, { method: 'POST' });
    jobs.refetch();
  }

  return (
    <div className="panel agents-jobs-panel">
      <h1>Agents &amp; Jobs</h1>
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
