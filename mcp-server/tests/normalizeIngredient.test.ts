import { describe, expect, it } from 'vitest';
import { normalizeIngredient } from '../src/normalizeIngredient';

describe('normalizeIngredient', () => {
  it('strips a leading quantity+unit and a trailing prep clause', () => {
    expect(normalizeIngredient('2 cloves garlic, minced')).toBe('garlic');
  });

  it('strips a bare leading number (no unit word) and singularizes, keeping descriptive adjectives', () => {
    expect(normalizeIngredient('3 green onions')).toBe('green onion');
  });

  it('strips a leading unit word without touching a descriptive adjective', () => {
    expect(normalizeIngredient('1 tsp kosher salt')).toBe('kosher salt');
  });

  it('passes through an already-normalized ingredient unchanged', () => {
    expect(normalizeIngredient('jerk seasoning')).toBe('jerk seasoning');
  });

  it('passes through a bare noun with no quantity unchanged', () => {
    expect(normalizeIngredient('salt')).toBe('salt');
  });

  it('strips a bare leading number and singularizes a descriptive-adjective ingredient', () => {
    expect(normalizeIngredient('2 large eggs')).toBe('large egg');
  });

  it('does not mangle a word ending in a double s', () => {
    expect(normalizeIngredient('molasses')).toBe('molasses');
  });
});
