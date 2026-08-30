// mcp-server/tests/dietSubstitutions.test.ts
import { describe, expect, it, vi, beforeEach } from 'vitest';

const callOpenRouter = vi.fn();
vi.mock('../src/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => callOpenRouter(...args),
}));

const { substituteIngredient, rewriteSteps, generateVariant } = await import('../src/dietSubstitutions');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('substituteIngredient', () => {
  it('uses the substitution table for a known ingredient without calling the LLM', async () => {
    const result = await substituteIngredient({ item: 'All-purpose flour', amount: '2 cups' }, 'gluten-free');
    expect(result).toEqual({
      item: '1:1 gluten-free flour blend',
      amount: '2 cups',
      changed: true,
      note: 'Swapped all-purpose flour for 1:1 gluten-free flour blend',
    });
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('matches the spec examples: butter/vegan, heavy cream/low-fat, soy sauce/low-salt', async () => {
    expect((await substituteIngredient({ item: 'Butter' }, 'vegan')).item).toBe('vegan butter or coconut oil');
    expect((await substituteIngredient({ item: 'Heavy cream' }, 'low-fat')).item).toBe('evaporated skim milk');
    expect((await substituteIngredient({ item: 'Soy sauce' }, 'low-salt')).item).toBe(
      'low-sodium soy sauce or coconut aminos',
    );
  });

  it('falls back to an LLM call for an ingredient not in the table', async () => {
    callOpenRouter.mockResolvedValue('roasted beet slices');
    const result = await substituteIngredient({ item: 'Smoked salmon' }, 'vegan');
    expect(result).toEqual({
      item: 'roasted beet slices',
      amount: undefined,
      changed: true,
      note: 'Swapped smoked salmon for roasted beet slices',
    });
    expect(callOpenRouter).toHaveBeenCalledTimes(1);
  });

  it('returns the ingredient unchanged when the LLM says no substitution is needed', async () => {
    callOpenRouter.mockResolvedValue('no substitution needed');
    const result = await substituteIngredient({ item: 'Salt' }, 'vegan');
    expect(result).toEqual({ item: 'Salt', amount: undefined, changed: false });
  });
});

describe('rewriteSteps', () => {
  it('parses a valid JSON array response into rewritten steps', async () => {
    callOpenRouter.mockResolvedValue('["Brown the plant-based meat.", "Simmer for 10 minutes."]');
    const result = await rewriteSteps(
      ['Brown the beef.', 'Simmer for 10 minutes.'],
      [{ from: 'beef', to: 'plant-based meat' }],
      'vegan',
    );
    expect(result).toEqual(['Brown the plant-based meat.', 'Simmer for 10 minutes.']);
  });

  it('returns the original steps unchanged and skips the LLM call when there are no substitutions', async () => {
    const result = await rewriteSteps(['Bake at 350F.'], [], 'vegan');
    expect(result).toEqual(['Bake at 350F.']);
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('throws when the LLM response is not valid JSON (sanity guard)', async () => {
    callOpenRouter.mockResolvedValue('not json');
    await expect(
      rewriteSteps(['Bake it.'], [{ from: 'a', to: 'b' }], 'vegan'),
    ).rejects.toThrow(/not valid JSON/);
  });

  it('throws when the LLM returns an empty array (sanity guard)', async () => {
    callOpenRouter.mockResolvedValue('[]');
    await expect(
      rewriteSteps(['Bake it.'], [{ from: 'a', to: 'b' }], 'vegan'),
    ).rejects.toThrow(/non-empty array/);
  });
});

describe('generateVariant', () => {
  it('retries once on an LLM failure and succeeds on the second attempt', async () => {
    callOpenRouter.mockRejectedValueOnce(new Error('timeout')).mockResolvedValueOnce('["Mix the flour differently."]');

    const result = await generateVariant(
      'gluten-free',
      [{ item: 'All-purpose flour', amount: '2 cups' }],
      ['Mix the flour.'],
    );

    expect(result.rejected).toBe(false);
    expect(result.steps).toEqual(['Mix the flour differently.']);
    expect(callOpenRouter).toHaveBeenCalledTimes(2);
  });

  it('rejects the variant and falls back to the original ingredients/steps after two failed attempts', async () => {
    callOpenRouter.mockRejectedValue(new Error('timeout'));
    const original = [{ item: 'Smoked salmon' }];
    const originalSteps = ['Grill the salmon.'];

    const result = await generateVariant('vegan', original, originalSteps);

    expect(result.rejected).toBe(true);
    expect(result.ingredients).toEqual(original);
    expect(result.steps).toEqual(originalSteps);
    expect(result.notes).toBe("couldn't generate — needs manual pass");
  });
});

describe('deadline propagation', () => {
  it('substituteIngredient forwards the deadline to the LLM fallback call', async () => {
    callOpenRouter.mockResolvedValue('roasted beet slices');
    const deadline = Date.now() + 60_000;
    await substituteIngredient({ item: 'Smoked salmon' }, 'vegan', deadline);
    expect(callOpenRouter).toHaveBeenCalledWith(expect.anything(), deadline);
  });

  it('rewriteSteps forwards the deadline to its LLM call', async () => {
    callOpenRouter.mockResolvedValue('["Brown the plant-based meat."]');
    const deadline = Date.now() + 60_000;
    await rewriteSteps(['Brown the beef.'], [{ from: 'beef', to: 'plant-based meat' }], 'vegan', deadline);
    expect(callOpenRouter).toHaveBeenCalledWith(expect.anything(), deadline);
  });

  it('generateVariant forwards the deadline through to every LLM call it makes', async () => {
    callOpenRouter.mockResolvedValue('no substitution needed');
    const deadline = Date.now() + 60_000;
    await generateVariant('vegan', [{ item: 'Smoked salmon' }], ['Grill the salmon.'], deadline);
    for (const call of callOpenRouter.mock.calls) {
      expect(call[1]).toBe(deadline);
    }
  });
});

