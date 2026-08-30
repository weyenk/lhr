// mcp-server/src/dietSubstitutions.ts
import { normalizeIngredient } from './normalizeIngredient.js';
import { callOpenRouter } from './openrouter.js';
import type { RecipeVariantData } from '@lhr/schemas';

export type SubstitutableDiet = Exclude<RecipeVariantData['diet'], 'original'>;

export interface RecipeIngredient {
  item: string;
  amount?: string;
}

export const ALL_SUBSTITUTABLE_DIETS: SubstitutableDiet[] = [
  'gluten-free',
  'vegan',
  'vegetarian',
  'pescatarian',
  'low-carb',
  'low-salt',
  'low-fat',
];

const SUBSTITUTION_TABLE: Record<SubstitutableDiet, Record<string, string>> = {
  'gluten-free': {
    'all-purpose flour': '1:1 gluten-free flour blend',
    'soy sauce': 'tamari or gluten-free soy sauce',
  },
  vegan: {
    butter: 'vegan butter or coconut oil',
    'heavy cream': 'full-fat coconut cream',
    milk: 'unsweetened oat milk',
    egg: 'flax egg (1 tbsp ground flaxseed + 3 tbsp water)',
    'ground beef': 'plant-based ground meat',
    'cheddar cheese': 'dairy-free cheddar-style shred',
  },
  vegetarian: {
    'ground beef': 'plant-based ground meat',
    'beef broth': 'vegetable broth',
    bacon: 'smoky tempeh strips',
  },
  pescatarian: {
    'ground beef': 'flaked white fish or plant-based ground meat',
    bacon: 'smoked salmon strips',
  },
  'low-carb': {
    'all-purpose flour': 'almond flour',
    potato: 'cauliflower',
    rice: 'cauliflower rice',
  },
  'low-salt': {
    'soy sauce': 'low-sodium soy sauce or coconut aminos',
    'beef broth': 'low-sodium beef broth',
    salt: 'a pinch of salt, to taste',
  },
  'low-fat': {
    'heavy cream': 'evaporated skim milk',
    butter: 'unsweetened applesauce (baking) or a light cooking spray (sautéing)',
    'ground beef': 'extra-lean ground beef or ground turkey breast',
  },
};

export interface SubstitutedIngredient extends RecipeIngredient {
  changed: boolean;
  note?: string;
}

export async function substituteIngredient(
  ingredient: RecipeIngredient,
  diet: SubstitutableDiet,
): Promise<SubstitutedIngredient> {
  const normalized = normalizeIngredient(ingredient.item);
  const tableMatch = SUBSTITUTION_TABLE[diet][normalized];
  if (tableMatch) {
    return {
      item: tableMatch,
      amount: ingredient.amount,
      changed: true,
      note: `Swapped ${normalized} for ${tableMatch}`,
    };
  }

  const content = await callOpenRouter([
    {
      role: 'system',
      content:
        'You substitute recipe ingredients for a specific diet. Reply with ONLY the substitute ' +
        'ingredient name, or the exact text "no substitution needed" if the ingredient is already ' +
        'fine for that diet. No punctuation, no explanation.',
    },
    { role: 'user', content: `Ingredient: "${normalized}"\nDiet: ${diet}` },
  ]);

  const suggestion = content.trim();
  if (!suggestion || suggestion.toLowerCase() === 'no substitution needed') {
    return { item: ingredient.item, amount: ingredient.amount, changed: false };
  }
  return {
    item: suggestion,
    amount: ingredient.amount,
    changed: true,
    note: `Swapped ${normalized} for ${suggestion}`,
  };
}

export async function rewriteSteps(
  originalSteps: string[],
  changes: { from: string; to: string }[],
  diet: SubstitutableDiet,
): Promise<string[]> {
  if (changes.length === 0) return originalSteps;

  const changeList = changes.map((c) => `- "${c.from}" -> "${c.to}"`).join('\n');
  const content = await callOpenRouter([
    {
      role: 'system',
      content:
        'You rewrite recipe steps so they reflect ingredient substitutions. Reply with ONLY a JSON ' +
        'array of strings, one per input step, in the same order, with no other text.',
    },
    {
      role: 'user',
      content: `Diet: ${diet}\nSubstitutions:\n${changeList}\n\nSteps:\n${JSON.stringify(originalSteps)}`,
    },
  ]);

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('rewriteSteps: LLM response was not valid JSON');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || !parsed.every((s) => typeof s === 'string')) {
    throw new Error('rewriteSteps: LLM response was not a non-empty array of strings');
  }
  return parsed;
}

export interface RecipeVariantResult {
  diet: SubstitutableDiet;
  ingredients: RecipeIngredient[];
  steps: string[];
  notes?: string;
  rejected: boolean;
}

async function buildVariantOnce(
  diet: SubstitutableDiet,
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<{ ingredients: RecipeIngredient[]; steps: string[]; notes?: string }> {
  // Sequential, not Promise.all: firing one call per ingredient (times every diet, via the
  // Promise.all this replaced in generateAllVariants below) burst well past OpenRouter's
  // free-tier rate limit on any recipe with more than a handful of ingredients.
  const substituted: SubstitutedIngredient[] = [];
  for (const ing of originalIngredients) {
    substituted.push(await substituteIngredient(ing, diet));
  }

  const changes = originalIngredients
    .map((original, i) => ({ from: original.item, to: substituted[i].item, changed: substituted[i].changed }))
    .filter((c) => c.changed);

  const steps = await rewriteSteps(originalSteps, changes, diet);
  if (steps.length === 0) throw new Error('buildVariantOnce: rewriteSteps returned no steps');

  const ingredients = substituted.map(({ item, amount }) => ({ item, amount }));
  if (ingredients.length === 0) throw new Error('buildVariantOnce: no ingredients produced');

  const notes = changes.length > 0 ? changes.map((c) => `Swapped ${c.from} for ${c.to}`).join('; ') : undefined;

  return { ingredients, steps, notes };
}

export async function generateVariant(
  diet: SubstitutableDiet,
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<RecipeVariantResult> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const built = await buildVariantOnce(diet, originalIngredients, originalSteps);
      return { diet, ...built, rejected: false };
    } catch (err) {
      console.error(
        `[dietSubstitutions] ${diet}: attempt ${attempt + 1}/2 failed — ${err instanceof Error ? err.message : String(err)}`,
      );
      if (attempt === 1) {
        return {
          diet,
          ingredients: originalIngredients,
          steps: originalSteps,
          notes: "couldn't generate — needs manual pass",
          rejected: true,
        };
      }
    }
  }
  throw new Error('unreachable');
}

export interface DietPipelineResult {
  variants: RecipeVariantData[];
  flaggedDiets: SubstitutableDiet[];
}

export async function generateAllVariants(
  originalIngredients: RecipeIngredient[],
  originalSteps: string[],
): Promise<DietPipelineResult> {
  const original: RecipeVariantData = {
    diet: 'original',
    ingredients: originalIngredients,
    steps: originalSteps,
  };

  // Sequential, not Promise.all: see the note in buildVariantOnce above — running all 7 diets'
  // worth of LLM calls concurrently is what caused the rate-limit bursts.
  const results: RecipeVariantResult[] = [];
  for (const diet of ALL_SUBSTITUTABLE_DIETS) {
    results.push(await generateVariant(diet, originalIngredients, originalSteps));
  }

  const variants: RecipeVariantData[] = [
    original,
    ...results.map(({ rejected: _rejected, ...rest }) => rest),
  ];
  const flaggedDiets = results.filter((r) => r.rejected).map((r) => r.diet);

  return { variants, flaggedDiets };
}
