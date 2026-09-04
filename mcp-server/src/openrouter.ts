import { requireEnv } from './blob.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
// Each of these free models routes through a different upstream provider's own shared free
// pool (Google AI Studio, NVIDIA, Z.ai respectively). OpenRouter tries them in order server-side
// within a single request/response cycle and falls through automatically on an error (including
// rate limiting) - see https://openrouter.ai/docs/guides/routing/model-fallbacks. This matters
// because a single free model's shared pool getting saturated is common and NOT something our
// own request pacing can fix (it's rate-limited upstream, shared across every OpenRouter user on
// that model, regardless of how slowly we call it) - spreading the fallback chain across
// different providers means one saturated pool doesn't take down the whole run.
const DEFAULT_MODELS = [
  'google/gemma-4-31b-it:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'z-ai/glm-5.2:free',
];
const MAX_RATE_LIMIT_ATTEMPTS = 4;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5000;
// A hung free-tier model never throws on its own — without a hard cap a single stuck call can
// eat the whole pipeline's time budget (this is exactly what took down loveheatrelationship's
// sibling office app: apps/lhr-office's /status/run/recipe-variant-generator ran past Vercel's
// 300s maxDuration and got killed mid-request). Bounding every request lets a stuck model fail
// over (or fail fast) instead of hanging indefinitely.
const REQUEST_TIMEOUT_MS = 25_000;

export interface OpenRouterMessage {
  role: 'system' | 'user';
  content: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response: Response): number {
  const header = response.headers?.get?.('retry-after');
  const seconds = header ? Number(header) : NaN;
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : DEFAULT_RATE_LIMIT_BACKOFF_MS;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

// `deadline`, when given, is an epoch-ms cutoff for a whole multi-call pipeline (e.g. one diet
// variant's worth of ingredient substitutions), not just this single request — see
// dietSubstitutions.ts. Once it's passed, skip the network call entirely rather than spending
// another REQUEST_TIMEOUT_MS finding out something already knows: the pipeline is out of time.
export async function callOpenRouter(messages: OpenRouterMessage[], deadline?: number): Promise<string> {
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new Error('OpenRouter call skipped: ran out of time for this pipeline run');
  }

  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const models = process.env.OPENROUTER_MODEL ? [process.env.OPENROUTER_MODEL] : DEFAULT_MODELS;

  const doFetch = () =>
    fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ models, messages }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

  let response = await doFetch();
  for (let attempt = 1; response.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
    await sleep(retryDelayMs(response));
    response = await doFetch();
  }

  if (!response.ok) {
    const detail = await safeResponseText(response);
    throw new Error(`OpenRouter request failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter response had no message content');
  }
  return content;
}
