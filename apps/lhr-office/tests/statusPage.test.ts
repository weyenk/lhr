import { describe, expect, it } from 'vitest';
import { renderStatusPage } from '../src/statusPage';
import type { OrchestratorRun } from '@lhr/db';

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
});
