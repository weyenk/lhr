import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('home page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the site title', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('Love Heat Relationship');
  });

  it('shows the most recent post as the hero, only on page 1', () => {
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(page1).toContain('home__featured');
    expect(page1).toContain('href="/posts/when-gray-skies-call-for-warm-spice-an-apple-cinnamon-muffin-story/"');
    expect(page1).toContain('When Gray Skies Call for Warm Spice: An Apple Cinnamon Muffin Story');

    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(page2).not.toContain('home__featured');
  });

  it('shows exactly 5 article cards on page 1, excluding the hero post', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    // Count occurrences of the card's own class rather than checking
    // individual post hrefs are absent — a post's href could otherwise
    // appear elsewhere on the page (e.g. via a future feature), and this
    // assertion is only about how many article-cards render on page 1.
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/date-night-chicken-crust-pizza-with-whiskey-caramelized-onions-amp-bacon/"');
    expect(html).toContain('href="/posts/oaxacan-velvet-the-grounding-ritual-of-chicken-mole-negro/"');
    expect(html).toContain('href="/posts/the-pursuit-of-wok-hei-sesame-chicken-at-home/"');
    expect(html).toContain('href="/posts/suan-la-fen-a-journey-to-the-heart-of-sichuan-from-my-own-kitchen/"');
    expect(html).toContain('href="/posts/lemon-pepper-wet-an-atlanta-homecoming/"');
  });

  it('renders a truncated excerpt on each article card', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('line-clamp-3');
    expect(html).toContain('Skip the delivery with this ultimate low-carb date night pizza!');
  });

  it('paginates to a second page with the next 5 posts and a link back', () => {
    const html = readFileSync('dist/2/index.html', 'utf-8');
    expect((html.match(/article-card/g) ?? []).length).toBe(5);
    expect(html).toContain('href="/posts/pistachio-granita-with-brioche-con-tuppo-a-sicilian-morning-ritual/"');

    const paginationNav = html.match(/<nav class="home__pagination[^>]*>[\s\S]*?<\/nav>/);
    expect(paginationNav).not.toBeNull();
    expect(paginationNav![0]).toContain('href="/"');
  });

  it('renders numbered pagination controls with the current page marked', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__pagination');
    expect(html).toContain('aria-current="page"');
  });

  it('has a final page with just the oldest leftover posts', () => {
    const html = readFileSync('dist/5/index.html', 'utf-8');
    expect((html.match(/article-card/g) ?? []).length).toBe(3);
    expect(html).toContain('href="/posts/arancini-a-sicilian-street-food-sensation/"');
  });

  it('tags each card with its post type', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
  });

  it('hides the sidebar below the md breakpoint', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__sidebar hidden md:block');
  });

  it('sizes the sidebar to roughly match the main column on each page', () => {
    const countItems = (html: string) => (html.match(/home__recent-item/g) ?? []).length;

    // Page 1: hero (655px) + 5 cards (200px each) = 1655px of main column,
    // at ~380px per sidebar row -> round(1655 / 380) = 4 items.
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(countItems(page1)).toBe(4);

    // Page 2: no hero, 5 cards = 1000px -> round(1000 / 380) = 3 items.
    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(countItems(page2)).toBe(3);

    // Page 5 (last): no hero, 3 leftover cards = 600px -> round(600 / 380) = 2
    // would-be items, but the sidebar starts right after this page's own last
    // card (sidebarOffset) and there are no posts left in the pool past that
    // point, so the sidebar is empty here.
    const page5 = readFileSync('dist/5/index.html', 'utf-8');
    expect(countItems(page5)).toBe(0);
  });

  it('renders sidebar items as borderless image cards with a subheadline', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    const sidebarMatch = html.match(/<ul class="home__recent-list[^>]*>[\s\S]*?<\/ul>/);
    expect(sidebarMatch).not.toBeNull();
    const sidebarHtml = sidebarMatch![0];

    expect(sidebarHtml).toContain('<img');
    expect(sidebarHtml).toContain('A taste of Sicily in every bite: Pistachio granita with buttery brioche con tuppo—because summer mornings deserve a little magic.');
    expect(sidebarHtml).not.toContain('bg-white');
    expect(sidebarHtml).not.toContain('shadow-md');

    const listOpenTag = sidebarHtml.match(/<ul class="home__recent-list[^>]*>/)![0];
    expect(listOpenTag).toMatch(/\bspace-y-/);
    expect(listOpenTag).not.toMatch(/(^|\s)flex(\s|")/);
  });

  it('never repeats a page\'s own cards in its sidebar', () => {
    for (const path of ['dist/index.html', 'dist/2/index.html', 'dist/3/index.html']) {
      const html = readFileSync(path, 'utf-8');
      const sidebar = html.match(/<ul class="home__recent-list[^>]*>[\s\S]*?<\/ul>/)![0];
      const sidebarHrefs = new Set([...sidebar.matchAll(/href="\/posts\/([^"]+)\//g)].map((m) => m[1]));
      const cardHrefs = [...html.matchAll(/<a href="\/posts\/([^"]+)\/" class="article-card/g)].map((m) => m[1]);
      expect(cardHrefs.filter((h) => sidebarHrefs.has(h))).toEqual([]);
    }
  });
});
