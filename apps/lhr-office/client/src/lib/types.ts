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

export interface TrendsTopicUsed {
  topic: string;
  source: 'curated' | 'suggested';
}

export interface TrendsRelatedQuery {
  query: string;
  value: string;
}

export interface TrendsTopicInterest {
  direction: 'rising' | 'falling' | 'flat';
  topQueries: TrendsRelatedQuery[];
  risingQueries: TrendsRelatedQuery[];
}

export interface TrendsTopicFinding {
  topic: string;
  source: 'curated' | 'suggested';
  interest: TrendsTopicInterest;
}

export interface TrendsRawFindings {
  topics?: TrendsTopicFinding[];
  trendingNow?: { query: string; searchVolume: number | null; increasePercentage: number | null }[];
}

export interface TrendsReport {
  id: number;
  cycleId: string;
  category: TrendCategory;
  summary: string;
  generatedAt?: string;
  topicsUsed?: TrendsTopicUsed[];
  rawFindings?: TrendsRawFindings;
}

export interface TrendSeedTopic {
  id: number;
  category: TrendCategory;
  topic: string;
  status: 'curated' | 'candidate';
  timesSeen?: number;
}

export interface TrendsResponse {
  reports: TrendsReport[];
  topics: TrendSeedTopic[];
}

export interface Competitor {
  id: number;
  domain: string;
  name: string | null;
  discoveryQuery?: string | null;
  status: 'candidate' | 'tracked' | 'rejected';
}

export interface OverlapScores {
  market: number;
  content: number;
  product: number;
  threat: number;
}

export interface CompetitorPostSummary {
  title: string;
  url: string;
  publishedAt: string | null;
}

export interface SeoPositionEntry {
  keyword: string;
  position: number | null;
}

export interface CompetitorReport {
  id: number;
  competitorId: number;
  cycleId: string;
  generatedAt?: string | Date;
  newContent: CompetitorPostSummary[];
  seoPositions: SeoPositionEntry[];
  monetizationSnapshot: string;
  designSnapshot: string;
  summary: string;
  overlapScores: OverlapScores;
  decisionBrief: string;
  suggestedActions: string[];
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

export interface CompetitorDiscoveryQuery {
  id: number;
  query: string;
}

export type BridgeJob = {
  id: string;
  kind: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled';
  payload: { goal?: string; repo_key?: string };
  result: { final_answer?: string; ok?: boolean } | null;
  error_message: string | null;
  created_at: string;
  finished_at: string | null;
  worker_id: string | null;
};

export type SourcedProductCycleStatus =
  | 'drafting_criteria'
  | 'awaiting_criteria_approval'
  | 'searching'
  | 'awaiting_product_picks'
  | 'monetizing'
  | 'awaiting_monetize_approval'
  | 'branding'
  | 'awaiting_final'
  | 'closed';

export type SourcedProductCandidateStatus =
  | 'sourced'
  | 'picked'
  | 'skipped'
  | 'monetize_pass'
  | 'monetize_fail'
  | 'monetize_confirmed'
  | 'dropped'
  | 'brand_pass'
  | 'brand_fail'
  | 'pending_final'
  | 'approved'
  | 'denied';

export interface SourcedProductCriteria {
  keywords: string[];
  platforms: string[];
  aestheticNotes: string;
  categoryHints: string[];
}

export interface SourcedProductCycle {
  id: number;
  startedAt: string;
  status: SourcedProductCycleStatus;
  criteriaJson: Partial<SourcedProductCriteria> | null;
  criteriaApprovedAt: string | null;
  gatingProfile: 'strict' | 'trust';
  closedAt: string | null;
}

export interface SourcedProductCandidate {
  id: number;
  cycleId: number;
  title: string;
  imageUrl: string | null;
  sourceUrl: string;
  platform: string;
  moq: string | null;
  unitCostCents: number | null;
  notes: string | null;
  status: SourcedProductCandidateStatus;
  monetizePass: boolean | null;
  monetizeRationale: string | null;
  brandPass: boolean | null;
  brandRationale: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** GET /api/sourced-products/cycle — `cycle` is null when nothing is open. */
export interface SourcedProductCycleResponse {
  cycle: SourcedProductCycle | null;
  candidates: SourcedProductCandidate[];
}
