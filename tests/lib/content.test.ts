import { describe, expect, it } from 'vitest';
import { getActiveSet, getSetProducts, getEntriesByIds, formatPrice } from '../../src/lib/content';

const sets = [
  {
    id: 'coastal-blue',
    data: {
      name: 'Coastal Blue',
      startDate: new Date('2026-07-01'),
      endDate: new Date('2026-12-31'),
    },
  },
];

const products = [
  {
    id: 'coastal-blue-platter',
    data: {
      name: 'Coastal Blue Serving Platter',
      priceCents: 4800,
      image: 'https://example.com/platter.jpg',
      imageAlt: 'A coastal blue ceramic serving platter',
      vendorUrl: 'https://vendor.example.com/coastal-blue-platter',
      setId: 'coastal-blue',
    },
  },
];

describe('getActiveSet', () => {
  it('returns the set whose date range contains the given date', () => {
    const active = getActiveSet(sets, new Date('2026-08-15'));
    expect(active?.id).toBe('coastal-blue');
  });

  it('returns null when no set is active', () => {
    const active = getActiveSet(sets, new Date('2027-01-15'));
    expect(active).toBeNull();
  });
});

describe('getSetProducts', () => {
  it('returns products belonging to the given set', () => {
    const result = getSetProducts('coastal-blue', products);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coastal-blue-platter');
  });
});

describe('getEntriesByIds', () => {
  it('returns entries in the requested order, skipping missing ids', () => {
    const result = getEntriesByIds(['coastal-blue-platter', 'missing-id'], products);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('coastal-blue-platter');
  });
});

describe('formatPrice', () => {
  it('formats cents as a dollar string', () => {
    expect(formatPrice(4800)).toBe('$48.00');
  });
});
