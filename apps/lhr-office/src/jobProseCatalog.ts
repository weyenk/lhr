import { SUGGEST_TOPICS_PERSONA } from './trendsWatcher.js';
import {
  DECISION_PACKAGING_PERSONA,
  WEEKLY_SUMMARY_PERSONA,
  MONETIZATION_PERSONA,
  DESIGN_PERSONA,
} from './competitorAnalysis.js';
import { CRITERIA_TASK_PROMPT } from './productSourcing/criteriaJob.js';
import { ANNOTATE_TASK_PROMPT } from './productSourcing/searchJob.js';
import { MONETIZE_TASK_PROMPT } from './productSourcing/monetizeJob.js';
import { BRAND_TASK_PROMPT } from './productSourcing/brandJob.js';

export interface ProseCatalogEntry {
  id: string;
  title: string;
  source: 'inline' | 'repo';
  /** Whether a PATCH /api/jobs/:jobName/tuning can override this entry's text. Repo-loaded
   * personas are always read-only in the UI, even though the underlying file is author-editable
   * on GitHub. */
  editable: boolean;
  defaultText: string;
  note?: string;
}

// Catalog entries for the two recipe-variant jobs mirror the real persona text in
// lhr-authoring-mcp-server (narrative.ts / dietSubstitutions.ts) for accurate display, but — per
// the plan's scope — are not yet wired to an override-aware resolve call in that package. Saving
// an override here persists it in `job_tuning`; it just has no effect on those two jobs' runs
// until that package is wired up too.
const RECIPE_NARRATIVE_PERSONA =
  'You write a short, story-style intro (2-4 paragraphs) for a recipe blog post, in a warm, ' +
  'personal, first-person voice. Do not include a title or headings, just the narrative prose.';

const RECIPE_SUBSTITUTION_PERSONA =
  'You substitute recipe ingredients for a specific diet. Reply with ONLY the substitute ' +
  'ingredient name, or the exact text "no substitution needed" if the ingredient is already ' +
  'fine for that diet. No punctuation, no explanation.';

const NOT_WIRED_NOTE =
  'Catalog default only — not yet wired into an override-aware call in lhr-authoring-mcp-server (separate package).';

function repoPersonaEntry(id: string, path: string): ProseCatalogEntry {
  return {
    id,
    title: `${path.split('/').pop()} persona`,
    source: 'repo',
    editable: false,
    defaultText: `(loaded from ${path} on GitHub main at run time)`,
  };
}

/** Default prose entries for every job in the registry (src/registry.ts). */
export const JOB_PROSE_CATALOG: Record<string, ProseCatalogEntry[]> = {
  'recipe-variant-generator': [
    {
      id: 'narrative',
      title: 'Narrative persona (on approve)',
      source: 'inline',
      editable: true,
      defaultText: RECIPE_NARRATIVE_PERSONA,
      note: `Used when a candidate is approved — not during the weekly pick. ${NOT_WIRED_NOTE}`,
    },
  ],
  'recipe-variant-finisher': [
    {
      id: 'sub',
      title: 'Diet substitution persona',
      source: 'inline',
      editable: true,
      defaultText: RECIPE_SUBSTITUTION_PERSONA,
      note: NOT_WIRED_NOTE,
    },
  ],
  'trends-watcher': [
    {
      id: 'suggest',
      title: 'Suggest-adjacent-topics persona',
      source: 'inline',
      editable: true,
      defaultText: SUGGEST_TOPICS_PERSONA,
      note: 'Used each cycle when suggesting candidate topics alongside the curated list.',
    },
    repoPersonaEntry('strategist', '.claude/agents/content-strategist.md'),
  ],
  'competitor-analysis': [
    {
      id: 'decision',
      title: 'Decision packaging persona',
      source: 'inline',
      editable: true,
      defaultText: DECISION_PACKAGING_PERSONA,
    },
    {
      id: 'weekly',
      title: 'Weekly summary persona',
      source: 'inline',
      editable: true,
      defaultText: WEEKLY_SUMMARY_PERSONA,
    },
    {
      id: 'monetization',
      title: 'Monetization snapshot persona',
      source: 'inline',
      editable: true,
      defaultText: MONETIZATION_PERSONA,
    },
    {
      id: 'design',
      title: 'Design snapshot persona',
      source: 'inline',
      editable: true,
      defaultText: DESIGN_PERSONA,
    },
  ],
  'product-sourcing-criteria': [
    {
      id: 'criteria',
      title: 'Criteria JSON task prompt',
      source: 'inline',
      editable: true,
      defaultText: CRITERIA_TASK_PROMPT,
      note: 'Persona from designer-experience.md + BRAND.md.',
    },
    repoPersonaEntry('persona', '.claude/agents/designer-experience.md'),
  ],
  'product-sourcing-search': [
    {
      id: 'annotate',
      title: 'Hit annotation prompt',
      source: 'inline',
      editable: true,
      defaultText: ANNOTATE_TASK_PROMPT,
    },
    repoPersonaEntry('persona', '.claude/agents/product-sourcing-scout.md'),
  ],
  'product-sourcing-monetize': [
    {
      id: 'monetize',
      title: 'Wholesale sellability prompt',
      source: 'inline',
      editable: true,
      defaultText: MONETIZE_TASK_PROMPT,
      note: 'Persona from monetization-scout.md.',
    },
    repoPersonaEntry('persona', '.claude/agents/monetization-scout.md'),
  ],
  'product-sourcing-brand': [
    {
      id: 'brand',
      title: 'Brand-fit prompt',
      source: 'inline',
      editable: true,
      defaultText: BRAND_TASK_PROMPT,
      note: 'Persona from designer-experience.md + BRAND.md.',
    },
    repoPersonaEntry('persona', '.claude/agents/designer-experience.md'),
  ],
};
