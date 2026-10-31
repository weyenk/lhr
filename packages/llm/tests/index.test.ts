import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../src/index';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

const HUB = 'https://hub.example/api/v1';
const JOB_ID = '11111111-1111-1111-1111-111111111111';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  process.env.AIRLIE_HUB_URL = HUB;
  process.env.AIRLIE_HUB_TENANT_KEY = 'tenant-secret';
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe('callLLM', () => {
  it('enqueues an llm job, polls until done, and returns result.content', async () => {
    let polls = 0;
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST' && url === `${HUB}/jobs`) {
        return jsonResponse(201, {
          job: { id: JOB_ID, status: 'queued', result: null, error_message: null },
        });
      }
      if (url === `${HUB}/jobs/${JOB_ID}`) {
        polls += 1;
        if (polls < 2) {
          return jsonResponse(200, {
            job: { id: JOB_ID, status: 'running', result: null, error_message: null },
          });
        }
        return jsonResponse(200, {
          job: {
            id: JOB_ID,
            status: 'done',
            result: { output: 'chat.completions', content: 'roasted beet slices' },
            error_message: null,
          },
        });
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch;

    // Skip real poll sleeps in this suite when status is already terminal after enqueue+one poll.
    vi.spyOn(global, 'setTimeout').mockImplementation(((fn: TimerHandler) => {
      if (typeof fn === 'function') fn();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    const result = await callLLM(
      [
        { role: 'system', content: 'You substitute ingredients.' },
        { role: 'user', content: 'Substitute: bacon' },
      ],
      { persona: 'You substitute ingredients.' },
    );

    expect(result).toBe('roasted beet slices');

    const enqueueCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[1]?.method === 'POST',
    );
    expect(enqueueCall[0]).toBe(`${HUB}/jobs`);
    expect(enqueueCall[1].headers).toEqual(
      expect.objectContaining({ Authorization: 'Bearer tenant-secret' }),
    );
    const body = JSON.parse(enqueueCall[1].body as string);
    expect(body).toEqual({
      kind: 'llm',
      created_by: 'lhr-office-jobs',
      channel: 'web',
      payload: {
        prompt: 'Substitute: bacon',
        persona: 'You substitute ingredients.',
        output: 'chat.completions',
        caller: 'lhr',
      },
    });
    expect(body.payload.model).toBeUndefined();
    expect(body.payload.thinking).toBeUndefined();

    const pollCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => c[0] === `${HUB}/jobs/${JOB_ID}`,
    );
    expect(pollCall[1].headers).toEqual(
      expect.objectContaining({ 'X-Created-By': 'lhr-office-jobs' }),
    );
  });

  it('treats a system message as persona when the persona option is omitted', async () => {
    global.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(201, {
          job: { id: JOB_ID, status: 'queued', result: null, error_message: null },
        });
      }
      return jsonResponse(200, {
        job: {
          id: JOB_ID,
          status: 'done',
          result: { content: 'ok' },
          error_message: null,
        },
      });
    }) as unknown as typeof fetch;

    await callLLM([
      { role: 'system', content: 'Be brief.' },
      { role: 'user', content: 'hi' },
    ]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.payload.persona).toBe('Be brief.');
    expect(body.payload.prompt).toBe('hi');
  });

  it('throws when AIRLIE_HUB_URL is not set', async () => {
    delete process.env.AIRLIE_HUB_URL;
    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/AIRLIE_HUB_URL/);
  });

  it('throws when AIRLIE_HUB_TENANT_KEY is not set', async () => {
    delete process.env.AIRLIE_HUB_TENANT_KEY;
    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/AIRLIE_HUB_TENANT_KEY/);
  });

  it('throws when enqueue fails with a non-201 status', async () => {
    global.fetch = vi.fn().mockResolvedValue(
      jsonResponse(500, { error: 'hub exploded' }),
    ) as unknown as typeof fetch;
    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/500.*hub exploded/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('throws when the job fails', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(201, {
          job: { id: JOB_ID, status: 'queued', result: null, error_message: null },
        });
      }
      return jsonResponse(200, {
        job: {
          id: JOB_ID,
          status: 'failed',
          result: null,
          error_message: 'serve unavailable',
        },
      });
    }) as unknown as typeof fetch;

    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/failed: serve unavailable/);
  });

  it('throws when done but result.content is missing', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(201, {
          job: { id: JOB_ID, status: 'queued', result: null, error_message: null },
        });
      }
      return jsonResponse(200, {
        job: { id: JOB_ID, status: 'done', result: {}, error_message: null },
      });
    }) as unknown as typeof fetch;

    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }]),
    ).rejects.toThrow(/no result\.content/);
  });

  it('skips the request and throws immediately once the given deadline has already passed', async () => {
    global.fetch = vi.fn();
    await expect(
      callLLM([{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }], {
        deadline: Date.now() - 1,
      }),
    ).rejects.toThrow(/ran out of time/);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('still enqueues when the deadline has not passed yet', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return jsonResponse(201, {
          job: { id: JOB_ID, status: 'queued', result: null, error_message: null },
        });
      }
      return jsonResponse(200, {
        job: {
          id: JOB_ID,
          status: 'done',
          result: { content: 'ok' },
          error_message: null,
        },
      });
    }) as unknown as typeof fetch;

    const result = await callLLM(
      [{ role: 'system', content: 's' }, { role: 'user', content: 'hi' }],
      { deadline: Date.now() + 60_000 },
    );

    expect(result).toBe('ok');
    expect(global.fetch).toHaveBeenCalled();
  });

  it('requires a persona somehow (option or system message)', async () => {
    global.fetch = vi.fn();
    await expect(callLLM([{ role: 'user', content: 'hi' }])).rejects.toThrow(/persona/);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
