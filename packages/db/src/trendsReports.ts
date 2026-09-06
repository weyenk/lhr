import type { Queryable } from './client.js';
import type { TrendCategory } from './trendSeedTopics.js';

export interface TopicUsed {
  topic: string;
  source: 'curated' | 'suggested';
}

export interface TrendsReport {
  id: number;
  cycleId: string;
  category: TrendCategory;
  generatedAt: Date;
  topicsUsed: TopicUsed[];
  rawFindings: unknown;
  summary: string;
}

export interface NewTrendsReport {
  cycleId: string;
  category: TrendCategory;
  topicsUsed: TopicUsed[];
  rawFindings: unknown;
  summary: string;
}

type TrendsReportRow = {
  id: number;
  cycle_id: string;
  category: TrendCategory;
  generated_at: Date;
  topics_used: TopicUsed[];
  raw_findings: unknown;
  summary: string;
};

function mapRow(row: TrendsReportRow): TrendsReport {
  return {
    id: row.id,
    cycleId: row.cycle_id,
    category: row.category,
    generatedAt: row.generated_at,
    topicsUsed: row.topics_used,
    rawFindings: row.raw_findings,
    summary: row.summary,
  };
}

export async function insertTrendsReport(db: Queryable, report: NewTrendsReport): Promise<TrendsReport> {
  const result = await db.query<TrendsReportRow>(
    `INSERT INTO trends_reports (cycle_id, category, topics_used, raw_findings, summary)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      report.cycleId,
      report.category,
      JSON.stringify(report.topicsUsed),
      JSON.stringify(report.rawFindings),
      report.summary,
    ],
  );
  return mapRow(result.rows[0]);
}

export async function listRecentReports(db: Queryable, category: TrendCategory, limit = 10): Promise<TrendsReport[]> {
  const result = await db.query<TrendsReportRow>(
    `SELECT * FROM trends_reports WHERE category = $1 ORDER BY generated_at DESC LIMIT $2`,
    [category, limit],
  );
  return result.rows.map(mapRow);
}
