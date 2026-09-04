export interface RecipeIngredient {
  item: string;
  amount?: string;
}

export interface SourceRecipe {
  idMeal: string;
  title: string;
  cuisine: string;
  category: string;
  thumbnail: string;
  ingredients: RecipeIngredient[];
  steps: string[];
}

export type RawMealDbMeal = Record<string, string | null | undefined> & {
  idMeal: string;
  strMeal: string;
  strCategory: string;
  strArea: string;
  strInstructions: string;
  strMealThumb: string;
};

const MEALDB_BASE = 'https://www.themealdb.com/api/json/v1/1';

export const CATEGORY_ROTATION = ['Beef', 'Chicken', 'Seafood', 'Vegetarian', 'Pasta', 'Vegan', 'Pork', 'Dessert'];

export function parseIngredients(meal: RawMealDbMeal): RecipeIngredient[] {
  const ingredients: RecipeIngredient[] = [];
  for (let i = 1; i <= 20; i++) {
    const item = meal[`strIngredient${i}`]?.trim();
    const amount = meal[`strMeasure${i}`]?.trim();
    if (!item) continue;
    ingredients.push(amount ? { item, amount } : { item });
  }
  return ingredients;
}

export function splitInstructionsIntoSteps(instructions: string): string[] {
  const byLine = instructions
    .split(/\r?\n+/)
    .map((line) => line.replace(/^\s*(?:STEP\s*)?\d+[.):]\s*/i, '').trim())
    .filter((line) => line.length > 0);
  if (byLine.length > 1) return byLine;

  return instructions
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function toSourceRecipe(meal: RawMealDbMeal): SourceRecipe {
  return {
    idMeal: meal.idMeal,
    title: meal.strMeal,
    cuisine: meal.strArea,
    category: meal.strCategory,
    thumbnail: meal.strMealThumb,
    ingredients: parseIngredients(meal),
    steps: splitInstructionsIntoSteps(meal.strInstructions),
  };
}

async function fetchJson<T>(path: string): Promise<T> {
  const response = await fetch(`${MEALDB_BASE}${path}`);
  if (!response.ok) throw new Error(`TheMealDB request failed: ${response.status}`);
  return (await response.json()) as T;
}

export async function listCategoryMealIds(category: string): Promise<{ idMeal: string; strMeal: string }[]> {
  const data = await fetchJson<{ meals: { idMeal: string; strMeal: string }[] | null }>(
    `/filter.php?c=${encodeURIComponent(category)}`,
  );
  return data.meals ?? [];
}

export async function lookupMeal(idMeal: string): Promise<SourceRecipe> {
  const data = await fetchJson<{ meals: RawMealDbMeal[] | null }>(`/lookup.php?i=${encodeURIComponent(idMeal)}`);
  const meal = data.meals?.[0];
  if (!meal) throw new Error(`TheMealDB lookup found no meal for id ${idMeal}`);
  return toSourceRecipe(meal);
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function rotationIndexForDate(date: Date): number {
  return Math.floor(date.getTime() / WEEK_MS);
}

export async function pickUnusedSourceRecipe(
  usedMealDbIds: Set<string>,
  options: { rotation?: string[]; weekIndex?: number; maxCategoryAttempts?: number } = {},
): Promise<SourceRecipe | null> {
  const rotation = options.rotation ?? CATEGORY_ROTATION;
  const weekIndex = options.weekIndex ?? rotationIndexForDate(new Date());
  const maxCategoryAttempts = options.maxCategoryAttempts ?? rotation.length;
  const start = weekIndex % rotation.length;

  for (let attempt = 0; attempt < maxCategoryAttempts; attempt++) {
    const category = rotation[(start + attempt) % rotation.length];
    const candidates = await listCategoryMealIds(category);
    const unused = candidates.filter((c) => !usedMealDbIds.has(c.idMeal));
    if (unused.length === 0) continue;
    const pick = unused[Math.floor(Math.random() * unused.length)];
    return lookupMeal(pick.idMeal);
  }
  return null;
}
