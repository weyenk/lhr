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
