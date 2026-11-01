import { beforeEach, describe, expect, it, vi } from 'vitest';

const llmMock = { callLLM: vi.fn() };
vi.mock('@lhr/llm', () => llmMock);

const githubMock = { getFile: vi.fn() };
vi.mock('lhr-authoring-mcp-server/dist-lib/github.js', () => githubMock);

const { parseLlmJson, callLlmJson } = await import('../../src/productSourcing/parseLlmJson');
const { loadAgentPersona } = await import('../../src/productSourcing/loadPersona');

describe('parseLlmJson', () => {
  it('parses plain JSON', () => {
    expect(parseLlmJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips ```json fences', () => {
    expect(parseLlmJson<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('strips bare ``` fences and surrounding whitespace', () => {
    expect(parseLlmJson<number[]>('  ```\n[1,2]\n```  ')).toEqual([1, 2]);
  });

  it('throws on invalid JSON', () => {
    expect(() => parseLlmJson('not json')).toThrow();
  });
});

describe('callLlmJson', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }];
  const parse = (u: unknown) => {
    const o = u as { ok?: boolean };
    if (o.ok !== true) throw new Error('bad shape');
    return o as { ok: true };
  };

  beforeEach(() => llmMock.callLLM.mockReset());

  it('returns parsed value on first success', async () => {
    llmMock.callLLM.mockResolvedValueOnce('{"ok":true}');
    await expect(callLlmJson(messages, {}, parse)).resolves.toEqual({ ok: true });
    expect(llmMock.callLLM).toHaveBeenCalledTimes(1);
  });

  it('retries once after invalid JSON then succeeds', async () => {
    llmMock.callLLM.mockResolvedValueOnce('nope').mockResolvedValueOnce('```json\n{"ok":true}\n```');
    await expect(callLlmJson(messages, { persona: 'p' }, parse)).resolves.toEqual({ ok: true });
    expect(llmMock.callLLM).toHaveBeenCalledTimes(2);
    expect(llmMock.callLLM).toHaveBeenCalledWith(messages, { persona: 'p' });
  });

  it('retries once after parse validator failure then throws', async () => {
    llmMock.callLLM.mockResolvedValue('{"ok":false}');
    await expect(callLlmJson(messages, {}, parse)).rejects.toThrow('bad shape');
    expect(llmMock.callLLM).toHaveBeenCalledTimes(2);
  });
});

describe('loadAgentPersona', () => {
  beforeEach(() => githubMock.getFile.mockReset());

  it('returns trimmed persona content from main', async () => {
    githubMock.getFile.mockResolvedValue({ content: '\n# Persona\n' });
    const client = {} as never;
    await expect(loadAgentPersona(client, '.claude/agents/x.md')).resolves.toBe('# Persona');
    expect(githubMock.getFile).toHaveBeenCalledWith(client, '.claude/agents/x.md', 'main');
  });

  it('throws when file is missing', async () => {
    githubMock.getFile.mockResolvedValue(null);
    await expect(loadAgentPersona({} as never, '.claude/agents/x.md')).rejects.toThrow('.claude/agents/x.md');
  });

  it('throws when file is empty', async () => {
    githubMock.getFile.mockResolvedValue({ content: '   ' });
    await expect(loadAgentPersona({} as never, '.claude/agents/x.md')).rejects.toThrow('.claude/agents/x.md');
  });
});
