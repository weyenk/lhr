import { build } from 'esbuild';
import { build as viteBuild } from 'vite';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
};

await Promise.all([
  build({ ...shared, entryPoints: ['api/index.ts'], outfile: 'dist/api/index.js' }),
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/src/server.js' }),
]);

await viteBuild({ root: new URL('../client', import.meta.url).pathname });
