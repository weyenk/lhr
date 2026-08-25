import type { Pool, QueryResult } from 'pg';
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

interface TrendsReportRow {
  id: number;
  cycle_id: string;
  category: TrendCategory;
  generated_at: Date;
  topics_used: TopicUsed[];
  raw_findings: unknown;
  summary: string;
}

function rowToReport(row: TrendsReportRow): TrendsReport {
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

export async function insertTrendsReport(pool: Pool, report: NewTrendsReport): Promise<TrendsReport> {
  const res = (await pool.query(
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
  )) as QueryResult<TrendsReportRow>;
  return rowToReport(res.rows[0]);
}

export async function listRecentReports(pool: Pool, category: TrendCategory, limit = 10): Promise<TrendsReport[]> {
  const res = (await pool.query(
    `SELECT * FROM trends_reports WHERE category = $1 ORDER BY generated_at DESC LIMIT $2`,
    [category, limit],
  )) as QueryResult<TrendsReportRow>;
  return res.rows.map(rowToReport);
}
