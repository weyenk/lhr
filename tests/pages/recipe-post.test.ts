import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('recipe post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the seed recipe post with ingredients, steps, kitchenware, and affiliate links', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toContain('Jerk Chicken for a Crowd');
    expect(html).toContain('Chicken thighs');
    expect(html).toContain('Marinate the chicken overnight.');
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('$48.00');
    expect(html).toContain('data-umami-event="kitchenware-click"');
    expect(html).toContain('The jerk seasoning we used');
    expect(html).toContain('data-umami-event="affiliate-click"');
    expect(html).toContain('affiliate link');
  }, 60000);

  it('gives kitchenware and affiliate links the shared card styling', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toMatch(/class="product-card[^"]*rounded-lg[^"]*shadow-md/);
    expect(html).toMatch(/class="affiliate-link[^"]*rounded-lg[^"]*shadow-md/);
  }, 60000);

  it('wraps steps and ingredients in a two-column layout grid', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toContain('recipe-post__layout');
    expect(html).toContain('grid-cols-12');
  }, 60000);

  it('gives the ingredients card the shared shadow-card styling, not a border', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toMatch(/class="recipe-post__ingredients[^"]*shadow-md/);
  }, 60000);

  it('stacks ingredients above steps on mobile while preserving desktop column order', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    const stepsWrapper = html.match(/<div class="([^"]*)">\s*<ol class="recipe-post__steps/);
    const ingredientsWrapper = html.match(/<div class="([^"]*)">\s*<ul class="recipe-post__ingredients/);
    expect(stepsWrapper?.[1]).toContain('order-2');
    expect(ingredientsWrapper?.[1]).toContain('order-1');
  }, 60000);
});
