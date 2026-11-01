import type { JobStatusRow, SourcedProductCycleResponse, SourcedProductCycleStatus } from './types';

export type ChainNodeState = 'done' | 'current' | 'blocked';
export type ChainGateState = 'passed' | 'waiting' | 'idle';

export interface ChainJobStage {
  kind: 'job';
  job: string;
  state: ChainNodeState;
  label: string;
}

export interface ChainGateStage {
  kind: 'gate';
  gate: string;
  gateState: ChainGateState;
  note: string;
}

export type ChainStage = ChainJobStage | ChainGateStage;

export interface Chain {
  id: string;
  title: string;
  /** True while the chain has real in-progress work right now (an open, non-closed cycle). */
  active: boolean;
  meta: string;
  blurb: string;
  footer: string;
  stages: ChainStage[];
}

function latestHistoryStatus(jobs: JobStatusRow[], jobName: string): string | null {
  return jobs.find((j) => j.name === jobName)?.history[0]?.status ?? null;
}

function jobLabel(state: ChainNodeState, latest: string | null): string {
  if (state === 'blocked') return 'blocked';
  if (latest === 'running') return 'running';
  if (state === 'done') return latest ? `last: ${latest}` : 'done';
  return latest ? `current · last ${latest}` : 'current';
}

const CYCLE_ORDER: SourcedProductCycleStatus[] = [
  'drafting_criteria',
  'awaiting_criteria_approval',
  'searching',
  'awaiting_product_picks',
  'monetizing',
  'awaiting_monetize_approval',
  'branding',
  'awaiting_final',
  'closed',
];

function orderIndex(status: SourcedProductCycleStatus): number {
  return CYCLE_ORDER.indexOf(status);
}

const SOURCING_JOB = {
  criteria: 'product-sourcing-criteria',
  search: 'product-sourcing-search',
  monetize: 'product-sourcing-monetize',
  brand: 'product-sourcing-brand',
} as const;

function footerForStatus(status: SourcedProductCycleStatus): string {
  switch (status) {
    case 'drafting_criteria':
      return 'Current stage: drafting search criteria.';
    case 'awaiting_criteria_approval':
      return 'Current gate: criteria approval on Approvals.';
    case 'searching':
      return 'Current stage: searching wholesale marketplaces.';
    case 'awaiting_product_picks':
      return 'Current gate: product picks on Approvals — search finished, monetize/brand blocked.';
    case 'monetizing':
      return 'Current stage: checking wholesale sellability.';
    case 'awaiting_monetize_approval':
      return 'Current gate: monetize approval on Approvals.';
    case 'branding':
      return 'Current stage: checking brand fit.';
    case 'awaiting_final':
      return 'Current gate: final approval on Approvals.';
    case 'closed':
      return 'Cycle closed — product-sourcing-criteria starts the next one on its next due run.';
    default:
      return '';
  }
}

function sourcingChainBlurb(): string {
  return (
    'One open cycle at a time. Each job only runs when the cycle is in its stage; human gates ' +
    '(and trust auto-clears) unlock the next.'
  );
}

function blockedSourcingChain(jobs: JobStatusRow[]): Chain {
  return {
    id: 'product-sourcing',
    title: 'Product sourcing',
    active: false,
    meta: 'no open cycle',
    blurb: sourcingChainBlurb(),
    footer: 'No open sourcing cycle right now — product-sourcing-criteria starts a new one on its next due run.',
    stages: [
      {
        kind: 'job',
        job: SOURCING_JOB.criteria,
        state: 'current',
        label: jobLabel('current', latestHistoryStatus(jobs, SOURCING_JOB.criteria)),
      },
      { kind: 'gate', gate: 'criteria approval', gateState: 'idle', note: 'no open cycle' },
      { kind: 'job', job: SOURCING_JOB.search, state: 'blocked', label: 'blocked' },
      { kind: 'gate', gate: 'product picks', gateState: 'idle', note: 'always human' },
      { kind: 'job', job: SOURCING_JOB.monetize, state: 'blocked', label: 'blocked' },
      { kind: 'gate', gate: 'monetize approval', gateState: 'idle', note: 'trust may auto' },
      { kind: 'job', job: SOURCING_JOB.brand, state: 'blocked', label: 'blocked' },
      { kind: 'gate', gate: 'final approve', gateState: 'idle', note: 'always human' },
    ],
  };
}

function sourcingChain(jobs: JobStatusRow[], cycleResponse: SourcedProductCycleResponse | null): Chain {
  const cycle = cycleResponse?.cycle ?? null;
  if (!cycle) return blockedSourcingChain(jobs);

  const idx = orderIndex(cycle.status);
  const trust = cycle.gatingProfile === 'trust';
  const approvalNote = (autoClears: boolean) => (autoClears ? 'auto-cleared (trust)' : 'human approval required');

  const criteriaState: ChainNodeState = idx >= 2 ? 'done' : 'current';
  const criteriaGate: ChainGateState =
    idx >= 2 ? 'passed' : cycle.status === 'awaiting_criteria_approval' ? 'waiting' : 'idle';

  const searchState: ChainNodeState = idx < 2 ? 'blocked' : idx === 2 ? 'current' : 'done';
  const pickGate: ChainGateState = idx >= 4 ? 'passed' : cycle.status === 'awaiting_product_picks' ? 'waiting' : 'idle';

  const monetizeState: ChainNodeState = idx < 4 ? 'blocked' : idx === 4 ? 'current' : 'done';
  const monetizeGate: ChainGateState =
    idx >= 6 ? 'passed' : cycle.status === 'awaiting_monetize_approval' ? 'waiting' : 'idle';

  const brandState: ChainNodeState = idx < 6 ? 'blocked' : idx === 6 ? 'current' : 'done';
  const finalGate: ChainGateState = cycle.status === 'closed' ? 'passed' : cycle.status === 'awaiting_final' ? 'waiting' : 'idle';

  return {
    id: 'product-sourcing',
    title: 'Product sourcing',
    active: cycle.status !== 'closed',
    meta: `cycle #${cycle.id} · gating profile ${cycle.gatingProfile} · status ${cycle.status}`,
    blurb: sourcingChainBlurb(),
    footer: footerForStatus(cycle.status),
    stages: [
      {
        kind: 'job',
        job: SOURCING_JOB.criteria,
        state: criteriaState,
        label: jobLabel(criteriaState, latestHistoryStatus(jobs, SOURCING_JOB.criteria)),
      },
      { kind: 'gate', gate: 'criteria approval', gateState: criteriaGate, note: approvalNote(trust) },
      {
        kind: 'job',
        job: SOURCING_JOB.search,
        state: searchState,
        label: jobLabel(searchState, latestHistoryStatus(jobs, SOURCING_JOB.search)),
      },
      { kind: 'gate', gate: 'product picks', gateState: pickGate, note: 'always human' },
      {
        kind: 'job',
        job: SOURCING_JOB.monetize,
        state: monetizeState,
        label: jobLabel(monetizeState, latestHistoryStatus(jobs, SOURCING_JOB.monetize)),
      },
      { kind: 'gate', gate: 'monetize approval', gateState: monetizeGate, note: approvalNote(trust) },
      {
        kind: 'job',
        job: SOURCING_JOB.brand,
        state: brandState,
        label: jobLabel(brandState, latestHistoryStatus(jobs, SOURCING_JOB.brand)),
      },
      { kind: 'gate', gate: 'final approve', gateState: finalGate, note: 'always human' },
    ],
  };
}

function recipeChain(jobs: JobStatusRow[]): Chain {
  const generatorLatest = latestHistoryStatus(jobs, 'recipe-variant-generator');
  const finisherLatest = latestHistoryStatus(jobs, 'recipe-variant-finisher');
  const generatorState: ChainNodeState = generatorLatest === 'running' ? 'current' : 'done';

  return {
    id: 'recipe-variants',
    title: 'Recipe variants',
    active: false,
    meta: 'soft handoff · not a DB cycle',
    blurb:
      'Generator writes candidates; finisher advances diet passes. Approvals sits between "pick" and publish, ' +
      'not between these two jobs.',
    footer: 'No hard gate between jobs — finisher drains whatever generator left pending.',
    stages: [
      {
        kind: 'job',
        job: 'recipe-variant-generator',
        state: generatorState,
        label: jobLabel(generatorState, generatorLatest),
      },
      { kind: 'gate', gate: 'candidate queue', gateState: 'passed', note: 'shared backlog' },
      {
        kind: 'job',
        job: 'recipe-variant-finisher',
        state: 'current',
        label: finisherLatest ? `daily · last ${finisherLatest}` : 'daily drain',
      },
    ],
  };
}

function researchChain(jobs: JobStatusRow[]): Chain {
  const trendsLatest = latestHistoryStatus(jobs, 'trends-watcher');
  const competitorLatest = latestHistoryStatus(jobs, 'competitor-analysis');
  const trendsState: ChainNodeState = trendsLatest === 'running' ? 'current' : 'done';
  const competitorState: ChainNodeState = competitorLatest === 'running' ? 'current' : 'done';

  return {
    id: 'research',
    title: 'Research watchers',
    active: false,
    meta: 'independent · no gate',
    blurb:
      'Trends and competitor analysis run on their own cadences. Shown as siblings, not a chain — knobs live on Research.',
    footer: 'Not a gated pipeline — listed so Chains is the map of everything.',
    stages: [
      { kind: 'job', job: 'trends-watcher', state: trendsState, label: jobLabel(trendsState, trendsLatest) },
      { kind: 'gate', gate: 'none', gateState: 'idle', note: 'parallel' },
      {
        kind: 'job',
        job: 'competitor-analysis',
        state: competitorState,
        label: jobLabel(competitorState, competitorLatest),
      },
    ],
  };
}

/**
 * Derives the Chains tab's gated-pipeline view from the open product-sourcing cycle (or lack of
 * one) plus every job's recent run history. Pure — no fetching here, so it's easy to unit test
 * and easy to re-derive on every poll tick without extra API calls.
 */
export function deriveChains(jobs: JobStatusRow[], cycleResponse: SourcedProductCycleResponse | null): Chain[] {
  return [sourcingChain(jobs, cycleResponse), recipeChain(jobs), researchChain(jobs)];
}
