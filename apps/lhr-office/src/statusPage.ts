import type { Candidate, OrchestratorRun } from '@lhr/db';
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

export function renderStatusPage(
  rows: JobStatusRow[],
  candidate: CandidateSummary | null = null,
  affiliateCandidates: Candidate[] = [],
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
    ${sections || '<p>No jobs registered yet.</p>'}
  </body>
</html>`;
}
