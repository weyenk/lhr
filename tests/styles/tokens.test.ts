import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('design tokens', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('compiles the brand color tokens into the built stylesheet', () => {
    const cssFiles = readdirSync('dist', { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'));
    const css = cssFiles
      .map((f) => readFileSync(`dist/${f}`, 'utf-8'))
      .join('\n')
      .toLowerCase();

    expect(css).toContain('#f5f1ea'); // background
    expect(css).toContain('#2b2521'); // text
    expect(css).toContain('#a83e2c'); // accent
    expect(css).toContain('#6b6560'); // accent-secondary
  }, 60000);

  it('compiles a focus-visible outline in the accent color for interactive elements', () => {
    const cssFiles = readdirSync('dist', { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'));
    const css = cssFiles
      .map((f) => readFileSync(`dist/${f}`, 'utf-8'))
      .join('\n')
      .toLowerCase();

    expect(css).toContain('focus-visible');
    expect(css).toMatch(/outline:2px solid var\(--color-accent\)/);
    expect(css).toContain('--color-accent:#a83e2c');
  }, 60000);
});
