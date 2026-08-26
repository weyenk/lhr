import { callOpenRouter } from './openrouter.js';

const MAX_TEXT_CHARS = 6000;

function htmlToText(html: string): string {
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ');
  const withoutTags = withoutScripts.replace(/<[^>]+>/g, ' ');
  return withoutTags.replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_CHARS);
}

export async function fetchHomepageText(domain: string): Promise<string> {
  const response = await fetch(`https://${domain}`);
  if (!response.ok) {
    throw new Error(`Failed to fetch homepage for ${domain}: ${response.status}`);
  }
  return htmlToText(await response.text());
}

export async function summarizeMonetization(domain: string, pageText: string): Promise<string> {
  return callOpenRouter([
    {
      role: 'system',
      content:
        "You analyze a competitor recipe/kitchenware site's homepage text and produce a short, factual snapshot of its monetization and product strategy: what it sells or promotes, any visible price ranges, and any visible affiliate/ad programs or sponsorship disclosures. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

export async function summarizeDesign(domain: string, pageText: string): Promise<string> {
  return callOpenRouter([
    {
      role: 'system',
      content:
        "You analyze a competitor site's homepage text (tags stripped, so infer structure from headings, nav labels, and link text) and produce a short, factual description of its apparent layout, prominent calls-to-action, and visual/content style. 2-4 sentences, no speculation beyond what the text shows.",
    },
    { role: 'user', content: `Homepage text for ${domain}:\n\n${pageText}` },
  ]);
}

export async function diffSnapshot(previous: string | null, current: string): Promise<string> {
  if (previous === null) {
    return `Initial snapshot: ${current}`;
  }
  return callOpenRouter([
    {
      role: 'system',
      content:
        'Given a previous snapshot and a current snapshot of the same thing, describe what substantively changed in 1-2 sentences. If the current snapshot is just a prose rephrasing of the same facts with no substantive change, respond exactly with "No substantive change."',
    },
    { role: 'user', content: `Previous snapshot:\n${previous}\n\nCurrent snapshot:\n${current}` },
  ]);
}
