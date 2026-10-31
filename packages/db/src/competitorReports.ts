import type { Queryable } from './client.js';

export interface CompetitorPostSummary {
  title: string;
  url: string;
  publishedAt: string | null;
}

export interface SeoPositionEntry {
  keyword: string;
  position: number | null;
}

export interface OverlapScores {
  market: number;
  content: number;
  product: number;
  threat: number;
}

export const ZERO_OVERLAP_SCORES: OverlapScores = {
  market: 0,
  content: 0,
  product: 0,
  threat: 0,
};

export interface NewCompetitorReport {
  competitorId: number;
  cycleId: string;
  newContent: CompetitorPostSummary[];
  seoPositions: SeoPositionEntry[];
  monetizationSnapshot: string;
  designSnapshot: string;
  summary: string;
  overlapScores: OverlapScores;
  decisionBrief: string;
  suggestedActions: string[];
}

export interface CompetitorReport extends NewCompetitorReport {
  id: number;
  generatedAt: Date;
}

type CompetitorReportRow = {
  id: number;
  competitor_id: number;
  cycle_id: string;
  generated_at: Date;
  new_content: CompetitorPostSummary[];
  seo_positions: SeoPositionEntry[];
  monetization_snapshot: string;
  design_snapshot: string;
  summary: string;
  overlap_scores: OverlapScores | null;
  decision_brief: string | null;
  suggested_actions: string[] | null;
};

function mapRow(row: CompetitorReportRow): CompetitorReport {
  return {
    id: row.id,
    competitorId: row.competitor_id,
    cycleId: row.cycle_id,
    generatedAt: row.generated_at,
    newContent: row.new_content,
    seoPositions: row.seo_positions,
    monetizationSnapshot: row.monetization_snapshot,
    designSnapshot: row.design_snapshot,
    summary: row.summary,
    overlapScores: row.overlap_scores ?? ZERO_OVERLAP_SCORES,
    decisionBrief: row.decision_brief ?? row.summary,
    suggestedActions: row.suggested_actions ?? [],
  };
}

export async function insertCompetitorReport(db: Queryable, report: NewCompetitorReport): Promise<CompetitorReport> {
  const result = await db.query<CompetitorReportRow>(
    `INSERT INTO competitor_reports
      (competitor_id, cycle_id, new_content, seo_positions, monetization_snapshot, design_snapshot, summary,
       overlap_scores, decision_brief, suggested_actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      report.competitorId,
      report.cycleId,
      JSON.stringify(report.newContent),
      JSON.stringify(report.seoPositions),
      report.monetizationSnapshot,
      report.designSnapshot,
      report.summary,
      JSON.stringify(report.overlapScores),
      report.decisionBrief,
      JSON.stringify(report.suggestedActions),
    ],
  );
  return mapRow(result.rows[0]);
}

export async function listRecentCompetitorReports(db: Queryable, competitorId: number, limit = 10): Promise<CompetitorReport[]> {
  const result = await db.query<CompetitorReportRow>(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT $2`,
    [competitorId, limit],
  );
  return result.rows.map(mapRow);
}
