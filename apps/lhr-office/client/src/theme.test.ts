// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

describe('theme.css', () => {
  it.each([
    '--bg',
    '--surface',
    '--border',
    '--accent',
    '--warning',
    '--success',
    '--error',
    '--font-sans',
    '--font-mono',
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
  ])('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });
});

describe('approvals workshop styles', () => {
  it.each(['.approvals-workshop', '.decision-row', '.queue-empty', '.tab-count'])('styles %s', (selector) => {
    expect(css).toContain(selector);
  });

  it('reuses the research workshop tab styling instead of a second palette', () => {
    expect(css).toMatch(/\.approvals-workshop \.workshop-tabs/);
  });
});
