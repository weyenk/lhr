import type { JobResult } from '@lhr/jobs';
import {
  getOpenSourcedProductCycle,
  getPool,
  listSourcedProductCandidates,
  setCandidateBrandResult,
  setCandidateStatus,
  setCycleStatus,
  type SourcedProductCandidate,
} from '@lhr/db';
import { createGitHubClient, getFile } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { loadAgentPersona } from './loadPersona.js';
import { callLlmJson } from './parseLlmJson.js';
import { describeCandidate, isWaitingForGate, requireEnv, verdictParser, type Verdict } from './monetizeJob.js';

const PERSONA_PATH = '.claude/agents/designer-experience.md';

const BLOCKED_NO_OPEN_CYCLE: JobResult = { status: 'success', summary: 'blocked: no open cycle' };
const BLOCKED_WAITING_FOR_GATE: JobResult = { status: 'success', summary: 'blocked: waiting for gate' };
const BLOCKED_CYCLE_NOT_BRANDING: JobResult = { status: 'success', summary: 'blocked: cycle not branding' };

function buildPrompt(brand: string, candidates: SourcedProductCandidate[]): string {
  return (
    `Judge whether each shortlisted product fits this site's brand and design language (palette, materials, ` +
    `shape, overall aesthetic) as described in the brand doc. You only have a title, source URL, and notes — ` +
    `do not invent visual details you cannot infer from them.\n\n` +
    `Reply with JSON only, exactly this shape, with one entry for every candidate id:\n` +
    `{"results": [{"id": number, "pass": boolean, "rationale": string (one or two sentences)}]}\n\n` +
    `Brand doc:\n${brand || '(missing)'}\n\n` +
    `Candidates:\n${candidates.map(describeCandidate).join('\n')}`
  );
}

export async function runProductSourcingBrand(): Promise<JobResult> {
  const pool = getPool();

  const cycle = await getOpenSourcedProductCycle(pool);
  if (!cycle) return BLOCKED_NO_OPEN_CYCLE;
  if (cycle.status !== 'branding') {
    return isWaitingForGate(cycle) ? BLOCKED_WAITING_FOR_GATE : BLOCKED_CYCLE_NOT_BRANDING;
  }

  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  const persona = await loadAgentPersona(client, PERSONA_PATH);
  const brand = (await getFile(client, 'docs/BRAND.md', 'main'))?.content ?? '';

  const candidates = await listSourcedProductCandidates(pool, cycle.id, 'monetize_confirmed');
  const verdicts =
    candidates.length === 0
      ? new Map<number, Verdict>()
      : await callLlmJson(
          [{ role: 'user', content: buildPrompt(brand, candidates) }],
          { persona },
          verdictParser(candidates.map((c) => c.id)),
        );

  let passed = 0;
  for (const candidate of candidates) {
    const verdict = verdicts.get(candidate.id)!;
    await setCandidateBrandResult(pool, candidate.id, verdict);
    await setCandidateStatus(pool, candidate.id, verdict.pass ? 'pending_final' : 'brand_fail');
    if (verdict.pass) passed += 1;
  }

  await setCycleStatus(pool, cycle.id, 'awaiting_final');
  return {
    status: 'success',
    summary: `Brand check for cycle ${cycle.id}: ${passed} of ${candidates.length} passed; awaiting final approval.`,
  };
}
