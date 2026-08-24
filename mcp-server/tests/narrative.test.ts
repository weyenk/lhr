import { describe, expect, it, vi, beforeEach } from 'vitest';

const callOpenRouter = vi.fn();
vi.mock('../src/openrouter', () => ({
  callOpenRouter: (...args: unknown[]) => callOpenRouter(...args),
}));

const { generateNarrative } = await import('../src/narrative');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateNarrative', () => {
  it('returns the trimmed LLM narrative on success', async () => {
    callOpenRouter.mockResolvedValue('  Once upon a weeknight, dinner needed to be easy.  ');
    const result = await generateNarrative({ title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' });
    expect(result).toBe('Once upon a weeknight, dinner needed to be easy.');
  });

  it('passes the recipe title/cuisine/category to the LLM call', async () => {
    callOpenRouter.mockResolvedValue('A story.');
    await generateNarrative({ title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' });
    const userMessage = callOpenRouter.mock.calls[0][0][1].content;
    expect(userMessage).toContain('Teriyaki Chicken Casserole');
    expect(userMessage).toContain('Japanese');
    expect(userMessage).toContain('Chicken');
  });

  it('falls back to the placeholder narrative when the LLM call fails', async () => {
    callOpenRouter.mockRejectedValue(new Error('timeout'));
    const result = await generateNarrative({ title: 'x', cuisine: 'y', category: 'z' });
    expect(result).toBe('[Narrative draft pending — auto-generation failed]');
  });

  it('falls back to the placeholder narrative when the LLM returns only whitespace', async () => {
    callOpenRouter.mockResolvedValue('   ');
    const result = await generateNarrative({ title: 'x', cuisine: 'y', category: 'z' });
    expect(result).toBe('[Narrative draft pending — auto-generation failed]');
  });
});
