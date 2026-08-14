# Site UX/UI Design Implementation Plan

**Status:** Done — merged PR #9 (f5951c9, 2026-07-19)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the currently-unstyled site into a styled site matching `docs/BRAND.md` and `docs/superpowers/specs/2026-07-19-site-ux-ui-design.md` — a Tailwind-based design system, a global header/nav/footer, and restyled Home, Recipe Post, and Article Post pages, plus a new About page.

**Architecture:** Tailwind CSS v4 (via `@tailwindcss/vite`) supplies utility classes and CSS-custom-property design tokens defined once in `src/styles/global.css`. Existing BEM-style structural class names (`recipe-post__ingredients`, `article-post__section`, etc.) are kept as-is and used as test hooks; Tailwind utility classes are layered onto the same elements for visual styling. A new `Header.astro` / `Footer.astro` wrap every page via `BaseLayout.astro`.

**Tech Stack:** Astro 5, Tailwind CSS v4, `@tailwindcss/vite`, Vitest (existing build-and-grep integration test style).

## Global Constraints

- Colors (exact hex, from BRAND.md): background `#F5F1EA`, text `#2B2521`, accent `#A83E2C`, accent-secondary `#6B6560`, error `#C62828`, sold-out `#6B6560`, sale `#256B39`.
- Fonts: heading = Poppins, weights 500/700; body = Karla, weights 400/500/700.
- Spacing scale: 8/16/24/32/48/64 (px).
- Breakpoint: single-column below 768px (matches Tailwind's default `md:` breakpoint — no custom breakpoint config needed).
- Grid: `max-width: 1200px` container, 12-column grid on desktop.
- Contrast: WCAG AA confirmed in BRAND.md (13.4:1 text-on-background, 5.5:1 accent-on-background) — do not introduce new color combinations without checking contrast.
- Scope: Home (`src/pages/index.astro`), Recipe Post (`src/layouts/RecipeLayout.astro`), Article Post (`src/layouts/ArticleLayout.astro`), and a new About page (`src/pages/about.astro`) only. Product/Shop Listing and Community are explicitly out of scope.
- Styling approach: Tailwind CSS v4 utility classes. Do not add `@tailwindcss/typography` or any other Tailwind plugin — not part of the approved approach.
- Preserve every existing BEM-style structural class name already present in `RecipeLayout.astro`, `ArticleLayout.astro`, `ProductCard.astro`, and `AffiliateLink.astro` (they're used as test hooks) — add Tailwind utility classes alongside them, don't rename or remove them.
- Test convention: this repo has no component-level test runner — every existing page/layout test works by running `npm run build` and grepping the generated HTML in `dist/`. Follow this exact pattern for all new tests; don't introduce a new testing approach (e.g. jsdom, Playwright).

---

## File Structure

**Create:**
- `src/styles/global.css` — Tailwind entrypoint + `@theme` design tokens
- `src/components/Header.astro` — site header: centered wordmark, nav, mobile hamburger toggle
- `src/components/Footer.astro` — minimal site footer
- `src/components/PostTag.astro` — small "Recipe"/"Article" type badge, shared across Home/Recipe/Article
- `src/pages/about.astro` — new static About page
- `tests/styles/tokens.test.ts` — verifies brand color tokens compile into the built CSS
- `tests/pages/about.test.ts` — verifies the About page builds and renders

**Modify:**
- `package.json` — add `tailwindcss` and `@tailwindcss/vite` devDependencies
- `astro.config.mjs` — register the Tailwind Vite plugin
- `src/layouts/BaseLayout.astro` — import global stylesheet + Google Fonts, apply base body classes, render `<Header />` / `<Footer />` around `<slot />`
- `src/pages/index.astro` — featured-post + recent-list split layout
- `src/components/ProductCard.astro` — shared card styling
- `src/components/AffiliateLink.astro` — shared card styling
- `src/layouts/RecipeLayout.astro` — hero photo, steps/ingredients grid, kitchenware/affiliate strip
- `src/layouts/ArticleLayout.astro` — hero photo, prose/sidebar grid
- `tests/layouts/base-layout.test.ts` — add header and footer assertions
- `tests/pages/home.test.ts` — add featured/list and tag assertions
- `tests/pages/recipe-post.test.ts` — add card-styling and layout-grid assertions
- `tests/pages/article-post.test.ts` — add layout-grid assertions

---

### Task 1: Tailwind CSS v4 setup and design tokens

**Files:**
- Create: `src/styles/global.css`
- Create: `tests/styles/tokens.test.ts`
- Modify: `package.json`
- Modify: `astro.config.mjs`
- Modify: `src/layouts/BaseLayout.astro`

**Interfaces:**
- Produces: `src/styles/global.css`, imported by `BaseLayout.astro` and (transitively) every page. Defines Tailwind theme tokens: colors `background`, `text`, `accent`, `accent-secondary`, `error`, `sold-out`, `sale`; fonts `heading`, `body`. These generate Tailwind utilities `bg-background`, `text-text`, `text-accent`, `border-accent-secondary`, `font-heading`, `font-body`, etc., used by every later task.
- Produces: `<body>` in `BaseLayout.astro` carries classes `bg-background text-text font-body`, inherited by all page content.

- [ ] **Step 1: Write the failing test**

Create `tests/styles/tokens.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('design tokens', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('compiles the brand color tokens into the built stylesheet', () => {
    const cssFiles = readdirSync('dist', { recursive: true })
      .filter((f): f is string => typeof f === 'string' && f.endsWith('.css'));
    const css = cssFiles
      .map((f) => readFileSync(`dist/${f}`, 'utf-8'))
      .join('\n')
      .toLowerCase();

    expect(css).toContain('#f5f1ea'); // background
    expect(css).toContain('#2b2521'); // text
    expect(css).toContain('#a83e2c'); // accent
    expect(css).toContain('#6b6560'); // accent-secondary
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/styles/tokens.test.ts`
Expected: FAIL — no `.css` files exist in `dist/` yet (nothing imports a stylesheet), so the assertions against an empty string fail: `expected '' to contain '#f5f1ea'`.

- [ ] **Step 3: Write minimal implementation**

Install Tailwind:

Run: `npm install -D tailwindcss@^4.0.0 @tailwindcss/vite@^4.0.0`

Create `src/styles/global.css`:

```css
@import "tailwindcss";

@theme {
  --color-background: #F5F1EA;
  --color-text: #2B2521;
  --color-accent: #A83E2C;
  --color-accent-secondary: #6B6560;
  --color-error: #C62828;
  --color-sold-out: #6B6560;
  --color-sale: #256B39;

  --font-heading: "Poppins", sans-serif;
  --font-body: "Karla", sans-serif;
}
```

Modify `astro.config.mjs`:

```js
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  integrations: [mdx()],
  vite: {
    plugins: [tailwindcss()],
  },
});
```

Modify `src/layouts/BaseLayout.astro` (full file):

```astro
---
import '../styles/global.css';

interface Props {
  title: string;
}

const { title } = Astro.props;
const umamiUrl = import.meta.env.PUBLIC_UMAMI_URL;
const umamiWebsiteId = import.meta.env.PUBLIC_UMAMI_WEBSITE_ID;
---
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>{title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link
      href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;700&family=Karla:wght@400;500;700&display=swap"
      rel="stylesheet"
    />
    {umamiUrl && umamiWebsiteId && (
      <script defer src={umamiUrl} data-website-id={umamiWebsiteId}></script>
    )}
  </head>
  <body class="bg-background text-text font-body">
    <slot />
  </body>
</html>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/styles/tokens.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json astro.config.mjs src/styles/global.css src/layouts/BaseLayout.astro tests/styles/tokens.test.ts
git commit -m "feat: add Tailwind CSS v4 and brand design tokens"
```

---

### Task 2: Site header (masthead + mobile nav)

**Files:**
- Create: `src/components/Header.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `tests/layouts/base-layout.test.ts`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`bg-background`, `text-text`, `text-accent`, `border-accent-secondary`, `font-heading`).
- Produces: `Header.astro` — no props, self-contained. Rendered by `BaseLayout.astro` as `<Header />` immediately inside `<body>`, before `<slot />`. Root element carries class `site-header`; nav element carries `data-nav-menu` and class `site-header__nav`; toggle button carries `data-nav-toggle`, `aria-label="Toggle navigation"`, `aria-expanded`.

- [ ] **Step 1: Write the failing test**

Modify `tests/layouts/base-layout.test.ts` (full file):

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('Umami analytics script', () => {
  it('is included in the build when Umami env vars are set', () => {
    execSync('npm run build', {
      stdio: 'inherit',
      env: {
        ...process.env,
        PUBLIC_UMAMI_URL: 'https://umami.loveheatrelationship.com/script.js',
        PUBLIC_UMAMI_WEBSITE_ID: 'test-website-id',
      },
    });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('src="https://umami.loveheatrelationship.com/script.js"');
    expect(html).toContain('data-website-id="test-website-id"');
  }, 60000);

  it('is omitted from the build when Umami env vars are unset', () => {
    execSync('npm run build', { stdio: 'inherit' });
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).not.toContain('data-website-id');
  }, 60000);
});

describe('site header', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the wordmark and links to Home and About', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('site-header');
    expect(html).toContain('site-header__nav');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/about/"');
  });

  it('renders an accessible mobile nav toggle', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('data-nav-toggle');
    expect(html).toContain('aria-label="Toggle navigation"');
    expect(html).toContain('aria-expanded="false"');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/layouts/base-layout.test.ts`
Expected: FAIL on the two new `site header` tests — `expected ... to contain 'site-header'` (no header markup exists yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/components/Header.astro`:

```astro
---
const navLinks = [
  { href: '/', label: 'Home' },
  { href: '/about/', label: 'About' },
];
---
<header class="site-header border-b border-accent-secondary">
  <div class="mx-auto max-w-[1200px] px-4 py-4 text-center">
    <a href="/" class="font-heading text-xl font-bold tracking-tight text-text">lhr</a>
    <button
      type="button"
      data-nav-toggle
      aria-label="Toggle navigation"
      aria-expanded="false"
      class="site-header__toggle mt-2 inline-flex items-center justify-center md:hidden"
    >
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
        class="text-accent"
      >
        <line x1="4" y1="7" x2="20" y2="7" />
        <line x1="4" y1="12" x2="20" y2="12" />
        <line x1="4" y1="17" x2="20" y2="17" />
      </svg>
    </button>
    <nav data-nav-menu class="site-header__nav hidden mt-2 text-sm font-medium md:flex md:justify-center md:gap-6">
      {navLinks.map((link) => (
        <a href={link.href} class="block py-1 text-text hover:text-accent md:inline">{link.label}</a>
      ))}
    </nav>
  </div>
</header>

<script>
  const toggle = document.querySelector('[data-nav-toggle]');
  const menu = document.querySelector('[data-nav-menu]');
  toggle?.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    menu?.classList.toggle('hidden');
  });
</script>
```

Modify `src/layouts/BaseLayout.astro` — add the import and render `<Header />`:

```astro
---
import '../styles/global.css';
import Header from '../components/Header.astro';

interface Props {
  title: string;
}
```

```astro
  <body class="bg-background text-text font-body">
    <Header />
    <slot />
  </body>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/layouts/base-layout.test.ts`
Expected: PASS (all four tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Header.astro src/layouts/BaseLayout.astro tests/layouts/base-layout.test.ts
git commit -m "feat: add site header with centered masthead and mobile nav toggle"
```

---

### Task 3: Site footer

**Files:**
- Create: `src/components/Footer.astro`
- Modify: `src/layouts/BaseLayout.astro`
- Modify: `tests/layouts/base-layout.test.ts`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1 (`border-accent-secondary`, `text-accent-secondary`, `font-heading`).
- Produces: `Footer.astro` — no props. Rendered by `BaseLayout.astro` as `<Footer />` immediately after `<slot />`. Root element carries class `site-footer`.

- [ ] **Step 1: Write the failing test**

Add to `tests/layouts/base-layout.test.ts`, after the `site header` describe block:

```ts
describe('site footer', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the wordmark and copyright line', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    const year = new Date().getFullYear();
    expect(html).toContain('site-footer');
    expect(html).toContain(`© ${year} Love Heat Relationship`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/layouts/base-layout.test.ts`
Expected: FAIL on the new `site footer` test — `expected ... to contain 'site-footer'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/Footer.astro`:

```astro
---
const year = new Date().getFullYear();
---
<footer class="site-footer border-t border-accent-secondary py-6 text-center text-xs text-accent-secondary">
  <div class="mb-1 font-heading text-sm font-bold text-text">lhr</div>
  <div>© {year} Love Heat Relationship</div>
  <div class="mt-2 flex justify-center gap-3" aria-hidden="true">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <rect x="3" y="3" width="18" height="18" rx="4" />
      <circle cx="12" cy="12" r="4" />
    </svg>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M22 12a10 10 0 1 0-11.5 9.9v-7H8v-3h2.5V9.5A3.5 3.5 0 0 1 14 6h2v3h-2a1 1 0 0 0-1 1v2h3l-.5 3H13v7A10 10 0 0 0 22 12z" />
    </svg>
  </div>
</footer>
```

Modify `src/layouts/BaseLayout.astro`:

```astro
---
import '../styles/global.css';
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';

interface Props {
  title: string;
}
```

```astro
  <body class="bg-background text-text font-body">
    <Header />
    <slot />
    <Footer />
  </body>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/layouts/base-layout.test.ts`
Expected: PASS (all five tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/Footer.astro src/layouts/BaseLayout.astro tests/layouts/base-layout.test.ts
git commit -m "feat: add minimal site footer"
```

---

### Task 4: Home page — featured post + recent list

**Files:**
- Create: `src/components/PostTag.astro`
- Modify: `src/pages/index.astro`
- Modify: `tests/pages/home.test.ts`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1. `PostData` type from `../content/schemas` (already exported via `src/content/schemas.ts` → `@lhr/schemas`), specifically `data.type: 'recipe' | 'article'`.
- Produces: `PostTag.astro` — `Props { type: 'recipe' | 'article' }`, renders `<span class="post-tag ...">{label}</span>` where label is `'Recipe'` or `'Article'`. Used by this task and by Tasks 6 and 7.
- Produces: `src/pages/index.astro` root layout carries `home__featured` (featured post link) and `home__recent-list` (recent posts `<ul>`) classes.

- [ ] **Step 1: Write the failing test**

Add to `tests/pages/home.test.ts`, inside the existing `describe('home page', ...)` block, after the `'lists links to all published posts'` test:

```ts
  it('splits posts into a featured card and a recent-posts list', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('home__featured');
    expect(html).toContain('home__recent-list');
  });

  it('tags each post with its type', () => {
    const html = readFileSync('dist/index.html', 'utf-8');
    expect(html).toContain('post-tag');
    expect(html).toContain('>Recipe<');
    expect(html).toContain('>Article<');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pages/home.test.ts`
Expected: FAIL on both new tests — `expected ... to contain 'home__featured'` and `expected ... to contain 'post-tag'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/components/PostTag.astro`:

```astro
---
interface Props {
  type: 'recipe' | 'article';
}

const { type } = Astro.props;
const label = type === 'recipe' ? 'Recipe' : 'Article';
---
<span class="post-tag font-heading text-[10px] font-bold uppercase tracking-wide text-accent">{label}</span>
```

Modify `src/pages/index.astro` (full file):

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
import PostTag from '../components/PostTag.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('posts')).sort(
  (a, b) => b.data.date.valueOf() - a.data.date.valueOf(),
);
const [featured, ...recent] = posts;
---
<BaseLayout title="Love Heat Relationship">
  <div class="mx-auto max-w-[1200px] px-4 py-8">
    <h1 class="sr-only">Love Heat Relationship</h1>
    <div class="grid grid-cols-1 gap-6 md:grid-cols-12">
      {featured && (
        <a
          href={`/posts/${featured.id}/`}
          class="home__featured block rounded-lg bg-white p-4 shadow-md md:col-span-8"
        >
          <img
            src={featured.data.coverPhoto}
            alt={featured.data.coverPhotoAlt}
            class="mb-3 aspect-[3/2] w-full rounded-md object-cover"
          />
          <PostTag type={featured.data.type} />
          <h2 class="mt-1 font-heading text-xl font-bold text-text">{featured.data.title}</h2>
        </a>
      )}
      <ul class="home__recent-list md:col-span-4">
        {recent.map((post) => (
          <li class="home__recent-item mb-3 rounded-lg bg-white p-3 shadow-md">
            <a href={`/posts/${post.id}/`} class="block">
              <PostTag type={post.data.type} />
              <h3 class="mt-1 font-heading text-sm font-medium text-text">{post.data.title}</h3>
            </a>
          </li>
        ))}
      </ul>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/pages/home.test.ts`
Expected: PASS (all four tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/PostTag.astro src/pages/index.astro tests/pages/home.test.ts
git commit -m "feat: restyle home page into a featured-post and recent-list split"
```

---

### Task 5: Shared card styling for ProductCard and AffiliateLink

**Files:**
- Modify: `src/components/ProductCard.astro`
- Modify: `src/components/AffiliateLink.astro`
- Modify: `tests/pages/recipe-post.test.ts`

**Interfaces:**
- Consumes: Tailwind tokens from Task 1. Existing `ProductData` / `AffiliateLinkData` types and existing `Props` shapes — unchanged.
- Produces: both components keep their existing root class (`product-card`, `affiliate-link`) and existing child class names (`product-card__name`, `product-card__price`, `product-card__disclosure`, `affiliate-link__disclosure`) unchanged, with Tailwind card-styling utilities (`rounded-lg`, `shadow-md`, `bg-white`) added to the root class attribute. Consumed by `RecipeLayout.astro` and `ArticleLayout.astro` (Tasks 6 and 7) — no signature changes, so those layouts don't need to change how they call `<ProductCard id={...} data={...} />` / `<AffiliateLink id={...} data={...} />`.

- [ ] **Step 1: Write the failing test**

Add to `tests/pages/recipe-post.test.ts`, inside the existing `describe('recipe post page', ...)` block, after the existing test:

```ts
  it('gives kitchenware and affiliate links the shared card styling', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toMatch(/class="product-card[^"]*rounded-lg[^"]*shadow-md/);
    expect(html).toMatch(/class="affiliate-link[^"]*rounded-lg[^"]*shadow-md/);
  }, 60000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pages/recipe-post.test.ts`
Expected: FAIL on the new test — the `class="product-card"` attribute doesn't contain `rounded-lg` or `shadow-md` yet.

- [ ] **Step 3: Write minimal implementation**

Modify `src/components/ProductCard.astro` (full file):

```astro
---
import { formatPrice } from '../lib/content';
import type { ProductData } from '../content/schemas';

interface Props {
  id: string;
  data: ProductData;
}

const { id, data } = Astro.props;
---
<a
  class="product-card block rounded-lg bg-white p-3 shadow-md"
  href={data.vendorUrl}
  target="_blank"
  rel="noopener sponsored"
  data-umami-event="kitchenware-click"
  data-umami-event-product={id}
>
  <img src={data.image} alt={data.imageAlt} class="mb-2 aspect-[4/3] w-full rounded-md object-cover" />
  <span class="product-card__name block font-heading text-sm font-medium text-text">{data.name}</span>
  <span class="product-card__price block text-sm font-bold text-accent">{formatPrice(data.priceCents)}</span>
  <small class="product-card__disclosure block text-[10px] text-accent-secondary">Shop this piece (affiliate link)</small>
</a>
```

Modify `src/components/AffiliateLink.astro` (full file):

```astro
---
import type { AffiliateLinkData } from '../content/schemas';

interface Props {
  id: string;
  data: AffiliateLinkData;
}

const { id, data } = Astro.props;
---
<a
  class="affiliate-link block rounded-lg bg-white p-3 shadow-md text-sm font-medium text-text hover:text-accent"
  href={data.url}
  target="_blank"
  rel="noopener sponsored"
  data-umami-event="affiliate-click"
  data-umami-event-link={id}
>
  {data.label}
  <small class="affiliate-link__disclosure block text-[10px] font-normal text-accent-secondary">(affiliate link)</small>
</a>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/pages/recipe-post.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/components/ProductCard.astro src/components/AffiliateLink.astro tests/pages/recipe-post.test.ts
git commit -m "feat: restyle ProductCard and AffiliateLink into the shared card language"
```

---

### Task 6: Recipe Post layout

**Files:**
- Modify: `src/layouts/RecipeLayout.astro`
- Modify: `tests/pages/recipe-post.test.ts`

**Interfaces:**
- Consumes: `PostTag.astro` (Task 4, `Props { type: 'recipe' | 'article' }`), restyled `ProductCard.astro` / `AffiliateLink.astro` (Task 5) — same call signatures as before. Tailwind tokens from Task 1.
- Produces: root `<article>` keeps class `recipe-post`. New wrapper `<div class="recipe-post__layout ...">` (12-col grid) contains the existing `recipe-post__steps` and `recipe-post__ingredients` elements side by side. Existing `recipe-post__kitchenware` / `recipe-post__affiliate-links` sections unchanged in class name, now wrapped by a new `<div class="recipe-post__strip ...">`.

- [ ] **Step 1: Write the failing test**

Add to `tests/pages/recipe-post.test.ts`, after the test added in Task 5:

```ts
  it('wraps steps and ingredients in a two-column layout grid', () => {
    const html = readFileSync('dist/posts/jerk-chicken-platter/index.html', 'utf-8');
    expect(html).toContain('recipe-post__layout');
    expect(html).toContain('grid-cols-12');
  }, 60000);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pages/recipe-post.test.ts`
Expected: FAIL on the new test — `expected ... to contain 'recipe-post__layout'`.

- [ ] **Step 3: Write minimal implementation**

Modify `src/layouts/RecipeLayout.astro` (full file):

```astro
---
import BaseLayout from './BaseLayout.astro';
import PostTag from '../components/PostTag.astro';
import ProductCard from '../components/ProductCard.astro';
import AffiliateLink from '../components/AffiliateLink.astro';
import { render, type CollectionEntry } from 'astro:content';
import { getEntriesByIds } from '../lib/content';

interface Props {
  post: CollectionEntry<'posts'>;
  products: CollectionEntry<'products'>[];
  affiliateLinks: CollectionEntry<'affiliateLinks'>[];
}

const { post, products, affiliateLinks } = Astro.props;
const { data } = post;

if (data.type !== 'recipe') {
  throw new Error(`RecipeLayout received a non-recipe post: ${post.id}`);
}

const linkedProducts = getEntriesByIds(data.kitchenwareIds, products);
const linkedAffiliateLinks = getEntriesByIds(data.affiliateLinkIds, affiliateLinks);
const { Content } = await render(post);
---
<BaseLayout title={data.title}>
  <article class="recipe-post mx-auto max-w-[1200px] px-4 py-8">
    <img
      src={data.coverPhoto}
      alt={data.coverPhotoAlt}
      class="mb-4 aspect-[3/2] w-full rounded-lg object-cover md:aspect-[16/6]"
    />
    <PostTag type="recipe" />
    <h1 class="mt-1 mb-4 font-heading text-2xl font-bold text-text">{data.title}</h1>
    <div class="recipe-post__layout grid grid-cols-1 gap-6 md:grid-cols-12">
      <div class="md:col-span-8">
        <ol class="recipe-post__steps list-decimal space-y-2 pl-5 text-sm">
          {data.steps.map((step) => <li>{step}</li>)}
        </ol>
        <div class="recipe-post__content mt-6 space-y-3 text-sm leading-relaxed">
          <Content />
        </div>
      </div>
      <div class="md:col-span-4">
        <ul class="recipe-post__ingredients rounded-lg bg-white p-4 text-sm shadow-md">
          {data.ingredients.map((ingredient) => (
            <li class="mb-1">{ingredient.amount ? `${ingredient.amount} ` : ''}{ingredient.item}</li>
          ))}
        </ul>
      </div>
    </div>
    {(linkedProducts.length > 0 || linkedAffiliateLinks.length > 0) && (
      <div class="recipe-post__strip mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
        {linkedProducts.length > 0 && (
          <section class="recipe-post__kitchenware">
            <h2 class="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Shop this set</h2>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {linkedProducts.map((product) => <ProductCard id={product.id} data={product.data} />)}
            </div>
          </section>
        )}
        {linkedAffiliateLinks.length > 0 && (
          <section class="recipe-post__affiliate-links">
            <h2 class="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Also mentioned</h2>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {linkedAffiliateLinks.map((link) => <AffiliateLink id={link.id} data={link.data} />)}
            </div>
          </section>
        )}
      </div>
    )}
  </article>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/pages/recipe-post.test.ts`
Expected: PASS (all three tests)

- [ ] **Step 5: Commit**

```bash
git add src/layouts/RecipeLayout.astro tests/pages/recipe-post.test.ts
git commit -m "feat: restyle recipe post layout with hero photo and steps/ingredients grid"
```

---

### Task 7: Article Post layout

**Files:**
- Modify: `src/layouts/ArticleLayout.astro`
- Modify: `tests/pages/article-post.test.ts`

**Interfaces:**
- Consumes: `PostTag.astro` (Task 4), restyled `ProductCard.astro` / `AffiliateLink.astro` (Task 5) — same call signatures as before. Tailwind tokens from Task 1.
- Produces: root `<article>` keeps class `article-post`. New wrapper `<div class="article-post__layout ...">` (12-col grid) contains a new `article-post__prose` column (existing `article-post__section` elements, unchanged class name) and a new `article-post__sidebar` column (existing `article-post__kitchenware` / `article-post__affiliate-links` sections, unchanged class names).

- [ ] **Step 1: Write the failing test**

Modify `tests/pages/article-post.test.ts` (full file):

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

  it('wraps the prose and sidebar in a two-column layout grid', () => {
    const html = readFileSync('dist/posts/why-coastal-blue/index.html', 'utf-8');
    expect(html).toContain('article-post__layout');
    expect(html).toContain('article-post__prose');
    expect(html).toContain('article-post__sidebar');
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pages/article-post.test.ts`
Expected: FAIL on the new test — `expected ... to contain 'article-post__layout'`.

- [ ] **Step 3: Write minimal implementation**

Modify `src/layouts/ArticleLayout.astro` (full file):

```astro
---
import BaseLayout from './BaseLayout.astro';
import PostTag from '../components/PostTag.astro';
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
  <article class="article-post mx-auto max-w-[1200px] px-4 py-8">
    <img
      src={data.coverPhoto}
      alt={data.coverPhotoAlt}
      class="mb-4 aspect-[3/2] w-full rounded-lg object-cover md:aspect-[16/6]"
    />
    <PostTag type="article" />
    <h1 class="mt-1 mb-4 font-heading text-2xl font-bold text-text">{data.title}</h1>
    <div class="article-post__layout grid grid-cols-1 gap-6 md:grid-cols-12">
      <div class="article-post__prose max-w-[60ch] md:col-span-8">
        {data.sections.map((section) => (
          <section class="article-post__section mb-5">
            <h2 class="mb-1 font-heading text-base font-bold text-text">{section.heading}</h2>
            <p class="text-sm leading-relaxed">{section.body}</p>
          </section>
        ))}
      </div>
      {(linkedProducts.length > 0 || linkedAffiliateLinks.length > 0) && (
        <div class="article-post__sidebar space-y-4 md:col-span-4">
          {linkedProducts.length > 0 && (
            <section class="article-post__kitchenware">
              <h2 class="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Shop this set</h2>
              <div class="space-y-3">
                {linkedProducts.map((product) => <ProductCard id={product.id} data={product.data} />)}
              </div>
            </section>
          )}
          {linkedAffiliateLinks.length > 0 && (
            <section class="article-post__affiliate-links">
              <h2 class="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-accent-secondary">Also mentioned</h2>
              <div class="space-y-3">
                {linkedAffiliateLinks.map((link) => <AffiliateLink id={link.id} data={link.data} />)}
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  </article>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/pages/article-post.test.ts`
Expected: PASS (both tests)

- [ ] **Step 5: Commit**

```bash
git add src/layouts/ArticleLayout.astro tests/pages/article-post.test.ts
git commit -m "feat: restyle article post layout with hero photo and prose/sidebar grid"
```

---

### Task 8: About page

**Files:**
- Create: `src/pages/about.astro`
- Create: `tests/pages/about.test.ts`

**Interfaces:**
- Consumes: `BaseLayout.astro` (Task 1-3, `Props { title: string }`). No content-collection dependency — static markup only, per the spec.
- Produces: new route at `src/pages/about.astro`, building to `dist/about/index.html`. Root wrapper carries class `about-page`; photo carries `about-page__photo`; bio column carries `about-page__bio`.

- [ ] **Step 1: Write the failing test**

Create `tests/pages/about.test.ts`:

```ts
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

describe('about page', () => {
  beforeAll(() => {
    execSync('npm run build', { stdio: 'inherit' });
  }, 60000);

  it('renders the author photo beside the bio copy', () => {
    const html = readFileSync('dist/about/index.html', 'utf-8');
    expect(html).toContain('about-page__photo');
    expect(html).toContain('about-page__bio');
    expect(html).toContain('Love Heat Relationship began as a way to keep track of what actually worked');
  }, 60000);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/pages/about.test.ts`
Expected: FAIL — `ENOENT: no such file or directory, open 'dist/about/index.html'` (the page doesn't exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `src/pages/about.astro`:

```astro
---
import BaseLayout from '../layouts/BaseLayout.astro';
---
<BaseLayout title="About — Love Heat Relationship">
  <div class="about-page mx-auto max-w-[1200px] px-4 py-8">
    <h1 class="mb-6 font-heading text-2xl font-bold text-text">About</h1>
    <div class="grid grid-cols-1 gap-6 md:grid-cols-[260px_1fr]">
      <img
        src="https://placehold.co/600x800?text=In+the+Kitchen"
        alt="The kitchen behind every recipe and article on this site"
        class="about-page__photo w-full rounded-lg object-cover shadow-md"
      />
      <div class="about-page__bio space-y-4 text-sm leading-relaxed">
        <p>This kitchen has a brick wall, black granite counters, and more natural light than any kitchen has a right to — and everything on this site starts right here.</p>
        <p>Love Heat Relationship began as a way to keep track of what actually worked: the recipes on repeat, the pans that earned a permanent spot on the stove, the sets of dishes worth building a whole dinner around.</p>
        <p>Every six months, one kitchenware set gets the spotlight — used, photographed, and cooked with until it's time for the next one. Everything posted here is real: shot in this kitchen, cooked on this stove, no heavy filters.</p>
      </div>
    </div>
  </div>
</BaseLayout>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/pages/about.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pages/about.astro tests/pages/about.test.ts
git commit -m "feat: add About page with photo-and-story layout"
```

---

## Final Verification

- [ ] Run the full suite: `npm test`
- [ ] Expected: all test files pass, including the pre-existing `tests/content/*.test.ts`, `tests/lib/content.test.ts`, `tests/docs/governance.test.ts`, and `tests/deployment/vercel-config.test.ts` (untouched by this plan).
- [ ] Run `npm run build` once more and spot-check `dist/index.html`, `dist/posts/jerk-chicken-platter/index.html`, `dist/posts/why-coastal-blue/index.html`, and `dist/about/index.html` in a browser (`npm run preview`) at both a desktop width and a width under 768px, confirming the hamburger menu toggles the nav.
