import { callLLM, type CallLlmOptions, type LlmMessage } from '@lhr/llm';

export function parseLlmJson<T>(raw: string): T {
  const fenced = raw.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?\s*```$/i);
  const body = fenced ? fenced[1]! : raw.trim();
  return JSON.parse(body) as T;
}

export async function callLlmJson<T>(
  messages: LlmMessage[],
  options: CallLlmOptions,
  parse: (u: unknown) => T,
): Promise<T> {
  const attempt = async (): Promise<T> => parse(parseLlmJson<unknown>(await callLLM(messages, options)));
  try {
    return await attempt();
  } catch {
    return await attempt();
  }
}
