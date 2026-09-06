import type { Candidate, OrchestratorRun } from '@lhr/db';
import type { TrendsReport, TrendSeedTopic, TrendCategory } from '@lhr/db';
import { TREND_CATEGORIES } from '@lhr/db';
import type { CandidateSummary } from 'lhr-authoring-mcp-server/dist-lib/recipeCandidates.js';

export interface JobStatusRow {
  name: string;
  cadenceDays: number;
  history: OrchestratorRun[];
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function describeRun(run: OrchestratorRun): string {
  const detail = escapeHtml(run.summary ?? run.errorMessage ?? '');
  const when = run.finishedAt ? run.finishedAt.toISOString() : 'in progress';
  return `${escapeHtml(run.status)} — ${detail} (${when})`;
}

// Shown above the job history so a picked recipe is visible — and rerollable — before any AI
// cycles are spent generating its diet variants (2026-08-30 "pick/approve" amendment).
function renderCandidateSection(candidate: CandidateSummary | null): string {
  if (!candidate) return '';
  const { id, record } = candidate;
  const { source } = record;
  return `
    <section>
      <h2>Recipe candidate awaiting approval</h2>
      <p><strong>${escapeHtml(source.title)}</strong> — ${escapeHtml(source.cuisine)} ${escapeHtml(source.category)} (TheMealDB id ${escapeHtml(source.idMeal)})</p>
      <form method="post" action="/status/candidate/${encodeURIComponent(id)}/approve" style="display:inline">
        <button type="submit">Approve</button>
      </form>
      <form method="post" action="/status/candidate/${encodeURIComponent(id)}/reroll" style="display:inline">
        <button type="submit">Reroll</button>
      </form>
    </section>`;
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

// Every money-ish number here is a projection off a static rate card and Keepa's sales estimate,
// never a figure Amazon has reported — so each one carries an explicit "Est." label. This must
// never read as real earnings data (see the affiliate-sourcing spec's estimates-only rule).
function renderAffiliateCandidate(candidate: Candidate): string {
  const commission = `${(candidate.commissionRate * 100).toFixed(1)}%`;
  const fallbackNote = candidate.commissionRateIsFallback ? ' (fallback rate — verify)' : '';
  const sales =
    candidate.estimatedMonthlySales === null
      ? 'No estimate available'
      : `~${candidate.estimatedMonthlySales.toLocaleString('en-US')}/mo`;
  return `
      <li>
        <p><strong>${escapeHtml(candidate.title)}</strong> — ${escapeHtml(candidate.category)} · ${formatPrice(candidate.priceCents)}${candidate.isWildcard ? ' · wildcard' : ''}</p>
        <p>Est. commission: ${commission}${fallbackNote}</p>
        <p>Est. monthly sales: ${escapeHtml(sales)}</p>
        <form method="post" action="/status/affiliate-candidates/${encodeURIComponent(String(candidate.id))}/approve" style="display:inline">
          <button type="submit">Approve</button>
        </form>
        <form method="post" action="/status/affiliate-candidates/${encodeURIComponent(String(candidate.id))}/deny" style="display:inline">
          <button type="submit">Deny</button>
        </form>
      </li>`;
}

// The weekly Keepa-sourced affiliate products awaiting a yes/no from the author. Rendered here
// rather than on a page of its own so every human-in-the-loop decision this orchestrator needs
// lives behind the one Basic-Auth-gated /status route.
export function renderAffiliateCandidatesSection(candidates: Candidate[]): string {
  if (candidates.length === 0) return '';
  return `
    <section>
      <h2>Affiliate candidates awaiting review</h2>
      <ul>${candidates.map(renderAffiliateCandidate).join('')}</ul>
    </section>`;
}

function renderTrendsReportRow(report: TrendsReport): string {
  return `
      <li>
        <p>${escapeHtml(report.cycleId)}: ${escapeHtml(report.summary)}</p>
        <details>
          <summary>Raw findings (${report.topicsUsed.length} topic(s) used)</summary>
          <pre>${escapeHtml(JSON.stringify(report.rawFindings, null, 2))}</pre>
        </details>
      </li>`;
}

// One shared /status view of every category's trends reports, most recent first per category —
// the same "everything lives on this one Basic-Auth-gated page" posture as the candidate sections
// above.
export function renderTrendsSection(reports: TrendsReport[]): string {
  if (reports.length === 0) return '';
  const byCategory = new Map<TrendCategory, TrendsReport[]>();
  for (const category of TREND_CATEGORIES) byCategory.set(category, []);
  for (const report of reports) {
    byCategory.get(report.category)?.push(report);
  }
  const categoryBlocks = TREND_CATEGORIES.map((category) => {
    const categoryReports = byCategory.get(category) ?? [];
    if (categoryReports.length === 0) return '';
    return `
      <h3>${escapeHtml(category)}</h3>
      <ul>${categoryReports.map(renderTrendsReportRow).join('')}</ul>`;
  }).join('');
  return `
    <section>
      <h2>Trends</h2>
      ${categoryBlocks}
    </section>`;
}

function renderTrendSeedTopic(topic: TrendSeedTopic): string {
  const nextStatus = topic.status === 'curated' ? 'candidate' : 'curated';
  const label = topic.status === 'curated' ? 'Demote' : 'Promote';
  return `
      <li>
        <p>${escapeHtml(topic.category)} / ${escapeHtml(topic.topic)} — ${escapeHtml(topic.status)}, seen ${topic.timesSeen}×</p>
        <form method="post" action="/status/trends/topics/${topic.id}/${nextStatus === 'curated' ? 'promote' : 'demote'}" style="display:inline">
          <button type="submit">${label}</button>
        </form>
      </li>`;
}

// Manual override sits alongside the automatic promotion mechanism (trendSeedTopics.ts) rather
// than replacing it — the author can act immediately without waiting three cycles.
export function renderTrendSeedTopicsSection(topics: TrendSeedTopic[]): string {
  return `
    <section>
      <h2>Trend seed topics</h2>
      <ul>${topics.map(renderTrendSeedTopic).join('')}</ul>
      <form method="post" action="/status/trends/topics/add">
        <select name="category">
          ${TREND_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}
        </select>
        <input type="text" name="topic" placeholder="New curated topic" required />
        <button type="submit">Add curated topic</button>
      </form>
    </section>`;
}

export function renderStatusPage(
  rows: JobStatusRow[],
  candidate: CandidateSummary | null = null,
  affiliateCandidates: Candidate[] = [],
  trendsReports: TrendsReport[] = [],
  trendSeedTopics: TrendSeedTopic[] = [],
): string {
  const sections = rows
    .map((row) => {
      const latest = row.history[0];
      const historyItems = row.history
        .map((run) => `<li>${describeRun(run)} — started ${run.startedAt.toISOString()}</li>`)
        .join('');
      return `
        <section>
          <h2>${escapeHtml(row.name)}</h2>
          <p>Cadence: every ${row.cadenceDays} days</p>
          <p>Latest: ${latest ? describeRun(latest) : 'never run'}</p>
          <ul>${historyItems}</ul>
          <form method="post" action="/status/run/${encodeURIComponent(row.name)}">
            <button type="submit">Run now</button>
          </form>
        </section>`;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Orchestrator status</title>
  </head>
  <body>
    <h1>Orchestrator status</h1>
    ${renderCandidateSection(candidate)}
    ${renderAffiliateCandidatesSection(affiliateCandidates)}
    ${renderTrendsSection(trendsReports)}
    ${renderTrendSeedTopicsSection(trendSeedTopics)}
    ${sections || '<p>No jobs registered yet.</p>'}
  </body>
</html>`;
}
