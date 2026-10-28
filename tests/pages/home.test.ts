import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/lib/posts', async () => {
  const { loadHomePagePostViews } = await import('../fixtures/contentPostViews');
  const publishedPosts = loadHomePagePostViews();
  return {
    countPublished: async () => publishedPosts.length,
    getPublishedPostsPage: async (offset: number, limit: number) =>
      publishedPosts.slice(offset, offset + limit),
  };
});

import HomePage from '../../src/pages/[...page].astro';

async function renderHomePage(pageSegment?: string): Promise<string> {
  const container = await AstroContainer.create();
  return container.renderToString(HomePage, {
    params: pageSegment ? { page: pageSegment } : {},
  });
}

describe('home page', () => {
  it('renders the site title', async () => {
    const html = await renderHomePage();
    expect(html).toContain('Love Heat Relationship');
  });

  it('shows the most recent post as the hero, only on page 1', async () => {
    const page1 = await renderHomePage();
    expect(page1).toContain('home__featured');
    expect(page1).toContain(
      'href="/posts/double-fried-sesame-chicken-recreating-an-atlanta-favorite-at-home/"',
    );

    const page2 = await renderHomePage('2');
    expect(page2).not.toContain('home__featured');
  });

  it('shows exactly 5 article cards on page 1, excluding the hero post', async () => {
    const html = await renderHomePage();
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/pollo-alla-cacciatora/"');
    expect(html).toContain(
      'href="/posts/smothered-in-green-a-30-minute-burrito-for-long-day-nights/"',
    );
    expect(html).toContain('href="/posts/egg-roll-in-a-bowl/"');
    expect(html).toContain(
      'href="/posts/southwest-burritos-with-southwest-ranch-dipping-sauce/"',
    );
    expect(html).toContain(
      'href="/posts/corn-dogs-under-the-grandstand-lights-a-wisconsin-state-fair-summer/"',
    );
  });

  it('renders a truncated excerpt on each article card', async () => {
    const html = await renderHomePage();
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('Skip the delivery with this ultimate low-carb date night pizza!');
  });

  it('paginates to a second page with the next 5 posts and a link back', async () => {
    const html = await renderHomePage('2');
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/hugo-spritz/"');

    const paginationNav = html.match(/<nav class="home__pagination[^>]*>[\s\S]*?<\/nav>/);
    expect(paginationNav).not.toBeNull();
    expect(paginationNav![0]).toContain('href="/"');
  });

  it('renders numbered pagination controls with the current page marked', async () => {
    const html = await renderHomePage();
    expect(html).toContain('home__pagination');
    expect(html).toContain('aria-current="page"');
  });

  it('has a final page with just the oldest leftover posts', async () => {
    const html = await renderHomePage('6');
    expect((html.match(/article-card/g) ?? []).length).toBe(3);
    expect(html).toContain('href="/posts/arancini-a-sicilian-street-food-sensation/"');
  });

  it('tags each card with its post type', async () => {
    const html = await renderHomePage();
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
  });

  it('hides the sidebar below the md breakpoint', async () => {
    const html = await renderHomePage();
    expect(html).toContain('home__sidebar hidden md:block');
  });

  it('sizes the sidebar to roughly match the main column on each page', async () => {
    const countItems = (html: string) => (html.match(/home__recent-item/g) ?? []).length;

    const page1 = await renderHomePage();
    expect(countItems(page1)).toBe(4);

    const page2 = await renderHomePage('2');
    expect(countItems(page2)).toBe(3);

    const page5 = await renderHomePage('5');
    expect(countItems(page5)).toBe(3);

    const page6 = await renderHomePage('6');
    expect(countItems(page6)).toBe(0);
  });

  it('renders sidebar items as borderless image cards with a subheadline', async () => {
    const html = await renderHomePage();
    const sidebarMatch = html.match(/<ul class="home__recent-list[^>]*>[\s\S]*?<\/ul>/);
    expect(sidebarMatch).not.toBeNull();
    const sidebarHtml = sidebarMatch![0];

    expect(sidebarHtml).toContain('<img');
    expect(sidebarHtml).not.toContain('bg-white');
    expect(sidebarHtml).not.toContain('shadow-md');

    const listOpenTag = sidebarHtml.match(/<ul class="home__recent-list[^>]*>/)![0];
    expect(listOpenTag).toMatch(/\bspace-y-/);
    expect(listOpenTag).not.toMatch(/(^|\s)flex(\s|")/);
  });

  it('never repeats a page\'s own cards in its sidebar', async () => {
    for (const pageSegment of [undefined, '2', '3'] as const) {
      const html = await renderHomePage(pageSegment);
      const sidebar = html.match(/<ul class="home__recent-list[^>]*>[\s\S]*?<\/ul>/)![0];
      const sidebarHrefs = new Set(
        [...sidebar.matchAll(/href="\/posts\/([^"]+)\//g)].map((m) => m[1]),
      );
      const cardHrefs = [
        ...html.matchAll(/<a href="\/posts\/([^"]+)\/" class="article-card/g),
      ].map((m) => m[1]);
      expect(cardHrefs.filter((h) => sidebarHrefs.has(h))).toEqual([]);
    }
  });
});
