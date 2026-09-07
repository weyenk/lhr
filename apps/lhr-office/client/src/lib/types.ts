export interface OrchestratorRun {
  id: number;
  jobName: string;
  status: 'running' | 'success' | 'partial' | 'failure';
  summary: string | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface JobStatusRow {
  name: string;
  cadenceDays: number;
  history: OrchestratorRun[];
}

export interface RecipeCandidateSummary {
  id: string;
  record: {
    status: string;
    source: { idMeal: string; title: string; cuisine: string; category: string };
  };
}

export interface AffiliateCandidate {
  id: number;
  title: string;
  category: string;
  priceCents: number;
  commissionRate: number;
  commissionRateIsFallback: boolean;
  estimatedMonthlySales: number | null;
  isWildcard: boolean;
}

export type TrendCategory = 'web-design' | 'cooking' | 'nutrition';

export interface TrendsReport {
  id: number;
  cycleId: string;
  category: TrendCategory;
  summary: string;
}

export interface TrendSeedTopic {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
}

export interface TrendsResponse {
  reports: TrendsReport[];
  topics: TrendSeedTopic[];
}

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  status: 'candidate' | 'tracked' | 'rejected';
}

export interface CompetitorReport {
  id: number;
  competitorId: number;
  cycleId: string;
  summary: string;
}

export interface CompetitorsResponse {
  tracked: Competitor[];
  candidates: Competitor[];
  latestReportsByCompetitorId: Record<number, CompetitorReport>;
}

export interface CompetitorSeoKeyword {
  id: number;
  keyword: string;
}
