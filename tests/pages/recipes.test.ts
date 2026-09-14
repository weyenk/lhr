import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('recipes page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the page title', () => {
    const html = readFileSync('dist/recipes/index.html', 'utf-8');
    expect(html).toContain('Recipes');
  });

  it('lists every recipe post, newest first', () => {
    const html = readFileSync('dist/recipes/index.html', 'utf-8');
    const hrefs = [...html.matchAll(/<a href="\/posts\/([^"]+)\/" class="article-card/g)].map((m) => m[1]);
    expect(hrefs[0]).toBe('southwest-burritos-with-southwest-ranch-dipping-sauce');
    expect(hrefs).toContain('arancini-a-sicilian-street-food-sensation');
    expect(hrefs.length).toBe(25);
  });

  it('tags each card as a recipe', () => {
    const html = readFileSync('dist/recipes/index.html', 'utf-8');
    expect((html.match(/>Recipe</g) ?? []).length).toBe(25);
  });

  it('links to the recipes page from the header nav', () => {
    const html = readFileSync('dist/recipes/index.html', 'utf-8');
    expect(html).toContain('href="/recipes/"');
  });
});
