const DEFAULT_CALLER = 'lhr';
const DEFAULT_OUTPUT = 'chat.completions';
const DEFAULT_CREATED_BY = 'lhr-office-jobs';
const POLL_INTERVAL_MS = 2_000;
const REQUEST_TIMEOUT_MS = 25_000;
const TERMINAL = new Set(['done', 'failed', 'cancelled']);

export interface LlmMessage {
  role: 'system' | 'user';
  content: string;
}

export interface CallLlmOptions {
  // An epoch-ms cutoff for a whole multi-call pipeline, not just this single request. Once it's
  // passed, skip the network call entirely rather than spending more poll time finding out the
  // pipeline is already out of time.
  deadline?: number;
  // Inline agent markdown (or other system voice). When omitted, the first system message in
  // `messages` is used for back-compat during migration.
  persona?: string;
  caller?: string;
  output?: string;
  createdBy?: string;
}

type HubJob = {
  id: string;
  status: string;
  result: { content?: unknown; output?: unknown } | null;
  error_message: string | null;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hubBaseUrl(): string {
  return requireEnv('AIRLIE_HUB_URL').replace(/\/$/, '');
}

function hubHeaders(tenantKey: string, createdBy?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${tenantKey}`,
    'Content-Type': 'application/json',
  };
  if (createdBy) headers['X-Created-By'] = createdBy;
  return headers;
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

async function readJson(response: Response): Promise<unknown> {
  const text = await safeResponseText(response);
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return {};
  }
}

function resolvePersonaAndPrompt(
  messages: LlmMessage[],
  personaOption: string | undefined,
): { persona: string; prompt: string } {
  const systemParts = messages.filter((m) => m.role === 'system').map((m) => m.content);
  const userParts = messages.filter((m) => m.role === 'user').map((m) => m.content);

  const persona = (personaOption ?? systemParts.join('\n\n')).trim();
  const prompt = userParts.join('\n\n').trim();

  if (!persona) {
    throw new Error('callLLM requires a non-empty persona (option or system message)');
  }
  if (!prompt) {
    throw new Error('callLLM requires a non-empty prompt (user message)');
  }
  return { persona, prompt };
}

function assertWithinDeadline(deadline: number | undefined): void {
  if (deadline !== undefined && Date.now() >= deadline) {
    throw new Error('Hub LLM call skipped: ran out of time for this pipeline run');
  }
}

async function enqueueLlmJob(params: {
  base: string;
  tenantKey: string;
  createdBy: string;
  prompt: string;
  persona: string;
  caller: string;
  output: string;
}): Promise<HubJob> {
  const payload: Record<string, string> = {
    prompt: params.prompt,
    persona: params.persona,
    output: params.output,
    caller: params.caller,
  };

  const response = await fetch(`${params.base}/jobs`, {
    method: 'POST',
    headers: hubHeaders(params.tenantKey),
    body: JSON.stringify({
      kind: 'llm',
      created_by: params.createdBy,
      channel: 'web',
      payload,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = (await readJson(response)) as { job?: HubJob; error?: string };
  if (response.status !== 201 || !data.job?.id) {
    const detail = data.error ?? (await safeResponseText(response));
    throw new Error(
      `Hub LLM enqueue failed: ${response.status}${detail ? ` — ${detail}` : ''}`,
    );
  }
  return data.job;
}

async function getJob(params: {
  base: string;
  tenantKey: string;
  createdBy: string;
  id: string;
}): Promise<HubJob> {
  const response = await fetch(`${params.base}/jobs/${encodeURIComponent(params.id)}`, {
    method: 'GET',
    headers: hubHeaders(params.tenantKey, params.createdBy),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  const data = (await readJson(response)) as { job?: HubJob; error?: string };
  if (!response.ok || !data.job) {
    const detail = data.error ?? '';
    throw new Error(`Hub LLM poll failed: ${response.status}${detail ? ` — ${detail}` : ''}`);
  }
  return data.job;
}

async function pollUntilTerminal(params: {
  base: string;
  tenantKey: string;
  createdBy: string;
  id: string;
  deadline?: number;
}): Promise<HubJob> {
  for (;;) {
    assertWithinDeadline(params.deadline);
    const job = await getJob(params);
    if (TERMINAL.has(job.status)) return job;
    assertWithinDeadline(params.deadline);
    await sleep(POLL_INTERVAL_MS);
  }
}

export async function callLLM(messages: LlmMessage[], options?: CallLlmOptions): Promise<string> {
  const deadline = options?.deadline;
  assertWithinDeadline(deadline);

  const base = hubBaseUrl();
  const tenantKey = requireEnv('AIRLIE_HUB_TENANT_KEY');
  const createdBy = options?.createdBy?.trim() || DEFAULT_CREATED_BY;
  const caller = options?.caller?.trim() || DEFAULT_CALLER;
  const output = options?.output?.trim() || DEFAULT_OUTPUT;
  const { persona, prompt } = resolvePersonaAndPrompt(messages, options?.persona);

  const enqueued = await enqueueLlmJob({
    base,
    tenantKey,
    createdBy,
    prompt,
    persona,
    caller,
    output,
  });

  const job = await pollUntilTerminal({
    base,
    tenantKey,
    createdBy,
    id: enqueued.id,
    deadline,
  });

  if (job.status === 'failed' || job.status === 'cancelled') {
    const detail = job.error_message?.trim();
    throw new Error(
      `Hub LLM job ${job.status}${detail ? `: ${detail}` : ` (${job.id})`}`,
    );
  }

  const content = job.result?.content;
  if (typeof content !== 'string' || !content) {
    throw new Error('Hub LLM job completed with no result.content');
  }
  return content;
}
