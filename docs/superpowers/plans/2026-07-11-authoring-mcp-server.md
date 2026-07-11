# Authoring MCP Server + Article Sections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the authoring MCP server that lets the author create posts and rotate kitchenware sets entirely from the Claude.ai app, plus migrate the article content schema to structured sections that the server's tools depend on.

**Architecture:** A new `mcp-server/` Node/TypeScript project (own `package.json`, deployed as a single Vercel serverless function via `api/index.ts` wrapping an Express app) exposes an MCP server over Streamable HTTP, gated by GitHub OAuth (via the MCP SDK's `ProxyOAuthServerProvider`, restricted to one allowlisted GitHub username). All content reads/writes go through the GitHub REST API (Octokit) using her own OAuth-derived token — no local git checkout. In-progress posts/sets live as git branches holding one JSON draft file each; `confirm_and_publish` renders final content and commits it directly to `main` in one commit, which triggers the site's existing Vercel auto-deploy.

**Tech Stack:** TypeScript, Express, `@modelcontextprotocol/sdk`, `@octokit/rest`, `@vercel/blob`, `@vercel/kv`, `js-yaml`, Zod, Vitest.

## Global Constraints

- Repo is `weyenk/lhr` on GitHub — the MCP server's Octokit calls target this owner/repo directly (spec §2, §3).
- Nothing publishes without an explicit `confirm_and_publish` call — no autonomous auto-publish (Constitution #1).
- The server is single-author only: every tool call requires a GitHub OAuth token belonging to the allowlisted author username (Constitution #5, spec §2).
- In-progress drafts are never silently discarded on error — a failed `confirm_and_publish` must leave the draft branch intact (Constitution #4, spec §8).
- Draft state lives at `.drafts/<id>.json` on `draft/post-<id>` / `draft/set-<id>` branches — never as a real content file (spec §3).
- Photos are never sent as base64 tool-call payloads — `attach_photo` takes a URL, fetches it server-side, and stores the result in Vercel Blob (spec §5).
- `confirm_and_publish` writes directly to `main` as one commit (blobs → tree → commit → ref update), not a git merge (spec §3).
- The MCP TypeScript SDK's own docs warn against implementing OAuth token issuance from scratch — auth must proxy to GitHub OAuth via `ProxyOAuthServerProvider`, not a hand-rolled `/authorize`/`/token` (spec §2).
- The exact runtime shape of `@modelcontextprotocol/sdk`'s auth exports (import paths, `ProxyOAuthServerProvider` constructor, `mcpAuthRouter`) was verified against current documentation and examples as of this plan's writing, but this SDK is young and moves fast — if the installed package's TypeScript types disagree with the code in Task 6, trust the installed types and adjust the call shape accordingly rather than fighting the compiler.

---

### Task 1: Article Sections Schema Migration

**Files:**
- Modify: `src/content/schemas.ts`
- Modify: `src/layouts/ArticleLayout.astro`
- Modify: `src/content/posts/why-coastal-blue.mdx`
- Modify: `tests/content/schemas.test.ts`
- Modify: `tests/pages/article-post.test.ts`
- Modify: `docs/RULES.md`

**Interfaces:**
- Consumes: nothing new — this modifies Plan 1's existing `articlePostSchema`, `ArticleLayout.astro`.
- Produces: `articlePostSchema` now requires `sections: { heading: string; body: string }[]` (min 1) instead of relying on freeform MDX body. `PostData` (the inferred type) reflects this. The MCP server's `confirm_and_publish` (Task 13) renders posts against this exact shape.

- [ ] **Step 1: Write the failing schema test**

Modify `tests/content/schemas.test.ts` — replace the existing `articlePostSchema` describe block with:

```ts
describe('articlePostSchema', () => {
  it('accepts a valid article post with sections', () => {
    const result = articlePostSchema.safeParse({
      type: 'article',
      title: 'Why We Chose the Coastal Blue Set',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/set-hero.jpg',
      coverPhotoAlt: 'The Coastal Blue kitchenware set styled on a table',
      sections: [{ heading: 'Why blue', body: 'It photographs beautifully in natural light.' }],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an article post with no sections', () => {
    const result = articlePostSchema.safeParse({
      type: 'article',
      title: 'Why We Chose the Coastal Blue Set',
      date: '2026-07-01',
      coverPhoto: 'https://example.com/set-hero.jpg',
      coverPhotoAlt: 'The Coastal Blue kitchenware set styled on a table',
      sections: [],
    });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `rejects an article post with no sections` fails (current schema has no `sections` field, so an empty array doesn't cause rejection) or the accept case fails validation of an unrecognized extra field, depending on Zod's strictness. Either way, the two new assertions don't both pass yet.

- [ ] **Step 3: Update `articlePostSchema` in `src/content/schemas.ts`**

Replace:

```ts
export const articlePostSchema = z.object({
  type: z.literal('article'),
  ...basePostFields,
});
```

With:

```ts
export const articlePostSchema = z.object({
  type: z.literal('article'),
  ...basePostFields,
  sections: z
    .array(
      z.object({
        heading: z.string(),
        body: z.string(),
      }),
    )
    .min(1),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test`
Expected: PASS — `articlePostSchema` suite (schemas.test.ts). Other suites will now fail because the seed article post no longer validates — that's expected until Step 6.

- [ ] **Step 5: Update the failing article-post rendering test**

Modify `tests/pages/article-post.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('article post page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the seed article post with named sections and kitchenware', () => {
    const html = readFileSync('dist/posts/why-coastal-blue/index.html', 'utf-8');
    expect(html).toContain('Why We Chose the Coastal Blue Set');
    expect(html).toContain('Every six months');
    expect(html).toContain('Coastal Blue Serving Platter');
    expect(html).toContain('data-umami-event="kitchenware-click"');
    expect(html).not.toContain('recipe-post__ingredients');
  }, 60000);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — build error or missing content, since `why-coastal-blue.mdx` doesn't have `sections` frontmatter yet and `ArticleLayout.astro` still renders `<Content />`.

- [ ] **Step 7: Update `src/layouts/ArticleLayout.astro`**

Replace the whole file:

```astro
---
import BaseLayout from './BaseLayout.astro';
import ProductCard from '../components/ProductCard.astro';
import AffiliateLink from '../components/AffiliateLink.astro';
import type { CollectionEntry } from 'astro:content';
import { getEntriesByIds } from '../lib/content';

interface Props {
  post: CollectionEntry<'posts'>;
  products: CollectionEntry<'products'>[];
  affiliateLinks: CollectionEntry<'affiliateLinks'>[];
}

const { post, products, affiliateLinks } = Astro.props;
const { data } = post;

if (data.type !== 'article') {
  throw new Error(`ArticleLayout received a non-article post: ${post.id}`);
}

const linkedProducts = getEntriesByIds(data.kitchenwareIds, products);
const linkedAffiliateLinks = getEntriesByIds(data.affiliateLinkIds, affiliateLinks);
---
<BaseLayout title={data.title}>
  <article class="article-post">
    <h1>{data.title}</h1>
    <img src={data.coverPhoto} alt={data.coverPhotoAlt} />
    {data.sections.map((section) => (
      <section class="article-post__section">
        <h2>{section.heading}</h2>
        <p>{section.body}</p>
      </section>
    ))}
    {linkedProducts.length > 0 && (
      <section class="article-post__kitchenware">
        <h2>Shop this set</h2>
        {linkedProducts.map((product) => <ProductCard id={product.id} data={product.data} />)}
      </section>
    )}
    {linkedAffiliateLinks.length > 0 && (
      <section class="article-post__affiliate-links">
        <h2>Also mentioned</h2>
        {linkedAffiliateLinks.map((link) => <AffiliateLink id={link.id} data={link.data} />)}
      </section>
    )}
  </article>
</BaseLayout>
```

Note this drops the `render(post)` / `<Content />` call entirely — article bodies are now fully described by `sections`, not MDX prose.

- [ ] **Step 8: Update the seed post `src/content/posts/why-coastal-blue.mdx`**

Replace the whole file:

```mdx
---
type: article
title: "Why We Chose the Coastal Blue Set"
date: 2026-07-02
coverPhoto: "https://placehold.co/1200x800?text=Coastal+Blue"
coverPhotoAlt: "The Coastal Blue kitchenware set styled on a linen tablecloth"
kitchenwareIds: ["coastal-blue-platter"]
affiliateLinkIds: []
sections:
  - heading: "A season, not a forever"
    body: "Every six months we pick one set to live with, cook with, and photograph obsessively. This time, it's Coastal Blue."
  - heading: "Why blue"
    body: "It photographs beautifully in natural light, and it doesn't fight with the food the way white can."
---
```

The MDX body is intentionally empty — content now lives entirely in frontmatter `sections`.

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS — all suites, including `article post page` and `schemas.test.ts`.

- [ ] **Step 10: Update `docs/RULES.md` rule 5**

In `docs/RULES.md`, replace:

```markdown
5. Post frontmatter schema (type, title, date, cover photo + alt, linked kitchenware, linked affiliate links, plus recipe-only ingredients/steps) is the standard shape for new posts.
```

With:

```markdown
5. Post frontmatter schema (type, title, date, cover photo + alt, linked kitchenware, linked affiliate links, plus recipe-only ingredients/steps or article-only named sections) is the standard shape for new posts.
```

- [ ] **Step 11: Run the full test suite once more**

Run: `npm test`
Expected: PASS — including `tests/docs/governance.test.ts`, which only checks for the substring `frontmatter schema` and is unaffected by this wording change.

- [ ] **Step 12: Commit**

```bash
git add src/content/schemas.ts src/layouts/ArticleLayout.astro src/content/posts/why-coastal-blue.mdx tests/content/schemas.test.ts tests/pages/article-post.test.ts docs/RULES.md
git commit -m "feat: migrate article posts to structured named sections"
```

---

### Task 2: MCP Server Project Scaffold

**Files:**
- Create: `mcp-server/package.json`
- Create: `mcp-server/tsconfig.json`
- Create: `mcp-server/vitest.config.ts`
- Create: `mcp-server/vercel.json`
- Create: `mcp-server/.gitignore`
- Create: `mcp-server/src/server.ts`
- Create: `mcp-server/api/index.ts`
- Create: `mcp-server/tests/server.test.ts`

**Interfaces:**
- Consumes: nothing (leaf task).
- Produces: `mcp-server/src/server.ts` exporting a default Express `app` with a `GET /health` route — Task 6/7 extend this same file with auth middleware and the MCP endpoint. The repo root becomes an npm workspace host — Task 15's integration test relies on `mcp-server` being a declared workspace member to import the site's schema module cleanly.

- [ ] **Step 1: Declare `mcp-server` as an npm workspace**

Modify the root `package.json` (currently `lhr-site`'s manifest from Plan 1) to add a `workspaces` field:

```json
{
  "name": "lhr-site",
  "private": true,
  "type": "module",
  "workspaces": ["mcp-server"],
  "scripts": {
    "dev": "astro dev",
    "build": "astro build",
    "preview": "astro preview",
    "pretest": "astro sync && mkdir -p .astro && cp node_modules/.astro/data-store.json .astro/data-store.json",
    "test": "vitest run"
  },
  "dependencies": {
    "astro": "^5.0.0",
    "@astrojs/mdx": "^4.0.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^3.0.0"
  }
}
```

This makes `mcp-server` a proper workspace member: one shared root `package-lock.json`, one `npm install` covers both packages, and `mcp-server`'s tests can reference the site's modules by relative path as a normal same-repo (not cross-package) reference.

- [ ] **Step 2: Create `mcp-server/package.json`**

```json
{
  "name": "lhr-authoring-mcp-server",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.0",
    "@octokit/rest": "^21.1.0",
    "@vercel/blob": "^0.27.0",
    "@vercel/kv": "^3.0.0",
    "express": "^4.21.0",
    "js-yaml": "^4.1.0",
    "zod": "^3.24.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vitest": "^2.1.0",
    "@types/express": "^4.17.0",
    "@types/js-yaml": "^4.0.0",
    "@types/node": "^22.0.0",
    "supertest": "^7.0.0",
    "@types/supertest": "^6.0.0"
  }
}
```

- [ ] **Step 3: Create `mcp-server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "declaration": false
  },
  "include": ["src/**/*.ts", "api/**/*.ts"]
}
```

- [ ] **Step 4: Create `mcp-server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
  },
});
```

- [ ] **Step 5: Create `mcp-server/vercel.json`**

```json
{
  "version": 2,
  "rewrites": [
    { "source": "/(.*)", "destination": "/api" }
  ]
}
```

- [ ] **Step 6: Create `mcp-server/.gitignore`**

```
node_modules/
dist/
.env
```

- [ ] **Step 7: Install dependencies from the repo root**

Run: `npm install` (from the repo root, not inside `mcp-server/`)
Expected: installs without error for both workspace members, updates the root `package-lock.json` (there is no separate `mcp-server/package-lock.json` — npm workspaces share one lockfile), and creates `node_modules` symlinks so `mcp-server` sees its own dependencies.

- [ ] **Step 8: Write the failing test**

Create `mcp-server/tests/server.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import app from '../src/server';

describe('GET /health', () => {
  it('responds with ok status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/server'`

- [ ] **Step 10: Write `mcp-server/src/server.ts`**

```ts
import express from 'express';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

export default app;
```

- [ ] **Step 11: Write `mcp-server/api/index.ts`**

```ts
import app from '../src/server';

export default app;
```

- [ ] **Step 12: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `GET /health > responds with ok status`

- [ ] **Step 13: Commit**

```bash
git add package.json package-lock.json mcp-server/package.json mcp-server/tsconfig.json mcp-server/vitest.config.ts mcp-server/vercel.json mcp-server/.gitignore mcp-server/src/server.ts mcp-server/api/index.ts mcp-server/tests/server.test.ts
git commit -m "chore: scaffold authoring MCP server project as an npm workspace"
```

---

### Task 3: GitHub API Wrapper

**Files:**
- Create: `mcp-server/src/github.ts`
- Test: `mcp-server/tests/github.test.ts`

**Interfaces:**
- Consumes: nothing beyond `@octokit/rest`.
- Produces: `createGitHubClient(token)`, `getFile`, `listFiles`, `createBranch`, `listBranches`, `deleteBranch`, `putFile`, `commitFilesToMain`, and types `GitHubClient`, `FileWrite` — every later task (drafts, catalog, all tools) depends on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/github.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockOctokit = {
  repos: {
    getContent: vi.fn(),
    getBranch: vi.fn(),
    listBranches: vi.fn(),
    createOrUpdateFileContents: vi.fn(),
  },
  git: {
    createRef: vi.fn(),
    deleteRef: vi.fn(),
    getRef: vi.fn(),
    getCommit: vi.fn(),
    createBlob: vi.fn(),
    createTree: vi.fn(),
    createCommit: vi.fn(),
    updateRef: vi.fn(),
  },
};

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn(() => mockOctokit),
}));

const { createGitHubClient, getFile, listFiles, createBranch, listBranches, deleteBranch, putFile, commitFilesToMain } =
  await import('../src/github');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFile', () => {
  it('returns decoded content and sha for an existing file', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({
      data: { type: 'file', content: Buffer.from('hello').toString('base64'), sha: 'abc123' },
    });
    const client = createGitHubClient('token');
    const result = await getFile(client, '.drafts/x.json', 'main');
    expect(result).toEqual({ content: 'hello', sha: 'abc123' });
  });

  it('returns null for a 404', async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient('token');
    const result = await getFile(client, '.drafts/missing.json', 'main');
    expect(result).toBeNull();
  });
});

describe('listFiles', () => {
  it('lists file names in a directory, ignoring subdirectories', async () => {
    mockOctokit.repos.getContent.mockResolvedValue({
      data: [
        { type: 'file', name: 'coastal-blue.json' },
        { type: 'dir', name: 'nested' },
      ],
    });
    const client = createGitHubClient('token');
    const result = await listFiles(client, 'src/content/sets', 'main');
    expect(result).toEqual(['coastal-blue.json']);
  });

  it('returns an empty array for a 404', async () => {
    mockOctokit.repos.getContent.mockRejectedValue({ status: 404 });
    const client = createGitHubClient('token');
    const result = await listFiles(client, 'src/content/sets', 'main');
    expect(result).toEqual([]);
  });
});

describe('createBranch', () => {
  it('creates a ref pointing at the base branch head', async () => {
    mockOctokit.repos.getBranch.mockResolvedValue({ data: { commit: { sha: 'base-sha' } } });
    const client = createGitHubClient('token');
    await createBranch(client, 'draft/post-abc1');
    expect(mockOctokit.git.createRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'refs/heads/draft/post-abc1', sha: 'base-sha' }),
    );
  });
});

describe('listBranches', () => {
  it('filters branches by prefix', async () => {
    mockOctokit.repos.listBranches.mockResolvedValue({
      data: [{ name: 'main' }, { name: 'draft/post-abc1' }, { name: 'draft/post-def2' }],
    });
    const client = createGitHubClient('token');
    const result = await listBranches(client, 'draft/post-');
    expect(result).toEqual(['draft/post-abc1', 'draft/post-def2']);
  });
});

describe('deleteBranch', () => {
  it('deletes the ref for the given branch', async () => {
    const client = createGitHubClient('token');
    await deleteBranch(client, 'draft/post-abc1');
    expect(mockOctokit.git.deleteRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/draft/post-abc1' }),
    );
  });
});

describe('putFile', () => {
  it('base64-encodes content and passes sha when updating', async () => {
    const client = createGitHubClient('token');
    await putFile(client, { path: '.drafts/abc1.json', content: '{}', branch: 'draft/post-abc1', message: 'update', sha: 'old-sha' });
    expect(mockOctokit.repos.createOrUpdateFileContents).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '.drafts/abc1.json',
        content: Buffer.from('{}').toString('base64'),
        branch: 'draft/post-abc1',
        message: 'update',
        sha: 'old-sha',
      }),
    );
  });
});

describe('commitFilesToMain', () => {
  it('creates blobs, a tree, a commit, and updates the main ref', async () => {
    mockOctokit.git.getRef.mockResolvedValue({ data: { object: { sha: 'main-sha' } } });
    mockOctokit.git.getCommit.mockResolvedValue({ data: { tree: { sha: 'base-tree-sha' } } });
    mockOctokit.git.createBlob.mockResolvedValue({ data: { sha: 'blob-sha' } });
    mockOctokit.git.createTree.mockResolvedValue({ data: { sha: 'new-tree-sha' } });
    mockOctokit.git.createCommit.mockResolvedValue({ data: { sha: 'new-commit-sha' } });

    const client = createGitHubClient('token');
    const sha = await commitFilesToMain(client, [{ path: 'src/content/posts/x.mdx', content: '---\n---\n' }], 'Publish post: X');

    expect(mockOctokit.git.createTree).toHaveBeenCalledWith(
      expect.objectContaining({
        base_tree: 'base-tree-sha',
        tree: [{ path: 'src/content/posts/x.mdx', mode: '100644', type: 'blob', sha: 'blob-sha' }],
      }),
    );
    expect(mockOctokit.git.createCommit).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Publish post: X', tree: 'new-tree-sha', parents: ['main-sha'] }),
    );
    expect(mockOctokit.git.updateRef).toHaveBeenCalledWith(
      expect.objectContaining({ ref: 'heads/main', sha: 'new-commit-sha' }),
    );
    expect(sha).toBe('new-commit-sha');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/github'`

- [ ] **Step 3: Write `mcp-server/src/github.ts`**

```ts
import { Octokit } from '@octokit/rest';

const REPO_OWNER = 'weyenk';
const REPO_NAME = 'lhr';

export interface GitHubClient {
  octokit: Octokit;
}

export interface FileWrite {
  path: string;
  content: string;
}

export function createGitHubClient(token: string): GitHubClient {
  return { octokit: new Octokit({ auth: token }) };
}

export async function getFile(
  client: GitHubClient,
  path: string,
  ref: string,
): Promise<{ content: string; sha: string } | null> {
  try {
    const res = await client.octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path, ref });
    const data = res.data as { type: string; content: string; sha: string };
    if (Array.isArray(res.data) || data.type !== 'file') {
      throw new Error(`${path} is not a file`);
    }
    return { content: Buffer.from(data.content, 'base64').toString('utf-8'), sha: data.sha };
  } catch (err) {
    if ((err as { status?: number }).status === 404) return null;
    throw err;
  }
}

export async function listFiles(client: GitHubClient, dirPath: string, ref: string): Promise<string[]> {
  try {
    const res = await client.octokit.repos.getContent({ owner: REPO_OWNER, repo: REPO_NAME, path: dirPath, ref });
    if (!Array.isArray(res.data)) return [];
    return res.data.filter((entry) => entry.type === 'file').map((entry) => entry.name);
  } catch (err) {
    if ((err as { status?: number }).status === 404) return [];
    throw err;
  }
}

export async function createBranch(client: GitHubClient, branchName: string, fromRef = 'main'): Promise<void> {
  const base = await client.octokit.repos.getBranch({ owner: REPO_OWNER, repo: REPO_NAME, branch: fromRef });
  await client.octokit.git.createRef({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    ref: `refs/heads/${branchName}`,
    sha: base.data.commit.sha,
  });
}

export async function listBranches(client: GitHubClient, prefix: string): Promise<string[]> {
  const res = await client.octokit.repos.listBranches({ owner: REPO_OWNER, repo: REPO_NAME, per_page: 100 });
  return res.data.map((b: { name: string }) => b.name).filter((name: string) => name.startsWith(prefix));
}

export async function deleteBranch(client: GitHubClient, branchName: string): Promise<void> {
  await client.octokit.git.deleteRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: `heads/${branchName}` });
}

export async function putFile(
  client: GitHubClient,
  params: { path: string; content: string; branch: string; message: string; sha?: string },
): Promise<void> {
  await client.octokit.repos.createOrUpdateFileContents({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    path: params.path,
    content: Buffer.from(params.content, 'utf-8').toString('base64'),
    branch: params.branch,
    message: params.message,
    sha: params.sha,
  });
}

export async function commitFilesToMain(client: GitHubClient, files: FileWrite[], message: string): Promise<string> {
  const mainRef = await client.octokit.git.getRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: 'heads/main' });
  const baseSha = mainRef.data.object.sha;
  const baseCommit = await client.octokit.git.getCommit({ owner: REPO_OWNER, repo: REPO_NAME, commit_sha: baseSha });

  const blobs = await Promise.all(
    files.map(async (file) => {
      const blob = await client.octokit.git.createBlob({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        content: Buffer.from(file.content, 'utf-8').toString('base64'),
        encoding: 'base64',
      });
      return { path: file.path, sha: blob.data.sha };
    }),
  );

  const tree = await client.octokit.git.createTree({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    base_tree: baseCommit.data.tree.sha,
    tree: blobs.map((b) => ({ path: b.path, mode: '100644' as const, type: 'blob' as const, sha: b.sha })),
  });

  const commit = await client.octokit.git.createCommit({
    owner: REPO_OWNER,
    repo: REPO_NAME,
    message,
    tree: tree.data.sha,
    parents: [baseSha],
  });

  await client.octokit.git.updateRef({ owner: REPO_OWNER, repo: REPO_NAME, ref: 'heads/main', sha: commit.data.sha });

  return commit.data.sha;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — all `github.test.ts` cases plus `server.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/github.ts mcp-server/tests/github.test.ts
git commit -m "feat: add GitHub API wrapper for branches, files, and main-branch commits"
```

---

### Task 4: Draft Schema and Draft Store

**Files:**
- Create: `mcp-server/src/drafts.ts`
- Test: `mcp-server/tests/drafts.test.ts`

**Interfaces:**
- Consumes: `GitHubClient`, `getFile`, `putFile`, `createBranch`, `listBranches`, `deleteBranch` from `mcp-server/src/github.ts` (Task 3).
- Produces: `draftPostSchema`, `draftSetSchema`, `draftSchema`, types `DraftPost`, `DraftSet`, `Draft`; functions `generateDraftId`, `createDraft`, `readDraft`, `writeDraft`, `listDrafts`, `deleteDraftBranch`, `findDraftKind`, `summarizeDraftPost` — every tool task (7–14) depends on these exact names and shapes.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/drafts.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const github = {
  getFile: vi.fn(),
  putFile: vi.fn(),
  createBranch: vi.fn(),
  listBranches: vi.fn(),
  deleteBranch: vi.fn(),
};

vi.mock('../src/github', () => ({
  getFile: (...args: unknown[]) => github.getFile(...args),
  putFile: (...args: unknown[]) => github.putFile(...args),
  createBranch: (...args: unknown[]) => github.createBranch(...args),
  listBranches: (...args: unknown[]) => github.listBranches(...args),
  deleteBranch: (...args: unknown[]) => github.deleteBranch(...args),
}));

const {
  createDraft,
  readDraft,
  writeDraft,
  listDrafts,
  deleteDraftBranch,
  findDraftKind,
  summarizeDraftPost,
} = await import('../src/drafts');

const client = {} as import('../src/github').GitHubClient;

const emptyRecipeDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: '',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createDraft', () => {
  it('creates a branch and writes the initial draft JSON', async () => {
    const { id, branch } = await createDraft(client, 'post', emptyRecipeDraft);
    expect(branch).toBe(`draft/post-${id}`);
    expect(github.createBranch).toHaveBeenCalledWith(client, branch);
    expect(github.putFile).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ path: `.drafts/${id}.json`, branch }),
    );
  });
});

describe('readDraft', () => {
  it('parses the draft JSON from the branch', async () => {
    github.getFile.mockResolvedValue({ content: JSON.stringify(emptyRecipeDraft), sha: 'sha1' });
    const draft = await readDraft(client, 'post', 'abc1');
    expect(draft).toEqual(emptyRecipeDraft);
    expect(github.getFile).toHaveBeenCalledWith(client, '.drafts/abc1.json', 'draft/post-abc1');
  });

  it('throws if the draft does not exist', async () => {
    github.getFile.mockResolvedValue(null);
    await expect(readDraft(client, 'post', 'missing')).rejects.toThrow();
  });
});

describe('writeDraft', () => {
  it('writes updated draft JSON using the existing file sha', async () => {
    github.getFile.mockResolvedValue({ content: JSON.stringify(emptyRecipeDraft), sha: 'sha1' });
    const updated = { ...emptyRecipeDraft, title: 'Jerk Chicken' };
    await writeDraft(client, 'post', 'abc1', updated, 'Set title');
    expect(github.putFile).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ path: '.drafts/abc1.json', branch: 'draft/post-abc1', sha: 'sha1', message: 'Set title' }),
    );
  });
});

describe('listDrafts', () => {
  it('summarizes each open draft branch', async () => {
    github.listBranches.mockResolvedValue(['draft/post-abc1', 'draft/post-def2']);
    github.getFile.mockImplementation(async (_client: unknown, path: string) => {
      if (path === '.drafts/abc1.json') return { content: JSON.stringify({ ...emptyRecipeDraft, title: 'Jerk Chicken' }), sha: 's1' };
      if (path === '.drafts/def2.json') return { content: JSON.stringify(emptyRecipeDraft), sha: 's2' };
      return null;
    });
    const result = await listDrafts(client, 'post');
    expect(result).toEqual([
      { id: 'abc1', branch: 'draft/post-abc1', title: 'Jerk Chicken' },
      { id: 'def2', branch: 'draft/post-def2', title: '' },
    ]);
  });
});

describe('deleteDraftBranch', () => {
  it('deletes the branch for the given kind and id', async () => {
    await deleteDraftBranch(client, 'post', 'abc1');
    expect(github.deleteBranch).toHaveBeenCalledWith(client, 'draft/post-abc1');
  });
});

describe('findDraftKind', () => {
  it('returns "post" when a post draft branch exists', async () => {
    github.listBranches.mockImplementation(async (_client: unknown, prefix: string) =>
      prefix === 'draft/post-abc1' ? ['draft/post-abc1'] : [],
    );
    expect(await findDraftKind(client, 'abc1')).toBe('post');
  });

  it('returns "set" when a set draft branch exists', async () => {
    github.listBranches.mockImplementation(async (_client: unknown, prefix: string) =>
      prefix === 'draft/set-xyz9' ? ['draft/set-xyz9'] : [],
    );
    expect(await findDraftKind(client, 'xyz9')).toBe('set');
  });

  it('returns null when no matching branch exists', async () => {
    github.listBranches.mockResolvedValue([]);
    expect(await findDraftKind(client, 'nope')).toBeNull();
  });
});

describe('summarizeDraftPost', () => {
  it('includes recipe-specific counts', () => {
    const summary = summarizeDraftPost({ ...emptyRecipeDraft, title: 'Jerk Chicken', ingredients: [{ item: 'Chicken' }], steps: ['Grill it'] });
    expect(summary).toContain('Title: Jerk Chicken');
    expect(summary).toContain('Ingredients: 1');
    expect(summary).toContain('Steps: 1');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/drafts'`

- [ ] **Step 3: Write `mcp-server/src/drafts.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { createBranch, deleteBranch, getFile, listBranches, putFile, type GitHubClient } from './github';

export const draftPostSchema = z.object({
  kind: z.literal('post'),
  postType: z.enum(['recipe', 'article']),
  title: z.string().default(''),
  ingredients: z.array(z.object({ item: z.string(), amount: z.string().optional() })).default([]),
  steps: z.array(z.string()).default([]),
  sections: z.array(z.object({ heading: z.string(), body: z.string() })).default([]),
  photos: z.array(z.object({ url: z.string().url(), caption: z.string().optional() })).default([]),
  kitchenwareIds: z.array(z.string()).default([]),
  affiliateLinkIds: z.array(z.string()).default([]),
  pendingAffiliateLinks: z
    .array(z.object({ id: z.string(), label: z.string(), url: z.string().url(), tag: z.string() }))
    .default([]),
});

export const draftSetSchema = z.object({
  kind: z.literal('set'),
  name: z.string().default(''),
  startDate: z.string().optional(),
  products: z
    .array(
      z.object({
        name: z.string(),
        priceCents: z.number().int().positive(),
        image: z.string().url(),
        imageAlt: z.string(),
        vendorUrl: z.string().url(),
      }),
    )
    .default([]),
});

export const draftSchema = z.discriminatedUnion('kind', [draftPostSchema, draftSetSchema]);
export type DraftPost = z.infer<typeof draftPostSchema>;
export type DraftSet = z.infer<typeof draftSetSchema>;
export type Draft = z.infer<typeof draftSchema>;

export interface DraftSummary {
  id: string;
  branch: string;
  title: string;
}

function branchName(kind: 'post' | 'set', id: string): string {
  return `draft/${kind}-${id}`;
}

function draftPath(id: string): string {
  return `.drafts/${id}.json`;
}

export function generateDraftId(): string {
  return randomBytes(4).toString('hex');
}

export async function createDraft(
  client: GitHubClient,
  kind: 'post' | 'set',
  initial: Draft,
): Promise<{ id: string; branch: string }> {
  const id = generateDraftId();
  const branch = branchName(kind, id);
  await createBranch(client, branch);
  await putFile(client, {
    path: draftPath(id),
    content: JSON.stringify(initial, null, 2),
    branch,
    message: `Start ${kind} draft ${id}`,
  });
  return { id, branch };
}

export async function readDraft(client: GitHubClient, kind: 'post' | 'set', id: string): Promise<Draft> {
  const branch = branchName(kind, id);
  const file = await getFile(client, draftPath(id), branch);
  if (!file) throw new Error(`Draft ${id} not found on branch ${branch}`);
  return draftSchema.parse(JSON.parse(file.content));
}

export async function writeDraft(
  client: GitHubClient,
  kind: 'post' | 'set',
  id: string,
  draft: Draft,
  message: string,
): Promise<void> {
  const branch = branchName(kind, id);
  const file = await getFile(client, draftPath(id), branch);
  await putFile(client, {
    path: draftPath(id),
    content: JSON.stringify(draft, null, 2),
    branch,
    message,
    sha: file?.sha,
  });
}

export async function listDrafts(client: GitHubClient, kind: 'post' | 'set'): Promise<DraftSummary[]> {
  const prefix = `draft/${kind}-`;
  const branches = await listBranches(client, prefix);
  const summaries: DraftSummary[] = [];
  for (const branch of branches) {
    const id = branch.slice(prefix.length);
    const file = await getFile(client, draftPath(id), branch);
    if (!file) continue;
    const draft = draftSchema.parse(JSON.parse(file.content));
    const title = draft.kind === 'post' ? draft.title : draft.name;
    summaries.push({ id, branch, title });
  }
  return summaries;
}

export async function deleteDraftBranch(client: GitHubClient, kind: 'post' | 'set', id: string): Promise<void> {
  await deleteBranch(client, branchName(kind, id));
}

export async function findDraftKind(client: GitHubClient, id: string): Promise<'post' | 'set' | null> {
  const postBranches = await listBranches(client, branchName('post', id));
  if (postBranches.length > 0) return 'post';
  const setBranches = await listBranches(client, branchName('set', id));
  if (setBranches.length > 0) return 'set';
  return null;
}

export function summarizeDraftPost(draft: DraftPost): string {
  const lines = [`Type: ${draft.postType}`, `Title: ${draft.title || '(untitled)'}`];
  if (draft.postType === 'recipe') {
    lines.push(`Ingredients: ${draft.ingredients.length}`, `Steps: ${draft.steps.length}`);
  } else {
    lines.push(`Sections: ${draft.sections.length}`);
  }
  lines.push(`Photos: ${draft.photos.length}`);
  lines.push(`Kitchenware linked: ${draft.kitchenwareIds.length}`);
  lines.push(`Affiliate links: ${draft.affiliateLinkIds.length + draft.pendingAffiliateLinks.length}`);
  return lines.join('\n');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — all `drafts.test.ts` cases plus earlier suites.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/drafts.ts mcp-server/tests/drafts.test.ts
git commit -m "feat: add draft schema and branch-backed draft store"
```

---

### Task 5: Photo Fetch-and-Store

**Files:**
- Create: `mcp-server/src/blob.ts`
- Test: `mcp-server/tests/blob.test.ts`

**Interfaces:**
- Consumes: `@vercel/blob`'s `put`.
- Produces: `fetchAndStorePhoto(photoUrl: string): Promise<string>` — Task 9 (`attach_photo`) calls this directly.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/blob.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockPut = vi.fn();
vi.mock('@vercel/blob', () => ({ put: (...args: unknown[]) => mockPut(...args) }));

const { fetchAndStorePhoto } = await import('../src/blob');

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchAndStorePhoto', () => {
  it('fetches the URL and uploads the bytes to Blob storage', async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bytes.buffer,
    }) as unknown as typeof fetch;
    mockPut.mockResolvedValue({ url: 'https://blob.vercel-storage.com/posts/abc.jpeg' });

    const result = await fetchAndStorePhoto('https://icloud.com/share/abc');

    expect(result).toBe('https://blob.vercel-storage.com/posts/abc.jpeg');
    expect(mockPut).toHaveBeenCalledWith(
      expect.stringMatching(/^posts\/.+\.jpeg$/),
      expect.any(Buffer),
      expect.objectContaining({ access: 'public', contentType: 'image/jpeg' }),
    );
  });

  it('rejects a non-image response', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'text/html' }),
      arrayBuffer: async () => new ArrayBuffer(0),
    }) as unknown as typeof fetch;

    await expect(fetchAndStorePhoto('https://icloud.com/share/not-an-image')).rejects.toThrow(/image/);
  });

  it('rejects a failed fetch', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    await expect(fetchAndStorePhoto('https://icloud.com/share/missing')).rejects.toThrow(/404/);
  });

  it('rejects a photo larger than the size cap', async () => {
    const bigBuffer = new ArrayBuffer(26 * 1024 * 1024);
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      headers: new Headers({ 'content-type': 'image/jpeg' }),
      arrayBuffer: async () => bigBuffer,
    }) as unknown as typeof fetch;

    await expect(fetchAndStorePhoto('https://icloud.com/share/huge')).rejects.toThrow(/too large/);
  });
});
```

Add `afterEach` to the `vitest` import at the top: `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/blob'`

- [ ] **Step 3: Write `mcp-server/src/blob.ts`**

```ts
import { put } from '@vercel/blob';

const MAX_PHOTO_BYTES = 25 * 1024 * 1024;

export async function fetchAndStorePhoto(photoUrl: string): Promise<string> {
  const response = await fetch(photoUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch photo from ${photoUrl}: ${response.status}`);
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.startsWith('image/')) {
    throw new Error(`URL did not return an image (content-type: ${contentType || 'unknown'})`);
  }

  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_PHOTO_BYTES) {
    throw new Error(`Photo is too large (${arrayBuffer.byteLength} bytes, max ${MAX_PHOTO_BYTES})`);
  }

  const buffer = Buffer.from(arrayBuffer);
  const extension = contentType.split('/')[1]?.split(';')[0] ?? 'jpg';
  const filename = `posts/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const blob = await put(filename, buffer, { access: 'public', contentType });
  return blob.url;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — all `blob.test.ts` cases plus earlier suites.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/blob.ts mcp-server/tests/blob.test.ts
git commit -m "feat: add server-side photo fetch-and-store to Vercel Blob"
```

---

### Task 6: GitHub OAuth Auth Wiring

**Files:**
- Create: `mcp-server/src/auth/clientStore.ts`
- Create: `mcp-server/src/auth/githubOAuth.ts`
- Modify: `mcp-server/src/server.ts`
- Test: `mcp-server/tests/auth/githubOAuth.test.ts`
- Modify: `mcp-server/package.json` (add `@vercel/kv` — already present from Task 2)

**Interfaces:**
- Consumes: nothing beyond the SDK's auth exports and `@vercel/kv`.
- Produces: `createGitHubOAuthProvider(): ProxyOAuthServerProvider` — Task 7 wires this into `server.ts`'s `mcpAuthRouter`/`requireBearerAuth` and reads the verified GitHub token off `req.auth.token` to authenticate Octokit calls.

**Manual verification note:** unit tests here cover the allowlist logic in isolation; the full OAuth handshake (redirects, GitHub login, token exchange, Dynamic Client Registration from claude.ai) can only be verified by actually connecting from the Claude.ai app during the manual setup steps (Task 15) — budget time for that before considering this done.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/auth/githubOAuth.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const kvStore = new Map<string, unknown>();
vi.mock('@vercel/kv', () => ({
  kv: {
    get: vi.fn(async (key: string) => kvStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      kvStore.set(key, value);
    }),
  },
}));

vi.stubEnv('AUTHOR_GITHUB_USERNAME', 'weyenk');

const { createGitHubOAuthProvider } = await import('../../src/auth/githubOAuth');

const originalFetch = global.fetch;

beforeEach(() => {
  kvStore.clear();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('createGitHubOAuthProvider', () => {
  it('proxies to GitHub OAuth endpoints', () => {
    const provider = createGitHubOAuthProvider();
    expect(provider).toBeDefined();
  });

  it('accepts a token belonging to the allowlisted author', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'weyenk' }),
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    const result = await provider.verifyAccessToken('gh-token-123');
    expect(result.clientId).toBe('lhr-authoring');
    expect(result.token).toBe('gh-token-123');
  });

  it('rejects a token belonging to a different GitHub user', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ login: 'someone-else' }),
    }) as unknown as typeof fetch;

    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('gh-token-456')).rejects.toThrow(/not the authorized author/);
  });

  it('rejects an invalid token', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 401 }) as unknown as typeof fetch;
    const provider = createGitHubOAuthProvider();
    await expect(provider.verifyAccessToken('bad-token')).rejects.toThrow(/401/);
  });

  it('registers and remembers a dynamically-registered client', async () => {
    const provider = createGitHubOAuthProvider();
    const first = await provider.clientsStore.getClient('client-abc');
    expect(first).toBeUndefined();

    await provider.clientsStore.registerClient?.({
      client_id: 'client-abc',
      redirect_uris: ['https://claude.ai/api/mcp/callback'],
    });

    const second = await provider.clientsStore.getClient('client-abc');
    expect(second?.client_id).toBe('client-abc');
  });
});
```

Add `afterEach` to the vitest import: `import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/auth/githubOAuth'`

- [ ] **Step 3: Write `mcp-server/src/auth/clientStore.ts`**

```ts
import { kv } from '@vercel/kv';

export interface RegisteredClient {
  client_id: string;
  redirect_uris: string[];
}

export async function saveClient(client: RegisteredClient): Promise<void> {
  await kv.set(`oauth:client:${client.client_id}`, client);
}

export async function loadClient(clientId: string): Promise<RegisteredClient | null> {
  const client = await kv.get<RegisteredClient>(`oauth:client:${clientId}`);
  return client ?? null;
}
```

- [ ] **Step 4: Write `mcp-server/src/auth/githubOAuth.ts`**

```ts
import { ProxyOAuthServerProvider } from '@modelcontextprotocol/sdk/server/auth/providers/proxyProvider.js';
import { loadClient, saveClient, type RegisteredClient } from './clientStore';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';

async function fetchGitHubUser(token: string): Promise<{ login: string }> {
  const res = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'lhr-authoring-mcp-server' },
  });
  if (!res.ok) {
    throw new Error(`GitHub token verification failed: ${res.status}`);
  }
  return res.json();
}

export function createGitHubOAuthProvider(): ProxyOAuthServerProvider {
  const authorGitHubUsername = process.env.AUTHOR_GITHUB_USERNAME!;

  return new ProxyOAuthServerProvider({
    endpoints: {
      authorizationUrl: GITHUB_AUTHORIZE_URL,
      tokenUrl: GITHUB_TOKEN_URL,
    },
    verifyAccessToken: async (token: string) => {
      const user = await fetchGitHubUser(token);
      if (user.login !== authorGitHubUsername) {
        throw new Error(`GitHub user ${user.login} is not the authorized author`);
      }
      return { token, clientId: 'lhr-authoring', scopes: ['repo'] };
    },
    getClient: async (clientId: string) => {
      const stored = await loadClient(clientId);
      return stored ?? undefined;
    },
    clientsStore: {
      getClient: async (clientId: string) => (await loadClient(clientId)) ?? undefined,
      registerClient: async (client: RegisteredClient) => {
        await saveClient(client);
        return client;
      },
    },
  } as ConstructorParameters<typeof ProxyOAuthServerProvider>[0]);
}
```

Note: the `as ConstructorParameters<...>` cast exists because the exact combination of top-level `getClient` versus a nested `clientsStore` in `ProxyOAuthServerProvider`'s constructor type may not match this shape precisely — per this plan's Global Constraints, if `tsc` (Step 6) rejects this shape, open `node_modules/@modelcontextprotocol/sdk/dist/**/proxyProvider.d.ts` and adjust to the actual constructor signature (likely either a single `getClient` callback with an internal `registerClient` handled elsewhere by `mcpAuthRouter`, or a `clientsStore` object as the sole client-management surface) — keep `verifyAccessToken`'s allowlist logic and `endpoints` exactly as written, since those are the parts this task's tests pin down.

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — all `githubOAuth.test.ts` cases plus earlier suites. If `tsc` (run via `npm run build`) reports a type error on the `ProxyOAuthServerProvider` constructor call, resolve per the note in Step 4 rather than suppressing the error.

Run: `cd mcp-server && npm run build`
Expected: PASS — no type errors.

- [ ] **Step 6: Commit**

```bash
git add mcp-server/src/auth/clientStore.ts mcp-server/src/auth/githubOAuth.ts mcp-server/tests/auth/githubOAuth.test.ts
git commit -m "feat: add GitHub OAuth provider with single-author allowlist"
```

---

### Task 7: MCP Endpoint Wiring + start_post Tool

**Files:**
- Create: `mcp-server/src/tools/index.ts`
- Create: `mcp-server/src/tools/startPost.ts`
- Modify: `mcp-server/src/server.ts`
- Test: `mcp-server/tests/tools/startPost.test.ts`

**Interfaces:**
- Consumes: `createGitHubOAuthProvider` (Task 6); `createGitHubClient` (Task 3); `createDraft`, `listDrafts`, `readDraft`, `summarizeDraftPost`, `DraftPost` (Task 4).
- Produces: `registerTools(server, accessToken)` in `mcp-server/src/tools/index.ts` — every subsequent tool task (8–14) adds its own `registerXxx` function and calls it from here. The `/mcp` POST/GET/DELETE routes and session map in `server.ts` — stable for the rest of the plan.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/tools/startPost.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const drafts = {
  listDrafts: vi.fn(),
  createDraft: vi.fn(),
};

vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, listDrafts: drafts.listDrafts, createDraft: drafts.createDraft };
});
vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
}));

const { registerStartPost } = await import('../../src/tools/startPost');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('start_post', () => {
  it('lists open drafts instead of creating a new one when drafts exist', async () => {
    drafts.listDrafts.mockResolvedValue([{ id: 'abc1', branch: 'draft/post-abc1', title: 'Jerk Chicken' }]);
    const server = fakeServer();
    registerStartPost(server as never, 'token');

    const result = (await server.call('start_post', { type: 'recipe' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('abc1');
    expect(result.content[0].text).toContain('Jerk Chicken');
    expect(drafts.createDraft).not.toHaveBeenCalled();
  });

  it('creates a new draft when none are open', async () => {
    drafts.listDrafts.mockResolvedValue([]);
    drafts.createDraft.mockResolvedValue({ id: 'new1', branch: 'draft/post-new1' });
    const server = fakeServer();
    registerStartPost(server as never, 'token');

    const result = (await server.call('start_post', { type: 'article' })) as { content: { text: string }[] };

    expect(drafts.createDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      expect.objectContaining({ kind: 'post', postType: 'article' }),
    );
    expect(result.content[0].text).toContain('new1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/startPost'`

- [ ] **Step 3: Write `mcp-server/src/tools/startPost.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { createDraft, listDrafts, type DraftPost } from '../drafts';

export function registerStartPost(server: McpServer, accessToken: string): void {
  server.registerTool(
    'start_post',
    {
      title: 'Start or resume a post',
      description: 'Lists any unfinished draft posts of the given type and offers to resume one, or starts a new draft.',
      inputSchema: {
        type: z.enum(['recipe', 'article']).describe('Which kind of post to start'),
      },
    },
    async ({ type }: { type: 'recipe' | 'article' }) => {
      const client = createGitHubClient(accessToken);
      const openDrafts = await listDrafts(client, 'post');

      if (openDrafts.length > 0) {
        const list = openDrafts.map((d) => `- ${d.id}: "${d.title || '(untitled)'}"`).join('\n');
        return {
          content: [
            {
              type: 'text' as const,
              text: `You have unfinished drafts:\n${list}\n\nTell me the id of the one to resume, or say "start new" to begin a new ${type} draft.`,
            },
          ],
        };
      }

      const initial: DraftPost = {
        kind: 'post',
        postType: type,
        title: '',
        ingredients: [],
        steps: [],
        sections: [],
        photos: [],
        kitchenwareIds: [],
        affiliateLinkIds: [],
        pendingAffiliateLinks: [],
      };
      const { id } = await createDraft(client, 'post', initial);
      return {
        content: [{ type: 'text' as const, text: `Started a new ${type} draft. Draft id: ${id}. What's the title?` }],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `start_post` suite.

- [ ] **Step 5: Write `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
}
```

- [ ] **Step 6: Wire the MCP endpoint into `mcp-server/src/server.ts`**

Replace the whole file:

```ts
import express from 'express';
import { randomUUID } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { mcpAuthRouter } from '@modelcontextprotocol/sdk/server/auth/router.js';
import { requireBearerAuth } from '@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js';
import { createGitHubOAuthProvider } from './auth/githubOAuth';
import { registerTools } from './tools';

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

const provider = createGitHubOAuthProvider();

if (process.env.MCP_SERVER_URL) {
  const baseUrl = new URL(process.env.MCP_SERVER_URL);
  app.use(mcpAuthRouter({ provider, issuerUrl: new URL('https://github.com/login/oauth/'), baseUrl }));
}

const authMiddleware = requireBearerAuth({ verifier: provider });

const transports: Record<string, StreamableHTTPServerTransport> = {};

function createServer(accessToken: string): McpServer {
  const server = new McpServer({ name: 'lhr-authoring', version: '1.0.0' });
  registerTools(server, accessToken);
  return server;
}

app.post('/mcp', authMiddleware, async (req, res) => {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  let transport: StreamableHTTPServerTransport;

  if (sessionId && transports[sessionId]) {
    transport = transports[sessionId];
  } else if (!sessionId && isInitializeRequest(req.body)) {
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        transports[id] = transport;
      },
    });
    transport.onclose = () => {
      if (transport.sessionId) delete transports[transport.sessionId];
    };
    const accessToken = (req as unknown as { auth: { token: string } }).auth.token;
    const server = createServer(accessToken);
    await server.connect(transport);
  } else {
    res.status(400).json({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Bad Request: No valid session ID provided' },
      id: null,
    });
    return;
  }

  await transport.handleRequest(req, res, req.body);
});

async function handleSessionRequest(req: express.Request, res: express.Response): Promise<void> {
  const sessionId = req.headers['mcp-session-id'] as string | undefined;
  if (!sessionId || !transports[sessionId]) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await transports[sessionId].handleRequest(req, res);
}

app.get('/mcp', authMiddleware, handleSessionRequest);
app.delete('/mcp', authMiddleware, handleSessionRequest);

export default app;
```

- [ ] **Step 7: Run the full test suite and the build**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

Run: `cd mcp-server && npm run build`
Expected: PASS — no type errors. If `requireBearerAuth`'s expected `verifier` shape or `mcpAuthRouter`'s options disagree with what's written, adjust to match the installed SDK's types per this plan's Global Constraints, keeping the route structure and session map intact.

- [ ] **Step 8: Commit**

```bash
git add mcp-server/src/tools/index.ts mcp-server/src/tools/startPost.ts mcp-server/src/server.ts mcp-server/tests/tools/startPost.test.ts
git commit -m "feat: wire MCP Streamable HTTP endpoint and add start_post tool"
```

---

### Task 8: add_content_step Tool

**Files:**
- Create: `mcp-server/src/tools/addContentStep.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/tools/addContentStep.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient` (Task 3); `readDraft`, `writeDraft`, `DraftPost` (Task 4).
- Produces: `registerAddContentStep` — no later task depends on this beyond registration in `tools/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/tools/addContentStep.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerAddContentStep } = await import('../../src/tools/addContentStep');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const baseDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('add_content_step', () => {
  it('appends an ingredient and step to a recipe draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', {
      draftId: 'abc1',
      ingredient: { item: 'Chicken thighs', amount: '2 lbs' },
      step: 'Marinate overnight.',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
        steps: ['Marinate overnight.'],
      }),
      expect.any(String),
    );
  });

  it('appends a section to an article draft', async () => {
    draftsMock.readDraft.mockResolvedValue({ ...baseDraft, postType: 'article' });
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', {
      draftId: 'abc1',
      section: { heading: 'Why blue', body: 'It photographs beautifully.' },
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }] }),
      expect.any(String),
    );
  });

  it('sets the title when provided', async () => {
    draftsMock.readDraft.mockResolvedValue({ ...baseDraft, title: '' });
    const server = fakeServer();
    registerAddContentStep(server as never, 'token');

    await server.call('add_content_step', { draftId: 'abc1', title: 'Jerk Chicken for a Crowd' });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ title: 'Jerk Chicken for a Crowd' }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/addContentStep'`

- [ ] **Step 3: Write `mcp-server/src/tools/addContentStep.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, writeDraft } from '../drafts';

export function registerAddContentStep(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_content_step',
    {
      title: 'Add content to a draft',
      description:
        'Sets the title, and/or appends one ingredient+step (for recipes) or one named section (for articles) to the draft.',
      inputSchema: {
        draftId: z.string(),
        title: z.string().optional(),
        ingredient: z.object({ item: z.string(), amount: z.string().optional() }).optional(),
        step: z.string().optional(),
        section: z.object({ heading: z.string(), body: z.string() }).optional(),
      },
    },
    async ({ draftId, title, ingredient, step, section }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      if (title !== undefined) draft.title = title;
      if (ingredient !== undefined) draft.ingredients = [...draft.ingredients, ingredient];
      if (step !== undefined) draft.steps = [...draft.steps, step];
      if (section !== undefined) draft.sections = [...draft.sections, section];

      await writeDraft(client, 'post', draftId, draft, `Update draft ${draftId} content`);

      return { content: [{ type: 'text' as const, text: 'Updated.' }] };
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — `add_content_step` suite.

- [ ] **Step 5: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
}
```

- [ ] **Step 6: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools/addContentStep.ts mcp-server/src/tools/index.ts mcp-server/tests/tools/addContentStep.test.ts
git commit -m "feat: add add_content_step tool for recipe and article content"
```

---

### Task 9: attach_photo Tool

**Files:**
- Create: `mcp-server/src/tools/attachPhoto.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/tools/attachPhoto.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient` (Task 3); `readDraft`, `writeDraft` (Task 4); `fetchAndStorePhoto` (Task 5).
- Produces: `registerAttachPhoto` — registered in `tools/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/tools/attachPhoto.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const mockFetchAndStorePhoto = vi.fn();
vi.mock('../../src/blob', () => ({ fetchAndStorePhoto: (...args: unknown[]) => mockFetchAndStorePhoto(...args) }));

const { registerAttachPhoto } = await import('../../src/tools/attachPhoto');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const baseDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('attach_photo', () => {
  it('stores the fetched blob URL and caption on the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockFetchAndStorePhoto.mockResolvedValue('https://blob.vercel-storage.com/posts/abc.jpeg');
    const server = fakeServer();
    registerAttachPhoto(server as never, 'token');

    const result = (await server.call('attach_photo', {
      draftId: 'abc1',
      photoUrl: 'https://icloud.com/share/xyz',
      caption: 'Chicken on the platter',
    })) as { content: { text: string }[] };

    expect(mockFetchAndStorePhoto).toHaveBeenCalledWith('https://icloud.com/share/xyz');
    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        photos: [{ url: 'https://blob.vercel-storage.com/posts/abc.jpeg', caption: 'Chicken on the platter' }],
      }),
      expect.any(String),
    );
    expect(result.content[0].text).toContain('added');
  });

  it('reports a fetch failure without touching the draft', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    mockFetchAndStorePhoto.mockRejectedValue(new Error('Failed to fetch photo from https://icloud.com/share/bad: 404'));
    const server = fakeServer();
    registerAttachPhoto(server as never, 'token');

    await expect(
      server.call('attach_photo', { draftId: 'abc1', photoUrl: 'https://icloud.com/share/bad' }),
    ).rejects.toThrow(/404/);
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/attachPhoto'`

- [ ] **Step 3: Write `mcp-server/src/tools/attachPhoto.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, writeDraft } from '../drafts';
import { fetchAndStorePhoto } from '../blob';

export function registerAttachPhoto(server: McpServer, accessToken: string): void {
  server.registerTool(
    'attach_photo',
    {
      title: 'Attach a photo to a draft',
      description:
        'Fetches a shared photo URL (e.g. an iCloud link) server-side and stores it permanently, attaching it to the draft.',
      inputSchema: {
        draftId: z.string(),
        photoUrl: z.string().url(),
        caption: z.string().optional(),
      },
    },
    async ({ draftId, photoUrl, caption }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const blobUrl = await fetchAndStorePhoto(photoUrl);

      draft.photos = [...draft.photos, { url: blobUrl, caption }];
      await writeDraft(client, 'post', draftId, draft, `Attach photo to draft ${draftId}`);

      return { content: [{ type: 'text' as const, text: `Photo added (${draft.photos.length} total).` }] };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `attach_photo` suite.

- [ ] **Step 5: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
}
```

- [ ] **Step 6: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools/attachPhoto.ts mcp-server/src/tools/index.ts mcp-server/tests/tools/attachPhoto.test.ts
git commit -m "feat: add attach_photo tool"
```

---

### Task 10: link_kitchenware Tool

**Files:**
- Create: `mcp-server/src/catalog.ts`
- Create: `mcp-server/src/tools/linkKitchenware.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/catalog.test.ts`
- Test: `mcp-server/tests/tools/linkKitchenware.test.ts`

**Interfaces:**
- Consumes: `listFiles`, `getFile`, `GitHubClient` (Task 3); `readDraft`, `writeDraft` (Task 4).
- Produces: `mcp-server/src/catalog.ts`'s `readCollection<T>(client, dirPath, ref?)`, `slugify`, `uniqueSlug` — Task 11 (`add_affiliate_link`) and Task 13 (`confirm_and_publish`) both depend on `readCollection` and `uniqueSlug` respectively.

- [ ] **Step 1: Write the failing catalog tests**

Create `mcp-server/tests/catalog.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const github = { listFiles: vi.fn(), getFile: vi.fn() };
vi.mock('../src/github', () => ({
  listFiles: (...args: unknown[]) => github.listFiles(...args),
  getFile: (...args: unknown[]) => github.getFile(...args),
}));

const { readCollection, slugify, uniqueSlug } = await import('../src/catalog');

const client = {} as import('../src/github').GitHubClient;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('readCollection', () => {
  it('reads and parses every JSON file in a directory', async () => {
    github.listFiles.mockResolvedValue(['coastal-blue.json']);
    github.getFile.mockResolvedValue({ content: JSON.stringify({ name: 'Coastal Blue' }), sha: 's1' });

    const result = await readCollection(client, 'src/content/sets');

    expect(result).toEqual([{ id: 'coastal-blue', data: { name: 'Coastal Blue' } }]);
  });
});

describe('slugify', () => {
  it('lowercases and hyphenates a title', () => {
    expect(slugify('Jerk Chicken for a Crowd!')).toBe('jerk-chicken-for-a-crowd');
  });
});

describe('uniqueSlug', () => {
  it('returns the base slug when unused', async () => {
    github.listFiles.mockResolvedValue(['why-coastal-blue.mdx']);
    const slug = await uniqueSlug(client, 'Jerk Chicken for a Crowd');
    expect(slug).toBe('jerk-chicken-for-a-crowd');
  });

  it('appends a number when the base slug is taken', async () => {
    github.listFiles.mockResolvedValue(['jerk-chicken-for-a-crowd.mdx']);
    const slug = await uniqueSlug(client, 'Jerk Chicken for a Crowd');
    expect(slug).toBe('jerk-chicken-for-a-crowd-2');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/catalog'`

- [ ] **Step 3: Write `mcp-server/src/catalog.ts`**

```ts
import { getFile, listFiles, type GitHubClient } from './github';

export interface CatalogEntry<T> {
  id: string;
  data: T;
}

export async function readCollection<T>(client: GitHubClient, dirPath: string, ref = 'main'): Promise<CatalogEntry<T>[]> {
  const files = await listFiles(client, dirPath, ref);
  const entries: CatalogEntry<T>[] = [];
  for (const filename of files.filter((f) => f.endsWith('.json'))) {
    const file = await getFile(client, `${dirPath}/${filename}`, ref);
    if (!file) continue;
    entries.push({ id: filename.replace(/\.json$/, ''), data: JSON.parse(file.content) as T });
  }
  return entries;
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function uniqueSlug(client: GitHubClient, title: string): Promise<string> {
  const base = slugify(title);
  const existingFiles = await listFiles(client, 'src/content/posts', 'main');
  const existingSlugs = new Set(existingFiles.map((f) => f.replace(/\.mdx$/, '')));
  if (!existingSlugs.has(base)) return base;
  let n = 2;
  while (existingSlugs.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — `catalog.test.ts` suites.

- [ ] **Step 5: Write the failing `link_kitchenware` test**

Create `mcp-server/tests/tools/linkKitchenware.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const catalogMock = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { registerLinkKitchenware } = await import('../../src/tools/linkKitchenware');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const baseDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('link_kitchenware', () => {
  it('suggests the active set products when no productIds are given', async () => {
    catalogMock.readCollection.mockImplementation(async (_client: unknown, dir: string) => {
      if (dir === 'src/content/sets') {
        return [{ id: 'coastal-blue', data: { name: 'Coastal Blue', startDate: '2026-01-01', endDate: '2026-12-31' } }];
      }
      return [{ id: 'coastal-blue-platter', data: { name: 'Coastal Blue Serving Platter', priceCents: 4800, setId: 'coastal-blue' } }];
    });
    const server = fakeServer();
    registerLinkKitchenware(server as never, 'token');

    const result = (await server.call('link_kitchenware', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('coastal-blue-platter');
    expect(draftsMock.writeDraft).not.toHaveBeenCalled();
  });

  it('links the given product ids to the draft', async () => {
    catalogMock.readCollection.mockResolvedValue([]);
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    const server = fakeServer();
    registerLinkKitchenware(server as never, 'token');

    await server.call('link_kitchenware', { draftId: 'abc1', productIds: ['coastal-blue-platter'] });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ kitchenwareIds: ['coastal-blue-platter'] }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/linkKitchenware'`

- [ ] **Step 7: Write `mcp-server/src/tools/linkKitchenware.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, writeDraft } from '../drafts';
import { readCollection } from '../catalog';

interface ProductData {
  name: string;
  priceCents: number;
  setId: string;
}
interface SetData {
  name: string;
  startDate: string;
  endDate: string;
}

export function registerLinkKitchenware(server: McpServer, accessToken: string): void {
  server.registerTool(
    'link_kitchenware',
    {
      title: 'Link kitchenware to a draft',
      description: "Suggests the currently-active kitchenware set's products, or links the given product ids to the draft.",
      inputSchema: {
        draftId: z.string(),
        productIds: z.array(z.string()).optional(),
      },
    },
    async ({ draftId, productIds }) => {
      const client = createGitHubClient(accessToken);

      if (!productIds) {
        const sets = await readCollection<SetData>(client, 'src/content/sets');
        const products = await readCollection<ProductData>(client, 'src/content/products');
        const now = new Date();
        const activeSet = sets.find((s) => new Date(s.data.startDate) <= now && now <= new Date(s.data.endDate));
        const activeProducts = activeSet ? products.filter((p) => p.data.setId === activeSet.id) : [];
        const list = activeProducts.map((p) => `- ${p.id}: ${p.data.name}`).join('\n') || '(no active set configured)';
        return {
          content: [
            { type: 'text' as const, text: `Active set products:\n${list}\n\nCall again with productIds to link some.` },
          ],
        };
      }

      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);
      draft.kitchenwareIds = Array.from(new Set([...draft.kitchenwareIds, ...productIds]));
      await writeDraft(client, 'post', draftId, draft, `Link kitchenware to draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: `Linked ${productIds.length} product(s) to the draft.` }] };
    },
  );
}
```

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `link_kitchenware` suite.

- [ ] **Step 9: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
}
```

- [ ] **Step 10: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 11: Commit**

```bash
git add mcp-server/src/catalog.ts mcp-server/src/tools/linkKitchenware.ts mcp-server/src/tools/index.ts mcp-server/tests/catalog.test.ts mcp-server/tests/tools/linkKitchenware.test.ts
git commit -m "feat: add catalog reader and link_kitchenware tool"
```

---

### Task 11: add_affiliate_link Tool

**Files:**
- Create: `mcp-server/src/tools/addAffiliateLink.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/tools/addAffiliateLink.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient` (Task 3); `readDraft`, `writeDraft` (Task 4); `readCollection` (Task 10).
- Produces: `registerAddAffiliateLink` — registered in `tools/index.ts`.

- [ ] **Step 1: Write the failing tests**

Create `mcp-server/tests/tools/addAffiliateLink.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), writeDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft, writeDraft: draftsMock.writeDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const catalogMock = { readCollection: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return { ...actual, readCollection: catalogMock.readCollection };
});

const { registerAddAffiliateLink } = await import('../../src/tools/addAffiliateLink');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const baseDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [],
  steps: [],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('add_affiliate_link', () => {
  it('reuses an existing catalog entry matched by URL', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    catalogMock.readCollection.mockResolvedValue([
      { id: 'jerk-seasoning', data: { label: 'The jerk seasoning we used', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' } },
    ]);
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'Jerk seasoning',
      url: 'https://vendor.example.com/jerk-seasoning',
      tag: 'jerk-seasoning',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({ affiliateLinkIds: ['jerk-seasoning'], pendingAffiliateLinks: [] }),
      expect.any(String),
    );
  });

  it('stages a new pending entry when no URL match exists', async () => {
    draftsMock.readDraft.mockResolvedValue(baseDraft);
    catalogMock.readCollection.mockResolvedValue([]);
    const server = fakeServer();
    registerAddAffiliateLink(server as never, 'token');

    await server.call('add_affiliate_link', {
      draftId: 'abc1',
      label: 'New sauce',
      url: 'https://vendor.example.com/new-sauce',
      tag: 'new-sauce',
    });

    expect(draftsMock.writeDraft).toHaveBeenCalledWith(
      expect.anything(),
      'post',
      'abc1',
      expect.objectContaining({
        affiliateLinkIds: [],
        pendingAffiliateLinks: [expect.objectContaining({ label: 'New sauce', url: 'https://vendor.example.com/new-sauce', tag: 'new-sauce' })],
      }),
      expect.any(String),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/addAffiliateLink'`

- [ ] **Step 3: Write `mcp-server/src/tools/addAffiliateLink.ts`**

```ts
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, writeDraft } from '../drafts';
import { readCollection } from '../catalog';

interface AffiliateLinkData {
  label: string;
  url: string;
  tag: string;
}

export function registerAddAffiliateLink(server: McpServer, accessToken: string): void {
  server.registerTool(
    'add_affiliate_link',
    {
      title: 'Add an affiliate link to a draft',
      description: 'Adds a label + URL + tag, reusing an existing catalog entry when the URL already exists.',
      inputSchema: {
        draftId: z.string(),
        label: z.string(),
        url: z.string().url(),
        tag: z.string(),
      },
    },
    async ({ draftId, label, url, tag }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

      const existing = await readCollection<AffiliateLinkData>(client, 'src/content/affiliate-links');
      const match = existing.find((entry) => entry.data.url === url);

      if (match) {
        draft.affiliateLinkIds = Array.from(new Set([...draft.affiliateLinkIds, match.id]));
        await writeDraft(client, 'post', draftId, draft, `Link existing affiliate link ${match.id} to draft ${draftId}`);
        return { content: [{ type: 'text' as const, text: `Reused existing affiliate link "${match.data.label}".` }] };
      }

      const id = `${tag}-${randomBytes(2).toString('hex')}`;
      draft.pendingAffiliateLinks = [...draft.pendingAffiliateLinks, { id, label, url, tag }];
      await writeDraft(client, 'post', draftId, draft, `Add pending affiliate link ${id} to draft ${draftId}`);
      return { content: [{ type: 'text' as const, text: `Added new affiliate link "${label}" (created on publish).` }] };
    },
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd mcp-server && npm test`
Expected: PASS — `add_affiliate_link` suite.

- [ ] **Step 5: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';
import { registerAddAffiliateLink } from './addAffiliateLink';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
}
```

- [ ] **Step 6: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools/addAffiliateLink.ts mcp-server/src/tools/index.ts mcp-server/tests/tools/addAffiliateLink.test.ts
git commit -m "feat: add add_affiliate_link tool with catalog reuse"
```

---

### Task 12: preview_post Tool

**Files:**
- Create: `mcp-server/src/tools/previewPost.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/tools/previewPost.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient` (Task 3); `readDraft`, `summarizeDraftPost` (Task 4).
- Produces: `registerPreviewPost` — registered in `tools/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/tools/previewPost.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, readDraft: draftsMock.readDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerPreviewPost } = await import('../../src/tools/previewPost');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('preview_post', () => {
  it('returns a text summary of the draft', async () => {
    draftsMock.readDraft.mockResolvedValue({
      kind: 'post',
      postType: 'recipe',
      title: 'Jerk Chicken',
      ingredients: [{ item: 'Chicken' }],
      steps: ['Grill it'],
      sections: [],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [],
    });
    const server = fakeServer();
    registerPreviewPost(server as never, 'token');

    const result = (await server.call('preview_post', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(result.content[0].text).toContain('Title: Jerk Chicken');
    expect(result.content[0].text).toContain('Ingredients: 1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/previewPost'`

- [ ] **Step 3: Write `mcp-server/src/tools/previewPost.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { readDraft, summarizeDraftPost } from '../drafts';

export function registerPreviewPost(server: McpServer, accessToken: string): void {
  server.registerTool(
    'preview_post',
    {
      title: 'Preview a draft post',
      description: 'Renders a summary of the draft for review before publishing.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const draft = await readDraft(client, 'post', draftId);
      if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);
      return { content: [{ type: 'text' as const, text: summarizeDraftPost(draft) }] };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `preview_post` suite.

- [ ] **Step 5: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';
import { registerAddAffiliateLink } from './addAffiliateLink';
import { registerPreviewPost } from './previewPost';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
  registerPreviewPost(server, accessToken);
}
```

- [ ] **Step 6: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 7: Commit**

```bash
git add mcp-server/src/tools/previewPost.ts mcp-server/src/tools/index.ts mcp-server/tests/tools/previewPost.test.ts
git commit -m "feat: add preview_post tool"
```

---

### Task 13: confirm_and_publish Tool (Posts)

**Files:**
- Create: `mcp-server/src/render.ts`
- Create: `mcp-server/src/tools/confirmAndPublish.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/render.test.ts`
- Test: `mcp-server/tests/tools/confirmAndPublish.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient`, `commitFilesToMain`, `FileWrite` (Task 3); `readDraft`, `findDraftKind`, `deleteDraftBranch`, `DraftPost` (Task 4); `uniqueSlug` (Task 10).
- Produces: `renderPostMdx(slug: string, draft: DraftPost): string` in `mcp-server/src/render.ts` — this task's only consumer within this plan, but written standalone since it has no draft-store dependency. `registerConfirmAndPublish` — Task 14 modifies this same file to add the set-rotation branch.

- [ ] **Step 1: Write the failing render test**

Create `mcp-server/tests/render.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { renderPostMdx } from '../src/render';
import type { DraftPost } from '../src/drafts';

describe('renderPostMdx', () => {
  it('renders recipe frontmatter with ingredients and steps', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'recipe',
      title: 'Jerk Chicken for a Crowd',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Marinate overnight.'],
      sections: [],
      photos: [{ url: 'https://blob.vercel-storage.com/posts/a.jpg', caption: 'Jerk chicken' }],
      kitchenwareIds: ['coastal-blue-platter'],
      affiliateLinkIds: ['jerk-seasoning'],
      pendingAffiliateLinks: [],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('type: recipe');
    expect(mdx).toContain('title: Jerk Chicken for a Crowd');
    expect(mdx).toContain('coverPhoto: https://blob.vercel-storage.com/posts/a.jpg');
    expect(mdx).toContain('item: Chicken thighs');
    expect(mdx).toContain('- Marinate overnight.');
    expect(mdx).toContain('- coastal-blue-platter');
    expect(mdx).toContain('- jerk-seasoning');
  });

  it('renders article frontmatter with sections instead of ingredients/steps', () => {
    const draft: DraftPost = {
      kind: 'post',
      postType: 'article',
      title: 'Why We Chose Coastal Blue',
      ingredients: [],
      steps: [],
      sections: [{ heading: 'Why blue', body: 'It photographs beautifully.' }],
      photos: [],
      kitchenwareIds: [],
      affiliateLinkIds: [],
      pendingAffiliateLinks: [{ id: 'new-sauce-ab12', label: 'New sauce', url: 'https://vendor.example.com/new-sauce', tag: 'new-sauce' }],
    };

    const mdx = renderPostMdx(draft);

    expect(mdx).toContain('type: article');
    expect(mdx).toContain('heading: Why blue');
    expect(mdx).toContain('- new-sauce-ab12');
    expect(mdx).not.toContain('ingredients:');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../src/render'`

- [ ] **Step 3: Write `mcp-server/src/render.ts`**

```ts
import yaml from 'js-yaml';
import type { DraftPost } from './drafts';

export function renderPostMdx(draft: DraftPost): string {
  const frontmatter: Record<string, unknown> = {
    type: draft.postType,
    title: draft.title,
    date: new Date().toISOString().slice(0, 10),
    coverPhoto: draft.photos[0]?.url ?? '',
    coverPhotoAlt: draft.photos[0]?.caption ?? draft.title,
    kitchenwareIds: draft.kitchenwareIds,
    affiliateLinkIds: [...draft.affiliateLinkIds, ...draft.pendingAffiliateLinks.map((p) => p.id)],
  };

  if (draft.postType === 'recipe') {
    frontmatter.ingredients = draft.ingredients;
    frontmatter.steps = draft.steps;
  } else {
    frontmatter.sections = draft.sections;
  }

  return `---\n${yaml.dump(frontmatter)}---\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `render.test.ts` suites.

- [ ] **Step 5: Write the failing `confirm_and_publish` test**

Create `mcp-server/tests/tools/confirmAndPublish.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { readDraft: vi.fn(), findDraftKind: vi.fn(), deleteDraftBranch: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return {
    ...actual,
    readDraft: draftsMock.readDraft,
    findDraftKind: draftsMock.findDraftKind,
    deleteDraftBranch: draftsMock.deleteDraftBranch,
  };
});

const githubMock = { commitFilesToMain: vi.fn() };
vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  commitFilesToMain: (...args: unknown[]) => githubMock.commitFilesToMain(...args),
}));

const catalogMock = { uniqueSlug: vi.fn() };
vi.mock('../../src/catalog', () => ({ uniqueSlug: (...args: unknown[]) => catalogMock.uniqueSlug(...args) }));

const { registerConfirmAndPublish } = await import('../../src/tools/confirmAndPublish');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

const validRecipeDraft = {
  kind: 'post' as const,
  postType: 'recipe' as const,
  title: 'Jerk Chicken',
  ingredients: [{ item: 'Chicken' }],
  steps: ['Grill it'],
  sections: [],
  photos: [],
  kitchenwareIds: [],
  affiliateLinkIds: [],
  pendingAffiliateLinks: [{ id: 'sauce-ab12', label: 'Sauce', url: 'https://vendor.example.com/sauce', tag: 'sauce' }],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('confirm_and_publish (post)', () => {
  it('commits the rendered post and pending catalog entries, then deletes the draft branch', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue(validRecipeDraft);
    catalogMock.uniqueSlug.mockResolvedValue('jerk-chicken');
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    const result = (await server.call('confirm_and_publish', { draftId: 'abc1' })) as { content: { text: string }[] };

    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/content/posts/jerk-chicken.mdx' }),
        expect.objectContaining({ path: 'src/content/affiliate-links/sauce-ab12.json' }),
      ]),
      expect.stringContaining('Jerk Chicken'),
    );
    expect(draftsMock.deleteDraftBranch).toHaveBeenCalledWith(expect.anything(), 'post', 'abc1');
    expect(result.content[0].text).toContain('jerk-chicken');
  });

  it('rejects a recipe draft with no ingredients without committing anything', async () => {
    draftsMock.findDraftKind.mockResolvedValue('post');
    draftsMock.readDraft.mockResolvedValue({ ...validRecipeDraft, ingredients: [] });

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'abc1' })).rejects.toThrow(/ingredient/);
    expect(githubMock.commitFilesToMain).not.toHaveBeenCalled();
    expect(draftsMock.deleteDraftBranch).not.toHaveBeenCalled();
  });

  it('throws when no draft matches the given id', async () => {
    draftsMock.findDraftKind.mockResolvedValue(null);
    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await expect(server.call('confirm_and_publish', { draftId: 'nope' })).rejects.toThrow(/No draft found/);
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/confirmAndPublish'`

- [ ] **Step 7: Write `mcp-server/src/tools/confirmAndPublish.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient, commitFilesToMain, type FileWrite } from '../github';
import { readDraft, findDraftKind, deleteDraftBranch, type DraftPost } from '../drafts';
import { uniqueSlug } from '../catalog';
import { renderPostMdx } from '../render';

async function publishPost(client: ReturnType<typeof createGitHubClient>, draftId: string) {
  const draft = await readDraft(client, 'post', draftId);
  if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

  if (!draft.title.trim()) throw new Error('Draft has no title; cannot publish.');
  if (draft.postType === 'recipe' && (draft.ingredients.length === 0 || draft.steps.length === 0)) {
    throw new Error('Recipe drafts need at least one ingredient and one step before publishing.');
  }
  if (draft.postType === 'article' && draft.sections.length === 0) {
    throw new Error('Article drafts need at least one section before publishing.');
  }

  const slug = await uniqueSlug(client, draft.title);
  const files: FileWrite[] = [
    { path: `src/content/posts/${slug}.mdx`, content: renderPostMdx(draft) },
    ...draft.pendingAffiliateLinks.map((link) => ({
      path: `src/content/affiliate-links/${link.id}.json`,
      content: JSON.stringify({ label: link.label, url: link.url, tag: link.tag }, null, 2),
    })),
  ];

  await commitFilesToMain(client, files, `Publish post: ${draft.title}`);
  await deleteDraftBranch(client, 'post', draftId);

  return { content: [{ type: 'text' as const, text: `Published "${draft.title}" at /posts/${slug}/` }] };
}

export function registerConfirmAndPublish(server: McpServer, accessToken: string): void {
  server.registerTool(
    'confirm_and_publish',
    {
      title: 'Publish a confirmed draft',
      description: 'Validates, renders, and publishes a draft post or kitchenware set to the live site.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const kind = await findDraftKind(client, draftId);
      if (!kind) throw new Error(`No draft found with id ${draftId}`);
      if (kind === 'post') return publishPost(client, draftId);
      throw new Error(`Draft ${draftId} is a kitchenware set draft; set publishing isn't wired up yet`);
    },
  );
}
```

Note: the `kind === 'set'` branch is intentionally a clear error for now — Task 14 replaces it with real set-publishing logic in the same file.

- [ ] **Step 8: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `confirmAndPublish.test.ts` suites.

- [ ] **Step 9: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';
import { registerAddAffiliateLink } from './addAffiliateLink';
import { registerPreviewPost } from './previewPost';
import { registerConfirmAndPublish } from './confirmAndPublish';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
  registerPreviewPost(server, accessToken);
  registerConfirmAndPublish(server, accessToken);
}
```

- [ ] **Step 10: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

- [ ] **Step 11: Commit**

```bash
git add mcp-server/src/render.ts mcp-server/src/tools/confirmAndPublish.ts mcp-server/src/tools/index.ts mcp-server/tests/render.test.ts mcp-server/tests/tools/confirmAndPublish.test.ts
git commit -m "feat: add confirm_and_publish tool for posts"
```

---

### Task 14: start_new_set Tool + Set-Rotation Publishing

**Files:**
- Modify: `mcp-server/src/tools/confirmAndPublish.ts`
- Create: `mcp-server/src/tools/startNewSet.ts`
- Modify: `mcp-server/src/tools/index.ts`
- Test: `mcp-server/tests/tools/startNewSet.test.ts`
- Modify: `mcp-server/tests/tools/confirmAndPublish.test.ts`

**Interfaces:**
- Consumes: `createGitHubClient`, `commitFilesToMain`, `putFile`, `FileWrite` (Task 3); `createDraft`, `readDraft`, `deleteDraftBranch`, `DraftSet` (Task 4); `readCollection`, `slugify` (Task 10).
- Produces: `registerStartNewSet` — registered in `tools/index.ts`. Completes `confirm_and_publish`'s set-rotation branch, the plan's final tool.

- [ ] **Step 1: Write the failing `start_new_set` test**

Create `mcp-server/tests/tools/startNewSet.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const draftsMock = { createDraft: vi.fn() };
vi.mock('../../src/drafts', async () => {
  const actual = await vi.importActual<typeof import('../../src/drafts')>('../../src/drafts');
  return { ...actual, createDraft: draftsMock.createDraft };
});
vi.mock('../../src/github', () => ({ createGitHubClient: vi.fn(() => ({})) }));

const { registerStartNewSet } = await import('../../src/tools/startNewSet');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<unknown>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<unknown>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('start_new_set', () => {
  it('creates a set draft with the given name, start date, and products', async () => {
    draftsMock.createDraft.mockResolvedValue({ id: 'set1', branch: 'draft/set-set1' });
    const server = fakeServer();
    registerStartNewSet(server as never, 'token');

    const result = (await server.call('start_new_set', {
      name: 'Sunset Terracotta',
      startDate: '2027-01-01',
      products: [
        {
          name: 'Terracotta Bowl',
          priceCents: 3200,
          image: 'https://example.com/bowl.jpg',
          imageAlt: 'A terracotta bowl',
          vendorUrl: 'https://vendor.example.com/terracotta-bowl',
        },
      ],
    })) as { content: { text: string }[] };

    expect(draftsMock.createDraft).toHaveBeenCalledWith(
      expect.anything(),
      'set',
      expect.objectContaining({ kind: 'set', name: 'Sunset Terracotta', startDate: '2027-01-01' }),
    );
    expect(result.content[0].text).toContain('set1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../src/tools/startNewSet'`

- [ ] **Step 3: Write `mcp-server/src/tools/startNewSet.ts`**

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient } from '../github';
import { createDraft, type DraftSet } from '../drafts';

export function registerStartNewSet(server: McpServer, accessToken: string): void {
  server.registerTool(
    'start_new_set',
    {
      title: 'Start a new kitchenware set',
      description: 'Starts a draft for rotating to a new kitchenware set, with its product lineup.',
      inputSchema: {
        name: z.string(),
        startDate: z.string().describe('ISO date, e.g. 2027-01-01'),
        products: z.array(
          z.object({
            name: z.string(),
            priceCents: z.number().int().positive(),
            image: z.string().url(),
            imageAlt: z.string(),
            vendorUrl: z.string().url(),
          }),
        ),
      },
    },
    async ({ name, startDate, products }) => {
      const client = createGitHubClient(accessToken);
      const initial: DraftSet = { kind: 'set', name, startDate, products };
      const { id } = await createDraft(client, 'set', initial);
      return {
        content: [
          { type: 'text' as const, text: `Started a new set draft "${name}" with ${products.length} product(s). Draft id: ${id}.` },
        ],
      };
    },
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `start_new_set` suite.

- [ ] **Step 5: Extend the `confirm_and_publish` tests for the set branch**

Add to `mcp-server/tests/tools/confirmAndPublish.test.ts` (append inside the existing `describe('confirm_and_publish (post)', ...)` block's sibling, i.e. add a new top-level `describe` after it):

```ts
const catalogMock2 = { readCollection: vi.fn(), slugify: vi.fn() };
vi.mock('../../src/catalog', async () => {
  const actual = await vi.importActual<typeof import('../../src/catalog')>('../../src/catalog');
  return {
    ...actual,
    uniqueSlug: (...args: unknown[]) => catalogMock.uniqueSlug(...args),
    readCollection: catalogMock2.readCollection,
    slugify: catalogMock2.slugify,
  };
});

describe('confirm_and_publish (set)', () => {
  it('publishes the new set, its products, and auto-closes the previous active set', async () => {
    draftsMock.findDraftKind.mockResolvedValue('set');
    draftsMock.readDraft.mockResolvedValue({
      kind: 'set',
      name: 'Sunset Terracotta',
      startDate: '2027-01-01',
      products: [
        { name: 'Terracotta Bowl', priceCents: 3200, image: 'https://example.com/bowl.jpg', imageAlt: 'A terracotta bowl', vendorUrl: 'https://vendor.example.com/terracotta-bowl' },
      ],
    });
    catalogMock2.readCollection.mockResolvedValue([
      { id: 'coastal-blue', data: { name: 'Coastal Blue', startDate: '2026-07-01', endDate: '2026-12-31', productIds: ['coastal-blue-platter'] } },
    ]);
    catalogMock2.slugify.mockReturnValue('sunset-terracotta');
    githubMock.commitFilesToMain.mockResolvedValue('commit-sha');

    const server = fakeServer();
    registerConfirmAndPublish(server as never, 'token');

    await server.call('confirm_and_publish', { draftId: 'set1' });

    expect(githubMock.commitFilesToMain).toHaveBeenCalledWith(
      expect.anything(),
      expect.arrayContaining([
        expect.objectContaining({ path: 'src/content/sets/sunset-terracotta.json' }),
        expect.objectContaining({ path: 'src/content/products/terracotta-bowl.json' }),
        expect.objectContaining({
          path: 'src/content/sets/coastal-blue.json',
          content: expect.stringContaining('"endDate": "2026-12-31"'),
        }),
      ]),
      expect.stringContaining('Sunset Terracotta'),
    );
    expect(draftsMock.deleteDraftBranch).toHaveBeenCalledWith(expect.anything(), 'set', 'set1');
  });
});
```

This test asserts the previous set's `endDate` stays `2026-12-31` (one day before the new set's `2027-01-01` start) — since `2026-12-31` already is one day before `2027-01-01`, this fixture doesn't exercise a change; that's intentional to keep the assertion simple. The implementation in Step 6 computes the closed date generically.

- [ ] **Step 6: Update `mcp-server/src/tools/confirmAndPublish.ts` to add the set branch**

Replace the whole file:

```ts
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createGitHubClient, commitFilesToMain, type FileWrite } from '../github';
import { readDraft, findDraftKind, deleteDraftBranch, type DraftSet } from '../drafts';
import { readCollection, slugify, uniqueSlug } from '../catalog';
import { renderPostMdx } from '../render';

type GitHubClient = ReturnType<typeof createGitHubClient>;

async function publishPost(client: GitHubClient, draftId: string) {
  const draft = await readDraft(client, 'post', draftId);
  if (draft.kind !== 'post') throw new Error(`Draft ${draftId} is not a post draft`);

  if (!draft.title.trim()) throw new Error('Draft has no title; cannot publish.');
  if (draft.postType === 'recipe' && (draft.ingredients.length === 0 || draft.steps.length === 0)) {
    throw new Error('Recipe drafts need at least one ingredient and one step before publishing.');
  }
  if (draft.postType === 'article' && draft.sections.length === 0) {
    throw new Error('Article drafts need at least one section before publishing.');
  }

  const slug = await uniqueSlug(client, draft.title);
  const files: FileWrite[] = [
    { path: `src/content/posts/${slug}.mdx`, content: renderPostMdx(draft) },
    ...draft.pendingAffiliateLinks.map((link) => ({
      path: `src/content/affiliate-links/${link.id}.json`,
      content: JSON.stringify({ label: link.label, url: link.url, tag: link.tag }, null, 2),
    })),
  ];

  await commitFilesToMain(client, files, `Publish post: ${draft.title}`);
  await deleteDraftBranch(client, 'post', draftId);

  return { content: [{ type: 'text' as const, text: `Published "${draft.title}" at /posts/${slug}/` }] };
}

interface ExistingSetData {
  name: string;
  startDate: string;
  endDate: string;
  productIds: string[];
}

function dayBefore(isoDate: string): string {
  const d = new Date(isoDate);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

async function publishSet(client: GitHubClient, draftId: string) {
  const draft = await readDraft(client, 'set', draftId);
  if (draft.kind !== 'set') throw new Error(`Draft ${draftId} is not a set draft`);

  if (!draft.name.trim() || !draft.startDate || draft.products.length === 0) {
    throw new Error('Set drafts need a name, start date, and at least one product before publishing.');
  }

  const setSlug = slugify(draft.name);
  const productSlugs = draft.products.map((p) => slugify(p.name));

  const files: FileWrite[] = [
    {
      path: `src/content/sets/${setSlug}.json`,
      content: JSON.stringify(
        { name: draft.name, startDate: draft.startDate, endDate: '9999-12-31', productIds: productSlugs },
        null,
        2,
      ),
    },
    ...draft.products.map((product, i) => ({
      path: `src/content/products/${productSlugs[i]}.json`,
      content: JSON.stringify(
        {
          name: product.name,
          priceCents: product.priceCents,
          image: product.image,
          imageAlt: product.imageAlt,
          vendorUrl: product.vendorUrl,
          setId: setSlug,
        },
        null,
        2,
      ),
    })),
  ];

  const existingSets = await readCollection<ExistingSetData>(client, 'src/content/sets');
  const startDate = new Date(draft.startDate);
  const activeSet = existingSets.find(
    (s) => new Date(s.data.startDate) <= startDate && startDate <= new Date(s.data.endDate),
  );
  if (activeSet) {
    files.push({
      path: `src/content/sets/${activeSet.id}.json`,
      content: JSON.stringify({ ...activeSet.data, endDate: dayBefore(draft.startDate) }, null, 2),
    });
  }

  await commitFilesToMain(client, files, `Rotate to new kitchenware set: ${draft.name}`);
  await deleteDraftBranch(client, 'set', draftId);

  return { content: [{ type: 'text' as const, text: `Published new set "${draft.name}" with ${draft.products.length} product(s).` }] };
}

export function registerConfirmAndPublish(server: McpServer, accessToken: string): void {
  server.registerTool(
    'confirm_and_publish',
    {
      title: 'Publish a confirmed draft',
      description: 'Validates, renders, and publishes a draft post or kitchenware set to the live site.',
      inputSchema: { draftId: z.string() },
    },
    async ({ draftId }) => {
      const client = createGitHubClient(accessToken);
      const kind = await findDraftKind(client, draftId);
      if (!kind) throw new Error(`No draft found with id ${draftId}`);
      if (kind === 'post') return publishPost(client, draftId);
      return publishSet(client, draftId);
    },
  );
}
```

Note: the set's own `endDate` is written as a far-future placeholder (`9999-12-31`) since the design only closes the *previous* set on rotation — the new set's end date is set the next time a set rotates after it. This matches spec §7 (`start_new_set` auto-closes the previously-active set, not the new one).

- [ ] **Step 7: Run the full test suite**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites, including both `confirm_and_publish (post)` and `confirm_and_publish (set)`.

- [ ] **Step 8: Register the tool in `mcp-server/src/tools/index.ts`**

```ts
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerStartPost } from './startPost';
import { registerAddContentStep } from './addContentStep';
import { registerAttachPhoto } from './attachPhoto';
import { registerLinkKitchenware } from './linkKitchenware';
import { registerAddAffiliateLink } from './addAffiliateLink';
import { registerPreviewPost } from './previewPost';
import { registerConfirmAndPublish } from './confirmAndPublish';
import { registerStartNewSet } from './startNewSet';

export function registerTools(server: McpServer, accessToken: string): void {
  registerStartPost(server, accessToken);
  registerAddContentStep(server, accessToken);
  registerAttachPhoto(server, accessToken);
  registerLinkKitchenware(server, accessToken);
  registerAddAffiliateLink(server, accessToken);
  registerPreviewPost(server, accessToken);
  registerConfirmAndPublish(server, accessToken);
  registerStartNewSet(server, accessToken);
}
```

- [ ] **Step 9: Run the full test suite once more and the build**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites.

Run: `cd mcp-server && npm run build`
Expected: PASS — no type errors.

- [ ] **Step 10: Commit**

```bash
git add mcp-server/src/tools/confirmAndPublish.ts mcp-server/src/tools/startNewSet.ts mcp-server/src/tools/index.ts mcp-server/tests/tools/startNewSet.test.ts mcp-server/tests/tools/confirmAndPublish.test.ts
git commit -m "feat: add start_new_set tool and set-rotation publishing"
```

---

### Task 15: End-to-End Draft Flow Integration Test

**Files:**
- Test: `mcp-server/tests/integration/fullFlow.test.ts`

**Interfaces:**
- Consumes: every `registerXxx` tool function (Tasks 7–14) and `draftSchema`/`postSchema` for the final assertion.
- Produces: nothing consumed by later tasks — this is the plan's closing verification, per spec §9's "one integration-style test exercises the full sequence" requirement.

This test drives the tools directly (bypassing the HTTP/MCP transport layer, which Task 7 already covers structurally) against a single in-memory fake of the GitHub and Blob dependencies, proving the tools compose correctly end-to-end and that `confirm_and_publish`'s output is valid MDX frontmatter.

- [ ] **Step 1: Write the failing integration test**

Create `mcp-server/tests/integration/fullFlow.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import yaml from 'js-yaml';

interface FakeRepoState {
  branches: Map<string, string>; // branch name -> base sha (unused, just existence)
  files: Map<string, Map<string, string>>; // branch -> path -> content
  main: Map<string, string>; // path -> content
}

function makeFakeGitHub(): FakeRepoState {
  return { branches: new Map(), files: new Map(), main: new Map() };
}

let state: FakeRepoState;

vi.mock('../../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
  createBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.set(branch, 'base');
    state.files.set(branch, new Map());
  }),
  listBranches: vi.fn(async (_client: unknown, prefix: string) =>
    Array.from(state.branches.keys()).filter((b) => b.startsWith(prefix)),
  ),
  deleteBranch: vi.fn(async (_client: unknown, branch: string) => {
    state.branches.delete(branch);
    state.files.delete(branch);
  }),
  getFile: vi.fn(async (_client: unknown, path: string, ref: string) => {
    const store = ref === 'main' ? state.main : state.files.get(ref);
    const content = store?.get(path);
    return content === undefined ? null : { content, sha: 'sha' };
  }),
  putFile: vi.fn(async (_client: unknown, params: { path: string; content: string; branch: string }) => {
    state.files.get(params.branch)!.set(params.path, params.content);
  }),
  listFiles: vi.fn(async (_client: unknown, dirPath: string) =>
    Array.from(state.main.keys())
      .filter((p) => p.startsWith(`${dirPath}/`))
      .map((p) => p.slice(dirPath.length + 1)),
  ),
  commitFilesToMain: vi.fn(async (_client: unknown, files: { path: string; content: string }[]) => {
    for (const file of files) state.main.set(file.path, file.content);
    return 'fake-commit-sha';
  }),
}));

vi.mock('../../src/blob', () => ({
  fetchAndStorePhoto: vi.fn(async (url: string) => `https://blob.vercel-storage.com/posts/${encodeURIComponent(url)}.jpg`),
}));

const { registerStartPost } = await import('../../src/tools/startPost');
const { registerAddContentStep } = await import('../../src/tools/addContentStep');
const { registerAttachPhoto } = await import('../../src/tools/attachPhoto');
const { registerLinkKitchenware } = await import('../../src/tools/linkKitchenware');
const { registerAddAffiliateLink } = await import('../../src/tools/addAffiliateLink');
const { registerConfirmAndPublish } = await import('../../src/tools/confirmAndPublish');
const { postSchema } = await import('../../../src/content/schemas');

function fakeServer() {
  const handlers = new Map<string, (input: unknown) => Promise<{ content: { type: string; text: string }[] }>>();
  return {
    registerTool: (name: string, _meta: unknown, handler: (input: unknown) => Promise<{ content: { type: string; text: string }[] }>) => {
      handlers.set(name, handler);
    },
    call: (name: string, input: unknown) => handlers.get(name)!(input),
  };
}

beforeEach(() => {
  state = makeFakeGitHub();
});

describe('full authoring flow', () => {
  it('start_post -> add_content_step -> attach_photo -> link_kitchenware -> add_affiliate_link -> confirm_and_publish', async () => {
    state.main.set('src/content/products/coastal-blue-platter.json', JSON.stringify({ name: 'Coastal Blue Serving Platter', priceCents: 4800, setId: 'coastal-blue' }));
    state.main.set('src/content/sets/coastal-blue.json', JSON.stringify({ name: 'Coastal Blue', startDate: '2020-01-01', endDate: '2099-12-31' }));

    const server = fakeServer();
    registerStartPost(server as never, 'token');
    registerAddContentStep(server as never, 'token');
    registerAttachPhoto(server as never, 'token');
    registerLinkKitchenware(server as never, 'token');
    registerAddAffiliateLink(server as never, 'token');
    registerConfirmAndPublish(server as never, 'token');

    const startResult = await server.call('start_post', { type: 'recipe' });
    const draftId = startResult.content[0].text.match(/Draft id: (\w+)/)![1];

    await server.call('add_content_step', { draftId, title: 'Jerk Chicken for a Crowd' });
    await server.call('add_content_step', { draftId, ingredient: { item: 'Chicken thighs', amount: '2 lbs' } });
    await server.call('add_content_step', { draftId, step: 'Marinate overnight.' });
    await server.call('attach_photo', { draftId, photoUrl: 'https://icloud.com/share/xyz', caption: 'Jerk chicken' });
    await server.call('link_kitchenware', { draftId, productIds: ['coastal-blue-platter'] });
    await server.call('add_affiliate_link', { draftId, label: 'Jerk seasoning', url: 'https://vendor.example.com/jerk-seasoning', tag: 'jerk-seasoning' });

    const publishResult = await server.call('confirm_and_publish', { draftId });
    expect(publishResult.content[0].text).toContain('Published');

    const publishedPath = Array.from(state.main.keys()).find((p) => p.startsWith('src/content/posts/'));
    expect(publishedPath).toBeDefined();
    const mdx = state.main.get(publishedPath!)!;

    const frontmatterYaml = mdx.replace(/^---\n/, '').replace(/---\n$/, '');
    const frontmatter = yaml.load(frontmatterYaml);
    const parsed = postSchema.safeParse(frontmatter);
    expect(parsed.success).toBe(true);

    const affiliateLinkPath = Array.from(state.main.keys()).find((p) => p.startsWith('src/content/affiliate-links/jerk-seasoning'));
    expect(affiliateLinkPath).toBeDefined();

    expect(state.branches.has(`draft/post-${draftId}`)).toBe(false);
  });
});
```

This test imports `postSchema` from the site's `src/content/schemas.ts` via a relative path (`../../../src/content/schemas`) — `mcp-server/tests/integration/fullFlow.test.ts` is three levels below the repo root, so `../../../src` resolves to the repo root's `src/`. Since Task 2 declared `mcp-server` as an npm workspace member of the root package, this relative import is a normal same-repo reference, not a fragile cross-package hack — both packages share one `node_modules`/lockfile, and the import is read-only (schema validation only), needing none of the site's `astro:content` virtual module since `postSchema` is a plain Zod schema with no Astro-specific imports.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `Cannot find module '../../tests/integration/fullFlow.test.ts'` dependencies not yet wired, or an assertion failure if module resolution succeeds but behavior is incomplete. (If all prior tasks are done correctly, this should mostly work on the first real run — treat any failure as a genuine bug to fix, not an expected-fail placeholder.)

- [ ] **Step 3: Fix any integration issues surfaced**

If the test fails due to a real bug in how the tools compose (e.g. a mismatched field name between `attach_photo`'s output and what `confirm_and_publish` expects), fix the specific file responsible — do not change this test's assertions to paper over a real defect.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `full authoring flow` suite, plus every earlier suite.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/tests/integration/fullFlow.test.ts
git commit -m "test: add end-to-end draft flow integration test"
```

---

### Task 16: Manual Setup Documentation

**Files:**
- Create: `docs/AUTHORING-SETUP.md`
- Test: `mcp-server/tests/docs/authoringSetup.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed programmatically — read by the author (or whoever provisions the deployment) once, per spec §10.

- [ ] **Step 1: Write the failing test**

Create `mcp-server/tests/docs/authoringSetup.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd mcp-server && npm test`
Expected: FAIL — `ENOENT: no such file or directory, open '../docs/AUTHORING-SETUP.md'`

- [ ] **Step 3: Create `docs/AUTHORING-SETUP.md`**

```markdown
# Authoring MCP Server Setup

Manual, one-time setup for the authoring MCP server (outside this repo's automated tasks):

1. **Register a GitHub OAuth App** (GitHub → Settings → Developer settings → OAuth Apps → New OAuth App) for the MCP server. Set its callback URL to `https://<your-mcp-server-domain>/callback`. Note the generated Client ID and Client Secret.
2. **Create a new Vercel project** for `mcp-server/` (import this repo, set the project's root directory to `mcp-server/`).
3. **Provision a Vercel KV store** and attach it to the project — this holds OAuth client registrations from the Dynamic Client Registration flow.
4. **Provision Vercel Blob** for the project (if not already shared with the main site project) and note its read/write token.
5. **Set project environment variables** on the new Vercel project:
   - `AUTHOR_GITHUB_USERNAME` — her GitHub username (the single allowlisted author).
   - `MCP_SERVER_URL` — the deployed project's URL (e.g. `https://lhr-authoring.vercel.app`).
   - `KV_REST_API_URL` / `KV_REST_API_TOKEN` — from step 3 (Vercel sets these automatically when you attach a KV store).
   - `BLOB_READ_WRITE_TOKEN` — from step 4.
   - GitHub OAuth App Client ID/Secret from step 1, as required by the deployed auth wiring.
6. **Deploy** the `mcp-server/` project.
7. In the **Claude.ai app**, add a **custom MCP connector** pointing at the deployed project's `/mcp` URL, and complete the GitHub OAuth login when prompted — logging in as the same GitHub account named in `AUTHOR_GITHUB_USERNAME`. A login from any other GitHub account will be rejected by the server's allowlist check.
8. Create a **Claude.ai Project**, attach the connector, and paste in the scripted authoring-flow instructions (pick post type → title → content → photos → kitchenware → affiliate links → preview → confirm).
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd mcp-server && npm test`
Expected: PASS — `authoring setup docs` suite.

- [ ] **Step 5: Run the entire `mcp-server` suite and the site's suite once more**

Run: `cd mcp-server && npm test`
Expected: PASS — all suites in `mcp-server/`.

Run: `npm test` (from the repo root, for the site)
Expected: PASS — all suites from Task 1 plus Plan 1's existing suites.

- [ ] **Step 6: Commit**

```bash
git add docs/AUTHORING-SETUP.md mcp-server/tests/docs/authoringSetup.test.ts
git commit -m "docs: add authoring MCP server manual setup steps"
```

---

## Definition of Done

- [ ] `npm test` passes at the repo root (site suites, including the article-sections migration).
- [ ] `cd mcp-server && npm test` passes (all MCP server suites).
- [ ] `cd mcp-server && npm run build` passes with no type errors.
- [ ] `docs/AUTHORING-SETUP.md` exists and is committed.
- [ ] Manual steps in `docs/AUTHORING-SETUP.md` are completed by the user (GitHub OAuth App, Vercel project/KV/Blob, connector, Claude.ai Project) — outside the scope of automated tasks. In particular, the real OAuth handshake against claude.ai (Task 6's manual verification note) must be exercised at least once before considering this phase live.
