import { describe, expect, it } from 'vitest';
import { renderStatusPage, renderAffiliateCandidatesSection, renderTrendsSection, renderTrendSeedTopicsSection } from '../src/statusPage';
import type { Candidate, OrchestratorRun, TrendsReport, TrendSeedTopic } from '@lhr/db';

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

const trendsReport: TrendsReport = {
  id: 1,
  cycleId: '2026-09-06',
  category: 'cooking',
  generatedAt: new Date('2026-09-06T00:00:00Z'),
  topicsUsed: [{ topic: 'air fryer recipes', source: 'curated' }],
  rawFindings: { topics: [], trendingNow: [] },
  summary: 'Air fryer content is trending; you already cover it well.',
};

const seedTopic: TrendSeedTopic = {
  id: 1,
  category: 'cooking',
  topic: 'air fryer recipes',
  status: 'candidate',
  timesSeen: 2,
  firstSeenAt: new Date('2026-08-01T00:00:00Z'),
  lastSeenAt: new Date('2026-08-15T00:00:00Z'),
  promotedAt: null,
};

describe('renderTrendsSection', () => {
  it('renders the category, summary, and cycle date', () => {
    const html = renderTrendsSection([trendsReport]);
    expect(html).toContain('cooking');
    expect(html).toContain('Air fryer content is trending');
    expect(html).toContain('2026-09-06');
  });

  it('renders nothing when there are no reports', () => {
    expect(renderTrendsSection([])).toBe('');
  });

  it('escapes HTML in a summary', () => {
    const html = renderTrendsSection([{ ...trendsReport, summary: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('renders the topic count used', () => {
    const html = renderTrendsSection([trendsReport]);
    expect(html).toContain('1 topic(s) used');
  });

  it('renders the raw findings inside a <details> element', () => {
    const html = renderTrendsSection([trendsReport]);
    expect(html).toMatch(/<details>[\s\S]*<summary>[\s\S]*<\/summary>[\s\S]*<pre>[\s\S]*<\/pre>[\s\S]*<\/details>/);
  });

  it('HTML-escapes JSON.stringify\'d raw-findings content so a scraped/LLM-generated string cannot inject markup', () => {
    const dangerousReport: TrendsReport = {
      ...trendsReport,
      rawFindings: {
        topics: [{ topic: 'x', source: 'curated', interest: { note: '<script>alert(1)</script>' } }],
        trendingNow: [],
      },
    };
    const html = renderTrendsSection([dangerousReport]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('renderTrendSeedTopicsSection', () => {
  it('renders topic, category, status, times seen, and a Promote button for a candidate', () => {
    const html = renderTrendSeedTopicsSection([seedTopic]);
    expect(html).toContain('air fryer recipes');
    expect(html).toContain('cooking');
    expect(html).toContain('candidate');
    expect(html).toMatch(/action="\/status\/trends\/topics\/1\/promote"/);
  });

  it('renders a Demote button for a curated topic', () => {
    const html = renderTrendSeedTopicsSection([{ ...seedTopic, status: 'curated' }]);
    expect(html).toMatch(/action="\/status\/trends\/topics\/1\/demote"/);
  });

  it('always renders the add-curated-topic form, even with no topics yet', () => {
    const html = renderTrendSeedTopicsSection([]);
    expect(html).toMatch(/action="\/status\/trends\/topics\/add"/);
  });

  it('escapes HTML in a topic name', () => {
    const html = renderTrendSeedTopicsSection([{ ...seedTopic, topic: '<script>alert(1)</script>' }]);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
