export interface CommissionRateResult {
  rate: number;
  isFallback: boolean;
}

// Static snapshot of Amazon's published Associates rate card (spec §4). Rates change over
// time — verify against https://affiliate-program.amazon.com/help/operating/schedule before
// relying on these for a real cycle.
const CATEGORY_RATES: Record<string, number> = {
  Kitchen: 0.03,
  Grocery: 0.01,
  Electronics: 0.01,
};

const DEFAULT_RATE = 0.01;

export function lookupCommissionRate(category: string): CommissionRateResult {
  const rate = CATEGORY_RATES[category];
  if (rate === undefined) return { rate: DEFAULT_RATE, isFallback: true };
  return { rate, isFallback: false };
}
