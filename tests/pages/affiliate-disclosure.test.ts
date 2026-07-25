import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('affiliate disclosure page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('includes the required Amazon Associates disclosure wording', () => {
    const html = readFileSync('dist/affiliate-disclosure/index.html', 'utf-8');
    expect(html).toContain('Amazon Services LLC Associates Program');
    expect(html).toContain('an affiliate advertising program designed to provide a means for sites to earn advertising fees by advertising and linking to Amazon.com');
  });

  it('links to the privacy policy', () => {
    const html = readFileSync('dist/affiliate-disclosure/index.html', 'utf-8');
    expect(html).toContain('href="/privacy-policy/"');
  });
});
