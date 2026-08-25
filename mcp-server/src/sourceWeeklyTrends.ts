import type { Pool } from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import {
  TREND_CATEGORIES,
  type TrendCategory,
  getCuratedTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  insertTrendsReport,
  normalizeTopic,
  type TopicUsed,
} from '@lhr/db';
import { fetchInterestAndRelatedQueries, fetchTrendingNow, type InterestAndRelatedQueries, type TrendingNowItem } from './serpapiTrends.js';
import { callOpenRouter } from './openrouter.js';
import { parsePostFrontmatter } from './backfillIngredientLinks.js';

const SUGGESTIONS_PER_CATEGORY = 2;
const RECENT_POST_LIMIT = 15;
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';

interface TopicFinding {
  topic: string;
  source: 'curated' | 'suggested';
  interest: InterestAndRelatedQueries;
}

export interface CategoryCycleResult {
  category: TrendCategory;
  topicsUsed: TopicUsed[];
  callCount: number;
}

function readConstitution(repoRoot: string): string {
  return readFileSync(path.join(repoRoot, 'docs/CONSTITUTION.md'), 'utf-8');
}

function readRecentPostTitles(repoRoot: string, limit: number): string[] {
  const postsDir = path.join(repoRoot, 'src/content/posts');
  const files = readdirSync(postsDir).filter((f) => f.endsWith('.mdx'));
  const titles: string[] = [];
  for (const file of files.slice(0, limit)) {
    try {
      const content = readFileSync(path.join(postsDir, file), 'utf-8');
      const frontmatter = parsePostFrontmatter(content);
      if (typeof frontmatter.title === 'string') titles.push(frontmatter.title);
    } catch {
      // Skip a post whose frontmatter doesn't parse rather than fail the whole cycle.
    }
  }
  return titles;
}

async function suggestAdjacentTopics(category: TrendCategory, curated: string[]): Promise<string[]> {
  const reply = await callOpenRouter([
    {
      role: 'system',
      content:
        'You suggest search topics for a Google Trends watch list. Reply with a JSON array of ' +
        `up to ${SUGGESTIONS_PER_CATEGORY} short topic strings, nothing else.`,
    },
    {
      role: 'user',
      content:
        `Category: ${category}\nCurrent curated topics: ${curated.length ? curated.join(', ') : '(none yet)'}\n` +
        `Suggest up to ${SUGGESTIONS_PER_CATEGORY} adjacent topics worth trying this cycle.`,
    },
  ]);
  try {
    const parsed = JSON.parse(reply) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string').slice(0, SUGGESTIONS_PER_CATEGORY);
  } catch {
    return [];
  }
}

async function synthesizeSummary(params: {
  category: TrendCategory;
  findings: TopicFinding[];
  trendingNow: TrendingNowItem[];
  constitution: string;
  recentPostTitles: string[];
}): Promise<string> {
  const findingsText =
    params.findings
      .map(
        (f) =>
          `- ${f.topic} (${f.source}): direction=${f.interest.direction}, rising queries: ` +
          `${f.interest.risingQueries.map((q) => q.query).join(', ') || 'none'}`,
      )
      .join('\n') || '(no topic data succeeded this cycle)';
  const trendingText = params.trendingNow.map((t) => `- ${t.query}`).join('\n') || '(none)';

  try {
    return await callOpenRouter([
      {
        role: 'system',
        content:
          'You write a short "what is worth knowing this week" summary for a recipe site owner, given ' +
          'raw Google Trends signal for one category. Flag both what already aligns with her existing ' +
          'content and what she does not cover yet. Two to four sentences.',
      },
      {
        role: 'user',
        content:
          `Category: ${params.category}\n\nSite principles:\n${params.constitution}\n\n` +
          `Recent post titles:\n${params.recentPostTitles.join('\n') || '(none)'}\n\n` +
          `This cycle's topic findings:\n${findingsText}\n\nWildcard trending-now items:\n${trendingText}`,
      },
    ]);
  } catch {
    return SUMMARY_FAILURE_PLACEHOLDER;
  }
}

export async function runWeeklyTrendsCycle(pool: Pool, repoRoot: string): Promise<CategoryCycleResult[]> {
  const cycleId = new Date().toISOString().slice(0, 10);
  const constitution = readConstitution(repoRoot);
  const recentPostTitles = readRecentPostTitles(repoRoot, RECENT_POST_LIMIT);

  const results: CategoryCycleResult[] = [];

  for (const category of TREND_CATEGORIES) {
    let callCount = 0;

    const curated = await getCuratedTopics(pool, category);
    const curatedTopics = curated.map((t) => t.topic);
    const curatedNormalized = new Set(curatedTopics.map(normalizeTopic));
    const suggestedRaw = await suggestAdjacentTopics(category, curatedTopics);

    const seenNormalized = new Set<string>();
    const suggested: string[] = [];
    for (const topic of suggestedRaw) {
      const normalized = normalizeTopic(topic);
      if (curatedNormalized.has(normalized) || seenNormalized.has(normalized)) continue;
      seenNormalized.add(normalized);
      suggested.push(topic);
    }

    const candidateTopics: TopicUsed[] = [
      ...curatedTopics.map((topic) => ({ topic, source: 'curated' as const })),
      ...suggested.map((topic) => ({ topic, source: 'suggested' as const })),
    ];

    const findings: TopicFinding[] = [];
    const topicsUsed: TopicUsed[] = [];
    for (const { topic, source } of candidateTopics) {
      callCount += 1;
      try {
        const interest = await fetchInterestAndRelatedQueries(topic);
        findings.push({ topic, source, interest });
        topicsUsed.push({ topic, source });
      } catch (err) {
        console.error(
          `[trends] fetchInterestAndRelatedQueries failed for "${topic}" (${category}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    callCount += 1;
    let trendingNow: TrendingNowItem[] = [];
    try {
      trendingNow = await fetchTrendingNow(category);
    } catch (err) {
      console.error(`[trends] fetchTrendingNow failed for ${category}: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const topic of suggested) {
      await upsertSuggestedTopic(pool, category, topic);
    }
    await promoteEligibleCandidates(pool);

    const summary = await synthesizeSummary({ category, findings, trendingNow, constitution, recentPostTitles });

    await insertTrendsReport(pool, {
      cycleId,
      category,
      topicsUsed,
      rawFindings: { topics: findings, trendingNow },
      summary,
    });

    console.log(`[trends] ${category}: ${callCount} SerpApi call(s) this cycle`);
    results.push({ category, topicsUsed, callCount });
  }

  return results;
}
