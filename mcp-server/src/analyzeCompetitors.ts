import { Pool } from 'pg';
import { runDiscovery } from './competitorDiscovery.js';
import { trackSeoPositions } from './competitorSeoTracking.js';
import { fetchCompetitorPosts, diffNewPosts, type CompetitorPost } from './competitorContent.js';
import { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } from './competitorSnapshots.js';
import { callOpenRouter } from './openrouter.js';
import { computeCycleId } from './computeCycleId.js';
import { requireEnv } from './blob.js';
import {
  listCompetitorsByStatus,
  listRecentCompetitorReports,
  insertCompetitorReport,
  type Competitor,
  type NewCompetitorReport,
  type SeoPositionEntry,
} from '@lhr/db';

const SYNTHESIS_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';
const UNREACHABLE_NOTE = 'unreachable this cycle';

export interface WeeklyCompetitorRunSummary {
  cycleId: string;
  discoveredCandidates: number;
  failedDiscoveryQueries: string[];
  failedSeoKeywords: string[];
  reportsWritten: number;
  competitorsWithIssues: number;
}

interface CompetitorReportResult {
  report: NewCompetitorReport;
  hadIssue: boolean;
}

async function buildCompetitorReport(
  pool: Pool,
  competitor: Pick<Competitor, 'id' | 'domain'>,
  cycleId: string,
  seoPositions: SeoPositionEntry[],
): Promise<CompetitorReportResult> {
  // Cumulative baseline: prior reports only ever store each cycle's DELTA
  // (the posts that were new *that* cycle) in newContent, not a running
  // snapshot of everything seen. To know whether a post fetched this cycle
  // is genuinely new, union the newContent across recent history rather
  // than looking at only the single latest report.
  const priorReports = await listRecentCompetitorReports(pool, competitor.id);
  const priorLatest = priorReports[0] ?? null;
  const priorPostsByUrl = new Map<string, CompetitorPost>();
  for (const priorReport of priorReports) {
    for (const post of priorReport.newContent) {
      if (!priorPostsByUrl.has(post.url)) {
        priorPostsByUrl.set(post.url, post);
      }
    }
  }
  const priorPosts = Array.from(priorPostsByUrl.values());

  let hadIssue = false;

  let newContent: CompetitorPost[] = [];
  let contentDescriptor: string;
  try {
    const { posts, source } = await fetchCompetitorPosts(competitor.domain);
    if (source === 'unparseable') {
      contentDescriptor = UNREACHABLE_NOTE;
      hadIssue = true;
    } else {
      newContent = diffNewPosts(posts, priorPosts);
      contentDescriptor = newContent.length > 0 ? JSON.stringify(newContent) : 'no new content this cycle';
    }
  } catch (err) {
    console.error(`Content fetch for "${competitor.domain}" failed; marking unreachable this cycle.`, err);
    contentDescriptor = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  // Snapshot columns store the raw current snapshot (a cumulative fact,
  // not a delta) so the NEXT cycle has a real baseline to diff against.
  // diffSnapshot's change-description output is used only locally, to feed
  // the synthesis prompt below — it is never persisted to the report row.
  let monetizationSnapshot: string;
  let designSnapshot: string;
  let monetizationChangeDescriptor: string;
  let designChangeDescriptor: string;
  try {
    const pageText = await fetchHomepageText(competitor.domain);
    const [monetization, design] = await Promise.all([
      summarizeMonetization(competitor.domain, pageText),
      summarizeDesign(competitor.domain, pageText),
    ]);
    monetizationSnapshot = monetization;
    designSnapshot = design;
    monetizationChangeDescriptor = await diffSnapshot(priorLatest?.monetizationSnapshot ?? null, monetization);
    designChangeDescriptor = await diffSnapshot(priorLatest?.designSnapshot ?? null, design);
  } catch (err) {
    console.error(`Snapshot fetch for "${competitor.domain}" failed; marking unreachable this cycle.`, err);
    monetizationSnapshot = UNREACHABLE_NOTE;
    designSnapshot = UNREACHABLE_NOTE;
    monetizationChangeDescriptor = UNREACHABLE_NOTE;
    designChangeDescriptor = UNREACHABLE_NOTE;
    hadIssue = true;
  }

  let summary: string;
  try {
    summary = await callOpenRouter([
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
          `Monetization change: ${monetizationChangeDescriptor}`,
          `Design change: ${designChangeDescriptor}`,
        ].join('\n'),
      },
    ]);
  } catch (err) {
    console.error(`Synthesis LLM call for "${competitor.domain}" failed.`, err);
    summary = SYNTHESIS_FAILURE_PLACEHOLDER;
    hadIssue = true;
  }

  return {
    report: {
      competitorId: competitor.id,
      cycleId,
      newContent,
      seoPositions,
      monetizationSnapshot,
      designSnapshot,
      summary,
    },
    hadIssue,
  };
}

export async function runWeeklyCompetitorAnalysis(pool: Pool): Promise<WeeklyCompetitorRunSummary> {
  const discovery = await runDiscovery(pool);
  const seoTracking = await trackSeoPositions(pool);
  const tracked = await listCompetitorsByStatus(pool, 'tracked');
  const cycleId = computeCycleId(new Date());

  let reportsWritten = 0;
  let competitorsWithIssues = 0;
  for (const competitor of tracked) {
    const seoPositions = seoTracking.positionsByCompetitorId.get(competitor.id) ?? [];
    const { report, hadIssue } = await buildCompetitorReport(pool, competitor, cycleId, seoPositions);
    await insertCompetitorReport(pool, report);
    reportsWritten += 1;
    if (hadIssue) {
      competitorsWithIssues += 1;
    }
  }

  return {
    cycleId,
    discoveredCandidates: discovery.newCandidateDomains.length,
    failedDiscoveryQueries: discovery.failedQueries,
    failedSeoKeywords: seoTracking.failedKeywords,
    reportsWritten,
    competitorsWithIssues,
  };
}

// Mirrors packages/jobs/src/types.ts's JobResult contract (spec
// 2026-08-25-local-orchestrator-design.md §2). Defined locally — not
// imported from @lhr/jobs — because that package doesn't exist in this
// worktree yet; the shape matches exactly, so it satisfies the real `Job`
// type structurally once the orchestrator sub-project wires this in.
export interface JobResult {
  status: 'success' | 'partial' | 'failure';
  summary: string;
  details?: Record<string, unknown>;
}

export function summaryToJobResult(summary: WeeklyCompetitorRunSummary): JobResult {
  const degraded =
    summary.failedDiscoveryQueries.length > 0 ||
    summary.failedSeoKeywords.length > 0 ||
    summary.competitorsWithIssues > 0;
  return {
    status: degraded ? 'partial' : 'success',
    summary: `Cycle ${summary.cycleId}: wrote ${summary.reportsWritten} report(s), ${summary.discoveredCandidates} new candidate(s) discovered.`,
    details: {
      discoveredCandidates: summary.discoveredCandidates,
      failedDiscoveryQueries: summary.failedDiscoveryQueries,
      failedSeoKeywords: summary.failedSeoKeywords,
      reportsWritten: summary.reportsWritten,
      competitorsWithIssues: summary.competitorsWithIssues,
    },
  };
}

export async function analyzeCompetitors(): Promise<JobResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL env var is required.');
  }
  requireEnv('SERPAPI_KEY');
  requireEnv('OPENROUTER_API_KEY');

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    return summaryToJobResult(summary);
  } finally {
    await pool.end();
  }
}
