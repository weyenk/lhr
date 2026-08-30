import { requireEnv } from './blob.js';

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'google/gemma-4-31b-it:free';
const MAX_RATE_LIMIT_ATTEMPTS = 4;
const DEFAULT_RATE_LIMIT_BACKOFF_MS = 5000;

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

export async function callOpenRouter(messages: OpenRouterMessage[]): Promise<string> {
  const apiKey = requireEnv('OPENROUTER_API_KEY');
  const model = process.env.OPENROUTER_MODEL ?? DEFAULT_MODEL;

  const doFetch = () =>
    fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, messages }),
    });

  let response = await doFetch();
  for (let attempt = 1; response.status === 429 && attempt < MAX_RATE_LIMIT_ATTEMPTS; attempt++) {
    await sleep(retryDelayMs(response));
    response = await doFetch();
  }

  if (!response.ok) {
    throw new Error(`OpenRouter request failed: ${response.status}`);
  }

  const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('OpenRouter response had no message content');
  }
  return content;
}
