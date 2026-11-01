import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const execFileAsync = promisify(execFile);
const officeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Guards against circular imports between jobProseCatalog and job modules that
 * pull in resolveJobTuning. That cycle TDZ-crashes the Vercel function on boot
 * (FUNCTION_INVOCATION_FAILED). Vitest's transform can hide the TDZ, so this
 * loads the server entry under native tsx/ESM the same way Node does in prod.
 */
describe('job prose catalog boot graph', () => {
  it('loads createApp via the server entry without TDZ under native ESM', async () => {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      [
        '--import',
        'tsx',
        '-e',
        "import('./src/server.ts').then((m) => { if (typeof m.createApp !== 'function') process.exit(2); console.log('boot-ok'); })",
      ],
      { cwd: officeRoot, env: process.env, maxBuffer: 2 * 1024 * 1024 },
    );
    expect(stderr).not.toMatch(/Cannot access .* before initialization/);
    expect(stdout).toContain('boot-ok');
  }, 20_000);
});
