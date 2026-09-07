# lhr-office Admin SPA Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `apps/lhr-office`'s single unstyled Basic-Auth `/status` page with a sidebar-navigated React SPA ("Slate Console" visual style), a JSON API, and Supabase Auth-backed real authentication.

**Architecture:** A new Vite+React+TypeScript client (`apps/lhr-office/client/`) is built and served as static files by the existing Express app, alongside a JSON API reorganized into one Express Router module per resource area (`src/routes/{jobs,candidates,trends,competitors}.ts`). `statusPage.ts`'s HTML rendering is deleted outright. A new `requireSupabaseAuth` middleware (local JWT verification against `SUPABASE_JWT_SECRET`) replaces `requireStatusAuth` on every `/api/*` route except the cron endpoint. The client authenticates directly against Supabase Auth via `@supabase/supabase-js`; the static SPA shell itself is unguarded (no data lives there), and the client shows a login screen whenever it has no valid session.

**Tech Stack:** Vite, React 18, react-router-dom, `@supabase/supabase-js` (client), `jsonwebtoken` (server), Vitest + `@testing-library/react` + jsdom (client tests), existing Express/Vitest/Supertest (server tests).

**Spec:** `docs/superpowers/specs/active/2026-09-07-lhr-office-admin-spa-design.md`

## Global Constraints

- Flat access model: every authenticated user has identical full access; no roles/permissions this phase.
- No browser/e2e test automation this phase — component/unit-level client tests only.
- The static SPA shell (`index.html` + JS/CSS) is served without a server-side gate; only `/api/*` data is auth-gated.
- Visual system "Slate Console": background `#151B23`, panel surfaces `#1B2430`, borders `#2A3542`, primary accent `#3FC7E0` (cyan), warning `#E0B93F` (amber), success `#4CAF7D` (green), error `#E0574F` (red); system sans for UI text, monospace for data-dense content; 8px spacing scale (8/16/24/32/48/64).
- Agents & Jobs / Overview job-health data polls every 5000ms while mounted; no polling elsewhere.
- Sidebar navigation and API routing are additive-by-design: a new panel is one entry in the panel registry (`client/src/panels/index.ts`) plus one page component; a new API resource area is one router module plus one `app.use(...)` line — no existing panel/router is edited to add a new one.
- Verification before merge happens on a Vercel PR preview deployment (Constitution #1 — no autonomous merge), not solely via the test suite.

---

## File Structure Overview

```
apps/lhr-office/
  client/
    index.html
    vite.config.ts
    tsconfig.json
    vitest.setup.ts
    src/
      main.tsx
      App.tsx
      theme.css
      panels/index.ts
      lib/{supabaseClient.ts, auth.ts, api.ts, types.ts}
      hooks/{usePolling.ts, useApiResource.ts}
      components/Sidebar.tsx
      pages/{Login.tsx, Overview.tsx, Approvals.tsx, AgentsAndJobs.tsx, Research.tsx}
  src/
    server.ts            (modified — mounts routers + auth + static serving)
    authMiddleware.ts     (new)
    routes/{jobs.ts, candidates.ts, trends.ts, competitors.ts}   (new)
    statusPage.ts         (deleted)
  scripts/bundle.mjs      (modified — adds vite build step)
  vitest.config.ts        (modified — jsdom for client/**)
  package.json            (modified — new deps)
.env.example               (modified — new/removed env vars)
```

---

### Task 1: Client scaffold (Vite + React + TypeScript) and test infrastructure

**Files:**
- Create: `apps/lhr-office/client/index.html`
- Create: `apps/lhr-office/client/vite.config.ts`
- Create: `apps/lhr-office/client/tsconfig.json`
- Create: `apps/lhr-office/client/vitest.setup.ts`
- Create: `apps/lhr-office/client/src/main.tsx`
- Create: `apps/lhr-office/client/src/App.tsx`
- Create: `apps/lhr-office/client/src/App.test.tsx`
- Modify: `apps/lhr-office/package.json`
- Modify: `apps/lhr-office/vitest.config.ts`

**Interfaces:**
- Produces: `App` (default-less named export from `client/src/App.tsx`), rendering a placeholder shell. Task 6 replaces its body with real routing/auth-gating; the export name and file path stay stable so this task's test keeps passing until Task 6 explicitly rewrites it.

- [ ] **Step 1: Add client dependencies to `apps/lhr-office/package.json`**

Add to `"dependencies"`:
```json
"react": "^18.3.1",
"react-dom": "^18.3.1"
```
Add to `"devDependencies"`:
```json
"@vitejs/plugin-react": "^4.3.2",
"@testing-library/react": "^16.0.1",
"@testing-library/jest-dom": "^6.5.0",
"@types/react": "^18.3.11",
"@types/react-dom": "^18.3.0",
"jsdom": "^25.0.1",
"vite": "^5.4.8"
```

Run: `npm install` from the repo root (workspaces hoist these into the shared `node_modules`).

- [ ] **Step 2: Write the failing smoke test**

```tsx
// apps/lhr-office/client/src/App.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App', () => {
  it('renders the app shell', () => {
    render(<App />);
    expect(screen.getByText('lhr office')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- App.test.tsx`
Expected: FAIL — `Cannot find module './App'` (or jsdom/environment errors, since the config below doesn't exist yet).

- [ ] **Step 4: Add jsdom environment + setup file to the workspace's vitest config**

```ts
// apps/lhr-office/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    environmentMatchGlobs: [['client/**', 'jsdom']],
    setupFiles: ['./client/vitest.setup.ts'],
  },
});
```

```ts
// apps/lhr-office/client/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 5: Write `client/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

- [ ] **Step 6: Write `client/vite.config.ts` and `client/index.html`**

```ts
// apps/lhr-office/client/vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
```

```html
<!-- apps/lhr-office/client/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>lhr office</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 7: Write `main.tsx` and the placeholder `App.tsx`**

```tsx
// apps/lhr-office/client/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

```tsx
// apps/lhr-office/client/src/App.tsx
export function App() {
  return <div>lhr office</div>;
}
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- App.test.tsx`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/lhr-office/client apps/lhr-office/package.json apps/lhr-office/vitest.config.ts package-lock.json
git commit -m "Scaffold Vite+React client and jsdom test infra for lhr-office"
```

---

### Task 2: "Slate Console" design tokens

**Files:**
- Create: `apps/lhr-office/client/src/theme.css`
- Create: `apps/lhr-office/client/src/theme.test.ts`
- Modify: `apps/lhr-office/client/src/main.tsx`

**Interfaces:**
- Produces: CSS custom properties on `:root` — `--bg`, `--surface`, `--border`, `--accent`, `--warning`, `--success`, `--error`, `--font-sans`, `--font-mono`, `--space-1` through `--space-6` (8/16/24/32/48/64px) — consumed by every component built in later tasks via `var(--token)`.

- [ ] **Step 1: Write the failing test (asserts the token file defines every required variable)**

```ts
// apps/lhr-office/client/src/theme.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const css = readFileSync(fileURLToPath(new URL('./theme.css', import.meta.url)), 'utf8');

describe('theme.css', () => {
  it.each([
    '--bg',
    '--surface',
    '--border',
    '--accent',
    '--warning',
    '--success',
    '--error',
    '--font-sans',
    '--font-mono',
    '--space-1',
    '--space-2',
    '--space-3',
    '--space-4',
    '--space-5',
    '--space-6',
  ])('defines %s', (token) => {
    expect(css).toContain(`${token}:`);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- theme.test.ts`
Expected: FAIL — `theme.css` does not exist yet.

- [ ] **Step 3: Write `theme.css`**

```css
/* apps/lhr-office/client/src/theme.css */
:root {
  --bg: #151B23;
  --surface: #1B2430;
  --border: #2A3542;
  --accent: #3FC7E0;
  --warning: #E0B93F;
  --success: #4CAF7D;
  --error: #E0574F;
  --font-sans: -apple-system, "Segoe UI", sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, monospace;
  --space-1: 8px;
  --space-2: 16px;
  --space-3: 24px;
  --space-4: 32px;
  --space-5: 48px;
  --space-6: 64px;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: var(--bg);
  color: #E6E9EF;
  font-family: var(--font-sans);
}

.app-shell {
  display: flex;
  min-height: 100vh;
}

.app-main {
  flex: 1;
  padding: var(--space-3);
}

.sidebar {
  width: 220px;
  background: var(--surface);
  border-right: 1px solid var(--border);
  padding: var(--space-2);
}

.sidebar-brand {
  font-weight: 600;
  margin-bottom: var(--space-3);
}

.sidebar ul {
  list-style: none;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}

.sidebar a {
  display: block;
  padding: var(--space-1);
  border-radius: 4px;
  color: inherit;
  text-decoration: none;
}

.sidebar a.active {
  background: var(--border);
  color: var(--accent);
}

.panel section, .job-health-card, .job-card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: var(--space-2);
  margin-bottom: var(--space-2);
}

[role='alert'] {
  color: var(--error);
}
```

- [ ] **Step 4: Import it from `main.tsx`**

```tsx
// apps/lhr-office/client/src/main.tsx
import './theme.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- theme.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/client/src/theme.css apps/lhr-office/client/src/theme.test.ts apps/lhr-office/client/src/main.tsx
git commit -m "Add Slate Console design tokens"
```

---

### Task 3: Server — `requireSupabaseAuth` middleware

**Files:**
- Create: `apps/lhr-office/src/authMiddleware.ts`
- Create: `apps/lhr-office/tests/authMiddleware.test.ts`
- Modify: `apps/lhr-office/package.json`

**Interfaces:**
- Produces: `requireSupabaseAuth(req: express.Request, res: express.Response, next: express.NextFunction): void` — reads `SUPABASE_JWT_SECRET` from `process.env` at call time (so tests can set/unset it per-case like the existing `STATUS_AUTH_USER` pattern), verifies a `Authorization: Bearer <token>` HS256 JWT, calls `next()` on success or responds `401 { error: 'unauthorized' }` on any failure. Consumed by Task 11 when mounting `/api/*` routers.

- [ ] **Step 1: Add `jsonwebtoken` to `apps/lhr-office/package.json`**

Add to `"dependencies"`: `"jsonwebtoken": "^9.0.2"`
Add to `"devDependencies"`: `"@types/jsonwebtoken": "^9.0.7"`

Run: `npm install` from the repo root.

- [ ] **Step 2: Write the failing test**

```ts
// apps/lhr-office/tests/authMiddleware.test.ts
import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { requireSupabaseAuth } from '../src/authMiddleware';

const originalEnv = { ...process.env };

function buildApp() {
  const app = express();
  app.get('/protected', requireSupabaseAuth, (_req, res) => res.json({ ok: true }));
  return app;
}

beforeEach(() => {
  process.env.SUPABASE_JWT_SECRET = 'test-secret';
});

afterEach(() => {
  process.env = { ...originalEnv };
});

describe('requireSupabaseAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const res = await request(buildApp()).get('/protected');
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'unauthorized' });
  });

  it('rejects a malformed Authorization header', async () => {
    const res = await request(buildApp()).get('/protected').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'wrong-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256', expiresIn: -10 });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('rejects every request when SUPABASE_JWT_SECRET is unset, even with a well-formed token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256' });
    delete process.env.SUPABASE_JWT_SECRET;
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it('calls next() and allows the request through for a valid token', async () => {
    const token = jwt.sign({ sub: 'user-1' }, 'test-secret', { algorithm: 'HS256' });
    const res = await request(buildApp()).get('/protected').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- authMiddleware.test.ts`
Expected: FAIL — `Cannot find module '../src/authMiddleware'`

- [ ] **Step 4: Write the implementation**

```ts
// apps/lhr-office/src/authMiddleware.ts
import jwt from 'jsonwebtoken';
import type express from 'express';

// Mirrors requireStatusAuth's posture: if the secret env var is unset, every
// request is treated as unauthorized rather than silently open.
export function requireSupabaseAuth(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  const secret = process.env.SUPABASE_JWT_SECRET;
  const reject = () => res.status(401).json({ error: 'unauthorized' });

  if (!secret) {
    reject();
    return;
  }

  const authHeader = req.header('authorization') ?? '';
  const match = /^Bearer (.+)$/.exec(authHeader);
  if (!match) {
    reject();
    return;
  }

  try {
    jwt.verify(match[1], secret, { algorithms: ['HS256'] });
  } catch {
    reject();
    return;
  }

  next();
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- authMiddleware.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/authMiddleware.ts apps/lhr-office/tests/authMiddleware.test.ts apps/lhr-office/package.json package-lock.json
git commit -m "Add requireSupabaseAuth middleware"
```

---

### Task 4: Client — Supabase client, `useSession` hook, and Login page

**Files:**
- Create: `apps/lhr-office/client/src/lib/supabaseClient.ts`
- Create: `apps/lhr-office/client/src/lib/auth.ts`
- Create: `apps/lhr-office/client/src/lib/auth.test.ts`
- Create: `apps/lhr-office/client/src/pages/Login.tsx`
- Create: `apps/lhr-office/client/src/pages/Login.test.tsx`
- Modify: `apps/lhr-office/package.json`

**Interfaces:**
- Produces: `supabase` (configured `SupabaseClient`, from `lib/supabaseClient.ts`); `useSession(): { session: Session | null; loading: boolean }` (from `lib/auth.ts`); `Login` component (from `pages/Login.tsx`). Consumed by Task 5 (`api.ts` reads `supabase.auth.getSession()`) and Task 6 (`App.tsx` calls `useSession()` and renders `Login` when unauthenticated).

- [ ] **Step 1: Add `@supabase/supabase-js` to `apps/lhr-office/package.json`**

Add to `"dependencies"`: `"@supabase/supabase-js": "^2.45.4"`

Run: `npm install` from the repo root.

- [ ] **Step 2: Write the failing test for `useSession`**

```ts
// apps/lhr-office/client/src/lib/auth.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getSessionMock = vi.fn();
const onAuthStateChangeMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      onAuthStateChange: (...args: unknown[]) => onAuthStateChangeMock(...args),
    },
  },
}));

const { useSession } = await import('./auth');

beforeEach(() => {
  vi.clearAllMocks();
  onAuthStateChangeMock.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
});

describe('useSession', () => {
  it('starts loading, then resolves with the current session', async () => {
    getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok' } } });
    const { result } = renderHook(() => useSession());
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toEqual({ access_token: 'tok' });
  });

  it('resolves with a null session when signed out', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.session).toBeNull();
  });

  it('updates when onAuthStateChange fires', async () => {
    getSessionMock.mockResolvedValue({ data: { session: null } });
    let capturedCallback: ((event: string, session: unknown) => void) | undefined;
    onAuthStateChangeMock.mockImplementation((cb) => {
      capturedCallback = cb;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    const { result } = renderHook(() => useSession());
    await waitFor(() => expect(result.current.loading).toBe(false));
    capturedCallback?.('SIGNED_IN', { access_token: 'new-tok' });
    await waitFor(() => expect(result.current.session).toEqual({ access_token: 'new-tok' }));
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- auth.test.ts`
Expected: FAIL — `Cannot find module './auth'`

- [ ] **Step 4: Write `supabaseClient.ts` and `auth.ts`**

```ts
// apps/lhr-office/client/src/lib/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  throw new Error('VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set');
}

export const supabase = createClient(url, anonKey);
```

```ts
// apps/lhr-office/client/src/lib/auth.ts
import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabaseClient';

export interface UseSessionResult {
  session: Session | null;
  loading: boolean;
}

export function useSession(): UseSessionResult {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return { session, loading };
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- auth.test.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for `Login`**

```tsx
// apps/lhr-office/client/src/pages/Login.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const signInWithPasswordMock = vi.fn();

vi.mock('../lib/supabaseClient', () => ({
  supabase: { auth: { signInWithPassword: (...args: unknown[]) => signInWithPasswordMock(...args) } },
}));

const { Login } = await import('./Login');

beforeEach(() => vi.clearAllMocks());

describe('Login', () => {
  it('submits email/password to Supabase', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: null });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() =>
      expect(signInWithPasswordMock).toHaveBeenCalledWith({ email: 'a@example.com', password: 'hunter2' }),
    );
  });

  it('shows an error message when sign-in fails', async () => {
    signInWithPasswordMock.mockResolvedValue({ error: { message: 'Invalid credentials' } });
    render(<Login />);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'a@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid credentials');
  });
});
```

- [ ] **Step 7: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- Login.test.tsx`
Expected: FAIL — `Cannot find module './Login'`

- [ ] **Step 8: Write `Login.tsx`**

```tsx
// apps/lhr-office/client/src/pages/Login.tsx
import { useState, type FormEvent } from 'react';
import { supabase } from '../lib/supabaseClient';

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    setSubmitting(false);
    if (signInError) setError(signInError.message);
  }

  return (
    <div className="login-screen">
      <form onSubmit={handleSubmit} className="login-form">
        <h1>lhr office</h1>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 9: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- Login.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/lhr-office/client/src/lib/supabaseClient.ts apps/lhr-office/client/src/lib/auth.ts apps/lhr-office/client/src/lib/auth.test.ts apps/lhr-office/client/src/pages/Login.tsx apps/lhr-office/client/src/pages/Login.test.tsx apps/lhr-office/package.json package-lock.json
git commit -m "Add Supabase client, useSession hook, and Login page"
```

---

### Task 5: Client — API fetch wrapper and shared response types

**Files:**
- Create: `apps/lhr-office/client/src/lib/types.ts`
- Create: `apps/lhr-office/client/src/lib/api.ts`
- Create: `apps/lhr-office/client/src/lib/api.test.ts`

**Interfaces:**
- Consumes: `supabase` from `lib/supabaseClient.ts` (Task 4).
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>`, `ApiError extends Error` (with `.status: number`) — consumed by every panel task (13–16). `types.ts` exports `OrchestratorRun`, `JobStatusRow`, `RecipeCandidateSummary`, `AffiliateCandidate`, `TrendCategory`, `TrendsReport`, `TrendSeedTopic`, `TrendsResponse`, `Competitor`, `CompetitorReport`, `CompetitorsResponse`, `CompetitorSeoKeyword` — the client's local mirror of the server's JSON shapes (deliberately not imported from `@lhr/db`, to keep the client decoupled from server internals).

- [ ] **Step 1: Write `types.ts`** (no test — this is a type-only file; its correctness is exercised by every consumer's own tests in later tasks)

```ts
// apps/lhr-office/client/src/lib/types.ts
export interface OrchestratorRun {
  id: number;
  jobName: string;
  status: 'running' | 'success' | 'partial' | 'failure';
  summary: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface JobStatusRow {
  name: string;
  cadenceDays: number;
  history: OrchestratorRun[];
}

export interface RecipeCandidateSummary {
  id: string;
  record: {
    status: string;
    source: { idMeal: string; title: string; cuisine: string; category: string };
  };
}

export interface AffiliateCandidate {
  id: number;
  title: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  isWildcard: boolean;
}

export type TrendCategory = 'web-design' | 'cooking' | 'nutrition';

export interface TrendsReport {
  id: number;
  cycleId: string;
  category: TrendCategory;
  summary: string;
}

export interface TrendSeedTopic {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
}

export interface TrendsResponse {
  reports: TrendsReport[];
  topics: TrendSeedTopic[];
}

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: 'candidate' | 'tracked' | 'rejected';
}

export interface CompetitorReport {
  id: number;
  competitorId: number;
  cycleId: string;
  summary: string;
}

export interface CompetitorsResponse {
  tracked: Competitor[];
  candidates: Competitor[];
  latestReportsByCompetitorId: Record<number, CompetitorReport>;
}

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
}
```

- [ ] **Step 2: Write the failing test for `apiFetch`**

```ts
// apps/lhr-office/client/src/lib/api.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const getSessionMock = vi.fn();
const signOutMock = vi.fn();

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getSession: (...args: unknown[]) => getSessionMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
    },
  },
}));

const { apiFetch, ApiError } = await import('./api');

beforeEach(() => {
  vi.clearAllMocks();
  getSessionMock.mockResolvedValue({ data: { session: { access_token: 'tok-123' } } });
  vi.stubGlobal('fetch', vi.fn());
});

describe('apiFetch', () => {
  it('attaches the bearer token from the current session', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ hello: 'world' }),
    });
    const result = await apiFetch('/api/jobs');
    expect(result).toEqual({ hello: 'world' });
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(init.headers.Authorization).toBe('Bearer tok-123');
  });

  it('signs out and throws ApiError on a 401', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: 'unauthorized' }),
    });
    await expect(apiFetch('/api/jobs')).rejects.toBeInstanceOf(ApiError);
    expect(signOutMock).toHaveBeenCalled();
  });

  it('throws ApiError with the server message on other failures', async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'db down' }),
    });
    await expect(apiFetch('/api/jobs')).rejects.toMatchObject({ message: 'db down', status: 500 });
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- api.test.ts`
Expected: FAIL — `Cannot find module './api'`

- [ ] **Step 4: Write `api.ts`**

```ts
// apps/lhr-office/client/src/lib/api.ts
import { supabase } from './supabaseClient';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const res = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (res.status === 401) {
    await supabase.auth.signOut();
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new ApiError(body.error ?? res.statusText, res.status);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
```

- [ ] **Step 5: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- api.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/client/src/lib/types.ts apps/lhr-office/client/src/lib/api.ts apps/lhr-office/client/src/lib/api.test.ts
git commit -m "Add API fetch wrapper and shared client response types"
```

---

### Task 6: Client — panel registry, Sidebar, and routed App shell

**Files:**
- Create: `apps/lhr-office/client/src/panels/index.ts`
- Create: `apps/lhr-office/client/src/components/Sidebar.tsx`
- Create: `apps/lhr-office/client/src/components/ErrorBoundary.tsx`
- Create: `apps/lhr-office/client/src/components/ErrorBoundary.test.tsx`
- Create: `apps/lhr-office/client/src/pages/Overview.tsx`
- Create: `apps/lhr-office/client/src/pages/Approvals.tsx`
- Create: `apps/lhr-office/client/src/pages/AgentsAndJobs.tsx`
- Create: `apps/lhr-office/client/src/pages/Research.tsx`
- Modify: `apps/lhr-office/client/src/App.tsx`
- Modify: `apps/lhr-office/client/src/App.test.tsx`
- Modify: `apps/lhr-office/package.json`

**Interfaces:**
- Consumes: `useSession` (Task 4), `Login` (Task 4).
- Produces: `panels: Panel[]` where `Panel = { id: string; label: string; path: string; component: React.ComponentType }` — the extension point Tasks 13–16 modify (replacing each stub page's body) and any future panel is added to. `Sidebar` renders `NavLink`s from this array. `ErrorBoundary` (a class component, since React only supports catching render errors via `getDerivedStateFromError`/`componentDidCatch`) wraps the routed panel content as the spec's "last resort" fallback if a panel throws during render.

- [ ] **Step 1: Add `react-router-dom` to `apps/lhr-office/package.json`**

Add to `"dependencies"`: `"react-router-dom": "^6.26.2"`

Run: `npm install` from the repo root.

- [ ] **Step 2: Write the failing test (replaces the Task 1 smoke test)**

```tsx
// apps/lhr-office/client/src/App.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const useSessionMock = vi.fn();
vi.mock('./lib/auth', () => ({ useSession: () => useSessionMock() }));
// Isolates this shell/routing test from each panel's real data-fetching (added in Tasks
// 13-16, after this test is written) — without this, rendering a real panel would exercise
// the real lib/api.ts -> lib/supabaseClient.ts chain, which throws when VITE_SUPABASE_URL /
// VITE_SUPABASE_ANON_KEY aren't set in the test environment.
vi.mock('./lib/api', () => ({ apiFetch: vi.fn().mockResolvedValue(null) }));

const { App } = await import('./App');

beforeEach(() => vi.clearAllMocks());

describe('App', () => {
  it('shows nothing but a loading state while the session is resolving', () => {
    useSessionMock.mockReturnValue({ session: null, loading: true });
    render(<App />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders the Login page when there is no session', () => {
    useSessionMock.mockReturnValue({ session: null, loading: false });
    render(<App />);
    expect(screen.getByRole('heading', { name: 'lhr office' })).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
  });

  it('renders the sidebar and default panel when signed in', () => {
    useSessionMock.mockReturnValue({ session: { access_token: 'tok' }, loading: false });
    render(<App />);
    expect(screen.getByRole('link', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Approvals' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Agents & Jobs' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Research' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Overview' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- App.test.tsx`
Expected: FAIL — the new assertions don't match the Task 1 placeholder `<div>lhr office</div>`.

- [ ] **Step 4: Write the stub page components**

```tsx
// apps/lhr-office/client/src/pages/Overview.tsx
export function Overview() {
  return <h1>Overview</h1>;
}
```

```tsx
// apps/lhr-office/client/src/pages/Approvals.tsx
export function Approvals() {
  return <h1>Approvals</h1>;
}
```

```tsx
// apps/lhr-office/client/src/pages/AgentsAndJobs.tsx
export function AgentsAndJobs() {
  return <h1>Agents &amp; Jobs</h1>;
}
```

```tsx
// apps/lhr-office/client/src/pages/Research.tsx
export function Research() {
  return <h1>Research</h1>;
}
```

- [ ] **Step 5: Write the panel registry**

```ts
// apps/lhr-office/client/src/panels/index.ts
import type { ComponentType } from 'react';
import { Overview } from '../pages/Overview';
import { Approvals } from '../pages/Approvals';
import { AgentsAndJobs } from '../pages/AgentsAndJobs';
import { Research } from '../pages/Research';

export interface Panel {
  id: string;
  label: string;
  path: string;
  component: ComponentType;
}

export const panels: Panel[] = [
  { id: 'overview', label: 'Overview', path: '/', component: Overview },
  { id: 'approvals', label: 'Approvals', path: '/approvals', component: Approvals },
  { id: 'agents-jobs', label: 'Agents & Jobs', path: '/agents-jobs', component: AgentsAndJobs },
  { id: 'research', label: 'Research', path: '/research', component: Research },
];
```

- [ ] **Step 6: Write `Sidebar.tsx`**

```tsx
// apps/lhr-office/client/src/components/Sidebar.tsx
import { NavLink } from 'react-router-dom';
import { panels } from '../panels';

export function Sidebar() {
  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">lhr office</div>
      <ul>
        {panels.map((panel) => (
          <li key={panel.id}>
            <NavLink to={panel.path} end={panel.path === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
              {panel.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
```

- [ ] **Step 7: Write the failing test for `ErrorBoundary`**

```tsx
// apps/lhr-office/client/src/components/ErrorBoundary.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorBoundary } from './ErrorBoundary';

function Bomb(): never {
  throw new Error('kaboom');
}

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(
      <ErrorBoundary>
        <p>fine</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText('fine')).toBeInTheDocument();
  });

  it('renders a fallback instead of crashing when a child throws during render', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/something went wrong/i)).toBeInTheDocument();
    consoleError.mockRestore();
  });
});
```

- [ ] **Step 8: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- ErrorBoundary.test.tsx`
Expected: FAIL — `Cannot find module './ErrorBoundary'`

- [ ] **Step 9: Write `ErrorBoundary.tsx`**

```tsx
// apps/lhr-office/client/src/components/ErrorBoundary.tsx
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
}

// The spec's "last resort": a panel that throws during render shows this
// instead of taking down the whole app shell (sidebar included).
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Panel crashed:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return <p role="alert">Something went wrong rendering this panel.</p>;
    }
    return this.props.children;
  }
}
```

- [ ] **Step 10: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- ErrorBoundary.test.tsx`
Expected: PASS

- [ ] **Step 11: Rewrite `App.tsx`, wrapping the routed panel content in `ErrorBoundary`**

```tsx
// apps/lhr-office/client/src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useSession } from './lib/auth';
import { Login } from './pages/Login';
import { Sidebar } from './components/Sidebar';
import { ErrorBoundary } from './components/ErrorBoundary';
import { panels } from './panels';

export function App() {
  const { session, loading } = useSession();

  if (loading) return <div className="app-loading">Loading…</div>;
  if (!session) return <Login />;

  return (
    <BrowserRouter>
      <div className="app-shell">
        <Sidebar />
        <main className="app-main">
          <ErrorBoundary>
            <Routes>
              {panels.map((panel) => (
                <Route key={panel.id} path={panel.path} element={<panel.component />} />
              ))}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </ErrorBoundary>
        </main>
      </div>
    </BrowserRouter>
  );
}
```

- [ ] **Step 12: Run the App test to confirm it passes**

Run: `npm test --workspace=lhr-office -- App.test.tsx`
Expected: PASS

- [ ] **Step 13: Commit**

```bash
git add apps/lhr-office/client/src apps/lhr-office/package.json package-lock.json
git commit -m "Add panel registry, Sidebar, error boundary, and routed App shell"
```

---

### Task 7: Client — `usePolling` and `useApiResource` hooks

**Files:**
- Create: `apps/lhr-office/client/src/hooks/usePolling.ts`
- Create: `apps/lhr-office/client/src/hooks/usePolling.test.ts`
- Create: `apps/lhr-office/client/src/hooks/useApiResource.ts`
- Create: `apps/lhr-office/client/src/hooks/useApiResource.test.ts`

**Interfaces:**
- Consumes: `apiFetch` (Task 5).
- Produces: `usePolling(callback: () => void, intervalMs: number): void`; `useApiResource<T>(path: string): { data: T | null; error: string | null; loading: boolean; refetch: () => void }`. Both consumed by every panel task (13–16).

- [ ] **Step 1: Write the failing test for `usePolling`**

```ts
// apps/lhr-office/client/src/hooks/usePolling.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { usePolling } from './usePolling';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('usePolling', () => {
  it('calls the callback on every interval', () => {
    const callback = vi.fn();
    renderHook(() => usePolling(callback, 5000));
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5000);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10000);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('stops calling the callback after unmount', () => {
    const callback = vi.fn();
    const { unmount } = renderHook(() => usePolling(callback, 5000));
    unmount();
    vi.advanceTimersByTime(20000);
    expect(callback).not.toHaveBeenCalled();
  });

  it('always calls the latest callback, not the one from the first render', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 5000), { initialProps: { cb: first } });
    rerender({ cb: second });
    vi.advanceTimersByTime(5000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- usePolling.test.ts`
Expected: FAIL — `Cannot find module './usePolling'`

- [ ] **Step 3: Write `usePolling.ts`**

```ts
// apps/lhr-office/client/src/hooks/usePolling.ts
import { useEffect, useRef } from 'react';

export function usePolling(callback: () => void, intervalMs: number): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    const id = setInterval(() => callbackRef.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- usePolling.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for `useApiResource`**

```ts
// apps/lhr-office/client/src/hooks/useApiResource.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { useApiResource } = await import('./useApiResource');

beforeEach(() => vi.clearAllMocks());

describe('useApiResource', () => {
  it('fetches on mount and exposes the result', async () => {
    apiFetchMock.mockResolvedValue({ hello: 'world' });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual({ hello: 'world' });
    expect(result.current.error).toBeNull();
  });

  it('does not surface an error until 3 consecutive failures', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();

    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(result.current.error).toBeNull();

    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(result.current.error).toBe('boom'));
  });

  it('resets the failure count on a subsequent success', async () => {
    apiFetchMock.mockRejectedValueOnce(new Error('one'));
    apiFetchMock.mockRejectedValueOnce(new Error('two'));
    apiFetchMock.mockResolvedValueOnce({ ok: true });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(3));
    expect(result.current.error).toBeNull();
    expect(result.current.data).toEqual({ ok: true });
  });

  it('refetch triggers another apiFetch call for the same path', async () => {
    apiFetchMock.mockResolvedValue({ n: 1 });
    const { result } = renderHook(() => useApiResource('/api/jobs'));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(1));
    act(() => result.current.refetch());
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledTimes(2));
    expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs');
  });
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- useApiResource.test.ts`
Expected: FAIL — `Cannot find module './useApiResource'`

- [ ] **Step 7: Write `useApiResource.ts`**

```ts
// apps/lhr-office/client/src/hooks/useApiResource.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface ApiResourceState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  refetch: () => void;
}

export function useApiResource<T>(path: string): ApiResourceState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const failureCountRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    apiFetch<T>(path)
      .then((result) => {
        if (cancelled) return;
        failureCountRef.current = 0;
        setData(result);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        failureCountRef.current += 1;
        // Transient polling failures retry silently; only surface a banner
        // after a few consecutive failures, so a single dropped request
        // doesn't flash an error on every 5s poll.
        if (failureCountRef.current >= 3) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, version]);

  const refetch = useCallback(() => setVersion((v) => v + 1), []);

  return { data, error, loading, refetch };
}
```

- [ ] **Step 8: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- useApiResource.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add apps/lhr-office/client/src/hooks
git commit -m "Add usePolling and useApiResource hooks"
```

---

### Task 8: Server — `routes/jobs.ts`

**Files:**
- Create: `apps/lhr-office/src/routes/jobs.ts`
- Create: `apps/lhr-office/tests/routes/jobs.test.ts`

**Interfaces:**
- Consumes: `Queryable`, `getRunHistory` from `@lhr/db`; `JobRegistration` from `@lhr/jobs`; `runJobNow` from `../orchestrate.js`.
- Produces: `createJobsRouter(db: Queryable, registry: JobRegistration[]): express.Router`, mounted at `/api/jobs` by Task 12. Routes: `GET /` → `JobStatusRow[]`; `POST /:jobName/run` → the `OrchestrationOutcome` from `runJobNow`, or `404 { error: 'Unknown job' }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/lhr-office/tests/routes/jobs.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const getRunHistoryMock = vi.fn();
vi.mock('@lhr/db', () => ({ getRunHistory: (...args: unknown[]) => getRunHistoryMock(...args) }));

const runJobNowMock = vi.fn();
vi.mock('../../src/orchestrate.js', () => ({ runJobNow: (...args: unknown[]) => runJobNowMock(...args) }));

const { createJobsRouter } = await import('../../src/routes/jobs');

const fakeDb = {} as Queryable;

function buildApp(registry = [{ name: 'recipe-variant-generator', cadenceDays: 7, run: vi.fn() }]) {
  const app = express();
  app.use(express.json());
  app.use('/api/jobs', createJobsRouter(fakeDb, registry));
  return app;
}

beforeEach(() => vi.clearAllMocks());

describe('GET /api/jobs', () => {
  it("returns each registered job's name, cadence, and history", async () => {
    getRunHistoryMock.mockResolvedValue([
      {
        id: 1,
        jobName: 'recipe-variant-generator',
        status: 'success',
        summary: 'generated 1 variant',
        errorMessage: null,
        startedAt: new Date('2026-08-20T00:00:00Z'),
        finishedAt: new Date('2026-08-20T00:05:00Z'),
      },
    ]);
    const res = await request(buildApp()).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        name: 'recipe-variant-generator',
        cadenceDays: 7,
        history: [
          {
            id: 1,
            jobName: 'recipe-variant-generator',
            status: 'success',
            summary: 'generated 1 variant',
            errorMessage: null,
            startedAt: '2026-08-20T00:00:00.000Z',
            finishedAt: '2026-08-20T00:05:00.000Z',
          },
        ],
      },
    ]);
  });

  it('returns an empty array when no jobs are registered', async () => {
    const res = await request(buildApp([])).get('/api/jobs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns 500 (not a hang) when getRunHistory rejects', async () => {
    getRunHistoryMock.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/jobs');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});

describe('POST /api/jobs/:jobName/run', () => {
  it('runs the named job and returns its outcome', async () => {
    runJobNowMock.mockResolvedValue({ outcome: 'ran', jobName: 'recipe-variant-generator' });
    const res = await request(buildApp()).post('/api/jobs/recipe-variant-generator/run');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ outcome: 'ran', jobName: 'recipe-variant-generator' });
  });

  it('returns 404 for an unknown job name', async () => {
    runJobNowMock.mockResolvedValue(null);
    const res = await request(buildApp()).post('/api/jobs/unknown-job/run');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Unknown job' });
  });

  it('returns 500 (not a hang) when runJobNow rejects', async () => {
    runJobNowMock.mockRejectedValue(new Error('boom'));
    const res = await request(buildApp()).post('/api/jobs/recipe-variant-generator/run');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- routes/jobs.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/jobs'`

- [ ] **Step 3: Write `routes/jobs.ts`**

```ts
// apps/lhr-office/src/routes/jobs.ts
import express from 'express';
import type { Queryable } from '@lhr/db';
import { getRunHistory } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { runJobNow } from '../orchestrate.js';

export function createJobsRouter(db: Queryable, registry: JobRegistration[]): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const rows = await Promise.all(
        registry.map(async (job) => ({
          name: job.name,
          cadenceDays: job.cadenceDays,
          history: await getRunHistory(db, job.name, 5),
        })),
      );
      res.json(rows);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  router.post('/:jobName/run', async (req, res) => {
    try {
      const outcome = await runJobNow(db, registry, req.params.jobName);
      if (outcome === null) {
        res.status(404).json({ error: 'Unknown job' });
        return;
      }
      res.json(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: message });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- routes/jobs.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/routes/jobs.ts apps/lhr-office/tests/routes/jobs.test.ts
git commit -m "Add /api/jobs router"
```

---

### Task 9: Server — `routes/candidates.ts`

**Files:**
- Create: `apps/lhr-office/src/routes/candidates.ts`
- Create: `apps/lhr-office/tests/routes/candidates.test.ts`

**Interfaces:**
- Consumes: `CandidateOps`, `AffiliateCandidateOps` (exported from `../server.js` today — this task moves those two interfaces and their default-implementation factories out of `server.ts` into this file, since they belong with the routes that use them; `server.ts` re-exports them in Task 12 for backward compatibility of the type-only imports nothing else uses).
- Produces: `createCandidatesRouter(candidates: CandidateOps, affiliateCandidates: AffiliateCandidateOps): express.Router`, mounted at `/api/candidates` by Task 12. Routes: `GET /recipe`, `POST /recipe/:id/approve`, `POST /recipe/:id/reroll`, `GET /affiliate`, `POST /affiliate/:id/approve`, `POST /affiliate/:id/deny`.

**Note:** `CandidateOps`/`AffiliateCandidateOps` and their default factories (`defaultCandidateOps`, `defaultAffiliateCandidateOps`, `requireGitHubToken`, `requireAssociatesTag`) move from `server.ts` into this file verbatim — copy them here rather than reimplementing, then Task 12 deletes them from `server.ts` and imports them from this module instead.

- [ ] **Step 1: Write the failing test**

```ts
// apps/lhr-office/tests/routes/candidates.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createCandidatesRouter } from '../../src/routes/candidates';

function buildApp(candidates: any, affiliateCandidates: any) {
  const app = express();
  app.use(express.json());
  app.use('/api/candidates', createCandidatesRouter(candidates, affiliateCandidates));
  return app;
}

const noCandidates = { getPending: vi.fn().mockResolvedValue(null), approve: vi.fn(), reroll: vi.fn() };
const noAffiliateCandidates = { getPending: vi.fn().mockResolvedValue([]), approve: vi.fn(), deny: vi.fn() };

beforeEach(() => vi.clearAllMocks());

describe('GET /api/candidates/recipe', () => {
  it('returns the pending recipe candidate', async () => {
    const candidates = {
      getPending: vi.fn().mockResolvedValue({
        id: 'cand1',
        record: { status: 'pending', source: { idMeal: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' } },
      }),
      approve: vi.fn(),
      reroll: vi.fn(),
    };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).get('/api/candidates/recipe');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('cand1');
  });

  it('returns null when nothing is pending', async () => {
    const res = await request(buildApp(noCandidates, noAffiliateCandidates)).get('/api/candidates/recipe');
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
  });
});

describe('POST /api/candidates/recipe/:id/approve', () => {
  it('approves and returns the result', async () => {
    const candidates = {
      getPending: vi.fn(),
      approve: vi.fn().mockResolvedValue({ draftId: 'draft1', title: 'Teriyaki Chicken Casserole', sourceMealDbId: '52772' }),
      reroll: vi.fn(),
    };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ draftId: 'draft1', title: 'Teriyaki Chicken Casserole', sourceMealDbId: '52772' });
    expect(candidates.approve).toHaveBeenCalledWith('cand1');
  });

  it('returns 500 (not a hang) when approve rejects', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn().mockRejectedValue(new Error('boom')), reroll: vi.fn() };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/approve');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'boom' });
  });
});

describe('POST /api/candidates/recipe/:id/reroll', () => {
  it('rerolls and returns the new candidate', async () => {
    const candidates = { getPending: vi.fn(), approve: vi.fn(), reroll: vi.fn().mockResolvedValue({ id: 'cand2', record: {} }) };
    const res = await request(buildApp(candidates, noAffiliateCandidates)).post('/api/candidates/recipe/cand1/reroll');
    expect(res.status).toBe(200);
    expect(candidates.reroll).toHaveBeenCalledWith('cand1');
  });
});

describe('GET /api/candidates/affiliate', () => {
  it('returns pending affiliate candidates', async () => {
    const affiliateCandidates = { getPending: vi.fn().mockResolvedValue([{ id: 1, title: 'Cast Iron Skillet' }]), approve: vi.fn(), deny: vi.fn() };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).get('/api/candidates/affiliate');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 1, title: 'Cast Iron Skillet' }]);
  });
});

describe('POST /api/candidates/affiliate/:id/approve', () => {
  it('approves by numeric id and returns the result', async () => {
    const affiliateCandidates = { getPending: vi.fn(), approve: vi.fn().mockResolvedValue({ asin: 'B0X', title: 'Cast Iron Skillet', path: 'src/content/products/cast-iron.json' }), deny: vi.fn() };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).post('/api/candidates/affiliate/42/approve');
    expect(res.status).toBe(200);
    expect(affiliateCandidates.approve).toHaveBeenCalledWith(42);
  });
});

describe('POST /api/candidates/affiliate/:id/deny', () => {
  it('denies by numeric id and returns the result', async () => {
    const affiliateCandidates = { getPending: vi.fn(), approve: vi.fn(), deny: vi.fn().mockResolvedValue({ asin: 'B0X', title: 'Cast Iron Skillet' }) };
    const res = await request(buildApp(noCandidates, affiliateCandidates)).post('/api/candidates/affiliate/42/deny');
    expect(res.status).toBe(200);
    expect(affiliateCandidates.deny).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- routes/candidates.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/candidates'`

- [ ] **Step 3: Write `routes/candidates.ts`**

```ts
// apps/lhr-office/src/routes/candidates.ts
import express from 'express';
import type { Candidate, Queryable } from '@lhr/db';
import { getLatestPendingCycleId, getPendingCandidates } from '@lhr/db';
import { createGitHubClient } from 'lhr-authoring-mcp-server/dist-lib/github.js';
import {
  getPendingCandidate,
  approveCandidate,
  rerollCandidate,
  type CandidateSummary,
  type ApprovedCandidate,
} from 'lhr-authoring-mcp-server/dist-lib/recipeCandidates.js';
import {
  approveAffiliateCandidate,
  denyAffiliateCandidate,
  type ApprovedAffiliateCandidate,
  type DeniedAffiliateCandidate,
} from 'lhr-authoring-mcp-server/dist-lib/affiliateCandidateOps.js';

export interface CandidateOps {
  getPending: () => Promise<CandidateSummary | null>;
  approve: (id: string) => Promise<ApprovedCandidate>;
  reroll: (id: string) => Promise<CandidateSummary | null>;
}

export interface AffiliateCandidateOps {
  getPending: () => Promise<Candidate[]>;
  approve: (id: number) => Promise<ApprovedAffiliateCandidate>;
  deny: (id: number) => Promise<DeniedAffiliateCandidate>;
}

function requireGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  return token;
}

function requireAssociatesTag(): string {
  const tag = process.env.AMAZON_ASSOCIATES_TAG;
  if (!tag) throw new Error('AMAZON_ASSOCIATES_TAG is not set');
  return tag;
}

export function defaultCandidateOps(): CandidateOps {
  return {
    getPending: () => getPendingCandidate(createGitHubClient(requireGitHubToken())),
    approve: (id) => approveCandidate(createGitHubClient(requireGitHubToken()), id),
    reroll: (id) => rerollCandidate(createGitHubClient(requireGitHubToken()), id),
  };
}

export function defaultAffiliateCandidateOps(db: Queryable): AffiliateCandidateOps {
  return {
    getPending: async () => {
      const cycleId = await getLatestPendingCycleId(db);
      return cycleId ? getPendingCandidates(db, cycleId) : [];
    },
    approve: (id) => approveAffiliateCandidate(db, requireGitHubToken(), requireAssociatesTag(), id),
    deny: (id) => denyAffiliateCandidate(db, id),
  };
}

export function createCandidatesRouter(candidates: CandidateOps, affiliateCandidates: AffiliateCandidateOps): express.Router {
  const router = express.Router();

  router.get('/recipe', async (_req, res) => {
    try {
      res.json(await candidates.getPending());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/recipe/:id/approve', async (req, res) => {
    try {
      res.json(await candidates.approve(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/recipe/:id/reroll', async (req, res) => {
    try {
      res.json(await candidates.reroll(req.params.id));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/affiliate', async (_req, res) => {
    try {
      res.json(await affiliateCandidates.getPending());
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/affiliate/:id/approve', async (req, res) => {
    try {
      res.json(await affiliateCandidates.approve(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/affiliate/:id/deny', async (req, res) => {
    try {
      res.json(await affiliateCandidates.deny(Number(req.params.id)));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- routes/candidates.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/routes/candidates.ts apps/lhr-office/tests/routes/candidates.test.ts
git commit -m "Add /api/candidates router"
```

---

### Task 10: Server — `routes/trends.ts`

**Files:**
- Create: `apps/lhr-office/src/routes/trends.ts`
- Create: `apps/lhr-office/tests/routes/trends.test.ts`

**Interfaces:**
- Consumes: `Queryable`, `TREND_CATEGORIES`, `listRecentReports`, `getAllTopics`, `setTopicStatus`, `addCuratedTopic` from `@lhr/db`.
- Produces: `createTrendsRouter(db: Queryable): express.Router`, mounted at `/api/trends` by Task 12. Routes: `GET /` → `{ reports: TrendsReport[]; topics: TrendSeedTopic[] }`; `POST /topics` → created `TrendSeedTopic`; `POST /topics/:id/promote` / `POST /topics/:id/demote` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/lhr-office/tests/routes/trends.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const listRecentReportsMock = vi.fn();
const getAllTopicsMock = vi.fn();
const setTopicStatusMock = vi.fn();
const addCuratedTopicMock = vi.fn();

vi.mock('@lhr/db', () => ({
  TREND_CATEGORIES: ['web-design', 'cooking', 'nutrition'],
  listRecentReports: (...args: unknown[]) => listRecentReportsMock(...args),
  getAllTopics: (...args: unknown[]) => getAllTopicsMock(...args),
  setTopicStatus: (...args: unknown[]) => setTopicStatusMock(...args),
  addCuratedTopic: (...args: unknown[]) => addCuratedTopicMock(...args),
}));

const { createTrendsRouter } = await import('../../src/routes/trends');

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/trends', createTrendsRouter(fakeDb));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  listRecentReportsMock.mockResolvedValue([]);
  getAllTopicsMock.mockResolvedValue([]);
});

describe('GET /api/trends', () => {
  it('returns reports across all categories and all topics', async () => {
    listRecentReportsMock.mockImplementation(async (_db, category) =>
      category === 'cooking' ? [{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'summary' }] : [],
    );
    getAllTopicsMock.mockResolvedValue([{ id: 1, category: 'cooking', topic: 'sourdough', status: 'curated' }]);
    const res = await request(buildApp()).get('/api/trends');
    expect(res.status).toBe(200);
    expect(res.body.reports).toEqual([{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'summary' }]);
    expect(res.body.topics).toEqual([{ id: 1, category: 'cooking', topic: 'sourdough', status: 'curated' }]);
  });

  it('returns 500 (not a hang) when a lookup rejects', async () => {
    getAllTopicsMock.mockRejectedValue(new Error('db down'));
    const res = await request(buildApp()).get('/api/trends');
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'db down' });
  });
});

describe('POST /api/trends/topics', () => {
  it('adds a curated topic and returns it', async () => {
    addCuratedTopicMock.mockResolvedValue({ id: 5, category: 'cooking', topic: 'miso', status: 'curated' });
    const res = await request(buildApp()).post('/api/trends/topics').send({ category: 'cooking', topic: 'miso' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 5, category: 'cooking', topic: 'miso', status: 'curated' });
    expect(addCuratedTopicMock).toHaveBeenCalledWith(fakeDb, 'cooking', 'miso');
  });
});

describe('POST /api/trends/topics/:id/promote', () => {
  it('promotes the topic', async () => {
    const res = await request(buildApp()).post('/api/trends/topics/5/promote');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'curated');
  });
});

describe('POST /api/trends/topics/:id/demote', () => {
  it('demotes the topic', async () => {
    const res = await request(buildApp()).post('/api/trends/topics/5/demote');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setTopicStatusMock).toHaveBeenCalledWith(fakeDb, 5, 'candidate');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- routes/trends.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/trends'`

- [ ] **Step 3: Write `routes/trends.ts`**

```ts
// apps/lhr-office/src/routes/trends.ts
import express from 'express';
import type { Queryable } from '@lhr/db';
import { TREND_CATEGORIES, listRecentReports, getAllTopics, setTopicStatus, addCuratedTopic } from '@lhr/db';

export function createTrendsRouter(db: Queryable): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const reports = (await Promise.all(TREND_CATEGORIES.map((category) => listRecentReports(db, category)))).flat();
      const topics = await getAllTopics(db);
      res.json({ reports, topics });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics', async (req, res) => {
    try {
      res.json(await addCuratedTopic(db, req.body.category, req.body.topic));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics/:id/promote', async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'curated');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/topics/:id/demote', async (req, res) => {
    try {
      await setTopicStatus(db, Number(req.params.id), 'candidate');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- routes/trends.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/routes/trends.ts apps/lhr-office/tests/routes/trends.test.ts
git commit -m "Add /api/trends router"
```

---

### Task 11: Server — `routes/competitors.ts`

**Files:**
- Create: `apps/lhr-office/src/routes/competitors.ts`
- Create: `apps/lhr-office/tests/routes/competitors.test.ts`

**Interfaces:**
- Consumes: `Queryable`, `CompetitorReport`, `listCompetitorsByStatus`, `setCompetitorStatus`, `listRecentCompetitorReports`, `listKeywords`, `addKeyword`, `removeKeyword` from `@lhr/db`.
- Produces: `createCompetitorsRouter(db: Queryable): express.Router`, mounted at `/api/competitors` by Task 12. Routes: `GET /` → `{ tracked, candidates, latestReportsByCompetitorId }`; `POST /:id/approve` / `POST /:id/reject` → `{ ok: true }`; `GET /keywords` → `CompetitorSeoKeyword[]`; `POST /keywords` → created `CompetitorSeoKeyword`; `DELETE /keywords/:id` → `{ ok: true }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/lhr-office/tests/routes/competitors.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Queryable } from '@lhr/db';

const listCompetitorsByStatusMock = vi.fn();
const setCompetitorStatusMock = vi.fn();
const listRecentCompetitorReportsMock = vi.fn();
const listKeywordsMock = vi.fn();
const addKeywordMock = vi.fn();
const removeKeywordMock = vi.fn();

vi.mock('@lhr/db', () => ({
  listCompetitorsByStatus: (...args: unknown[]) => listCompetitorsByStatusMock(...args),
  setCompetitorStatus: (...args: unknown[]) => setCompetitorStatusMock(...args),
  listRecentCompetitorReports: (...args: unknown[]) => listRecentCompetitorReportsMock(...args),
  listKeywords: (...args: unknown[]) => listKeywordsMock(...args),
  addKeyword: (...args: unknown[]) => addKeywordMock(...args),
  removeKeyword: (...args: unknown[]) => removeKeywordMock(...args),
}));

const { createCompetitorsRouter } = await import('../../src/routes/competitors');

const fakeDb = {} as Queryable;

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/competitors', createCompetitorsRouter(fakeDb));
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  listCompetitorsByStatusMock.mockResolvedValue([]);
  listRecentCompetitorReportsMock.mockResolvedValue([]);
  listKeywordsMock.mockResolvedValue([]);
});

describe('GET /api/competitors', () => {
  it('returns tracked and candidate competitors with the latest report per tracked competitor', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db, status) =>
      status === 'tracked' ? [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }] : [{ id: 2, domain: 'other.com', name: null, status: 'candidate' }],
    );
    listRecentCompetitorReportsMock.mockResolvedValue([{ id: 10, competitorId: 1, cycleId: 'c1', summary: 'what changed' }]);
    const res = await request(buildApp()).get('/api/competitors');
    expect(res.status).toBe(200);
    expect(res.body.tracked).toEqual([{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }]);
    expect(res.body.candidates).toEqual([{ id: 2, domain: 'other.com', name: null, status: 'candidate' }]);
    expect(res.body.latestReportsByCompetitorId).toEqual({ '1': { id: 10, competitorId: 1, cycleId: 'c1', summary: 'what changed' } });
  });

  it('omits a competitor from latestReportsByCompetitorId when it has no reports yet', async () => {
    listCompetitorsByStatusMock.mockImplementation(async (_db, status) =>
      status === 'tracked' ? [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }] : [],
    );
    listRecentCompetitorReportsMock.mockResolvedValue([]);
    const res = await request(buildApp()).get('/api/competitors');
    expect(res.body.latestReportsByCompetitorId).toEqual({});
  });
});

describe('POST /api/competitors/:id/approve', () => {
  it('tracks the competitor', async () => {
    const res = await request(buildApp()).post('/api/competitors/1/approve');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'tracked');
  });
});

describe('POST /api/competitors/:id/reject', () => {
  it('rejects the competitor', async () => {
    const res = await request(buildApp()).post('/api/competitors/1/reject');
    expect(res.status).toBe(200);
    expect(setCompetitorStatusMock).toHaveBeenCalledWith(fakeDb, 1, 'rejected');
  });
});

describe('GET /api/competitors/keywords', () => {
  it('returns tracked keywords', async () => {
    listKeywordsMock.mockResolvedValue([{ id: 1, keyword: 'gluten free recipes' }]);
    const res = await request(buildApp()).get('/api/competitors/keywords');
    expect(res.body).toEqual([{ id: 1, keyword: 'gluten free recipes' }]);
  });
});

describe('POST /api/competitors/keywords', () => {
  it('adds a keyword and returns it', async () => {
    addKeywordMock.mockResolvedValue({ id: 2, keyword: 'kitchenware roundup' });
    const res = await request(buildApp()).post('/api/competitors/keywords').send({ keyword: 'kitchenware roundup' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 2, keyword: 'kitchenware roundup' });
    expect(addKeywordMock).toHaveBeenCalledWith(fakeDb, 'kitchenware roundup');
  });
});

describe('DELETE /api/competitors/keywords/:id', () => {
  it('removes the keyword', async () => {
    const res = await request(buildApp()).delete('/api/competitors/keywords/2');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(removeKeywordMock).toHaveBeenCalledWith(fakeDb, 2);
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- routes/competitors.test.ts`
Expected: FAIL — `Cannot find module '../../src/routes/competitors'`

- [ ] **Step 3: Write `routes/competitors.ts`**

```ts
// apps/lhr-office/src/routes/competitors.ts
import express from 'express';
import type { CompetitorReport, Queryable } from '@lhr/db';
import {
  listCompetitorsByStatus,
  setCompetitorStatus,
  listRecentCompetitorReports,
  listKeywords,
  addKeyword,
  removeKeyword,
} from '@lhr/db';

export function createCompetitorsRouter(db: Queryable): express.Router {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const tracked = await listCompetitorsByStatus(db, 'tracked');
      const candidates = await listCompetitorsByStatus(db, 'candidate');
      const latestReportEntries = await Promise.all(
        tracked.map(async (c): Promise<readonly [number, CompetitorReport] | null> => {
          const [latest] = await listRecentCompetitorReports(db, c.id, 1);
          return latest ? ([c.id, latest] as const) : null;
        }),
      );
      const latestReportsByCompetitorId = Object.fromEntries(
        latestReportEntries.filter((entry): entry is readonly [number, CompetitorReport] => entry !== null),
      );
      res.json({ tracked, candidates, latestReportsByCompetitorId });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/approve', async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'tracked');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/:id/reject', async (req, res) => {
    try {
      await setCompetitorStatus(db, Number(req.params.id), 'rejected');
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.get('/keywords', async (_req, res) => {
    try {
      res.json(await listKeywords(db));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.post('/keywords', async (req, res) => {
    try {
      res.json(await addKeyword(db, req.body.keyword));
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  router.delete('/keywords/:id', async (req, res) => {
    try {
      await removeKeyword(db, Number(req.params.id));
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  return router;
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- routes/competitors.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/src/routes/competitors.ts apps/lhr-office/tests/routes/competitors.test.ts
git commit -m "Add /api/competitors router"
```

---

### Task 12: Server — wire routers + auth + static serving into `server.ts`; delete `statusPage.ts`

**Files:**
- Modify: `apps/lhr-office/src/server.ts`
- Modify: `apps/lhr-office/tests/server.test.ts`
- Delete: `apps/lhr-office/src/statusPage.ts`
- Delete: `apps/lhr-office/tests/statusPage.test.ts`

**Interfaces:**
- Consumes: `requireSupabaseAuth` (Task 3); `createJobsRouter` (Task 8); `createCandidatesRouter`, `defaultCandidateOps`, `defaultAffiliateCandidateOps`, `CandidateOps`, `AffiliateCandidateOps` (Task 9); `createTrendsRouter` (Task 10); `createCompetitorsRouter` (Task 11).
- Produces: `createApp(db, registry?, candidates?, affiliateCandidates?, clientDistDir?): express.Express` — same first four parameters as today (so every existing call site keeps working unmodified), plus a new optional 5th parameter so tests can point static serving at a fixture directory instead of a real Vite build.

- [ ] **Step 1: Write the failing test additions** (new `describe` blocks appended to the existing `tests/server.test.ts`; the file's existing mocks for `@lhr/db`, `lhr-authoring-mcp-server/dist-lib/*`, and `../src/orchestrate` stay as they are)

```ts
// apps/lhr-office/tests/server.test.ts — additions
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import jwt from 'jsonwebtoken';

function validToken() {
  return jwt.sign({ sub: 'user-1' }, 'test-jwt-secret', { algorithm: 'HS256' });
}

describe('/api/* auth', () => {
  beforeEach(() => {
    process.env.SUPABASE_JWT_SECRET = 'test-jwt-secret';
  });

  it('rejects GET /api/jobs with no Authorization header', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(401);
  });

  it('allows GET /api/jobs with a valid bearer token', async () => {
    getRunHistoryMock.mockResolvedValue([]);
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    const res = await request(app).get('/api/jobs').set('Authorization', `Bearer ${validToken()}`);
    expect(res.status).toBe(200);
  });

  it('rejects GET /api/candidates/recipe, /api/trends, and /api/competitors with no token', async () => {
    const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates);
    for (const path of ['/api/candidates/recipe', '/api/trends', '/api/competitors']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(401);
    }
  });
});

describe('static SPA serving', () => {
  it('serves the built index.html for a non-API GET route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lhr-office-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>lhr office</title>');
    try {
      const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, dir);
      const res = await request(app).get('/agents-jobs');
      expect(res.status).toBe(200);
      expect(res.text).toContain('lhr office');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not shadow a real 404 from an /api/* route', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lhr-office-dist-'));
    writeFileSync(join(dir, 'index.html'), '<!doctype html>');
    try {
      const app = createApp(fakeDb, [], noCandidates, noAffiliateCandidates, dir);
      const res = await request(app).get('/api/does-not-exist').set('Authorization', `Bearer ${validToken()}`);
      expect(res.status).toBe(404);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

Also **delete** every existing `describe` block in this file that references `/status` (all of `status endpoints auth`, `GET /status`, `POST /status/run/:jobName`, `POST /status/candidate/...`, `POST /status/affiliate-candidates/...`, and the `GET /status affiliate candidates` block, and any later ones for trends/competitors/keywords) — those behaviors are now covered by Tasks 8–11's router tests instead. Keep `GET /health` and `cron endpoint auth` unchanged. Remove the now-unused `process.env.STATUS_AUTH_USER`/`STATUS_AUTH_PASSWORD` lines from `beforeEach`.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- server.test.ts`
Expected: FAIL — `/api/jobs` etc. don't exist yet on the app built by the current `createApp`.

- [ ] **Step 3: Rewrite `server.ts`**

```ts
// apps/lhr-office/src/server.ts
import path from 'node:path';
import express from 'express';
import type { Queryable } from '@lhr/db';
import type { JobRegistration } from '@lhr/jobs';
import { jobs as defaultRegistry } from './registry.js';
import { runDueJob } from './orchestrate.js';
import { requireSupabaseAuth } from './authMiddleware.js';
import { createJobsRouter } from './routes/jobs.js';
import {
  createCandidatesRouter,
  defaultCandidateOps,
  defaultAffiliateCandidateOps,
  type CandidateOps,
  type AffiliateCandidateOps,
} from './routes/candidates.js';
import { createTrendsRouter } from './routes/trends.js';
import { createCompetitorsRouter } from './routes/competitors.js';

export type { CandidateOps, AffiliateCandidateOps };

// Resolved from process.cwd() (apps/lhr-office both locally — see scripts/dev.ts's cwd-relative
// env file path — and on Vercel, where this project's root directory is apps/lhr-office) rather
// than import.meta.url: esbuild bundles this file into a single dist/api/index.js or
// dist/src/server.js output, at which point import.meta.url resolves to that bundle's own
// location, not this source file's — a relative URL computed from it would point outside the
// package entirely.
const defaultClientDistDir = path.resolve(process.cwd(), 'client/dist');

export function createApp(
  db: Queryable,
  registry: JobRegistration[] = defaultRegistry,
  candidates: CandidateOps = defaultCandidateOps(),
  affiliateCandidates: AffiliateCandidateOps = defaultAffiliateCandidateOps(db),
  clientDistDir: string = defaultClientDistDir,
): express.Express {
  const app = express();
  app.set('trust proxy', 1);
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const handleCron = async (req: express.Request, res: express.Response) => {
    const secret = process.env.CRON_SECRET;
    const authHeader = req.header('authorization') ?? '';
    if (!secret || authHeader !== `Bearer ${secret}`) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    try {
      const outcome = await runDueJob(db, registry);
      res.status(200).json(outcome);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.status(200).json({ outcome: 'error', error: message });
    }
  };
  app.get('/api/cron/orchestrator', handleCron);
  app.post('/api/cron/orchestrator', handleCron);

  app.use('/api/jobs', requireSupabaseAuth, createJobsRouter(db, registry));
  app.use('/api/candidates', requireSupabaseAuth, createCandidatesRouter(candidates, affiliateCandidates));
  app.use('/api/trends', requireSupabaseAuth, createTrendsRouter(db));
  app.use('/api/competitors', requireSupabaseAuth, createCompetitorsRouter(db));

  app.use(express.static(clientDistDir));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api/') || req.path === '/health') {
      next();
      return;
    }
    res.sendFile(path.join(clientDistDir, 'index.html'));
  });

  return app;
}
```

- [ ] **Step 4: Delete `statusPage.ts` and its test**

Run: `rm apps/lhr-office/src/statusPage.ts apps/lhr-office/tests/statusPage.test.ts`

- [ ] **Step 5: Run the full workspace test suite to confirm everything passes**

Run: `npm test --workspace=lhr-office`
Expected: PASS — all router tests (Tasks 8–11), the auth middleware test (Task 3), and the updated `server.test.ts` all green.

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/src/server.ts apps/lhr-office/tests/server.test.ts
git rm apps/lhr-office/src/statusPage.ts apps/lhr-office/tests/statusPage.test.ts
git commit -m "Wire routers, Supabase auth, and static SPA serving into server.ts; remove statusPage.ts"
```

---

### Task 13: Client — Overview panel

**Files:**
- Modify: `apps/lhr-office/client/src/pages/Overview.tsx`
- Create: `apps/lhr-office/client/src/pages/Overview.test.tsx`

**Interfaces:**
- Consumes: `useApiResource`, `usePolling` (Task 7); `apiFetch`'s types via `lib/types.ts` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/lhr-office/client/src/pages/Overview.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { Overview } = await import('./Overview');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/jobs') {
      return [
        {
          name: 'recipe-variant-generator',
          cadenceDays: 7,
          history: [{ id: 1, jobName: 'recipe-variant-generator', status: 'success', summary: 'ok', errorMessage: null, startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:05:00.000Z' }],
        },
      ];
    }
    if (path === '/api/candidates/recipe') return { id: 'cand1', record: { status: 'pending', source: { idMeal: '1', title: 'X', cuisine: 'Y', category: 'Z' } } };
    if (path === '/api/candidates/affiliate') return [{ id: 1 }, { id: 2 }];
    if (path === '/api/competitors') return { tracked: [], candidates: [{ id: 9 }], latestReportsByCompetitorId: {} };
    throw new Error(`unexpected path ${path}`);
  });
});

describe('Overview', () => {
  it('renders a job health card and the recent activity feed', async () => {
    render(<Overview />);
    expect(await screen.findByText('recipe-variant-generator')).toBeInTheDocument();
    expect(await screen.findByText(/success/)).toBeInTheDocument();
  });

  it('computes the badge count across recipe, affiliate, and competitor candidates', async () => {
    render(<Overview />);
    // 1 pending recipe candidate + 2 affiliate + 1 competitor candidate = 4
    expect(await screen.findByText('4 item(s) awaiting a decision')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- Overview.test.tsx`
Expected: FAIL — the stub `Overview` only renders an `<h1>`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/lhr-office/client/src/pages/Overview.tsx
import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import type { AffiliateCandidate, CompetitorsResponse, JobStatusRow, RecipeCandidateSummary } from '../lib/types';

export function Overview() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  const recipeCandidate = useApiResource<RecipeCandidateSummary | null>('/api/candidates/recipe');
  const affiliateCandidates = useApiResource<AffiliateCandidate[]>('/api/candidates/affiliate');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');

  usePolling(jobs.refetch, 5000);

  const pendingCount =
    (recipeCandidate.data ? 1 : 0) + (affiliateCandidates.data?.length ?? 0) + (competitors.data?.candidates.length ?? 0);

  const activity = (jobs.data ?? [])
    .flatMap((job) => job.history.map((run) => ({ jobName: job.name, ...run })))
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
    .slice(0, 10);

  return (
    <div className="panel overview-panel">
      <h1>Overview</h1>
      {jobs.error && <p role="alert">{jobs.error}</p>}
      <p>{pendingCount} item(s) awaiting a decision</p>
      <section className="job-health-strip">
        {(jobs.data ?? []).map((job) => {
          const latest = job.history[0];
          return (
            <div key={job.name} className="job-health-card">
              <h2>{job.name}</h2>
              <p>Cadence: every {job.cadenceDays} day(s)</p>
              <p>{latest ? `${latest.status} — ${latest.finishedAt ?? 'in progress'}` : 'Never run'}</p>
            </div>
          );
        })}
      </section>
      <section className="activity-feed">
        <h2>Recent activity</h2>
        <ul>
          {activity.map((run) => (
            <li key={`${run.jobName}-${run.id}`}>
              {run.jobName}: {run.status} ({run.startedAt})
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- Overview.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/client/src/pages/Overview.tsx apps/lhr-office/client/src/pages/Overview.test.tsx
git commit -m "Implement Overview panel"
```

---

### Task 14: Client — Approvals panel

**Files:**
- Modify: `apps/lhr-office/client/src/pages/Approvals.tsx`
- Create: `apps/lhr-office/client/src/pages/Approvals.test.tsx`

**Interfaces:**
- Consumes: `useApiResource` (Task 7), `apiFetch` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/lhr-office/client/src/pages/Approvals.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { Approvals } = await import('./Approvals');

function mockData() {
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/candidates/recipe') return { id: 'cand1', record: { status: 'pending', source: { idMeal: '1', title: 'Teriyaki Chicken', cuisine: 'Japanese', category: 'Chicken' } } };
    if (path === '/api/candidates/affiliate') return [{ id: 1, title: 'Cast Iron Skillet' }];
    if (path === '/api/competitors') return { tracked: [], candidates: [{ id: 9, domain: 'other.com' }], latestReportsByCompetitorId: {} };
    return { ok: true };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockData();
});

describe('Approvals', () => {
  it('approves the recipe candidate and refetches', async () => {
    render(<Approvals />);
    // Three "Approve" buttons render (recipe/affiliate/competitor sections) — the recipe
    // candidate's is the first, since that section renders first.
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/candidates/recipe/cand1/approve', { method: 'POST' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/candidates/recipe'));
  });

  it('shows an error banner when an action fails', async () => {
    render(<Approvals />);
    apiFetchMock.mockRejectedValueOnce(new Error('boom'));
    const approveButtons = await screen.findAllByRole('button', { name: 'Approve' });
    fireEvent.click(approveButtons[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('boom');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- Approvals.test.tsx`
Expected: FAIL — the stub `Approvals` only renders an `<h1>`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/lhr-office/client/src/pages/Approvals.tsx
import { useState } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { AffiliateCandidate, CompetitorsResponse, RecipeCandidateSummary } from '../lib/types';

export function Approvals() {
  const recipeCandidate = useApiResource<RecipeCandidateSummary | null>('/api/candidates/recipe');
  const affiliateCandidates = useApiResource<AffiliateCandidate[]>('/api/candidates/affiliate');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<unknown>, refetch: () => void) {
    setActionError(null);
    try {
      await action();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  const candidate = recipeCandidate.data;

  return (
    <div className="panel approvals-panel">
      <h1>Approvals</h1>
      {actionError && <p role="alert">{actionError}</p>}

      <section>
        <h2>Recipe candidate</h2>
        {candidate ? (
          <div>
            <p>
              {candidate.record.source.title} — {candidate.record.source.cuisine} {candidate.record.source.category}
            </p>
            <button onClick={() => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/approve`, { method: 'POST' }), recipeCandidate.refetch)}>
              Approve
            </button>
            <button onClick={() => runAction(() => apiFetch(`/api/candidates/recipe/${candidate.id}/reroll`, { method: 'POST' }), recipeCandidate.refetch)}>
              Reroll
            </button>
          </div>
        ) : (
          <p>Nothing pending</p>
        )}
      </section>

      <section>
        <h2>Affiliate candidates</h2>
        <ul>
          {(affiliateCandidates.data ?? []).map((c) => (
            <li key={c.id}>
              <span>{c.title}</span>
              <button onClick={() => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/approve`, { method: 'POST' }), affiliateCandidates.refetch)}>
                Approve
              </button>
              <button onClick={() => runAction(() => apiFetch(`/api/candidates/affiliate/${c.id}/deny`, { method: 'POST' }), affiliateCandidates.refetch)}>
                Deny
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Competitor candidates</h2>
        <ul>
          {(competitors.data?.candidates ?? []).map((c) => (
            <li key={c.id}>
              <span>{c.domain}</span>
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/${c.id}/approve`, { method: 'POST' }), competitors.refetch)}>
                Approve
              </button>
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/${c.id}/reject`, { method: 'POST' }), competitors.refetch)}>
                Reject
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- Approvals.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/client/src/pages/Approvals.tsx apps/lhr-office/client/src/pages/Approvals.test.tsx
git commit -m "Implement Approvals panel"
```

---

### Task 15: Client — Agents & Jobs panel

**Files:**
- Modify: `apps/lhr-office/client/src/pages/AgentsAndJobs.tsx`
- Create: `apps/lhr-office/client/src/pages/AgentsAndJobs.test.tsx`

**Interfaces:**
- Consumes: `useApiResource`, `usePolling` (Task 7), `apiFetch` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/lhr-office/client/src/pages/AgentsAndJobs.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { AgentsAndJobs } = await import('./AgentsAndJobs');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockResolvedValue([
    {
      name: 'trends-watcher',
      cadenceDays: 7,
      history: [{ id: 1, jobName: 'trends-watcher', status: 'success', summary: 'ok', errorMessage: null, startedAt: '2026-09-01T00:00:00.000Z', finishedAt: '2026-09-01T00:05:00.000Z' }],
    },
  ]);
});

describe('AgentsAndJobs', () => {
  it('renders each job with its run history', async () => {
    render(<AgentsAndJobs />);
    expect(await screen.findByText('trends-watcher')).toBeInTheDocument();
    expect(await screen.findByText(/success/)).toBeInTheDocument();
  });

  it('runs the job on click and refetches', async () => {
    render(<AgentsAndJobs />);
    const runButton = await screen.findByRole('button', { name: 'Run now' });
    apiFetchMock.mockResolvedValueOnce({ outcome: 'ran' });
    fireEvent.click(runButton);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs/trends-watcher/run', { method: 'POST' }));
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/jobs'));
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- AgentsAndJobs.test.tsx`
Expected: FAIL — the stub `AgentsAndJobs` only renders an `<h1>`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/lhr-office/client/src/pages/AgentsAndJobs.tsx
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { usePolling } from '../hooks/usePolling';
import type { JobStatusRow } from '../lib/types';

export function AgentsAndJobs() {
  const jobs = useApiResource<JobStatusRow[]>('/api/jobs');
  usePolling(jobs.refetch, 5000);

  async function runNow(jobName: string) {
    await apiFetch(`/api/jobs/${jobName}/run`, { method: 'POST' });
    jobs.refetch();
  }

  return (
    <div className="panel agents-jobs-panel">
      <h1>Agents &amp; Jobs</h1>
      {jobs.error && <p role="alert">{jobs.error}</p>}
      {(jobs.data ?? []).map((job) => (
        <section key={job.name} className="job-card">
          <h2>{job.name}</h2>
          <p>Cadence: every {job.cadenceDays} day(s)</p>
          <button onClick={() => runNow(job.name)}>Run now</button>
          <ul>
            {job.history.map((run) => (
              <li key={run.id}>
                {run.status} — {run.summary ?? run.errorMessage ?? ''} ({run.startedAt})
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- AgentsAndJobs.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/client/src/pages/AgentsAndJobs.tsx apps/lhr-office/client/src/pages/AgentsAndJobs.test.tsx
git commit -m "Implement Agents & Jobs panel"
```

---

### Task 16: Client — Research panel

**Files:**
- Modify: `apps/lhr-office/client/src/pages/Research.tsx`
- Create: `apps/lhr-office/client/src/pages/Research.test.tsx`

**Interfaces:**
- Consumes: `useApiResource` (Task 7), `apiFetch` (Task 5).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/lhr-office/client/src/pages/Research.test.tsx
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const apiFetchMock = vi.fn();
vi.mock('../lib/api', () => ({ apiFetch: (...args: unknown[]) => apiFetchMock(...args) }));

const { Research } = await import('./Research');

beforeEach(() => {
  vi.clearAllMocks();
  apiFetchMock.mockImplementation(async (path: string) => {
    if (path === '/api/trends') {
      return {
        reports: [{ id: 1, category: 'cooking', cycleId: 'c1', summary: 'sourdough is trending' }],
        topics: [{ id: 5, category: 'cooking', topic: 'miso', status: 'candidate' }],
      };
    }
    if (path === '/api/competitors') {
      return { tracked: [{ id: 1, domain: 'example.com', name: 'Example', status: 'tracked' }], candidates: [], latestReportsByCompetitorId: { 1: { id: 10, competitorId: 1, cycleId: 'c1', summary: 'redesigned homepage' } } };
    }
    if (path === '/api/competitors/keywords') return [{ id: 1, keyword: 'gluten free recipes' }];
    return { ok: true };
  });
});

describe('Research', () => {
  it('renders trend topics, reports, tracked competitors, and keywords', async () => {
    render(<Research />);
    expect(await screen.findByText(/miso/)).toBeInTheDocument();
    expect(await screen.findByText(/sourdough is trending/)).toBeInTheDocument();
    expect(await screen.findByText(/example.com/)).toBeInTheDocument();
    expect(await screen.findByText(/redesigned homepage/)).toBeInTheDocument();
    expect(await screen.findByText('gluten free recipes')).toBeInTheDocument();
  });

  it('promotes a candidate topic and refetches', async () => {
    render(<Research />);
    const promoteButton = await screen.findByRole('button', { name: 'Promote' });
    fireEvent.click(promoteButton);
    await waitFor(() => expect(apiFetchMock).toHaveBeenCalledWith('/api/trends/topics/5/promote', { method: 'POST' }));
  });

  it('adds a keyword via the form', async () => {
    render(<Research />);
    const input = await screen.findByPlaceholderText('New keyword');
    fireEvent.change(input, { target: { value: 'kitchenware roundup' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add keyword' }));
    await waitFor(() =>
      expect(apiFetchMock).toHaveBeenCalledWith('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: 'kitchenware roundup' }) }),
    );
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test --workspace=lhr-office -- Research.test.tsx`
Expected: FAIL — the stub `Research` only renders an `<h1>`.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/lhr-office/client/src/pages/Research.tsx
import { useState, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import type { CompetitorSeoKeyword, CompetitorsResponse, TrendCategory, TrendsResponse } from '../lib/types';

const TREND_CATEGORIES: TrendCategory[] = ['web-design', 'cooking', 'nutrition'];

export function Research() {
  const trends = useApiResource<TrendsResponse>('/api/trends');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const keywords = useApiResource<CompetitorSeoKeyword[]>('/api/competitors/keywords');
  const [newTopic, setNewTopic] = useState('');
  const [newTopicCategory, setNewTopicCategory] = useState<TrendCategory>('cooking');
  const [newKeyword, setNewKeyword] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<unknown>, refetch: () => void) {
    setActionError(null);
    try {
      await action();
      refetch();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleAddTopic(e: FormEvent) {
    e.preventDefault();
    await runAction(
      () => apiFetch('/api/trends/topics', { method: 'POST', body: JSON.stringify({ category: newTopicCategory, topic: newTopic }) }),
      trends.refetch,
    );
    setNewTopic('');
  }

  async function handleAddKeyword(e: FormEvent) {
    e.preventDefault();
    await runAction(() => apiFetch('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: newKeyword }) }), keywords.refetch);
    setNewKeyword('');
  }

  return (
    <div className="panel research-panel">
      <h1>Research</h1>
      {actionError && <p role="alert">{actionError}</p>}

      <section>
        <h2>Trend topics</h2>
        <ul>
          {(trends.data?.topics ?? []).map((topic) => (
            <li key={topic.id}>
              <span>
                {topic.category}: {topic.topic} ({topic.status})
              </span>
              {topic.status === 'candidate' ? (
                <button onClick={() => runAction(() => apiFetch(`/api/trends/topics/${topic.id}/promote`, { method: 'POST' }), trends.refetch)}>
                  Promote
                </button>
              ) : (
                <button onClick={() => runAction(() => apiFetch(`/api/trends/topics/${topic.id}/demote`, { method: 'POST' }), trends.refetch)}>
                  Demote
                </button>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddTopic}>
          <select value={newTopicCategory} onChange={(e) => setNewTopicCategory(e.target.value as TrendCategory)}>
            {TREND_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <input value={newTopic} onChange={(e) => setNewTopic(e.target.value)} placeholder="New topic" required />
          <button type="submit">Add topic</button>
        </form>
        <h3>Reports</h3>
        <ul>
          {(trends.data?.reports ?? []).map((report) => (
            <li key={report.id}>
              {report.category}: {report.summary}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>Tracked competitors</h2>
        <ul>
          {(competitors.data?.tracked ?? []).map((c) => (
            <li key={c.id}>
              {c.domain}
              {competitors.data?.latestReportsByCompetitorId[c.id] && <span> — {competitors.data.latestReportsByCompetitorId[c.id].summary}</span>}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2>SEO keywords</h2>
        <ul>
          {(keywords.data ?? []).map((k) => (
            <li key={k.id}>
              {k.keyword}
              <button onClick={() => runAction(() => apiFetch(`/api/competitors/keywords/${k.id}`, { method: 'DELETE' }), keywords.refetch)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
        <form onSubmit={handleAddKeyword}>
          <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="New keyword" required />
          <button type="submit">Add keyword</button>
        </form>
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `npm test --workspace=lhr-office -- Research.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/lhr-office/client/src/pages/Research.tsx apps/lhr-office/client/src/pages/Research.test.tsx
git commit -m "Implement Research panel"
```

---

### Task 17: Final integration — build wiring, env vars, full verification

**Files:**
- Modify: `apps/lhr-office/scripts/bundle.mjs`
- Modify: `apps/lhr-office/scripts/dev.ts`
- Modify: `.env.example`

**Interfaces:**
- Consumes: everything from Tasks 1–16. This task has no new production code interfaces — it wires the pieces together for a real build and documents the environment.

- [ ] **Step 1: Add the Vite client build to `scripts/bundle.mjs`**

```js
// apps/lhr-office/scripts/bundle.mjs
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
```

- [ ] **Step 2: Run the build to confirm the client compiles and outputs to `client/dist`**

Run: `npm run build --workspace=lhr-office`
Expected: succeeds; `apps/lhr-office/client/dist/index.html` and hashed JS/CSS assets exist afterward.

- [ ] **Step 3: Update `.env.example`**

Remove:
```
STATUS_AUTH_USER=
STATUS_AUTH_PASSWORD=
```
and its preceding comment block. Add in their place:
```
# Used by apps/lhr-office for admin auth (Supabase Auth). VITE_-prefixed vars are exposed to the
# client bundle by Vite; SUPABASE_JWT_SECRET is server-only and verifies the client's session
# token locally on every /api/* request.
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_JWT_SECRET=
```

- [ ] **Step 4: Update `scripts/dev.ts`, which still references the deleted Basic Auth and `/status` route**

Remove the `STATUS_AUTH_USER`/`STATUS_AUTH_PASSWORD` default-setting block (its comment and both `if` statements) and the `GITHUB_TOKEN`/`KEEPA_API_KEY` warning's mention of "viewing /status", and update the startup log:

```ts
// apps/lhr-office/scripts/dev.ts
import { getPool } from '@lhr/db';
import { createApp } from '../src/server.js';

const missing = ['DATABASE_URL', 'SUPABASE_JWT_SECRET'].filter((name) => !process.env[name]);
if (missing.length > 0) {
  console.error(`Missing required env var(s): ${missing.join(', ')}`);
  console.error('Add them to a .env file at the repo root (copy .env.example) and re-run.');
  process.exit(1);
}

if (!process.env.GITHUB_TOKEN) {
  console.warn(
    '[dev] GITHUB_TOKEN is not set. The recipe-candidate ops and "Approve" on affiliate ' +
      'candidates will fail with a clear error instead of writing anywhere. "Deny" and browsing ' +
      'the dashboard both work fine without it. Add GITHUB_TOKEN to .env only once you actually ' +
      'want to test a real commit — see the warning printed below for what that means.',
  );
}
if (!process.env.KEEPA_API_KEY || !process.env.AMAZON_ASSOCIATES_TAG) {
  console.warn(
    '[dev] KEEPA_API_KEY / AMAZON_ASSOCIATES_TAG not set — this only affects running the ' +
      'affiliate-sourcing job itself (npm run source:affiliate-candidates in mcp-server), not ' +
      'browsing/approving/denying candidates already in the database.',
  );
}

const port = Number(process.env.PORT ?? 3001);

createApp(getPool()).listen(port, () => {
  console.log(`\nlhr-office running locally: http://localhost:${port}/`);
  console.log('Sign in with a Supabase Auth user for this project (create one in the Supabase dashboard if needed).');
  if (process.env.GITHUB_TOKEN) {
    console.log(
      '\n⚠️  GITHUB_TOKEN is set — clicking "Approve" (on either the recipe candidate or an ' +
        'affiliate candidate) makes a REAL commit to the REAL weyenk/lhr main branch. There is ' +
        'no sandbox mode; the target repo is hardcoded, not environment-specific. "Deny" is ' +
        'always safe (database-only, no GitHub call).\n',
    );
  }
});
```

Note `client/dist` must exist for this to serve anything at `/` locally — run `npm run build --workspace=lhr-office` (or `npx vite build` from `apps/lhr-office/client`) at least once before `npm run dev --workspace=lhr-office`, same as any other static-serving Express app in dev.

- [ ] **Step 5: Run the full workspace test suite one more time**

Run: `npm test --workspace=lhr-office`
Expected: PASS — every test from Tasks 1–16 still green after the build-script and dev-script changes.

- [ ] **Step 6: Commit**

```bash
git add apps/lhr-office/scripts/bundle.mjs apps/lhr-office/scripts/dev.ts .env.example
git commit -m "Wire Vite client build into bundle.mjs; update dev script and env vars for Supabase auth"
```

- [ ] **Step 7: Manual pre-merge verification (not automatable — Constitution #1, no autonomous merge)**

1. Push this branch and open a PR; wait for the Vercel preview deployment of the `lhr-office` project.
2. In Vercel's project settings, confirm `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `SUPABASE_JWT_SECRET` are set on the **Preview** environment (one-time setup if not already done).
3. In the Supabase dashboard, confirm at least one Auth user exists to sign in with (create one if not).
4. On the preview URL: sign in, confirm all four panels load real data, confirm Agents & Jobs visibly live-updates within 5 seconds of a job's status changing, and exercise at least one action in Approvals, Agents & Jobs, and Research each.
5. Only once all of the above pass, merge the PR.
