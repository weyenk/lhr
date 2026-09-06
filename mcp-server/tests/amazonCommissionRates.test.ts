import { describe, expect, it } from 'vitest';
import { lookupCommissionRate } from '../src/amazonCommissionRates';

describe('lookupCommissionRate', () => {
  it('returns the known rate for a listed category, not flagged as fallback', () => {
    expect(lookupCommissionRate('Kitchen')).toEqual({ rate: 0.03, isFallback: false });
    expect(lookupCommissionRate('Grocery')).toEqual({ rate: 0.01, isFallback: false });
  });

  it('returns the default rate flagged as fallback for an unlisted category', () => {
    expect(lookupCommissionRate('Totally Unknown Category')).toEqual({ rate: 0.01, isFallback: true });
  });
});
