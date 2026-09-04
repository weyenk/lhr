import type { OrchestratorRun } from '@lhr/db';
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

export function renderStatusPage(rows: JobStatusRow[], candidate: CandidateSummary | null = null): string {
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
    ${sections || '<p>No jobs registered yet.</p>'}
  </body>
</html>`;
}
