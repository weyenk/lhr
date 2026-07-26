#!/usr/bin/env node
// One-off migration: rehost Squarespace-CDN image URLs still embedded in
// src/content/posts/*.mdx into the Cloudflare R2 bucket used by attach_photo,
// then rewrite the MDX files to point at the new URLs.
//
// Usage:
//   node --env-file=.env.r2.local mcp-server/scripts/migrate-images-to-r2.mjs [--dry-run]
//
// Requires (unless --dry-run): R2_ACCOUNT_ID, R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_PUBLIC_URL

import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dryRun = process.argv.includes('--dry-run');
const SOURCE_HOST = 'images.squarespace-cdn.com';
const URL_PATTERN = /https:\/\/images\.squarespace-cdn\.com\/[^\s")]+/g;

const postsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/content/posts',
);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function r2KeyFor(url) {
  const segments = new URL(url).pathname.split('/').filter(Boolean);
  const filename = segments.at(-1);
  const assetId = segments.at(-2) ?? 'asset';
  return `posts/${assetId}/${filename}`;
}

async function uploadToR2(client, PutObjectCommand, key, url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  const contentType = response.headers.get('content-type') ?? 'application/octet-stream';
  const buffer = Buffer.from(await response.arrayBuffer());

  await client.send(
    new PutObjectCommand({
      Bucket: requireEnv('R2_BUCKET_NAME'),
      Key: key,
      Body: buffer,
      ContentType: contentType,
    }),
  );
}

async function main() {
  const files = (await readdir(postsDir)).filter((f) => f.endsWith('.mdx'));

  const urlToKey = new Map();
  for (const file of files) {
    const text = await readFile(path.join(postsDir, file), 'utf-8');
    for (const url of text.match(URL_PATTERN) ?? []) {
      if (!urlToKey.has(url)) urlToKey.set(url, r2KeyFor(url));
    }
  }

  console.log(`Found ${urlToKey.size} unique ${SOURCE_HOST} URL(s) across ${files.length} post(s).`);

  if (urlToKey.size === 0) {
    console.log('Nothing to migrate.');
    return;
  }

  let client;
  let PutObjectCommand;
  const publicUrl = dryRun ? 'https://cdn.example.com' : requireEnv('R2_PUBLIC_URL').replace(/\/$/, '');

  if (!dryRun) {
    const sdk = await import('@aws-sdk/client-s3');
    PutObjectCommand = sdk.PutObjectCommand;
    client = new sdk.S3Client({
      region: 'auto',
      endpoint: `https://${requireEnv('R2_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: requireEnv('R2_ACCESS_KEY_ID'),
        secretAccessKey: requireEnv('R2_SECRET_ACCESS_KEY'),
      },
    });
  }

  const urlToNewUrl = new Map();
  for (const [url, key] of urlToKey) {
    const newUrl = `${publicUrl}/${key}`;
    if (dryRun) {
      console.log(`[dry-run] ${url}\n  -> ${newUrl}`);
    } else {
      process.stdout.write(`Uploading ${key} ... `);
      await uploadToR2(client, PutObjectCommand, key, url);
      console.log('done');
    }
    urlToNewUrl.set(url, newUrl);
  }

  let filesChanged = 0;
  for (const file of files) {
    const filePath = path.join(postsDir, file);
    const original = await readFile(filePath, 'utf-8');
    let updated = original;
    for (const [url, newUrl] of urlToNewUrl) {
      updated = updated.split(url).join(newUrl);
    }
    if (updated !== original) {
      filesChanged += 1;
      if (dryRun) {
        console.log(`[dry-run] would rewrite ${file}`);
      } else {
        await writeFile(filePath, updated, 'utf-8');
        console.log(`Rewrote ${file}`);
      }
    }
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}Migrated ${urlToKey.size} image(s), updated ${filesChanged} post file(s).`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
