import type { JobResult } from '@lhr/jobs';
import type { Queryable } from '@lhr/db';
import {
  getPool,
  insertCandidateCompetitor,
  listCompetitorsByStatus,
  listKeywords,
  listRecentCompetitorReports,
  insertCompetitorReport,
  type Competitor,
  type SeoPositionEntry,
  type NewCompetitorReport,
} from '@lhr/db';
import { fetchSearchResults } from './serpapiSearch.js';
import { fetchCompetitorPosts, diffNewPosts, type CompetitorPost } from './competitorContent.js';
import { callLLM } from '@lhr/llm';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const REQUEST_TIMEOUT_MS = 10_000;
const UNREACHABLE_NOTE = 'unreachable this cycle';
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';
const CONTENT_BASELINE_CYCLES = 10;
const MAX_TEXT_CHARS = 6000;

// A small, curated, non-auto-expanding list of niche-discovery queries.
const DISCOVERY_QUERIES: readonly string[] = [
  'gluten free recipe blog',
  'kitchenware affiliate roundup',
  'comfort food recipe blog',
  'best kitchen gadgets blog',
];

async function discoverCandidates(db: Queryable): Promise<{ discovered: number; failedQueries: string[] }> {
  const seenThisRun = new Set<string>();
  let discovered = 0;
  const failedQueries: string[] = [];

  for (const query of DISCOVERY_QUERIES) {
    let results;
    try {
      results = await fetchSearchResults(query);
    } catch (err) {
      console.warn(`[competitors] discovery query "${query}" failed; skipping.`, err);
      failedQueries.push(query);
      continue;
    }

    for (const result of results) {
      if (seenThisRun.has(result.domain)) continue;
      seenThisRun.add(result.domain);
      const inserted = await insertCandidateCompetitor(db, result.domain);
      if (inserted) discovered += 1;
    }
  }

  return { discovered, failedQueries };
}

async function trackSeoPositions(
  db: Queryable,
  tracked: Pick<Competitor, 'id' | 'domain'>[],
): Promise<{ positionsByCompetitorId: Map<number, SeoPositionEntry[]>; failedKeywords: string[] }> {
  const keywords = await listKeywords(db);
  const positionsByCompetitorId = new Map<number, SeoPositionEntry[]>();
  for (const competitor of tracked) positionsByCompetitorId.set(competitor.id, []);

  const failedKeywords: string[] = [];

  for (const { keyword } of keywords) {
    let results;
    try {
      results = await fetchSearchResults(keyword);
    } catch (err) {
      console.warn(`[competitors] SEO keyword "${keyword}" SerpApi call failed; skipping.`, err);
      failedKeywords.push(keyword);
      continue;
    }

    for (const competitor of tracked) {
      const match = results.find((r) => r.domain === competitor.domain);
      positionsByCompetitorId.get(competitor.id)!.push({ keyword, position: match ? match.position : null });
    }
  }

  return { positionsByCompetitorId, failedKeywords };
}

function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

async function fetchHomepageText(domain: string): Promise<string> {
  const response = await fetch(`https://${domain}`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`Failed to fetch homepage for ${domain}: ${response.status}`);
  return htmlToText(await response.text());
}

async function summarizeMonetization(domain: string, pageText: string): Promise<string> {
  return callLLM([
    {
      role: 'system',
      content:
        "You analyze a competitor recipe/kitchenware site's homepage text and produce a short, factual snapshot of its monetization and product strategy: what it sells or promotes, any visible price ranges, and any visible affiliate/ad programs or sponsorship disclosures. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

async function summarizeDesign(domain: string, pageText: string): Promise<string> {
  return callLLM([
    {
      role: 'system',
      content:
        "You analyze a competitor site's homepage text (tags stripped, so infer structure from headings, nav labels, and link text) and produce a short, factual description of its apparent layout, prominent calls-to-action, and visual/content style. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

async function diffSnapshot(previous: string | null, current: string): Promise<string> {
  if (previous === null) return `Initial snapshot: ${current}`;
  return callLLM([
    {
      role: 'system',
      content:
        'Given a previous snapshot and a current snapshot of the same thing, describe what substantively changed in 1-2 sentences. If the current snapshot is just a prose rephrasing of the same facts with no substantive change, respond exactly with "No substantive change."',
    },
    { role: 'user', content: `Previous snapshot:\n${previous}\n\nCurrent snapshot:\n${current}` },
  ]);
}

async function buildCompetitorReport(
  db: Queryable,
  competitor: Pick<Competitor, 'id' | 'domain'>,
  cycleId: string,
  seoPositions: SeoPositionEntry[],
): Promise<{ report: NewCompetitorReport; hadIssue: boolean }> {
  const recentReports = await listRecentCompetitorReports(db, competitor.id, CONTENT_BASELINE_CYCLES);

  // Search back through recent history for the most recent REAL snapshot per dimension — using
  // recentReports[0] unconditionally would hand the LLM 'unreachable this cycle' as a "previous
  // snapshot" whenever last cycle's homepage fetch failed, and it will fabricate a plausible-but-
  // meaningless "what changed" description between a status sentinel and a real snapshot.
  const monetizationBaseline = recentReports.find((r) => r.monetizationSnapshot !== UNREACHABLE_NOTE)?.monetizationSnapshot ?? null;
  const designBaseline = recentReports.find((r) => r.designSnapshot !== UNREACHABLE_NOTE)?.designSnapshot ?? null;

  let hadIssue = false;
  let newContent: CompetitorPost[] = [];
  let contentDescriptor: string;
  try {
    const { posts, source } = await fetchCompetitorPosts(competitor.domain);
    if (source === 'unparseable') {
      contentDescriptor = UNREACHABLE_NOTE;
      hadIssue = true;
    } else {
      // The baseline is the union of new_content across several recent cycles, not just the
      // single most-recent row — see Global Constraints for why diffing against only the latest
      // row's own delta silently re-flags old posts as new after a quiet week.
      const knownPosts = recentReports.flatMap((r) => r.newContent);
      newContent = diffNewPosts(posts, knownPosts);
      contentDescriptor = newContent.length > 0 ? JSON.stringify(newContent) : 'no new content this cycle';
    }
  } catch (err) {
    console.warn(`[competitors] content fetch failed for ${competitor.domain}; marking unreachable this cycle.`, err);
    contentDescriptor = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  // monetizationSnapshot/designSnapshot store the CURRENT full snapshot so next cycle's diff has
  // a real baseline — the LLM-produced change description is used only for this cycle's
  // synthesis prompt below, never persisted as the "snapshot".
  let monetizationSnapshot: string;
  let designSnapshot: string;
  let monetizationChange: string;
  let designChange: string;
  try {
    const pageText = await fetchHomepageText(competitor.domain);
    const [monetization, design] = await Promise.all([
      summarizeMonetization(competitor.domain, pageText),
      summarizeDesign(competitor.domain, pageText),
    ]);
    monetizationSnapshot = monetization;
    designSnapshot = design;
    [monetizationChange, designChange] = await Promise.all([
      diffSnapshot(monetizationBaseline, monetization),
      diffSnapshot(designBaseline, design),
    ]);
  } catch (err) {
    console.warn(`[competitors] homepage snapshot failed for ${competitor.domain}; marking unreachable this cycle.`, err);
    monetizationSnapshot = UNREACHABLE_NOTE;
    designSnapshot = UNREACHABLE_NOTE;
    monetizationChange = UNREACHABLE_NOTE;
    designChange = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  let summary: string;
  try {
    summary = await callLLM([
      {
        role: 'system',
        content:
          'Synthesize this week\'s changes for a tracked competitor into a short "what changed this week" summary (2-4 sentences), covering new content, SEO positions, monetization, and design where notable. Skip dimensions with no notable change.',
      },
      {
        role: 'user',
        content: [
          `Competitor: ${competitor.domain}`,
          `New content: ${contentDescriptor}`,
          `SEO positions: ${JSON.stringify(seoPositions)}`,
          `Monetization change: ${monetizationChange}`,
          `Design change: ${designChange}`,
        ].join('\n'),
      },
    ]);
  } catch (err) {
    console.warn(`[competitors] synthesis LLM call failed for ${competitor.domain}.`, err);
    summary = SUMMARY_FAILURE_PLACEHOLDER;
    hadIssue = true;
  }

  return {
    report: { competitorId: competitor.id, cycleId, newContent, seoPositions, monetizationSnapshot, designSnapshot, summary },
    hadIssue,
  };
}

export async function analyzeCompetitors(): Promise<JobResult> {
  requireEnv('SERPAPI_KEY');
  requireEnv('OPENROUTER_API_KEY');
  const db = getPool();

  const cycleId = new Date().toISOString().slice(0, 10);

  const { discovered, failedQueries } = await discoverCandidates(db);
  const tracked = await listCompetitorsByStatus(db, 'tracked');
  const { positionsByCompetitorId, failedKeywords } = await trackSeoPositions(db, tracked);

  let reportsWritten = 0;
  let competitorsWithIssues = 0;
  for (const competitor of tracked) {
    const seoPositions = positionsByCompetitorId.get(competitor.id) ?? [];
    const { report, hadIssue } = await buildCompetitorReport(db, competitor, cycleId, seoPositions);
    await insertCompetitorReport(db, report);
    reportsWritten += 1;
    if (hadIssue) competitorsWithIssues += 1;
  }

  console.log(`[competitors] cycle ${cycleId}: ${discovered} new candidate(s), ${reportsWritten} report(s) written`);

  const degraded = failedQueries.length > 0 || failedKeywords.length > 0 || competitorsWithIssues > 0;
  if (degraded) {
    return {
      status: 'partial',
      summary: `Wrote ${reportsWritten} competitor report(s); ${competitorsWithIssues} competitor(s) had an issue this cycle, or discovery/SEO tracking had a failure.`,
    };
  }
  return { status: 'success', summary: `Wrote a competitor report for ${reportsWritten} tracked competitor(s).` };
}
