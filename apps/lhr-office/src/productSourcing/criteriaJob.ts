import type { JobResult } from '@lhr/jobs';
import {
  approveCycleCriteria,
  createSourcedProductCycle,
  getOpenSourcedProductCycle,
  getPool,
  setCycleCriteria,
  setCycleStatus,
  type SourcedProductCycle,
} from '@lhr/db';
import { createGitHubClient, getFile, listFiles, type GitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { gateAutoClears, readGatingProfile } from './gating.js';
import { loadAgentPersona } from './loadPersona.js';
import { callLlmJson } from './parseLlmJson.js';

export type SearchCriteria = {
  keywords: string[];
  platforms: string[];
  aestheticNotes: string;
  categoryHints: string[];
};

const PERSONA_PATH = '.claude/agents/designer-experience.md';
const MAX_KEYWORDS = 6;
const HOSTNAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

const BLOCKED_WAITING_FOR_GATE: JobResult = { status: 'success', summary: 'blocked: waiting for gate' };
const BLOCKED_CYCLE_BUSY: JobResult = { status: 'success', summary: 'blocked: cycle busy' };

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === 'string' && v.trim() !== '');
}

export function parseSearchCriteria(value: unknown): SearchCriteria {
  const v = value as Partial<Record<keyof SearchCriteria, unknown>> | null;
  if (!v || typeof v !== 'object') throw new Error('criteria must be an object');
  if (!isStringArray(v.keywords) || v.keywords.length < 1 || v.keywords.length > MAX_KEYWORDS) {
    throw new Error(`criteria.keywords must be 1-${MAX_KEYWORDS} non-empty strings`);
  }
  if (!isStringArray(v.platforms) || !v.platforms.every((p) => HOSTNAME_PATTERN.test(p))) {
    throw new Error('criteria.platforms must be hostnames without scheme');
  }
  if (typeof v.aestheticNotes !== 'string') throw new Error('criteria.aestheticNotes must be a string');
  if (!isStringArray(v.categoryHints)) throw new Error('criteria.categoryHints must be an array of strings');
  return {
    keywords: v.keywords.map((k) => k.trim()),
    platforms: v.platforms.map((p) => p.trim().toLowerCase()),
    aestheticNotes: v.aestheticNotes,
    categoryHints: v.categoryHints.map((c) => c.trim()),
  };
}

async function readProductNames(client: GitHubClient): Promise<string[]> {
  const filenames = await listFiles(client, 'src/content/products', 'main');
  const names: string[] = [];
  for (const filename of filenames.filter((f) => f.endsWith('.json'))) {
    const file = await getFile(client, `src/content/products/${filename}`, 'main');
    if (!file) continue;
    try {
      const parsed = JSON.parse(file.content) as { name?: unknown };
      if (typeof parsed.name === 'string') names.push(parsed.name);
    } catch {
      // Skip a product file that doesn't parse rather than fail the whole job.
    }
  }
  return names;
}

function blockedResult(cycle: SourcedProductCycle): JobResult | null {
  switch (cycle.status) {
    case 'drafting_criteria':
    case 'awaiting_criteria_approval':
      return null;
    case 'awaiting_product_picks':
    case 'awaiting_monetize_approval':
    case 'awaiting_final':
      return BLOCKED_WAITING_FOR_GATE;
    default:
      return BLOCKED_CYCLE_BUSY;
  }
}

function buildPrompt(brand: string, productNames: string[]): string {
  return (
    `Draft a search brief for sourcing new kitchenware products for this site from wholesale marketplaces. ` +
    `Base it on the brand doc and on gaps in the current product catalog.\n\n` +
    `Reply with JSON only, exactly this shape:\n` +
    `{"keywords": string[] (1-${MAX_KEYWORDS} short search phrases), ` +
    `"platforms": string[] (hostnames without scheme, e.g. "alibaba.com"), ` +
    `"aestheticNotes": string (free text for the product scout), ` +
    `"categoryHints": string[] (e.g. "serveware", "knives")}\n\n` +
    `Brand doc:\n${brand || '(missing)'}\n\n` +
    `Existing products:\n${productNames.map((n) => `- ${n}`).join('\n') || '(none yet)'}`
  );
}

export async function runProductSourcingCriteria(): Promise<JobResult> {
  const pool = getPool();

  const open = await getOpenSourcedProductCycle(pool);
  if (open) {
    const blocked = blockedResult(open);
    if (blocked) return blocked;
  }

  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  const persona = await loadAgentPersona(client, PERSONA_PATH);
  const brand = (await getFile(client, 'docs/BRAND.md', 'main'))?.content ?? '';
  const productNames = await readProductNames(client);

  const cycle = open ?? (await createSourcedProductCycle(pool, { gatingProfile: readGatingProfile() }));

  const criteria = await callLlmJson(
    [{ role: 'user', content: buildPrompt(brand, productNames) }],
    { persona },
    parseSearchCriteria,
  );

  await setCycleCriteria(pool, cycle.id, criteria);

  if (gateAutoClears(cycle.gatingProfile, 'criteria')) {
    await approveCycleCriteria(pool, cycle.id);
    return { status: 'success', summary: `Drafted search criteria for cycle ${cycle.id}; auto-approved, searching.` };
  }
  await setCycleStatus(pool, cycle.id, 'awaiting_criteria_approval');
  return { status: 'success', summary: `Drafted search criteria for cycle ${cycle.id}; awaiting approval.` };
}
