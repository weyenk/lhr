import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchCompetitorPosts, diffNewPosts } from '../src/competitorContent';

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

const HOMEPAGE_WITH_FEED_LINK = `
<html><head>
<link rel="alternate" type="application/rss+xml" title="RSS" href="/feed.xml" />
</head><body>homepage</body></html>
`;

const RSS_FEED = `<?xml version="1.0"?>
<rss><channel>
<item><title>Sourdough Focaccia</title><link>https://example-recipes.com/sourdough-focaccia</link><pubDate>Thu, 20 Aug 2026 00:00:00 GMT</pubDate></item>
<item><title><![CDATA[Air Fryer Salmon]]></title><link>https://example-recipes.com/air-fryer-salmon</link><pubDate>Thu, 13 Aug 2026 00:00:00 GMT</pubDate></item>
</channel></rss>`;

const HOMEPAGE_NO_FEED_WITH_POST_LINKS = `
<html><body>
<a href="/blog/sourdough-focaccia">Sourdough Focaccia, straight from the oven</a>
<a href="/about">About</a>
</body></html>
`;

describe('fetchCompetitorPosts', () => {
  it('prefers RSS: discovers the feed link on the homepage and parses items from it', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://example-recipes.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED_LINK };
      if (u === 'https://example-recipes.com/feed.xml') return { ok: true, text: async () => RSS_FEED };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('example-recipes.com');

    expect(result.source).toBe('rss');
    expect(result.posts).toEqual([
      { title: 'Sourdough Focaccia', url: 'https://example-recipes.com/sourdough-focaccia', publishedAt: 'Thu, 20 Aug 2026 00:00:00 GMT' },
      { title: 'Air Fryer Salmon', url: 'https://example-recipes.com/air-fryer-salmon', publishedAt: 'Thu, 13 Aug 2026 00:00:00 GMT' },
    ]);
  });

  it('falls back to HTML listing extraction when no feed link is present', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://no-feed.com') return { ok: true, text: async () => HOMEPAGE_NO_FEED_WITH_POST_LINKS };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('no-feed.com');

    expect(result.source).toBe('html');
    expect(result.posts).toEqual([
      { title: 'Sourdough Focaccia, straight from the oven', url: 'https://no-feed.com/blog/sourdough-focaccia', publishedAt: null },
    ]);
  });

  it('falls back to HTML when the discovered feed URL fails to fetch', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string | URL) => {
      const u = url.toString();
      if (u === 'https://flaky-feed.com') return { ok: true, text: async () => HOMEPAGE_WITH_FEED_LINK.replace('example-recipes.com', 'flaky-feed.com') };
      if (u === 'https://flaky-feed.com/feed.xml') return { ok: false, status: 500 };
      throw new Error(`unexpected fetch ${u}`);
    }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('flaky-feed.com');
    expect(result.source).toBe('unparseable');
    expect(result.posts).toEqual([]);
  });

  it('returns unparseable, not a crash, when the homepage itself is unreachable', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network error')) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('down.com');
    expect(result).toEqual({ posts: [], source: 'unparseable' });
  });

  it('returns unparseable when neither RSS nor a parseable HTML listing is found', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => '<html><body>Nothing here.</body></html>' }) as unknown as typeof fetch;

    const result = await fetchCompetitorPosts('empty.com');
    expect(result).toEqual({ posts: [], source: 'unparseable' });
  });
});

describe('diffNewPosts', () => {
  it('returns only posts whose URL is not in the prior list', () => {
    const fetched = [
      { title: 'A', url: 'https://x.com/a', publishedAt: null },
      { title: 'B', url: 'https://x.com/b', publishedAt: null },
    ];
    const prior = [{ title: 'A', url: 'https://x.com/a', publishedAt: null }];
    expect(diffNewPosts(fetched, prior)).toEqual([{ title: 'B', url: 'https://x.com/b', publishedAt: null }]);
  });

  it('treats every fetched post as new when there is no prior list', () => {
    const fetched = [{ title: 'A', url: 'https://x.com/a', publishedAt: null }];
    expect(diffNewPosts(fetched, [])).toEqual(fetched);
  });
});
