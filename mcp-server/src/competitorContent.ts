export interface CompetitorPost {
  title: string;
  url: string;
  publishedAt: string | null;
}

export type ContentFetchSource = 'rss' | 'html' | 'unparseable';

export interface CompetitorContentResult {
  posts: CompetitorPost[];
  source: ContentFetchSource;
}

const MAX_HTML_CHARS = 200_000;

function stripCdata(text: string): string {
  const match = text.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return match ? match[1] : text;
}

function extractTag(block: string, tag: string): string | null {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripCdata(match[1]).trim() : null;
}

function parseRssItems(xml: string): CompetitorPost[] {
  const itemBlocks = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) ?? [];
  const posts: CompetitorPost[] = [];
  for (const block of itemBlocks) {
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    const pubDate = extractTag(block, 'pubDate');
    if (title && link) {
      posts.push({ title, url: link, publishedAt: pubDate });
    }
  }
  return posts;
}

function discoverFeedUrl(homepageHtml: string, baseUrl: string): string | null {
  const linkTagMatch = homepageHtml.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*>/i);
  if (!linkTagMatch) return null;
  const hrefMatch = linkTagMatch[0].match(/href=["']([^"']+)["']/i);
  if (!hrefMatch) return null;
  try {
    return new URL(hrefMatch[1], baseUrl).toString();
  } catch {
    return null;
  }
}

function parseHtmlListingFallback(html: string, baseUrl: string): CompetitorPost[] {
  const anchorMatches = html.match(/<a\s[^>]*href=["'][^"']+["'][^>]*>[\s\S]*?<\/a>/gi) ?? [];
  const posts: CompetitorPost[] = [];
  const seenUrls = new Set<string>();

  for (const anchor of anchorMatches) {
    const hrefMatch = anchor.match(/href=["']([^"']+)["']/i);
    if (!hrefMatch) continue;

    let url: string;
    try {
      url = new URL(hrefMatch[1], baseUrl).toString();
    } catch {
      continue;
    }
    if (!/\/(20\d\d|blog|posts?|recipes?)\//i.test(url)) continue;

    const text = anchor.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || text.length < 8) continue;
    if (seenUrls.has(url)) continue;

    seenUrls.add(url);
    posts.push({ title: text, url, publishedAt: null });
  }

  return posts;
}

export async function fetchCompetitorPosts(domain: string): Promise<CompetitorContentResult> {
  const baseUrl = `https://${domain}`;

  let homepageHtml: string;
  try {
    const homepageRes = await fetch(baseUrl);
    if (!homepageRes.ok) throw new Error(`status ${homepageRes.status}`);
    homepageHtml = (await homepageRes.text()).slice(0, MAX_HTML_CHARS);
  } catch {
    return { posts: [], source: 'unparseable' };
  }

  const feedUrl = discoverFeedUrl(homepageHtml, baseUrl);
  if (feedUrl) {
    try {
      const feedRes = await fetch(feedUrl);
      if (feedRes.ok) {
        const xml = await feedRes.text();
        const posts = parseRssItems(xml);
        if (posts.length > 0) {
          return { posts, source: 'rss' };
        }
      }
    } catch {
      // Fall through to the HTML fallback below.
    }
  }

  const htmlPosts = parseHtmlListingFallback(homepageHtml, baseUrl);
  if (htmlPosts.length > 0) {
    return { posts: htmlPosts, source: 'html' };
  }

  return { posts: [], source: 'unparseable' };
}

export function diffNewPosts(fetchedPosts: CompetitorPost[], priorPosts: CompetitorPost[]): CompetitorPost[] {
  const priorUrls = new Set(priorPosts.map((p) => p.url));
  return fetchedPosts.filter((p) => !priorUrls.has(p.url));
}
