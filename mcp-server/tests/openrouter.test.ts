import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { callOpenRouter } from '../src/openrouter';

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
});

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
});

describe('callOpenRouter', () => {
  it('posts the messages to OpenRouter and returns the reply content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'roasted beet slices' } }] }),
    }) as unknown as typeof fetch;

    const result = await callOpenRouter([{ role: 'user', content: 'Substitute: bacon' }]);

    expect(result).toBe('roasted beet slices');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    );
    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('google/gemma-4-31b-it:free');
    expect(body.messages).toEqual([{ role: 'user', content: 'Substitute: bacon' }]);
  });

  it('uses OPENROUTER_MODEL when set instead of the default', async () => {
    process.env.OPENROUTER_MODEL = 'some/other-model:free';
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'x' } }] }),
    }) as unknown as typeof fetch;

    await callOpenRouter([{ role: 'user', content: 'hi' }]);

    const body = JSON.parse((global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1].body);
    expect(body.model).toBe('some/other-model:free');
  });

  it('throws when OPENROUTER_API_KEY is not set', async () => {
    delete process.env.OPENROUTER_API_KEY;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/OPENROUTER_API_KEY/);
  });

  it('throws immediately when the request fails with a non-429 status', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '' }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/500/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('includes the response body in the thrown error, so the real reason is visible', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 402,
      text: async () => '{"error":{"message":"Insufficient credits for this request","code":402}}',
    }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/Insufficient credits/);
  });

  it('does not crash when the error response has no body/text() available', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/500/);
  });

  it('retries a 429 (honoring Retry-After) and succeeds on a later attempt', async () => {
    let calls = 0;
    global.fetch = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) {
        return { ok: false, status: 429, headers: new Headers({ 'retry-after': '0' }) };
      }
      return {
        ok: true,
        headers: new Headers(),
        json: async () => ({ choices: [{ message: { content: 'ok after retry' } }] }),
      };
    }) as unknown as typeof fetch;

    const result = await callOpenRouter([{ role: 'user', content: 'hi' }]);

    expect(result).toBe('ok after retry');
    expect(calls).toBe(3);
  });

  it('throws after exhausting retries when persistently rate limited, with the body in the error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '0' }),
      text: async () => '{"error":{"message":"Rate limit exceeded","code":429}}',
    }) as unknown as typeof fetch;

    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/429.*Rate limit exceeded/s);
    expect(global.fetch).toHaveBeenCalledTimes(4);
  });

  it('throws when the response has no message content', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [] }),
    }) as unknown as typeof fetch;
    await expect(callOpenRouter([{ role: 'user', content: 'hi' }])).rejects.toThrow(/no message content/);
  });
});
