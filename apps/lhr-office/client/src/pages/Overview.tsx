import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import type { AffiliateCandidate, CompetitorsResponse, JobStatusRow, RecipeCandidateSummary } from '../lib/types';

export function Overview() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  const recipeCandidate = useApiResource<RecipeCandidateSummary | null>('/api/candidates/recipe');
  const affiliateCandidates = useApiResource<AffiliateCandidate[]>('/api/candidates/affiliate');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');

  usePolling(jobs.refetch, 5000);

  const pendingCount =
    (recipeCandidate.data ? 1 : 0) + (affiliateCandidates.data?.length ?? 0) + (competitors.data?.candidates.length ?? 0);

  const activity = (jobs.data ?? [])
    .flatMap((job) => job.history)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 10);

  return (
    <div className="panel overview-panel">
      <h1>Overview</h1>
      {jobs.error && <p role="alert">{jobs.error}</p>}
      <p>{pendingCount} item(s) awaiting a decision</p>
      {recipeCandidate.error && <p role="alert">{recipeCandidate.error}</p>}
      {affiliateCandidates.error && <p role="alert">{affiliateCandidates.error}</p>}
      {competitors.error && <p role="alert">{competitors.error}</p>}
      <section className="job-health-strip">
        {(jobs.data ?? []).map((job) => {
          const latest = job.history[0];
          return (
            <div key={job.name} className="job-health-card">
              <h2>{job.name}</h2>
              <p>Cadence: every {job.cadenceDays} day(s)</p>
              <p>{latest ? `${latest.status} — ${latest.finishedAt ?? 'in progress'}` : 'Never run'}</p>
            </div>
          );
        })}
      </section>
      <section className="activity-feed">
        <h2>Recent activity</h2>
        <ul>
          {activity.map((run) => (
            <li key={`${run.jobName}-${run.id}`}>
              {run.jobName}: {run.status} ({run.startedAt})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
