import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { DecisionRow } from '../components/approvals/DecisionRow';
import { QueueEmpty } from '../components/approvals/QueueEmpty';
import { TypeTabBar } from '../components/approvals/TypeTabBar';
import { countSourcedActionable } from '../lib/sourcedActionable';
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
type ApprovalType = 'recipe' | 'affiliate' | 'sourced' | 'competitors';
type SourcedResource = ReturnType<typeof useApiResource<SourcedProductCycleResponse>>;

const SOURCED_BASE = '/api/sourced-products';
const TAB_LABELS: Record<SourcedTab, string> = { brief: 'Brief', pick: 'Pick', monetize: 'Monetize', final: 'Final' };
const TYPE_LABELS: Record<ApprovalType, string> = { recipe: 'Recipe', affiliate: 'Affiliate', sourced: 'Sourced', competitors: 'Competitors' };
const TYPE_ORDER: ApprovalType[] = ['recipe', 'affiliate', 'sourced', 'competitors'];

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
    <ul className="decision-list">
      {candidates.map((c) => (
        <li key={c.id} className="decision-row">
          <div className="decision-row-body">
            <label>
              <input type="checkbox" checked={isChecked(c.id)} onChange={() => toggle(c.id)} />
              {c.title}
            </label>
            <span className="decision-row-meta">
              <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                {c.platform}
              </a>
              {c.monetizeRationale && <span> — {c.monetizeRationale}</span>}
            </span>
          </div>
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

function SourcedPane({ resource, runAction }: { resource: SourcedResource; runAction: RunAction }) {
  const [chosenTab, setChosenTab] = useState<SourcedTab | null>(null);
  const cycle = resource.data?.cycle ?? null;
  const allCandidates = resource.data?.candidates ?? [];

  if (!cycle) return <QueueEmpty>No open sourcing cycle</QueueEmpty>;

  const tabs = visibleTabs(cycle, allCandidates);
  const preferred = chosenTab ?? defaultTab(cycle);
  const tab = tabs.includes(preferred) ? preferred : tabs[0];
  const inStatus = (status: SourcedProductCandidate['status']) => allCandidates.filter((c) => c.status === status);
  const criteria = cycle.criteriaJson;
  const sourced = inStatus('sourced');
  const passes = inStatus('monetize_pass');
  const pendingFinal = inStatus('pending_final');
  const none = <QueueEmpty>Nothing at this stage</QueueEmpty>;

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
          <button onClick={() => runAction(() => apiFetch(`${SOURCED_BASE}/cycle/${cycle.id}/criteria/approve`, { method: 'POST' }), resource.refetch)}>Approve brief</button>
        ) : (
          <p>Status: {cycle.status}</p>
        )}
      </div>
    );
  } else if (tab === 'pick') {
    stage = sourced.length === 0 ? none : <PickStage cycle={cycle} candidates={sourced} runAction={runAction} refetch={resource.refetch} />;
  } else if (tab === 'monetize') {
    stage = passes.length === 0 ? none : <MonetizeStage cycle={cycle} candidates={passes} runAction={runAction} refetch={resource.refetch} />;
  } else {
    stage =
      pendingFinal.length === 0 ? (
        none
      ) : (
        <ul className="decision-list">
          {pendingFinal.map((c) => (
            <DecisionRow
              key={c.id}
              title={c.title}
              meta={
                <a href={c.sourceUrl} target="_blank" rel="noreferrer">
                  {c.platform}
                </a>
              }
              primary={{
                label: 'Approve',
                ariaLabel: `Approve ${c.title}`,
                onClick: () => runAction(() => apiFetch(`${SOURCED_BASE}/candidates/${c.id}/approve`, { method: 'POST' }), resource.refetch),
              }}
              secondary={{
                label: 'Deny',
                ariaLabel: `Deny ${c.title}`,
                onClick: () => runAction(() => apiFetch(`${SOURCED_BASE}/candidates/${c.id}/deny`, { method: 'POST' }), resource.refetch),
              }}
            />
          ))}
        </ul>
      );
  }

  return (
    <>
      <TypeTabBar nested ariaLabel="Sourcing stages" tabs={tabs.map((t) => ({ id: t, label: TAB_LABELS[t] }))} active={tab} onChange={setChosenTab} />
      {stage}
    </>
  );
}

export function Approvals() {
  const recipeCandidate = useApiResource<RecipeCandidateSummary | null>('/api/candidates/recipe');
  const affiliateCandidates = useApiResource<AffiliateCandidate[]>('/api/candidates/affiliate');
  const sourced = useApiResource<SourcedProductCycleResponse>(`${SOURCED_BASE}/cycle`);
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const [actionError, setActionError] = useState<string | null>(null);
  const [chosenType, setChosenType] = useState<ApprovalType | null>(null);

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
  const affiliates = affiliateCandidates.data ?? [];
  const competitorCandidates = competitors.data?.candidates ?? [];

  const counts: Record<ApprovalType, number> = {
    recipe: candidate ? 1 : 0,
    affiliate: affiliates.length,
    sourced: countSourcedActionable(sourced.data),
    competitors: competitorCandidates.length,
  };
  // An explicit choice sticks; until then, land on the first type with work (recipe if none).
  const activeType = chosenType ?? TYPE_ORDER.find((t) => counts[t] > 0) ?? 'recipe';

  let pane;
  if (activeType === 'recipe') {
    pane = candidate ? (
      <ul className="decision-list">
        <DecisionRow
          title={`${candidate.record.source.title} — ${candidate.record.source.cuisine} ${candidate.record.source.category}`}
          primary={{ label: 'Approve', onClick: () => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/approve`, { method: 'POST' }), recipeCandidate.refetch) }}
          secondary={{ label: 'Reroll', onClick: () => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/reroll`, { method: 'POST' }), recipeCandidate.refetch) }}
        />
      </ul>
    ) : (
      <QueueEmpty />
    );
  } else if (activeType === 'affiliate') {
    pane =
      affiliates.length === 0 ? (
        <QueueEmpty />
      ) : (
        <ul className="decision-list">
          {affiliates.map((c) => (
            <DecisionRow
              key={c.id}
              title={c.title}
              primary={{ label: 'Approve', onClick: () => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/approve`, { method: 'POST' }), affiliateCandidates.refetch) }}
              secondary={{ label: 'Deny', onClick: () => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/deny`, { method: 'POST' }), affiliateCandidates.refetch) }}
            />
          ))}
        </ul>
      );
  } else if (activeType === 'sourced') {
    pane = <SourcedPane resource={sourced} runAction={runAction} />;
  } else {
    pane =
      competitorCandidates.length === 0 ? (
        <QueueEmpty />
      ) : (
        <ul className="decision-list">
          {competitorCandidates.map((c) => (
            <DecisionRow
              key={c.id}
              title={c.domain}
              primary={{ label: 'Approve', onClick: () => runAction(() => apiFetch(`/api/competitors/${c.id}/approve`, { method: 'POST' }), competitors.refetch) }}
              secondary={{ label: 'Reject', onClick: () => runAction(() => apiFetch(`/api/competitors/${c.id}/reject`, { method: 'POST' }), competitors.refetch) }}
            />
          ))}
        </ul>
      );
  }

  return (
    <div className="panel approvals-panel approvals-workshop">
      <h1>Approvals</h1>
      {actionError && <p role="alert">{actionError}</p>}
      {recipeCandidate.error && <p role="alert">{recipeCandidate.error}</p>}
      {affiliateCandidates.error && <p role="alert">{affiliateCandidates.error}</p>}
      {sourced.error && <p role="alert">{sourced.error}</p>}
      {competitors.error && <p role="alert">{competitors.error}</p>}

      <TypeTabBar
        ariaLabel="Approval types"
        tabs={TYPE_ORDER.map((t) => ({ id: t, label: TYPE_LABELS[t], count: counts[t] }))}
        active={activeType}
        onChange={setChosenType}
      />
      <section role="tabpanel">{pane}</section>
    </div>
  );
}
