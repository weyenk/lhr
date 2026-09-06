import type { JobResult } from '@lhr/jobs';
import {
  TREND_CATEGORIES,
  type TrendCategory,
  getCuratedTopics,
  upsertSuggestedTopic,
  promoteEligibleCandidates,
  insertTrendsReport,
  getPool,
  type TopicUsed,
} from '@lhr/db';
import { fetchInterestAndRelatedQueries, fetchTrendingNow, type InterestAndRelatedQueries, type TrendingNowItem } from './serpapiTrends.js';
import { callLLM } from '@lhr/llm';
import { createGitHubClient, getFile, listFiles, type GitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import { parsePostFrontmatter } from 'lhr-authoring-mcp-server/dist-lib/backfillIngredientLinks.js';

const SUGGESTIONS_PER_CATEGORY = 2;
const RECENT_POST_LIMIT = 15;
const SUMMARY_FAILURE_PLACEHOLDER = '[Summary generation failed this cycle]';

interface TopicFinding {
  topic: string;
  source: 'curated' | 'suggested';
  interest: InterestAndRelatedQueries;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

async function readConstitution(client: GitHubClient): Promise<string> {
  const file = await getFile(client, 'docs/CONSTITUTION.md', 'main');
  return file?.content ?? '';
}

async function readRecentPostTitles(client: GitHubClient, limit: number): Promise<string[]> {
  const filenames = await listFiles(client, 'src/content/posts', 'main');
  const titles: string[] = [];
  for (const filename of filenames.filter((f) => f.endsWith('.mdx')).slice(0, limit)) {
    const file = await getFile(client, `src/content/posts/${filename}`, 'main');
    if (!file) continue;
    try {
      const frontmatter = parsePostFrontmatter(file.content);
      if (typeof frontmatter.title === 'string') titles.push(frontmatter.title);
    } catch {
      // Skip a post whose frontmatter doesn't parse rather than fail the whole cycle.
    }
  }
  return titles;
}

async function suggestAdjacentTopics(category: TrendCategory, curated: string[]): Promise<string[]> {
  const reply = await callLLM([
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
    return await callLLM([
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

export async function sourceWeeklyTrends(): Promise<JobResult> {
  const client = createGitHubClient(requireEnv('GITHUB_TOKEN'));
  requireEnv('SERPAPI_KEY');
  const pool = getPool();

  const cycleId = new Date().toISOString().slice(0, 10);
  const constitution = await readConstitution(client);
  const recentPostTitles = await readRecentPostTitles(client, RECENT_POST_LIMIT);

  const partialCategories: string[] = [];

  for (const category of TREND_CATEGORIES) {
    let callCount = 0;

    const curated = await getCuratedTopics(pool, category);
    const curatedTopics = curated.map((t) => t.topic);
    const curatedNormalized = new Set(curatedTopics.map((t) => t.toLowerCase().trim()));

    const suggestedRaw = await suggestAdjacentTopics(category, curatedTopics);
    const seenNormalized = new Set<string>();
    const suggested: string[] = [];
    for (const topic of suggestedRaw) {
      const normalized = topic.toLowerCase().trim();
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
    let hadTopicFailure = false;
    for (const { topic, source } of candidateTopics) {
      callCount += 2;
      try {
        const interest = await fetchInterestAndRelatedQueries(topic);
        findings.push({ topic, source, interest });
        topicsUsed.push({ topic, source });
      } catch (err) {
        hadTopicFailure = true;
        console.warn(
          `[trends] fetchInterestAndRelatedQueries failed for "${topic}" (${category}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    callCount += 1;
    let trendingNow: TrendingNowItem[] = [];
    try {
      trendingNow = await fetchTrendingNow(category);
    } catch (err) {
      hadTopicFailure = true;
      console.warn(`[trends] fetchTrendingNow failed for ${category}: ${err instanceof Error ? err.message : String(err)}`);
    }

    for (const topic of suggested) {
      await upsertSuggestedTopic(pool, category, topic);
    }

    const summary = await synthesizeSummary({ category, findings, trendingNow, constitution, recentPostTitles });
    if (summary === SUMMARY_FAILURE_PLACEHOLDER || hadTopicFailure) {
      partialCategories.push(category);
    }

    await insertTrendsReport(pool, {
      cycleId,
      category,
      topicsUsed,
      rawFindings: { topics: findings, trendingNow },
      summary,
    });

    console.log(`[trends] ${category}: ${callCount} SerpApi call(s) this cycle`);
  }

  await promoteEligibleCandidates(pool);

  if (partialCategories.length > 0) {
    return {
      status: 'partial',
      summary: `Wrote reports for all 3 categories; ${partialCategories.join(', ')} had a partial cycle (skipped topic or fallback summary).`,
    };
  }
  return { status: 'success', summary: 'Wrote a trends report for all 3 categories.' };
}
