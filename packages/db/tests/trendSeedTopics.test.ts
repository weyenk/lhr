import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  normalizeTopic,
  getCuratedTopics,
  getAllTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  setTopicStatus,
  addCuratedTopic,
} from '../src/trendSeedTopics';

function mockPool(rows: unknown[] = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

const topicRow = {
  id: 1, category: 'cooking', topic: 'air fryer recipes', status: 'candidate', times_seen: 2,
  first_seen_at: new Date('2026-08-01T00:00:00Z'), last_seen_at: new Date('2026-08-15T00:00:00Z'), promoted_at: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('normalizeTopic', () => {
  it('lowercases and trims without any fuzzy matching', () => {
    expect(normalizeTopic('  Air Fryer Recipes  ')).toBe('air fryer recipes');
    expect(normalizeTopic('AIR FRYER RECIPES')).toBe('air fryer recipes');
  });
});

describe('getCuratedTopics', () => {
  it('queries curated rows for one category', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated' }]);
    const result = await getCuratedTopics(pool as never, 'cooking');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'curated'"), ['cooking']);
    expect(result[0].status).toBe('curated');
  });
});

describe('getAllTopics', () => {
  it('returns every topic across categories', async () => {
    const pool = mockPool([topicRow]);
    const result = await getAllTopics(pool as never);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      id: 1, category: 'cooking', topic: 'air fryer recipes', status: 'candidate', timesSeen: 2,
      firstSeenAt: topicRow.first_seen_at, lastSeenAt: topicRow.last_seen_at, promotedAt: null,
    });
  });
});

describe('upsertSuggestedTopic', () => {
  it('normalizes the topic and issues an insert-or-increment upsert', async () => {
    const pool = mockPool([topicRow]);
    await upsertSuggestedTopic(pool as never, 'cooking', '  Air Fryer Recipes  ');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (category, topic)'),
      ['cooking', 'air fryer recipes'],
    );
    expect(pool.query.mock.calls[0][0]).toContain('times_seen = trend_seed_topics.times_seen + 1');
  });
});

describe('promoteEligibleCandidates', () => {
  it('promotes only candidates at or above the threshold', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated', times_seen: 3, promoted_at: new Date() }]);
    const result = await promoteEligibleCandidates(pool as never);
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'candidate' AND times_seen >= $1"), [3]);
    expect(result[0].status).toBe('curated');
  });
});

describe('setTopicStatus', () => {
  it('sets promoted_at when manually promoting to curated', async () => {
    const pool = mockPool();
    await setTopicStatus(pool as never, 1, 'curated');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'curated'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('promoted_at = now()');
  });

  it('clears promoted_at when demoting to candidate', async () => {
    const pool = mockPool();
    await setTopicStatus(pool as never, 1, 'candidate');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("status = 'candidate'"), [1]);
    expect(pool.query.mock.calls[0][0]).toContain('promoted_at = NULL');
  });
});

describe('addCuratedTopic', () => {
  it('inserts (or upgrades) a topic directly as curated', async () => {
    const pool = mockPool([{ ...topicRow, status: 'curated', promoted_at: new Date() }]);
    const result = await addCuratedTopic(pool as never, 'cooking', 'Sourdough');
    expect(pool.query).toHaveBeenCalledWith(expect.stringContaining("'curated'"), ['cooking', 'sourdough']);
    expect(result.status).toBe('curated');
  });
});
