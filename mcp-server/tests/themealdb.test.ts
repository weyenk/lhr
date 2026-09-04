import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  parseIngredients,
  splitInstructionsIntoSteps,
  rotationIndexForDate,
  pickUnusedSourceRecipe,
  CATEGORY_ROTATION,
} from '../src/themealdb';

describe('parseIngredients', () => {
  it('collects non-empty strIngredientN/strMeasureN pairs and stops at the first gap in neither', () => {
    const meal = {
      idMeal: '1',
      strMeal: 'Test',
      strCategory: 'Chicken',
      strArea: 'Japanese',
      strInstructions: 'Do it.',
      strMealThumb: 'https://example.com/x.jpg',
      strIngredient1: 'Chicken thighs',
      strMeasure1: '2 lbs',
      strIngredient2: 'Salt',
      strMeasure2: '',
      strIngredient3: '',
      strMeasure3: '1 tsp',
    } as Record<string, string>;

    expect(parseIngredients(meal)).toEqual([
      { item: 'Chicken thighs', amount: '2 lbs' },
      { item: 'Salt' },
    ]);
  });
});

describe('splitInstructionsIntoSteps', () => {
  it('splits on newlines when the instructions are already multi-line', () => {
    const steps = splitInstructionsIntoSteps('Preheat oven.\nBrown the beef.\n\nServe hot.');
    expect(steps).toEqual(['Preheat oven.', 'Brown the beef.', 'Serve hot.']);
  });

  it('strips a leading "STEP 1." style numbering prefix from each line', () => {
    const steps = splitInstructionsIntoSteps('STEP 1. Preheat oven.\nSTEP 2. Brown the beef.');
    expect(steps).toEqual(['Preheat oven.', 'Brown the beef.']);
  });

  it('falls back to sentence-splitting for a single unbroken paragraph', () => {
    const steps = splitInstructionsIntoSteps('Preheat the oven. Brown the beef. Serve hot.');
    expect(steps).toEqual(['Preheat the oven.', 'Brown the beef.', 'Serve hot.']);
  });
});

describe('rotationIndexForDate', () => {
  it('is stable within the same week and advances week over week', () => {
    const a = rotationIndexForDate(new Date('2026-08-24T10:00:00Z'));
    const b = rotationIndexForDate(new Date('2026-08-25T10:00:00Z'));
    const c = rotationIndexForDate(new Date('2026-08-31T10:00:00Z'));
    expect(a).toBe(b);
    expect(c).toBeGreaterThan(a);
  });
});

describe('pickUnusedSourceRecipe', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetchSequence(responses: { url: RegExp; body: unknown }[]) {
    global.fetch = vi.fn(async (url: string) => {
      const match = responses.find((r) => r.url.test(url));
      if (!match) throw new Error(`Unexpected fetch to ${url}`);
      return { ok: true, json: async () => match.body } as Response;
    }) as unknown as typeof fetch;
  }

  it('returns a full SourceRecipe for the first unused candidate in the rotation category', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '52772', strMeal: 'Teriyaki Chicken Casserole' }] } },
      {
        url: /lookup\.php\?i=52772/,
        body: {
          meals: [
            {
              idMeal: '52772',
              strMeal: 'Teriyaki Chicken Casserole',
              strCategory: 'Chicken',
              strArea: 'Japanese',
              strInstructions: 'Preheat oven.\nBake it.',
              strMealThumb: 'https://example.com/x.jpg',
              strIngredient1: 'Chicken thighs',
              strMeasure1: '2 lbs',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(), { rotation: ['Beef'], weekIndex: 0 });

    expect(result).toEqual({
      idMeal: '52772',
      title: 'Teriyaki Chicken Casserole',
      cuisine: 'Japanese',
      category: 'Chicken',
      thumbnail: 'https://example.com/x.jpg',
      ingredients: [{ item: 'Chicken thighs', amount: '2 lbs' }],
      steps: ['Preheat oven.', 'Bake it.'],
    });
  });

  it('skips a candidate whose idMeal is already used and picks a different one', async () => {
    mockFetchSequence([
      {
        url: /filter\.php\?c=Beef/,
        body: { meals: [{ idMeal: '1', strMeal: 'Used' }, { idMeal: '2', strMeal: 'Unused' }] },
      },
      {
        url: /lookup\.php\?i=2/,
        body: {
          meals: [
            {
              idMeal: '2',
              strMeal: 'Unused',
              strCategory: 'Beef',
              strArea: 'American',
              strInstructions: 'Cook it.',
              strMealThumb: 'https://example.com/y.jpg',
              strIngredient1: 'Beef',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef'], weekIndex: 0 });

    expect(result?.idMeal).toBe('2');
  });

  it('moves on to the next category when every candidate in the first is already used', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
      { url: /filter\.php\?c=Chicken/, body: { meals: [{ idMeal: '2', strMeal: 'Fresh' }] } },
      {
        url: /lookup\.php\?i=2/,
        body: {
          meals: [
            {
              idMeal: '2',
              strMeal: 'Fresh',
              strCategory: 'Chicken',
              strArea: 'American',
              strInstructions: 'Cook it.',
              strMealThumb: 'https://example.com/z.jpg',
              strIngredient1: 'Chicken',
            },
          ],
        },
      },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef', 'Chicken'], weekIndex: 0 });

    expect(result?.idMeal).toBe('2');
  });

  it('returns null after exhausting all categories with no unused candidate', async () => {
    mockFetchSequence([
      { url: /filter\.php\?c=Beef/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
      { url: /filter\.php\?c=Chicken/, body: { meals: [{ idMeal: '1', strMeal: 'Used' }] } },
    ]);

    const result = await pickUnusedSourceRecipe(new Set(['1']), { rotation: ['Beef', 'Chicken'], weekIndex: 0 });

    expect(result).toBeNull();
  });

  it('exposes a non-empty default CATEGORY_ROTATION', () => {
    expect(CATEGORY_ROTATION.length).toBeGreaterThan(0);
  });
});
