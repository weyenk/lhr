import { Pool } from 'pg';
import { runDiscovery } from './competitorDiscovery.js';
import { trackSeoPositions } from './competitorSeoTracking.js';
import { fetchCompetitorPosts, diffNewPosts, type CompetitorPost } from './competitorContent.js';
import { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } from './competitorSnapshots.js';
import { callOpenRouter } from './openrouter.js';
import { computeCycleId } from './computeCycleId.js';
import {
  listCompetitorsByStatus,
  getLatestReport,
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
}

async function buildCompetitorReport(
  pool: Pool,
  competitor: Pick<Competitor, 'id' | 'domain'>,
  cycleId: string,
  seoPositions: SeoPositionEntry[],
): Promise<NewCompetitorReport> {
  const priorReport = await getLatestReport(pool, competitor.id);

  let newContent: CompetitorPost[] = [];
  let contentDescriptor: string;
  try {
    const { posts, source } = await fetchCompetitorPosts(competitor.domain);
    if (source === 'unparseable') {
      contentDescriptor = UNREACHABLE_NOTE;
    } else {
      newContent = diffNewPosts(posts, priorReport?.newContent ?? []);
      contentDescriptor = newContent.length > 0 ? JSON.stringify(newContent) : 'no new content this cycle';
    }
  } catch {
    contentDescriptor = UNREACHABLE_NOTE;
  }

  let monetizationSnapshot: string;
  let designSnapshot: string;
  try {
    const pageText = await fetchHomepageText(competitor.domain);
    const [monetization, design] = await Promise.all([
      summarizeMonetization(competitor.domain, pageText),
      summarizeDesign(competitor.domain, pageText),
    ]);
    monetizationSnapshot = await diffSnapshot(priorReport?.monetizationSnapshot ?? null, monetization);
    designSnapshot = await diffSnapshot(priorReport?.designSnapshot ?? null, design);
  } catch {
    monetizationSnapshot = UNREACHABLE_NOTE;
    designSnapshot = UNREACHABLE_NOTE;
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
          `Monetization change: ${monetizationSnapshot}`,
          `Design change: ${designSnapshot}`,
        ].join('\n'),
      },
    ]);
  } catch {
    summary = SYNTHESIS_FAILURE_PLACEHOLDER;
  }

  return {
    competitorId: competitor.id,
    cycleId,
    newContent,
    seoPositions,
    monetizationSnapshot,
    designSnapshot,
    summary,
  };
}

export async function runWeeklyCompetitorAnalysis(pool: Pool): Promise<WeeklyCompetitorRunSummary> {
  const discovery = await runDiscovery(pool);
  const seoTracking = await trackSeoPositions(pool);
  const tracked = await listCompetitorsByStatus(pool, 'tracked');
  const cycleId = computeCycleId(new Date());

  let reportsWritten = 0;
  for (const competitor of tracked) {
    const seoPositions = seoTracking.positionsByCompetitorId.get(competitor.id) ?? [];
    const report = await buildCompetitorReport(pool, competitor, cycleId, seoPositions);
    await insertCompetitorReport(pool, report);
    reportsWritten += 1;
  }

  return {
    cycleId,
    discoveredCandidates: discovery.newCandidateDomains.length,
    failedDiscoveryQueries: discovery.failedQueries,
    failedSeoKeywords: seoTracking.failedKeywords,
    reportsWritten,
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
  const degraded = summary.failedDiscoveryQueries.length > 0 || summary.failedSeoKeywords.length > 0;
  return {
    status: degraded ? 'partial' : 'success',
    summary: `Cycle ${summary.cycleId}: wrote ${summary.reportsWritten} report(s), ${summary.discoveredCandidates} new candidate(s) discovered.`,
    details: {
      discoveredCandidates: summary.discoveredCandidates,
      failedDiscoveryQueries: summary.failedDiscoveryQueries,
      failedSeoKeywords: summary.failedSeoKeywords,
      reportsWritten: summary.reportsWritten,
    },
  };
}

export async function analyzeCompetitors(): Promise<JobResult> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL env var is required.');
  }

  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const summary = await runWeeklyCompetitorAnalysis(pool);
    return summaryToJobResult(summary);
  } finally {
    await pool.end();
  }
}
