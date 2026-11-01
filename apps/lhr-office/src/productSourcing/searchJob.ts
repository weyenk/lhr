import type { JobResult } from '@lhr/jobs';
import {
  getOpenSourcedProductCycle,
  getPool,
  insertSourcedProductCandidate,
  setCycleStatus,
  type NewSourcedProductCandidate,
  type SourcedProductCycle,
} from '@lhr/db';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { fetchSearchResults, type SearchResultItem } from '../serpapiSearch.js';
import { parseSearchCriteria, type SearchCriteria } from './criteriaJob.js';
import { loadAgentPersona } from './loadPersona.js';
import { callLlmJson } from './parseLlmJson.js';

const PERSONA_PATH = '.claude/agents/product-sourcing-scout.md';
const MAX_QUERIES = 6;
const RESULTS_PER_QUERY = 8;
const DEFAULT_PLATFORMS = ['alibaba.com', 'dhgate.com'];

const BLOCKED_NO_OPEN_CYCLE: JobResult = { status: 'success', summary: 'blocked: no open cycle' };
const BLOCKED_WAITING_FOR_GATE: JobResult = { status: 'success', summary: 'blocked: waiting for gate' };
const BLOCKED_CYCLE_NOT_SEARCHING: JobResult = { status: 'success', summary: 'blocked: cycle not searching' };

function blockedSearchResult(cycle: SourcedProductCycle): JobResult {
  switch (cycle.status) {
    case 'awaiting_criteria_approval':
    case 'awaiting_product_picks':
    case 'awaiting_monetize_approval':
    case 'awaiting_final':
      return BLOCKED_WAITING_FOR_GATE;
    default:
      return BLOCKED_CYCLE_NOT_SEARCHING;
  }
}

type Annotation = { notes: string | null; moq: string | null; unitCostCents: number | null };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function readCriteria(raw: unknown): SearchCriteria {
  const base = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const platforms = Array.isArray(base.platforms) && base.platforms.length > 0 ? base.platforms : DEFAULT_PLATFORMS;
  return parseSearchCriteria({ aestheticNotes: '', categoryHints: [], ...base, platforms });
}

function buildQueries(criteria: SearchCriteria): string[] {
  const queries = criteria.keywords.flatMap((keyword) =>
    criteria.platforms.map((platform) => `${keyword} site:${platform}`),
  );
  return queries.slice(0, MAX_QUERIES);
}

function inferPlatform(domain: string, platforms: string[]): string {
  const host = domain.toLowerCase();
  return platforms.find((p) => host === p || host.endsWith(`.${p}`)) ?? host;
}

function uniqueByLink(hits: SearchResultItem[]): SearchResultItem[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.link) ? false : (seen.add(h.link), true)));
}

function buildAnnotatePrompt(criteria: SearchCriteria, hits: SearchResultItem[]): string {
  const list = hits.map((h, i) => `${i}. ${h.title} (${h.link})`).join('\n');
  return (
    `You are screening wholesale search hits for fit with this brief.\n` +
    `Aesthetic notes: ${criteria.aestheticNotes || '(none)'}\n` +
    `Category hints: ${criteria.categoryHints.join(', ') || '(none)'}\n\n` +
    `You only have each hit's title and URL. Do NOT invent MOQ, unit cost, or any other fact you cannot read ` +
    `from the title/URL — use null for anything unknown. Prefer null over a guess.\n\n` +
    `Reply with JSON only, exactly this shape:\n` +
    `{"annotations": [{"index": number, "notes": string|null (one short sentence on fit), ` +
    `"moq": string|null, "unitCostCents": number|null}]}\n\n` +
    `Hits:\n${list}`
  );
}

function parseAnnotations(value: unknown): Map<number, Annotation> {
  const list = (value as { annotations?: unknown } | null)?.annotations;
  if (!Array.isArray(list)) throw new Error('annotations must be an array');
  const out = new Map<number, Annotation>();
  for (const item of list as Record<string, unknown>[]) {
    if (!item || typeof item.index !== 'number' || !Number.isInteger(item.index)) continue;
    out.set(item.index, {
      notes: typeof item.notes === 'string' && item.notes.trim() ? item.notes.trim() : null,
      moq: typeof item.moq === 'string' && item.moq.trim() ? item.moq.trim() : null,
      unitCostCents:
        typeof item.unitCostCents === 'number' && Number.isInteger(item.unitCostCents) && item.unitCostCents >= 0
          ? item.unitCostCents
          : null,
    });
  }
  return out;
}

export async function runProductSourcingSearch(): Promise<JobResult> {
  const pool = getPool();

  const cycle = await getOpenSourcedProductCycle(pool);
  if (!cycle) return BLOCKED_NO_OPEN_CYCLE;
  if (cycle.status !== 'searching') return blockedSearchResult(cycle);

  const criteria = readCriteria(cycle.criteriaJson);
  requireEnv('SERPAPI_KEY');
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  const persona = await loadAgentPersona(client, PERSONA_PATH);

  const hits: SearchResultItem[] = [];
  for (const query of buildQueries(criteria)) {
    hits.push(...(await fetchSearchResults(query, RESULTS_PER_QUERY)));
  }
  const unique = uniqueByLink(hits);

  let annotations = new Map<number, Annotation>();
  let annotateFailed = false;
  if (unique.length > 0) {
    try {
      annotations = await callLlmJson(
        [{ role: 'user', content: buildAnnotatePrompt(criteria, unique) }],
        { persona },
        parseAnnotations,
      );
    } catch {
      annotateFailed = true;
    }
  }

  let inserted = 0;
  for (const [index, hit] of unique.entries()) {
    const annotation = annotations.get(index);
    const candidate: NewSourcedProductCandidate = {
      cycleId: cycle.id,
      title: hit.title,
      sourceUrl: hit.link,
      platform: inferPlatform(hit.domain, criteria.platforms),
      moq: annotation?.moq ?? null,
      unitCostCents: annotation?.unitCostCents ?? null,
      notes: annotation?.notes ?? null,
    };
    if (await insertSourcedProductCandidate(pool, candidate)) inserted += 1;
  }

  await setCycleStatus(pool, cycle.id, 'awaiting_product_picks');

  const summary = `Sourced ${inserted} new candidates for cycle ${cycle.id} from ${unique.length} hits; awaiting product picks.`;
  if (annotateFailed) {
    return { status: 'partial', summary: `${summary} LLM annotation failed; candidates saved unannotated.` };
  }
  return { status: 'success', summary };
}
