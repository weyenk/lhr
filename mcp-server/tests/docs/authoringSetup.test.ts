import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('authoring setup docs', () => {
  it('documents all manual setup steps from the spec', () => {
    const text = readFileSync('../docs/AUTHORING-SETUP.md', 'utf-8');
    expect(text).toContain('GitHub OAuth App');
    expect(text).toContain('AUTHOR_GITHUB_USERNAME');
    expect(text).toContain('Vercel KV');
    expect(text).toContain('Vercel Blob');
    expect(text).toContain('custom MCP connector');
    expect(text).toContain('Claude.ai Project');
  });
});
