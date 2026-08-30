import { callOpenRouter } from './openrouter.js';

export interface NarrativeSource {
  title: string;
  cuisine: string;
  category: string;
}

const FALLBACK_NARRATIVE = '[Narrative draft pending — auto-generation failed]';

export async function generateNarrative(source: NarrativeSource): Promise<string> {
  try {
    const content = await callOpenRouter([
      {
        role: 'system',
        content:
          'You write a short, story-style intro (2-4 paragraphs) for a recipe blog post, in a warm, ' +
          'personal, first-person voice. Do not include a title or headings, just the narrative prose.',
      },
      {
        role: 'user',
        content: `Recipe: "${source.title}"\nCuisine/region: ${source.cuisine}\nCategory: ${source.category}`,
      },
    ]);
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : FALLBACK_NARRATIVE;
  } catch (err) {
    console.error(`[narrative] generation failed — ${err instanceof Error ? err.message : String(err)}`);
    return FALLBACK_NARRATIVE;
  }
}
