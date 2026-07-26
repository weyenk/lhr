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
    // individual post hrefs are absent: the sidebar is allowed to (and,
    // before Task 2's sizing, does) list every post regardless of which
    // page's cards are showing, so a post's href can legitimately appear
    // via the sidebar without being one of this page's cards.
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

  it('has a final page with just the single oldest leftover post', () => {
    const html = readFileSync('dist/5/index.html', 'utf-8');
    expect((html.match(/article-card/g) ?? []).length).toBe(1);
    expect(html).toContain('href="/posts/arancini-a-sicilian-street-food-sensation/"');
  });

  it('tags each card with its post type', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
  });

  it('hides the sidebar below the md breakpoint', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__recent-list hidden md:block');
  });

  it('sizes the sidebar to roughly match the main column on each page', () => {
    const countItems = (html: string) => (html.match(/home__recent-item/g) ?? []).length;

    // Page 1: hero (500px) + 5 cards (180px each) = 1400px of main column,
    // at ~70px per sidebar row -> round(1400 / 70) = 20 items.
    const page1 = readFileSync('dist/index.html', 'utf-8');
    expect(countItems(page1)).toBe(20);

    // Page 2: no hero, 5 cards = 900px -> round(900 / 70) = 13 items.
    const page2 = readFileSync('dist/2/index.html', 'utf-8');
    expect(countItems(page2)).toBe(13);

    // Page 5 (last): no hero, 1 leftover card = 180px -> round(180 / 70) = 3 items.
    const page5 = readFileSync('dist/5/index.html', 'utf-8');
    expect(countItems(page5)).toBe(3);
  });
});
