import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('recipe post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the recipe post with its ingredients and steps', () => {
    const html = readFileSync('dist/posts/arancini-a-sicilian-street-food-sensation/index.html', 'utf-8');
    expect(html).toContain('Arancini: A Sicilian Street Food Sensation');
    expect(html).toContain('Arborio rice');
    expect(html).toContain('Fry arancini in batches for 3-4 minutes');
  }, 60000);

  it('wraps steps and ingredients in a two-column layout grid', () => {
    const html = readFileSync('dist/posts/arancini-a-sicilian-street-food-sensation/index.html', 'utf-8');
    expect(html).toContain('recipe-post__layout');
    expect(html).toContain('grid-cols-12');
  }, 60000);

  it('gives the ingredients card the shared shadow-card styling, not a border', () => {
    const html = readFileSync('dist/posts/arancini-a-sicilian-street-food-sensation/index.html', 'utf-8');
    expect(html).toMatch(/class="recipe-post__ingredients[^"]*shadow-md/);
  }, 60000);

  it('stacks ingredients above steps on mobile while preserving desktop column order', () => {
    const html = readFileSync('dist/posts/arancini-a-sicilian-street-food-sensation/index.html', 'utf-8');
    // The steps div renders an optional recipeMeta <p> between the <h2> and the
    // <ol> (present whenever the post has yields/prepMinutes/cookMinutes) — match
    // through the <h2> so this doesn't depend on that paragraph being absent.
    const stepsWrapper = html.match(/<div class="([^"]*)">\s*<h2[^>]*>Recipe<\/h2>\s*(?:<p[^>]*>[\s\S]*?<\/p>\s*)?<ol class="recipe-post__steps/);
    const ingredientsWrapper = html.match(/<div class="([^"]*)">\s*<h2[^>]*>Ingredients<\/h2>\s*<ul class="recipe-post__ingredients/);
    expect(stepsWrapper?.[1]).toContain('order-2');
    expect(ingredientsWrapper?.[1]).toContain('order-1');
  }, 60000);
});
