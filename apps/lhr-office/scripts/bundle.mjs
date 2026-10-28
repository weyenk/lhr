import { build } from 'esbuild';
import { generateClientAssets } from './generateClientAssets.mjs';

const shared = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  packages: 'external',
  sourcemap: false,
};

// Client assets are inlined into src/clientAssets.generated.ts (see generateClientAssets.mjs for
// why) before esbuild bundles the server code that imports it.
await generateClientAssets();

await Promise.all([
  build({ ...shared, entryPoints: ['api/index.ts'], outfile: 'dist/api/index.js' }),
  build({ ...shared, entryPoints: ['src/server.ts'], outfile: 'dist/src/server.js' }),
]);
