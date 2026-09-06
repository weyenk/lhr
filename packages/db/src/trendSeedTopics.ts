import type { Queryable } from './client.js';

export const TREND_CATEGORIES = ['web-design', 'cooking', 'nutrition'] as const;
export type TrendCategory = (typeof TREND_CATEGORIES)[number];

export interface TrendSeedTopic {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  timesSeen: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  promotedAt: Date | null;
}

type TrendSeedTopicRow = {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  times_seen: number;
  first_seen_at: Date;
  last_seen_at: Date;
  promoted_at: Date | null;
};

const PROMOTION_THRESHOLD = 3;

function mapRow(row: TrendSeedTopicRow): TrendSeedTopic {
  return {
    id: row.id,
    category: row.category,
    topic: row.topic,
    status: row.status,
    timesSeen: row.times_seen,
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
    promotedAt: row.promoted_at,
  };
}

export function normalizeTopic(topic: string): string {
  return topic.toLowerCase().trim();
}

export async function getCuratedTopics(db: Queryable, category: TrendCategory): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `SELECT * FROM trend_seed_topics WHERE category = $1 AND status = 'curated' ORDER BY topic ASC`,
    [category],
  );
  return result.rows.map(mapRow);
}

export async function getAllTopics(db: Queryable): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `SELECT * FROM trend_seed_topics ORDER BY category ASC, status ASC, times_seen DESC`,
  );
  return result.rows.map(mapRow);
}

export async function upsertSuggestedTopic(
  db: Queryable,
  category: TrendCategory,
  topic: string,
): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const result = await db.query<TrendSeedTopicRow>(
    `INSERT INTO trend_seed_topics (category, topic)
     VALUES ($1, $2)
     ON CONFLICT (category, topic)
     DO UPDATE SET times_seen = trend_seed_topics.times_seen + 1, last_seen_at = now()
     RETURNING *`,
    [category, normalized],
  );
  return mapRow(result.rows[0]);
}

export async function promoteEligibleCandidates(db: Queryable): Promise<TrendSeedTopic[]> {
  const result = await db.query<TrendSeedTopicRow>(
    `UPDATE trend_seed_topics
     SET status = 'curated', promoted_at = now()
     WHERE status = 'candidate' AND times_seen >= $1
     RETURNING *`,
    [PROMOTION_THRESHOLD],
  );
  return result.rows.map(mapRow);
}

export async function setTopicStatus(db: Queryable, id: number, status: 'curated' | 'candidate'): Promise<void> {
  if (status === 'curated') {
    await db.query(`UPDATE trend_seed_topics SET status = 'curated', promoted_at = now() WHERE id = $1`, [id]);
  } else {
    await db.query(`UPDATE trend_seed_topics SET status = 'candidate', promoted_at = NULL WHERE id = $1`, [id]);
  }
}

export async function addCuratedTopic(db: Queryable, category: TrendCategory, topic: string): Promise<TrendSeedTopic> {
  const normalized = normalizeTopic(topic);
  const result = await db.query<TrendSeedTopicRow>(
    `INSERT INTO trend_seed_topics (category, topic, status, times_seen, promoted_at)
     VALUES ($1, $2, 'curated', 1, now())
     ON CONFLICT (category, topic)
     DO UPDATE SET status = 'curated', promoted_at = now()
     RETURNING *`,
    [category, normalized],
  );
  return mapRow(result.rows[0]);
}
