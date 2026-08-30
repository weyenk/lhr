import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('../src/github', () => ({
  createGitHubClient: vi.fn(() => ({})),
}));

const getPendingCandidate = vi.fn();
const pickNewCandidate = vi.fn();
vi.mock('../src/recipeCandidates', () => ({
  getPendingCandidate: (...args: unknown[]) => getPendingCandidate(...args),
  pickNewCandidate: (...args: unknown[]) => pickNewCandidate(...args),
}));

const { generateWeeklyVariantRecipe } = await import('../src/generateWeeklyVariantRecipe');

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GITHUB_TOKEN = 'test-token';
});

describe('generateWeeklyVariantRecipe (job entry point)', () => {
  it('reports the existing pending candidate instead of picking a new one', async () => {
    getPendingCandidate.mockResolvedValue({
      id: 'abc123',
      record: { status: 'pending', source: { idMeal: '52772', title: 'Teriyaki Chicken Casserole' } },
    });

    const result = await generateWeeklyVariantRecipe();

    expect(pickNewCandidate).not.toHaveBeenCalled();
    expect(result.status).toBe('success');
    expect(result.summary).toContain('Teriyaki Chicken Casserole');
    expect(result.summary).toContain('already awaiting approval');
  });

  it('picks a new candidate and reports it as pending approval', async () => {
    getPendingCandidate.mockResolvedValue(null);
    pickNewCandidate.mockResolvedValue({
      id: 'def456',
      record: { status: 'pending', source: { idMeal: '52844', title: 'Lasagne' } },
    });

    const result = await generateWeeklyVariantRecipe();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('Lasagne');
    expect(result.summary).toContain('52844');
    expect(result.summary).toContain('approve or reroll');
    expect(result.details).toEqual({ candidateId: 'def456', sourceMealDbId: '52844' });
  });

  it('reports a skip when no unused recipe can be found', async () => {
    getPendingCandidate.mockResolvedValue(null);
    pickNewCandidate.mockResolvedValue(null);

    const result = await generateWeeklyVariantRecipe();

    expect(result.status).toBe('success');
    expect(result.summary).toContain('No unused TheMealDB recipe');
    expect(result.details).toBeUndefined();
  });
});
