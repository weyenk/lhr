import type { Pool, QueryResult } from 'pg';

export interface CompetitorPostSummary {
  title: string;
  url: string;
  publishedAt: string | null;
}

export interface SeoPositionEntry {
  keyword: string;
  position: number | null;
}

export interface NewCompetitorReport {
  competitorId: number;
  cycleId: string;
  newContent: CompetitorPostSummary[];
  seoPositions: SeoPositionEntry[];
  monetizationSnapshot: string;
  designSnapshot: string;
  summary: string;
}

export interface CompetitorReport extends NewCompetitorReport {
  id: number;
  generatedAt: Date;
}

interface CompetitorReportRow {
  id: number;
  competitor_id: number;
  cycle_id: string;
  generated_at: Date;
  new_content: CompetitorPostSummary[];
  seo_positions: SeoPositionEntry[];
  monetization_snapshot: string;
  design_snapshot: string;
  summary: string;
}

function rowToReport(row: CompetitorReportRow): CompetitorReport {
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
  };
}

export async function insertCompetitorReport(pool: Pool, report: NewCompetitorReport): Promise<CompetitorReport> {
  const res = (await pool.query(
    `INSERT INTO competitor_reports
      (competitor_id, cycle_id, new_content, seo_positions, monetization_snapshot, design_snapshot, summary)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      report.competitorId,
      report.cycleId,
      JSON.stringify(report.newContent),
      JSON.stringify(report.seoPositions),
      report.monetizationSnapshot,
      report.designSnapshot,
      report.summary,
    ],
  )) as QueryResult<CompetitorReportRow>;
  return rowToReport(res.rows[0]);
}

export async function getLatestReport(pool: Pool, competitorId: number): Promise<CompetitorReport | null> {
  const res = (await pool.query(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT 1`,
    [competitorId],
  )) as QueryResult<CompetitorReportRow>;
  return res.rows[0] ? rowToReport(res.rows[0]) : null;
}

export async function listRecentReports(pool: Pool, competitorId: number, limit = 10): Promise<CompetitorReport[]> {
  const res = (await pool.query(
    `SELECT * FROM competitor_reports WHERE competitor_id = $1 ORDER BY generated_at DESC LIMIT $2`,
    [competitorId, limit],
  )) as QueryResult<CompetitorReportRow>;
  return res.rows.map(rowToReport);
}
