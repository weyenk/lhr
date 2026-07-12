import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // The full-flow integration test imports the site's `postSchema` from
      // `../../../src/content/schemas`, which imports `z` from the
      // `astro:content` virtual module. That virtual module is normally
      // supplied by Astro's own Vite plugin during `astro dev`/`astro
      // build`/`astro sync`, which this plain vitest setup does not run.
      // `astro:content`'s `z` export is just Astro's re-exported zod though
      // (see `astro/dist/zod.js`: `export { mod as z }` where `mod` is the
      // `zod` package) — so aliasing the virtual module id to the real,
      // already-installed `astro/zod` module resolves the import without
      // pulling in Astro's whole dev/build pipeline.
      'astro:content': 'astro/zod',
    },
  },
  test: {
    environment: 'node',
  },
});
