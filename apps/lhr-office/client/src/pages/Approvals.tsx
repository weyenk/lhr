import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type {
  AffiliateCandidate,
  CompetitorsResponse,
  RecipeCandidateSummary,
  SourcedProductCandidate,
  SourcedProductCycle,
  SourcedProductCycleResponse,
} from '../lib/types';

type RunAction = (action: () => Promise<unknown>, refetch: () => void) => Promise<void>;
type SourcedTab = 'brief' | 'pick' | 'monetize' | 'final';

const SOURCED_BASE = '/api/sourced-products';
const TAB_LABELS: Record<SourcedTab, string> = { brief: 'Brief', pick: 'Pick', monetize: 'Monetize', final: 'Final' };

function defaultTab(cycle: SourcedProductCycle): SourcedTab {
  switch (cycle.status) {
    case 'awaiting_product_picks':
      return 'pick';
    case 'awaiting_monetize_approval':
      return 'monetize';
    case 'awaiting_final':
      return 'final';
    default:
      return 'brief';
  }
}

function visibleTabs(cycle: SourcedProductCycle, candidates: SourcedProductCandidate[]): SourcedTab[] {
  const has = (status: SourcedProductCandidate['status']) => candidates.some((c) => c.status === status);
  const tabs: SourcedTab[] = ['brief'];
  if (cycle.status === 'awaiting_product_picks' || has('sourced')) tabs.push('pick');
  if (cycle.status === 'awaiting_monetize_approval' || has('monetize_pass')) tabs.push('monetize');
  if (cycle.status === 'awaiting_final' || has('pending_final')) tabs.push('final');
  return tabs;
}

function postJson(path: string, body: unknown) {
  return apiFetch(path, { method: 'POST', body: JSON.stringify(body) });
}

function SelectableCandidates({
  candidates,
  isChecked,
  toggle,
}: {
  candidates: SourcedProductCandidate[];
  isChecked: (id: number) => boolean;
  toggle: (id: number) => void;
}) {
  return (
    <ul>
      {candidates.map((c) => (
        <li key={c.id}>
          <label>
            <input type="checkbox" checked={isChecked(c.id)} onChange={() => toggle(c.id)} />
            {c.title}
          </label>{' '}
          <a href={c.sourceUrl} target="_blank" rel="noreferrer">
            {c.platform}
          </a>
          {c.monetizeRationale && <p>{c.monetizeRationale}</p>}
        </li>
      ))}
    </ul>
  );
}

function PickStage({ cycle, candidates, runAction, refetch }: { cycle: SourcedProductCycle; candidates: SourcedProductCandidate[]; runAction: RunAction; refetch: () => void }) {
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const pickIds = candidates.filter((c) => picked.has(c.id)).map((c) => c.id);
  const skipIds = candidates.filter((c) => !picked.has(c.id)).map((c) => c.id);
  return (
    <div>
      <SelectableCandidates candidates={candidates} isChecked={(id) => picked.has(id)} toggle={toggle} />
      <button
        disabled={pickIds.length === 0}
        onClick={() => runAction(() => postJson(`${SOURCED_BASE}/cycle/${cycle.id}/candidates/pick`, { pickIds, skipIds }), refetch)}
      >
        Advance selected
      </button>
    </div>
  );
}

function MonetizeStage({ cycle, candidates, runAction, refetch }: { cycle: SourcedProductCycle; candidates: SourcedProductCandidate[]; runAction: RunAction; refetch: () => void }) {
  // Monetize passes default to confirmed; the author unchecks the ones to drop.
  const [dropped, setDropped] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setDropped((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  const confirmIds = candidates.filter((c) => !dropped.has(c.id)).map((c) => c.id);
  const dropIds = candidates.filter((c) => dropped.has(c.id)).map((c) => c.id);
  return (
    <div>
      <SelectableCandidates candidates={candidates} isChecked={(id) => !dropped.has(id)} toggle={toggle} />
      <button
        disabled={cycle.status !== 'awaiting_monetize_approval'}
        onClick={() => runAction(() => postJson(`${SOURCED_BASE}/cycle/${cycle.id}/monetize/confirm`, { confirmIds, dropIds }), refetch)}
      >
        Confirm selected
      </button>
    </div>
  );
}

function SourcedProductsSection({ runAction }: { runAction: RunAction }) {
  const resource = useApiResource<SourcedProductCycleResponse>(`${SOURCED_BASE}/cycle`);
  const [chosenTab, setChosenTab] = useState<SourcedTab | null>(null);
  const cycle = resource.data?.cycle ?? null;
  const allCandidates = resource.data?.candidates ?? [];

  let body;
  if (!cycle) {
    body = <p>No open sourcing cycle</p>;
  } else {
    const tabs = visibleTabs(cycle, allCandidates);
    const preferred = chosenTab ?? defaultTab(cycle);
    const tab = tabs.includes(preferred) ? preferred : tabs[0];
    const inStatus = (status: SourcedProductCandidate['status']) => allCandidates.filter((c) => c.status === status);
    const criteria = cycle.criteriaJson;
    const sourced = inStatus('sourced');
    const passes = inStatus('monetize_pass');
    const pendingFinal = inStatus('pending_final');

    let stage;
    if (tab === 'brief') {
      stage = (
        <div>
          <ul aria-label="Search keywords">
            {(criteria?.keywords ?? []).map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
          {criteria?.aestheticNotes && <p>{criteria.aestheticNotes}</p>}
          {cycle.status === 'awaiting_criteria_approval' ? (
            <button onClick={() => runAction(() => apiFetch(`${SOURCED_BASE}/cycle/${cycle.id}/criteria/approve`, { method: 'POST' }), resource.refetch)}>
              Approve brief
            </button>
          ) : (
            <p>Status: {cycle.status}</p>
          )}
        </div>
      );
    } else if (tab === 'pick') {
      stage = sourced.length === 0 ? <p>Nothing at this stage</p> : <PickStage cycle={cycle} candidates={sourced} runAction={runAction} refetch={resource.refetch} />;
    } else if (tab === 'monetize') {
      stage = passes.length === 0 ? <p>Nothing at this stage</p> : <MonetizeStage cycle={cycle} candidates={passes} runAction={runAction} refetch={resource.refetch} />;
    } else {
      stage =
        pendingFinal.length === 0 ? (
          <p>Nothing at this stage</p>
        ) : (
          <ul>
            {pendingFinal.map((c) => (
              <li key={c.id}>
                <span>{c.title}</span>{' '}
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {c.platform}
                </a>
                <button aria-label={`Approve ${c.title}`} onClick={() => runAction(() => apiFetch(`${SOURCED_BASE}/candidates/${c.id}/approve`, { method: 'POST' }), resource.refetch)}>
                  Approve
                </button>
                <button aria-label={`Deny ${c.title}`} onClick={() => runAction(() => apiFetch(`${SOURCED_BASE}/candidates/${c.id}/deny`, { method: 'POST' }), resource.refetch)}>
                  Deny
                </button>
              </li>
            ))}
          </ul>
        );
    }

    body = (
      <>
        <div role="tablist">
          {tabs.map((t) => (
            <button key={t} role="tab" aria-selected={t === tab} onClick={() => setChosenTab(t)}>
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        {stage}
      </>
    );
  }

  return (
    <section>
      <h2>Sourced products</h2>
      {resource.error && <p role="alert">{resource.error}</p>}
      {body}
    </section>
  );
}

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

      <SourcedProductsSection runAction={runAction} />

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
