import { describe, expect, it } from 'vitest';
import { renderStatusPage, renderAffiliateCandidatesSection } from '../src/statusPage';
import type { Candidate, OrchestratorRun } from '@lhr/db';

const run: OrchestratorRun = {
  id: 1,
  jobName: 'recipe-variant-generator',
  status: 'success',
  summary: 'generated 1 variant',
  errorMessage: null,
  startedAt: new Date('2026-08-20T00:00:00Z'),
  finishedAt: new Date('2026-08-20T00:05:00Z'),
};

describe('renderStatusPage', () => {
  it('renders each job\'s name, cadence, and latest summary', () => {
    const html = renderStatusPage([{ name: 'recipe-variant-generator', cadenceDays: 7, history: [run] }]);
    expect(html).toContain('recipe-variant-generator');
    expect(html).toContain('generated 1 variant');
    expect(html).toContain('every 7 days');
  });

  it('renders a placeholder when no jobs are registered', () => {
    const html = renderStatusPage([]);
    expect(html).toContain('No jobs registered yet');
  });

  it('renders "never run" for a job with no history', () => {
    const html = renderStatusPage([{ name: 'affiliate-sourcing', cadenceDays: 7, history: [] }]);
    expect(html).toContain('never run');
  });

  it('escapes HTML in a job summary so a failure message cannot inject markup', () => {
    const dangerous: OrchestratorRun = { ...run, summary: '<script>alert(1)</script>' };
    const html = renderStatusPage([{ name: 'a', cadenceDays: 7, history: [dangerous] }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the pending candidate with approve/reroll actions when one is given', () => {
    const html = renderStatusPage([], {
      id: 'cand1',
      record: {
        status: 'pending',
        source: { idMeal: '52772', title: 'Teriyaki Chicken Casserole', cuisine: 'Japanese', category: 'Chicken' },
      },
    });
    expect(html).toContain('Teriyaki Chicken Casserole');
    expect(html).toContain('Japanese');
    expect(html).toMatch(/action="\/status\/candidate\/cand1\/approve"/);
    expect(html).toMatch(/action="\/status\/candidate\/cand1\/reroll"/);
  });

  it('renders no candidate section when none is pending', () => {
    const html = renderStatusPage([], null);
    expect(html).not.toContain('/status/candidate/');
  });

  it('escapes HTML in a candidate title', () => {
    const html = renderStatusPage([], {
      id: 'cand1',
      record: {
        status: 'pending',
        source: { idMeal: '1', title: '<script>alert(1)</script>', cuisine: 'x', category: 'y' },
      },
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders pending affiliate candidates when they are given', () => {
    const html = renderStatusPage([], null, [affiliateCandidate]);
    expect(html).toContain('Ceramic Mixing Bowl Set');
    expect(html).toMatch(/action="\/status\/affiliate-candidates\/7\/approve"/);
    expect(html).toMatch(/action="\/status\/affiliate-candidates\/7\/deny"/);
  });

  it('renders no affiliate-candidate section when none are pending', () => {
    const html = renderStatusPage([], null, []);
    expect(html).not.toContain('/status/affiliate-candidates/');
  });
});

const affiliateCandidate: Candidate = {
  id: 7,
  cycleId: '2026-W35',
  asin: 'B0EXAMPLE1',
  title: 'Ceramic Mixing Bowl Set',
  category: 'Kitchen',
  priceCents: 2999,
  imageUrl: 'https://example.com/bowl.jpg',
  productUrl: 'https://www.amazon.com/dp/B0EXAMPLE1',
  commissionRate: 0.03,
  commissionRateIsFallback: false,
  estimatedMonthlySales: 450,
  bsr: 1200,
  bsrCategory: 'Kitchen',
  rating: 4.6,
  reviewCount: 812,
  score: 0.71,
  isWildcard: false,
  status: 'pending',
  decidedAt: null,
  createdAt: new Date('2026-08-24T00:00:00Z'),
};

describe('renderAffiliateCandidatesSection', () => {
  it('renders title, category, dollar-formatted price and approve/deny forms', () => {
    const html = renderAffiliateCandidatesSection([affiliateCandidate]);
    expect(html).toContain('Ceramic Mixing Bowl Set');
    expect(html).toContain('Kitchen');
    expect(html).toContain('$29.99');
    expect(html).toMatch(/<form method="post" action="\/status\/affiliate-candidates\/7\/approve"/);
    expect(html).toMatch(/<form method="post" action="\/status\/affiliate-candidates\/7\/deny"/);
  });

  it('labels the commission and sales figures as estimates, never as earnings', () => {
    const html = renderAffiliateCandidatesSection([affiliateCandidate]);
    expect(html).toContain('Est. commission: 3.0%');
    expect(html).toContain('Est. monthly sales: ~450/mo');
  });

  it('says so explicitly when there is no sales estimate', () => {
    const html = renderAffiliateCandidatesSection([{ ...affiliateCandidate, estimatedMonthlySales: null }]);
    expect(html).toContain('No estimate available');
  });

  it('flags a fallback commission rate so it is not mistaken for a real rate-card figure', () => {
    const html = renderAffiliateCandidatesSection([{ ...affiliateCandidate, commissionRateIsFallback: true }]);
    expect(html).toContain('fallback rate');
  });

  it('marks a wildcard pick', () => {
    const html = renderAffiliateCandidatesSection([{ ...affiliateCandidate, isWildcard: true }]);
    expect(html).toContain('wildcard');
  });

  it('renders nothing when there are no candidates', () => {
    expect(renderAffiliateCandidatesSection([])).toBe('');
  });

  it('escapes HTML in a candidate title so a scraped product name cannot inject markup', () => {
    const html = renderAffiliateCandidatesSection([{ ...affiliateCandidate, title: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
