import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { AffiliateCandidate, CompetitorsResponse, RecipeCandidateSummary } from '../lib/types';

export function Approvals() {
  const recipeCandidate = useApiResource<RecipeCandidateSummary | null>('/api/candidates/recipe');
  const affiliateCandidates = useApiResource<AffiliateCandidate[]>('/api/candidates/affiliate');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<unknown>, refetch: () => void) {
    setActionError(null);
    try {
      await action();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const candidate = recipeCandidate.data;

  return (
    <div className="panel approvals-panel">
      <h1>Approvals</h1>
      {actionError && <p role="alert">{actionError}</p>}

      <section>
        <h2>Recipe candidate</h2>
        {recipeCandidate.error && <p role="alert">{recipeCandidate.error}</p>}
        {candidate ? (
          <div>
            <p>
              {candidate.record.source.title} — {candidate.record.source.cuisine} {candidate.record.source.category}
            </p>
            <button onClick={() => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/approve`, { method: 'POST' }), recipeCandidate.refetch)}>
              Approve
            </button>
            <button onClick={() => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/reroll`, { method: 'POST' }), recipeCandidate.refetch)}>
              Reroll
            </button>
          </div>
        ) : (
          <p>Nothing pending</p>
        )}
      </section>

      <section>
        <h2>Affiliate candidates</h2>
        {affiliateCandidates.error && <p role="alert">{affiliateCandidates.error}</p>}
        <ul>
          {(affiliateCandidates.data ?? []).map((c) => (
            <li key={c.id}>
              <span>{c.title}</span>
              <button onClick={() => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/approve`, { method: 'POST' }), affiliateCandidates.refetch)}>
                Approve
              </button>
              <button onClick={() => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/deny`, { method: 'POST' }), affiliateCandidates.refetch)}>
                Deny
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Competitor candidates</h2>
        {competitors.error && <p role="alert">{competitors.error}</p>}
        <ul>
          {(competitors.data?.candidates ?? []).map((c) => (
            <li key={c.id}>
              <span>{c.domain}</span>
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/${c.id}/approve`, { method: 'POST' }), competitors.refetch)}>
                Approve
              </button>
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/${c.id}/reject`, { method: 'POST' }), competitors.refetch)}>
                Reject
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
