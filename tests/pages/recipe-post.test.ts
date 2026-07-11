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
});
