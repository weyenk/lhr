import type { JobResult } from '@lhr/jobs';
import {
  getOpenSourcedProductCycle,
  getPool,
  listSourcedProductCandidates,
  setCandidateMonetizeResult,
  setCandidateStatus,
  setCycleStatus,
  type SourcedProductCandidate,
  type SourcedProductCycle,
} from '@lhr/db';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { gateAutoClears } from './gating.js';
import { loadAgentPersona } from './loadPersona.js';
import { callLlmJson } from './parseLlmJson.js';

export type Verdict = { pass: boolean; rationale: string };

const PERSONA_PATH = '.claude/agents/monetization-scout.md';

const BLOCKED_NO_OPEN_CYCLE: JobResult = { status: 'success', summary: 'blocked: no open cycle' };
const BLOCKED_WAITING_FOR_GATE: JobResult = { status: 'success', summary: 'blocked: waiting for gate' };
const BLOCKED_CYCLE_NOT_MONETIZING: JobResult = { status: 'success', summary: 'blocked: cycle not monetizing' };

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function isWaitingForGate(cycle: SourcedProductCycle): boolean {
  switch (cycle.status) {
    case 'awaiting_criteria_approval':
    case 'awaiting_product_picks':
    case 'awaiting_monetize_approval':
    case 'awaiting_final':
      return true;
    default:
      return false;
  }
}

// Parses `{ results: [{ id, pass, rationale }] }` and requires a verdict for every expected id, so a
// truncated or partial LLM reply fails (and is retried by callLlmJson) instead of leaving candidates
// stranded in their current status. Verdicts for unknown ids are ignored.
export function verdictParser(expectedIds: number[]): (value: unknown) => Map<number, Verdict> {
  return (value) => {
    const list = (value as { results?: unknown } | null)?.results;
    if (!Array.isArray(list)) throw new Error('results must be an array');
    const verdicts = new Map<number, Verdict>();
    for (const item of list as Record<string, unknown>[]) {
      if (!item || typeof item.id !== 'number' || typeof item.pass !== 'boolean') continue;
      verdicts.set(item.id, {
        pass: item.pass,
        rationale: typeof item.rationale === 'string' ? item.rationale.trim() : '',
      });
    }
    const missing = expectedIds.filter((id) => !verdicts.has(id));
    if (missing.length > 0) throw new Error(`missing verdicts for candidate ids: ${missing.join(', ')}`);
    return verdicts;
  };
}

export function describeCandidate(c: SourcedProductCandidate): string {
  const { title, platform, sourceUrl, moq, unitCostCents, notes } = c;
  // The id is emitted first and unquoted-spaced so the LLM echoes it back verbatim as a number.
  return `{"id": ${c.id}, ${JSON.stringify({ title, platform, sourceUrl, moq, unitCostCents, notes }).slice(1)}`;
}

function buildPrompt(candidates: SourcedProductCandidate[]): string {
  return (
    `Judge each shortlisted wholesale product on wholesale sellability only: is there a realistic path to buying it ` +
    `at wholesale and reselling it profitably (unit cost vs. a plausible retail price, MOQ vs. a small shop's budget, ` +
    `supplier reliability signals, shipping and fragility)? Do not consider affiliate programs or commissions.\n` +
    `Use only the facts given; where MOQ or cost is null, say it is unknown rather than guessing.\n\n` +
    `Reply with JSON only, exactly this shape, with one entry for every candidate id:\n` +
    `{"results": [{"id": number, "pass": boolean, "rationale": string (one or two sentences)}]}\n\n` +
    `Candidates:\n${candidates.map(describeCandidate).join('\n')}`
  );
}

export async function runProductSourcingMonetize(): Promise<JobResult> {
  const pool = getPool();

  const cycle = await getOpenSourcedProductCycle(pool);
  if (!cycle) return BLOCKED_NO_OPEN_CYCLE;
  if (cycle.status !== 'monetizing') {
    return isWaitingForGate(cycle) ? BLOCKED_WAITING_FOR_GATE : BLOCKED_CYCLE_NOT_MONETIZING;
  }

  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  const persona = await loadAgentPersona(client, PERSONA_PATH);

  const candidates = await listSourcedProductCandidates(pool, cycle.id, 'picked');
  const verdicts =
    candidates.length === 0
      ? new Map<number, Verdict>()
      : await callLlmJson(
          [{ role: 'user', content: buildPrompt(candidates) }],
          { persona },
          verdictParser(candidates.map((c) => c.id)),
        );

  const autoClear = gateAutoClears(cycle.gatingProfile, 'monetize');
  let passed = 0;
  for (const candidate of candidates) {
    const verdict = verdicts.get(candidate.id)!;
    await setCandidateMonetizeResult(pool, candidate.id, verdict);
    await setCandidateStatus(pool, candidate.id, verdict.pass ? 'monetize_pass' : 'monetize_fail');
    if (verdict.pass) {
      passed += 1;
      if (autoClear) await setCandidateStatus(pool, candidate.id, 'monetize_confirmed');
    }
  }

  const summary = `Monetize check for cycle ${cycle.id}: ${passed} of ${candidates.length} passed`;
  if (autoClear) {
    await setCycleStatus(pool, cycle.id, 'branding');
    return { status: 'success', summary: `${summary}; auto-confirmed, branding.` };
  }
  await setCycleStatus(pool, cycle.id, 'awaiting_monetize_approval');
  return { status: 'success', summary: `${summary}; awaiting approval.` };
}
