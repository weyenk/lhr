// Placeholder — overwritten by scripts/bundle.mjs at build time from the real
// Vite build output (client/dist). Checked into git so `tsc`/tests always have
// a valid module to import without requiring a client build to have run first.
// Running `npm run build` locally regenerates this file with real (large)
// content — that's expected; don't commit the regenerated version.
export interface ClientAsset {
  contentType: string;
  base64: string;
}

export const clientAssets: Record<string, ClientAsset> = {
  '/index.html': {
    contentType: 'text/html; charset=utf-8',
    // "<!doctype html><title>lhr office</title>" base64-encoded.
    base64: 'PCFkb2N0eXBlIGh0bWw+PHRpdGxlPmxociBvZmZpY2U8L3RpdGxlPg==',
  },
};
