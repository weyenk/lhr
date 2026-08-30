import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/openrouter', () => ({ callOpenRouter: vi.fn() }));
const { callOpenRouter } = await import('../src/openrouter');
const { fetchHomepageText, summarizeMonetization, summarizeDesign, diffSnapshot } = await import('../src/competitorSnapshots');

const originalFetch = global.fetch;

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe('fetchHomepageText', () => {
  it('strips tags, scripts, and styles, and collapses whitespace', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => '<html><head><style>.x{color:red}</style></head><body><script>track()</script><h1>Shop  the\nKitchen</h1></body></html>',
    }) as unknown as typeof fetch;

    const text = await fetchHomepageText('example.com');
    expect(text).toBe('Shop the Kitchen');
  });

  it('throws with the domain name when the fetch fails', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 }) as unknown as typeof fetch;
    await expect(fetchHomepageText('down.com')).rejects.toThrow(/down\.com/);
  });
});

describe('summarizeMonetization', () => {
  it('calls the LLM with the domain and page text and returns its response', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Sells a $40 cast-iron pan via Amazon affiliate links.');
    const result = await summarizeMonetization('example.com', 'Shop the Kitchen');
    expect(callOpenRouter).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ role: 'user', content: expect.stringContaining('example.com') })]),
    );
    expect(result).toBe('Sells a $40 cast-iron pan via Amazon affiliate links.');
  });
});

describe('summarizeDesign', () => {
  it('calls the LLM with the domain and page text and returns its response', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Grid homepage with a prominent shop CTA.');
    const result = await summarizeDesign('example.com', 'Shop the Kitchen');
    expect(result).toBe('Grid homepage with a prominent shop CTA.');
  });
});

describe('diffSnapshot', () => {
  it('labels the current snapshot as an initial snapshot when there is no prior one, without an LLM call', async () => {
    const result = await diffSnapshot(null, 'Sells a $40 cast-iron pan.');
    expect(result).toBe('Initial snapshot: Sells a $40 cast-iron pan.');
    expect(callOpenRouter).not.toHaveBeenCalled();
  });

  it('calls the LLM to describe the change between two snapshots', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('Added a new $25 spatula set to the shop.');
    const result = await diffSnapshot('Sells a $40 cast-iron pan.', 'Sells a $40 cast-iron pan and a $25 spatula set.');
    expect(callOpenRouter).toHaveBeenCalled();
    expect(result).toBe('Added a new $25 spatula set to the shop.');
  });

  it('can report no substantive change', async () => {
    vi.mocked(callOpenRouter).mockResolvedValue('No substantive change.');
    const result = await diffSnapshot('Sells cookware.', 'Sells cookware and kitchen gear.');
    expect(result).toBe('No substantive change.');
  });
});
