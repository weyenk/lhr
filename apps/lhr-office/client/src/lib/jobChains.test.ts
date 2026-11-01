import { describe, expect, it } from 'vitest';
import { deriveChains } from './jobChains';
import type { JobStatusRow, SourcedProductCycleResponse } from './types';

function job(name: string, historyStatus: 'success' | 'failure' | 'partial' | 'running' | null = 'success'): JobStatusRow {
  return {
    name,
    defaultCadenceDays: 7,
    cadenceDays: 7,
    prose: [],
    history: historyStatus
      ? [
          {
            id: 1,
            jobName: name,
            status: historyStatus,
            summary: 'did the thing',
            errorMessage: null,
            startedAt: '2026-10-30T00:00:00.000Z',
            finishedAt: '2026-10-30T00:05:00.000Z',
          },
        ]
      : [],
  };
}

const ALL_SOURCING_JOBS = [
  job('product-sourcing-criteria'),
  job('product-sourcing-search'),
  job('product-sourcing-monetize'),
  job('product-sourcing-brand'),
  job('recipe-variant-generator'),
  job('recipe-variant-finisher'),
  job('trends-watcher'),
  job('competitor-analysis'),
];

function cycleResponse(status: SourcedProductCycleResponse['cycle'] extends null ? never : NonNullable<SourcedProductCycleResponse['cycle']>['status']): SourcedProductCycleResponse {
  return {
    cycle: {
      id: 12,
      startedAt: '2026-10-01T00:00:00.000Z',
      status,
      criteriaJson: null,
      criteriaApprovedAt: null,
      gatingProfile: 'trust',
      closedAt: null,
    },
    candidates: [],
  };
}

function sourcingChain(jobs: JobStatusRow[], response: SourcedProductCycleResponse | null) {
  return deriveChains(jobs, response).find((c) => c.id === 'product-sourcing')!;
}

function stageState(chain: ReturnType<typeof sourcingChain>, jobName: string) {
  const stage = chain.stages.find((s) => s.kind === 'job' && s.job === jobName);
  return stage && stage.kind === 'job' ? stage.state : undefined;
}

function gateState(chain: ReturnType<typeof sourcingChain>, gateName: string) {
  const stage = chain.stages.find((s) => s.kind === 'gate' && s.gate === gateName);
  return stage && stage.kind === 'gate' ? stage.gateState : undefined;
}

describe('deriveChains — product-sourcing chain', () => {
  it('returns a blocked/idle chain with no active cycle when the cycle is null', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, { cycle: null, candidates: [] });
    expect(chain.active).toBe(false);
    expect(stageState(chain, 'product-sourcing-search')).toBe('blocked');
    expect(stageState(chain, 'product-sourcing-monetize')).toBe('blocked');
    expect(stageState(chain, 'product-sourcing-brand')).toBe('blocked');
  });

  it('marks criteria current and every later stage blocked while drafting_criteria', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('drafting_criteria'));
    expect(stageState(chain, 'product-sourcing-criteria')).toBe('current');
    expect(gateState(chain, 'criteria approval')).toBe('idle');
    expect(stageState(chain, 'product-sourcing-search')).toBe('blocked');
  });

  it('marks the criteria-approval gate as waiting while awaiting_criteria_approval', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('awaiting_criteria_approval'));
    expect(stageState(chain, 'product-sourcing-criteria')).toBe('current');
    expect(gateState(chain, 'criteria approval')).toBe('waiting');
    expect(stageState(chain, 'product-sourcing-search')).toBe('blocked');
  });

  it('marks criteria done, search current, and the criteria gate passed while searching', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('searching'));
    expect(stageState(chain, 'product-sourcing-criteria')).toBe('done');
    expect(gateState(chain, 'criteria approval')).toBe('passed');
    expect(stageState(chain, 'product-sourcing-search')).toBe('current');
    expect(stageState(chain, 'product-sourcing-monetize')).toBe('blocked');
  });

  it('marks the product-picks gate as waiting while awaiting_product_picks', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('awaiting_product_picks'));
    expect(stageState(chain, 'product-sourcing-search')).toBe('done');
    expect(gateState(chain, 'product picks')).toBe('waiting');
    expect(stageState(chain, 'product-sourcing-monetize')).toBe('blocked');
  });

  it('marks search done, monetize current while monetizing', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('monetizing'));
    expect(stageState(chain, 'product-sourcing-search')).toBe('done');
    expect(gateState(chain, 'product picks')).toBe('passed');
    expect(stageState(chain, 'product-sourcing-monetize')).toBe('current');
    expect(stageState(chain, 'product-sourcing-brand')).toBe('blocked');
  });

  it('marks the monetize-approval gate as waiting while awaiting_monetize_approval', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('awaiting_monetize_approval'));
    expect(gateState(chain, 'monetize approval')).toBe('waiting');
    expect(stageState(chain, 'product-sourcing-brand')).toBe('blocked');
  });

  it('marks monetize done, brand current while branding', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('branding'));
    expect(stageState(chain, 'product-sourcing-monetize')).toBe('done');
    expect(gateState(chain, 'monetize approval')).toBe('passed');
    expect(stageState(chain, 'product-sourcing-brand')).toBe('current');
  });

  it('marks the final-approve gate as waiting while awaiting_final', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('awaiting_final'));
    expect(stageState(chain, 'product-sourcing-brand')).toBe('done');
    expect(gateState(chain, 'final approve')).toBe('waiting');
  });

  it('marks everything done and the final gate passed once closed', () => {
    const chain = sourcingChain(ALL_SOURCING_JOBS, cycleResponse('closed'));
    expect(stageState(chain, 'product-sourcing-brand')).toBe('done');
    expect(gateState(chain, 'final approve')).toBe('passed');
  });

  it('notes auto-clear on the criteria/monetize gates under a trust gating profile', () => {
    const response = cycleResponse('searching');
    const chain = sourcingChain(ALL_SOURCING_JOBS, response);
    const gate = chain.stages.find((s) => s.kind === 'gate' && s.gate === 'criteria approval');
    expect(gate && gate.kind === 'gate' ? gate.note : undefined).toMatch(/auto/i);
  });
});

describe('deriveChains — recipe-variants and research chains', () => {
  it('always includes a recipe-variants chain and a research chain alongside product-sourcing', () => {
    const chains = deriveChains(ALL_SOURCING_JOBS, { cycle: null, candidates: [] });
    expect(chains.map((c) => c.id).sort()).toEqual(['product-sourcing', 'recipe-variants', 'research']);
  });

  it('marks the research chain jobs current when their latest history run is still running', () => {
    const jobs = [...ALL_SOURCING_JOBS.filter((j) => j.name !== 'trends-watcher'), job('trends-watcher', 'running')];
    const chains = deriveChains(jobs, { cycle: null, candidates: [] });
    const research = chains.find((c) => c.id === 'research')!;
    const trends = research.stages.find((s) => s.kind === 'job' && s.job === 'trends-watcher');
    expect(trends && trends.kind === 'job' ? trends.state : undefined).toBe('current');
  });
});
