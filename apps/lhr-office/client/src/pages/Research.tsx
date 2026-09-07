import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { CompetitorSeoKeyword, CompetitorsResponse, TrendCategory, TrendsResponse } from '../lib/types';

const TREND_CATEGORIES: TrendCategory[] = ['web-design', 'cooking', 'nutrition'];

export function Research() {
  const trends = useApiResource<TrendsResponse>('/api/trends');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const keywords = useApiResource<CompetitorSeoKeyword[]>('/api/competitors/keywords');
  const [newTopic, setNewTopic] = useState('');
  const [newTopicCategory, setNewTopicCategory] = useState<TrendCategory>('cooking');
  const [newKeyword, setNewKeyword] = useState('');
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

  async function handleAddTopic(e: FormEvent) {
    e.preventDefault();
    await runAction(
      () => apiFetch('/api/trends/topics', { method: 'POST', body: JSON.stringify({ category: newTopicCategory, topic: newTopic }) }),
      trends.refetch,
    );
    setNewTopic('');
  }

  async function handleAddKeyword(e: FormEvent) {
    e.preventDefault();
    await runAction(() => apiFetch('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: newKeyword }) }), keywords.refetch);
    setNewKeyword('');
  }

  return (
    <div className="panel research-panel">
      <h1>Research</h1>
      {actionError && <p role="alert">{actionError}</p>}

      <section>
        <h2>Trend topics</h2>
        <ul>
          {(trends.data?.topics ?? []).map((topic) => (
            <li key={topic.id}>
              <span>
                {topic.category}: {topic.topic} ({topic.status})
              </span>
              {topic.status === 'candidate' ? (
                <button onClick={() => runAction(() => apiFetch(`/api/trends/topics/${topic.id}/promote`, { method: 'POST' }), trends.refetch)}>
                  Promote
                </button>
              ) : (
                <button onClick={() => runAction(() => apiFetch(`/api/trends/topics/${topic.id}/demote`, { method: 'POST' }), trends.refetch)}>
                  Demote
                </button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddTopic}>
          <select value={newTopicCategory} onChange={(e) => setNewTopicCategory(e.target.value as TrendCategory)}>
            {TREND_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" required />
          <button type="submit">Add topic</button>
        </form>
        <h3>Reports</h3>
        <ul>
          {(trends.data?.reports ?? []).map((report) => (
            <li key={report.id}>
              {report.category}: {report.summary}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Tracked competitors</h2>
        <ul>
          {(competitors.data?.tracked ?? []).map((c) => (
            <li key={c.id}>
              {c.domain}
              {competitors.data?.latestReportsByCompetitorId[c.id] && <span> — {competitors.data.latestReportsByCompetitorId[c.id].summary}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>SEO keywords</h2>
        <ul>
          {(keywords.data ?? []).map((k) => (
            <li key={k.id}>
              {k.keyword}
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/keywords/${k.id}`, { method: 'DELETE' }), keywords.refetch)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddKeyword}>
          <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="New keyword" required />
          <button type="submit">Add keyword</button>
        </form>
      </section>
    </div>
  );
}
