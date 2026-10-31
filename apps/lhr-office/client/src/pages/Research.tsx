import { useEffect, useMemo, useRef, useState, type DragEvent, type FormEvent } from 'react';
import { apiFetch } from '../lib/api';
import { useApiResource } from '../hooks/useApiResource';
import { OverlapRadar, OVERLAP_AXES } from '../components/OverlapRadar';
import type {
  Competitor,
  CompetitorDiscoveryQuery,
  CompetitorReport,
  CompetitorSeoKeyword,
  CompetitorsResponse,
  OverlapScores,
  TrendSeedTopic,
  TrendsReport,
  TrendsTopicFinding,
  TrendsResponse,
} from '../lib/types';

const ZERO_SCORES: OverlapScores = { market: 0, content: 0, product: 0, threat: 0 };

function domainInitial(domain: string): string {
  const base = domain.replace(/^www\./, '').split('.')[0] ?? domain;
  return base.slice(0, 2).toUpperCase();
}

function threatClass(threat: number): string {
  if (threat >= 75) return 'high';
  if (threat >= 55) return 'mid';
  return 'low';
}

function reportFor(competitors: CompetitorsResponse | null, id: number): CompetitorReport | undefined {
  return competitors?.latestReportsByCompetitorId[id];
}

function sortTrackedByThreat(tracked: Competitor[], reports: Record<number, CompetitorReport>): Competitor[] {
  return [...tracked].sort((a, b) => {
    const ta = reports[a.id]?.overlapScores?.threat ?? 0;
    const tb = reports[b.id]?.overlapScores?.threat ?? 0;
    if (tb !== ta) return tb - ta;
    return a.domain.localeCompare(b.domain);
  });
}

/** Backend still requires a category; Research UI no longer exposes it. */
const DEFAULT_TOPIC_CATEGORY = 'cooking';

type ResearchView = 'board' | 'competitors';
type BoardColumn = 'candidate' | 'curated';

function heatLevel(timesSeen: number | undefined): number {
  if (!timesSeen || timesSeen <= 0) return 0;
  return Math.min(5, timesSeen);
}

function normalizeTopic(topic: string): string {
  return topic.toLowerCase().trim();
}

function sortReportsNewestFirst(reports: TrendsReport[]): TrendsReport[] {
  return [...reports].sort((a, b) => {
    const aTime = a.generatedAt ? new Date(a.generatedAt).getTime() : 0;
    const bTime = b.generatedAt ? new Date(b.generatedAt).getTime() : 0;
    if (bTime !== aTime) return bTime - aTime;
    return b.cycleId.localeCompare(a.cycleId);
  });
}

function reportMentionsTopic(report: TrendsReport, needle: string): boolean {
  if (report.topicsUsed?.some((t) => normalizeTopic(t.topic) === needle)) return true;
  if (report.rawFindings?.topics?.some((t) => normalizeTopic(t.topic) === needle)) return true;
  return false;
}

/** Trends digests that mentioned this topic — newest first. */
function reportsForTopic(reports: TrendsReport[], topicName: string): TrendsReport[] {
  const needle = normalizeTopic(topicName);
  return sortReportsNewestFirst(reports.filter((r) => reportMentionsTopic(r, needle)));
}

/** Newest SerpApi finding for the topic, if any cycle measured it. */
function latestFindingForTopic(reports: TrendsReport[], topicName: string): TrendsTopicFinding | null {
  const needle = normalizeTopic(topicName);
  for (const report of sortReportsNewestFirst(reports)) {
    const finding = report.rawFindings?.topics?.find((t) => normalizeTopic(t.topic) === needle);
    if (finding) return finding;
  }
  return null;
}

function plainSummary(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .trim();
}

function formatCycleDate(report: TrendsReport): string {
  const raw = report.generatedAt ?? (/^\d{4}-\d{2}-\d{2}/.test(report.cycleId) ? report.cycleId : null);
  if (!raw) return report.cycleId;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return report.cycleId;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function TopicChip({
  topic,
  onOpen,
  onDragStart,
  onDragEnd,
}: {
  topic: TrendSeedTopic;
  onOpen: (topic: TrendSeedTopic) => void;
  onDragStart: (topic: TrendSeedTopic) => void;
  onDragEnd: () => void;
}) {
  const heat = heatLevel(topic.timesSeen);
  // HTML5 DnD still fires click after a drop in some browsers — suppress that click.
  const suppressClickRef = useRef(false);

  return (
    <button
      type="button"
      className="topic-chip"
      draggable
      aria-label={`${topic.topic} (${topic.status})`}
      onDragStart={() => {
        suppressClickRef.current = true;
        onDragStart(topic);
      }}
      onDragEnd={() => {
        onDragEnd();
        // Defer clearing so the synthetic click after dragEnd is ignored.
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
      }}
      onClick={() => {
        if (suppressClickRef.current) return;
        onOpen(topic);
      }}
    >
      <div className="topic-chip-top">
        <div className="topic-chip-title">{topic.topic}</div>
        {heat > 0 && (
          <span className="topic-heat" aria-label={`Seen ${topic.timesSeen} time(s)`}>
            {[1, 2, 3, 4, 5].map((i) => (
              <i key={i} className={i <= heat ? (i >= 4 ? 'on hot' : 'on') : undefined} />
            ))}
          </span>
        )}
      </div>
      <div className="topic-chip-hint">Click for research · drag to move</div>
    </button>
  );
}

function TopicResearchModal({
  topic,
  reports,
  finding,
  onClose,
  onPromote,
  onDemote,
  onResearch,
}: {
  topic: TrendSeedTopic;
  reports: TrendsReport[];
  finding: TrendsTopicFinding | null;
  onClose: () => void;
  onPromote: () => void;
  onDemote: () => void;
  onResearch: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const interest = finding?.interest;
  const source = finding?.source;

  return (
    <div className="topic-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="topic-modal"
        role="dialog"
        aria-modal="true"
        aria-label={topic.topic}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="topic-modal-header">
          <div>
            <p className="topic-modal-kicker">{topic.status === 'curated' ? 'Curated seed' : 'Candidate suggestion'}</p>
            <h2>{topic.topic}</h2>
          </div>
          <button type="button" className="topic-modal-close" onClick={onClose} aria-label="Close">
            Close
          </button>
        </header>

        <div className="topic-modal-body">
          <dl className="topic-modal-stats">
            <div>
              <dt>Seen</dt>
              <dd>{topic.timesSeen ?? 0}×</dd>
            </div>
            {source && (
              <div>
                <dt>In last measure</dt>
                <dd className={`topic-modal-source ${source}`}>{source}</dd>
              </div>
            )}
            {interest && (
              <div>
                <dt>Interest</dt>
                <dd className={`topic-modal-direction ${interest.direction}`}>{interest.direction}</dd>
              </div>
            )}
            <div>
              <dt>Reports</dt>
              <dd>{reports.length}</dd>
            </div>
          </dl>

          <section className="topic-modal-reports" aria-label="Deep research reports">
            <h3>Deep research reports</h3>
            {reports.length === 0 ? (
              <p className="topic-modal-empty">
                No reports yet for this topic. They’ll appear here after a trends-watcher cycle that includes
                it.
              </p>
            ) : (
              <ul className="topic-report-list">
                {reports.map((report) => (
                  <li key={report.id} className="topic-report-item">
                    <div className="topic-report-meta">
                      <time dateTime={report.generatedAt ?? report.cycleId}>{formatCycleDate(report)}</time>
                      {interest && report.id === reports[0]?.id && (
                        <span className={`topic-modal-direction ${interest.direction}`}>{interest.direction}</span>
                      )}
                    </div>
                    <p>{plainSummary(report.summary)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <footer className="topic-modal-actions">
          {topic.status === 'candidate' ? (
            <button type="button" onClick={onPromote}>
              Promote
            </button>
          ) : (
            <>
              <button type="button" onClick={onDemote}>
                Demote to candidate
              </button>
              <button type="button" className="topic-modal-research" onClick={onResearch}>
                Research
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}

function CompetitorAnalysisModal({
  competitor,
  report,
  onClose,
  onRemove,
}: {
  competitor: Competitor;
  report: CompetitorReport | undefined;
  onClose: () => void;
  onRemove: () => void;
}) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const scores = report?.overlapScores ?? ZERO_SCORES;

  return (
    <div className="topic-modal-backdrop competitor-modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="competitor-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`Analysis for ${competitor.domain}`}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="competitor-modal-header">
          <h2>{competitor.domain}</h2>
          <div className="competitor-modal-header-actions">
            <a className="competitor-website" href={`https://${competitor.domain}`} target="_blank" rel="noopener noreferrer">
              Website
            </a>
            <button type="button" aria-label={`Remove ${competitor.domain}`} onClick={onRemove}>
              Remove
            </button>
            <button type="button" className="topic-modal-close" onClick={onClose} aria-label="Close">
              Close
            </button>
          </div>
        </header>
        <div className="competitor-modal-body">
          <aside className="competitor-modal-radar">
            <div className="panel-label">Overlap radar</div>
            <OverlapRadar scores={scores} size={260} label={competitor.domain} />
            <div className="overlap-score-list">
              {OVERLAP_AXES.map((axis) => (
                <div key={axis.key}>
                  <span>{axis.label}</span>
                  <strong>{scores[axis.key]}</strong>
                </div>
              ))}
            </div>
          </aside>
          <div className="competitor-modal-copy">
            <section>
              <h3>Decision brief</h3>
              <p>{report?.decisionBrief || report?.summary || 'No report yet for this competitor.'}</p>
            </section>
            {report && report.suggestedActions.length > 0 && (
              <section className="competitor-actions-box">
                <h3>Suggested actions</h3>
                <ul>
                  {report.suggestedActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              </section>
            )}
            <section>
              <h3>Monetization</h3>
              <p>{report?.monetizationSnapshot || '—'}</p>
            </section>
            <section>
              <h3>Design</h3>
              <p>{report?.designSnapshot || '—'}</p>
            </section>
            <section>
              <h3>SEO positions</h3>
              {(report?.seoPositions?.length ?? 0) === 0 ? (
                <p>—</p>
              ) : (
                <div className="competitor-seo-list">
                  {report!.seoPositions.map((row) => (
                    <div key={row.keyword} className="competitor-seo-row">
                      <span>{row.keyword}</span>
                      <span>{row.position == null ? '—' : `#${row.position}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
            {report && report.newContent.length > 0 && (
              <section>
                <h3>New content</h3>
                <ul className="competitor-new-content">
                  {report.newContent.map((post) => (
                    <li key={post.url}>
                      <a href={post.url} target="_blank" rel="noopener noreferrer">
                        {post.title}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function Research() {
  const trends = useApiResource<TrendsResponse>('/api/trends');
  const competitors = useApiResource<CompetitorsResponse>('/api/competitors');
  const keywords = useApiResource<CompetitorSeoKeyword[]>('/api/competitors/keywords');
  const discoveryQueries = useApiResource<CompetitorDiscoveryQuery[]>('/api/competitors/discovery-queries');
  const [view, setView] = useState<ResearchView>('board');
  const [newTopic, setNewTopic] = useState('');
  const [newKeyword, setNewKeyword] = useState('');
  const [newDiscoveryQuery, setNewDiscoveryQuery] = useState('');
  const [newCompetitorDomain, setNewCompetitorDomain] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [dragging, setDragging] = useState<TrendSeedTopic | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardColumn | null>(null);
  const [selectedTopic, setSelectedTopic] = useState<TrendSeedTopic | null>(null);
  const [selectedCompetitorId, setSelectedCompetitorId] = useState<number | null>(null);
  const [competitorModalOpen, setCompetitorModalOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  function showToast(message: string) {
    setToast(message);
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2500);
  }

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    };
  }, []);

  async function runAction(action: () => Promise<unknown>, refetch: () => void): Promise<boolean> {
    setActionError(null);
    try {
      await action();
      refetch();
      return true;
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
      return false;
    }
  }

  async function handleAddTopic(e: FormEvent) {
    e.preventDefault();
    const succeeded = await runAction(
      () =>
        apiFetch('/api/trends/topics', {
          method: 'POST',
          body: JSON.stringify({ category: DEFAULT_TOPIC_CATEGORY, topic: newTopic }),
        }),
      trends.refetch,
    );
    if (succeeded) setNewTopic('');
  }

  async function handleAddKeyword(e: FormEvent) {
    e.preventDefault();
    const succeeded = await runAction(() => apiFetch('/api/competitors/keywords', { method: 'POST', body: JSON.stringify({ keyword: newKeyword }) }), keywords.refetch);
    if (succeeded) setNewKeyword('');
  }

  async function handleAddDiscoveryQuery(e: FormEvent) {
    e.preventDefault();
    const succeeded = await runAction(
      () => apiFetch('/api/competitors/discovery-queries', { method: 'POST', body: JSON.stringify({ query: newDiscoveryQuery }) }),
      discoveryQueries.refetch,
    );
    if (succeeded) setNewDiscoveryQuery('');
  }

  async function handleAddCompetitor(e: FormEvent) {
    e.preventDefault();
    const succeeded = await runAction(
      () => apiFetch('/api/competitors', { method: 'POST', body: JSON.stringify({ domain: newCompetitorDomain }) }),
      competitors.refetch,
    );
    if (succeeded) setNewCompetitorDomain('');
  }

  async function moveTopic(topic: TrendSeedTopic, target: BoardColumn) {
    if (topic.status === target) return;
    const path = target === 'curated' ? `/api/trends/topics/${topic.id}/promote` : `/api/trends/topics/${topic.id}/demote`;
    await runAction(() => apiFetch(path, { method: 'POST' }), trends.refetch);
  }

  function onColumnDragOver(e: DragEvent, column: BoardColumn) {
    e.preventDefault();
    setDropTarget(column);
  }

  async function onColumnDrop(e: DragEvent, column: BoardColumn) {
    e.preventDefault();
    setDropTarget(null);
    if (!dragging) return;
    const topic = dragging;
    setDragging(null);
    await moveTopic(topic, column);
  }

  const topics = trends.data?.topics ?? [];
  const reports = trends.data?.reports ?? [];
  const candidates = topics.filter((t) => t.status === 'candidate');
  const curated = topics.filter((t) => t.status === 'curated');
  const selectedReports = selectedTopic ? reportsForTopic(reports, selectedTopic.topic) : [];
  const selectedFinding = selectedTopic ? latestFindingForTopic(reports, selectedTopic.topic) : null;

  // Keep modal topic in sync after promote/demote refetch.
  const selectedLive = selectedTopic ? topics.find((t) => t.id === selectedTopic.id) ?? selectedTopic : null;

  const trackedList = competitors.data?.tracked;
  const latestReports = competitors.data?.latestReportsByCompetitorId;
  const trackedSorted = useMemo(
    () => sortTrackedByThreat(trackedList ?? [], latestReports ?? {}),
    [trackedList, latestReports],
  );

  useEffect(() => {
    if (trackedSorted.length === 0) {
      setSelectedCompetitorId(null);
      return;
    }
    if (selectedCompetitorId != null && trackedSorted.some((c) => c.id === selectedCompetitorId)) return;
    setSelectedCompetitorId(trackedSorted[0].id);
  }, [trackedSorted, selectedCompetitorId]);

  const selectedCompetitor = trackedSorted.find((c) => c.id === selectedCompetitorId) ?? trackedSorted[0] ?? null;
  const selectedCompetitorReport = selectedCompetitor ? reportFor(competitors.data ?? null, selectedCompetitor.id) : undefined;
  const selectedScores = selectedCompetitorReport?.overlapScores ?? ZERO_SCORES;

  return (
    <div className="panel research-panel research-workshop">
      <h1>Research</h1>
      {actionError && <p role="alert">{actionError}</p>}
      {toast && (
        <div className="office-toast" role="status">
          {toast}
        </div>
      )}

      <div className="workshop-tabs" role="tablist" aria-label="Research views">
        <button type="button" role="tab" aria-selected={view === 'board'} className={view === 'board' ? 'on' : undefined} onClick={() => setView('board')}>
          Trend board
        </button>
        <button type="button" role="tab" aria-selected={view === 'competitors'} className={view === 'competitors' ? 'on' : undefined} onClick={() => setView('competitors')}>
          Competitors
        </button>
      </div>

      {view === 'board' && (
        <section className="workshop-board-view">
          {trends.error && <p role="alert">{trends.error}</p>}
          <p className="board-intro">
            Drag cards between columns to promote or demote. Click a card to open its latest trends research.
          </p>
          <div className="trend-board">
            <div
              className={`board-column${dropTarget === 'candidate' ? ' drop-target' : ''}`}
              role="region"
              aria-label="Candidates"
              onDragOver={(e) => onColumnDragOver(e, 'candidate')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onColumnDrop(e, 'candidate')}
            >
              <h2>Candidates</h2>
              <div className="board-column-cards">
                {candidates.map((topic) => (
                  <TopicChip
                    key={topic.id}
                    topic={topic}
                    onOpen={setSelectedTopic}
                    onDragStart={setDragging}
                    onDragEnd={() => setDragging(null)}
                  />
                ))}
              </div>
            </div>
            <div
              className={`board-column${dropTarget === 'curated' ? ' drop-target' : ''}`}
              role="region"
              aria-label="Curated seeds"
              onDragOver={(e) => onColumnDragOver(e, 'curated')}
              onDragLeave={() => setDropTarget(null)}
              onDrop={(e) => onColumnDrop(e, 'curated')}
            >
              <h2>Curated seeds</h2>
              <div className="board-column-cards">
                {curated.map((topic) => (
                  <TopicChip
                    key={topic.id}
                    topic={topic}
                    onOpen={setSelectedTopic}
                    onDragStart={setDragging}
                    onDragEnd={() => setDragging(null)}
                  />
                ))}
              </div>
            </div>
          </div>

          <form className="add-topic-form" onSubmit={handleAddTopic}>
            <label className="add-topic-field">
              <span>Topic</span>
              <input
                value={newTopic}
                onChange={(e) => setNewTopic(e.target.value)}
                placeholder="Any phrase — e.g. sourdough discard cookies"
                required
              />
            </label>
            <button type="submit">Add to curated</button>
          </form>
        </section>
      )}

      {view === 'competitors' && (
        <section className="workshop-competitors-view">
          {competitors.error && <p role="alert">{competitors.error}</p>}
          <h2>Competitors</h2>
          <p className="board-intro">Overlap radar · select a chip, then open the full brief</p>

          <div className="competitors-overview-a">
            <div className="competitors-radar-panel">
              <div className="panel-label">Overlap vs LHR</div>
              {selectedCompetitor ? (
                <>
                  <OverlapRadar scores={selectedScores} size={340} label={selectedCompetitor.domain} />
                  <div className="competitors-selected-name">
                    <strong>{selectedCompetitor.domain}</strong>
                    <span>
                      threat {selectedScores.threat}
                      {selectedCompetitorReport?.decisionBrief
                        ? ` · ${selectedCompetitorReport.decisionBrief.slice(0, 80)}${selectedCompetitorReport.decisionBrief.length > 80 ? '…' : ''}`
                        : ''}
                    </span>
                  </div>
                  <p className="competitors-open-row">
                    <button type="button" className="ghost-btn" onClick={() => setCompetitorModalOpen(true)}>
                      Open full analysis →
                    </button>
                  </p>
                </>
              ) : (
                <p className="board-intro">No tracked competitors yet. Add one below.</p>
              )}
            </div>

            <div className="competitors-chip-panel">
              <div className="panel-label">Tracked · sorted by threat</div>
              <div className="competitor-chips" role="list">
                {trackedSorted.map((c) => {
                  const report = latestReports?.[c.id];
                  const scores = report?.overlapScores ?? ZERO_SCORES;
                  const selected = c.id === selectedCompetitor?.id;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="listitem"
                      className={`competitor-chip ${selected ? 'on' : ''}`}
                      aria-pressed={selected}
                      aria-label={`${c.domain}, threat ${scores.threat}`}
                      onClick={() => setSelectedCompetitorId(c.id)}
                      onDoubleClick={() => {
                        setSelectedCompetitorId(c.id);
                        setCompetitorModalOpen(true);
                      }}
                    >
                      <span className="competitor-chip-avatar">{domainInitial(c.domain)}</span>
                      <span className="competitor-chip-meta">
                        <strong>{c.domain}</strong>
                        <small>
                          market {scores.market} · content {scores.content}
                        </small>
                      </span>
                      <span className={`threat-pill ${threatClass(scores.threat)}`}>{scores.threat}</span>
                    </button>
                  );
                })}
              </div>
              <form className="add-competitor-form" onSubmit={handleAddCompetitor}>
                <label className="add-topic-field">
                  <span>Domain</span>
                  <input
                    value={newCompetitorDomain}
                    onChange={(e) => setNewCompetitorDomain(e.target.value)}
                    placeholder="e.g. all-clad.com"
                    required
                  />
                </label>
                <button type="submit">Add competitor</button>
              </form>
            </div>
          </div>

          <details className="competitors-sources">
            <summary>Sources (discovery queries &amp; SEO keywords)</summary>
            <div className="discovery-queries-block">
              <h3>Discovery queries</h3>
              <p className="board-intro">
                Google searches used to find new competitor candidates (shown under Approvals). Separate from SEO
                ranking keywords below.
              </p>
              {discoveryQueries.error && <p role="alert">{discoveryQueries.error}</p>}
              <ul className="keyword-list">
                {(discoveryQueries.data ?? []).map((q) => (
                  <li key={q.id}>
                    <span>{q.query}</span>
                    <button
                      type="button"
                      aria-label={`Remove discovery query ${q.query}`}
                      onClick={() =>
                        void runAction(() => apiFetch(`/api/competitors/discovery-queries/${q.id}`, { method: 'DELETE' }), discoveryQueries.refetch)
                      }
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <form className="add-keyword-form" onSubmit={handleAddDiscoveryQuery}>
                <input
                  value={newDiscoveryQuery}
                  onChange={(e) => setNewDiscoveryQuery(e.target.value)}
                  placeholder="e.g. weeknight pasta blog"
                  required
                />
                <button type="submit">Add discovery query</button>
              </form>
            </div>

            <div className="keywords-block">
              <h3>SEO keywords</h3>
              <p className="board-intro">Used to check where tracked competitors rank — not for finding new sites.</p>
              {keywords.error && <p role="alert">{keywords.error}</p>}
              <ul className="keyword-list">
                {(keywords.data ?? []).map((k) => (
                  <li key={k.id}>
                    <span>{k.keyword}</span>
                    <button type="button" onClick={() => void runAction(() => apiFetch(`/api/competitors/keywords/${k.id}`, { method: 'DELETE' }), keywords.refetch)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
              <form className="add-keyword-form" onSubmit={handleAddKeyword}>
                <input value={newKeyword} onChange={(e) => setNewKeyword(e.target.value)} placeholder="New keyword" required />
                <button type="submit">Add keyword</button>
              </form>
            </div>
          </details>

          {competitorModalOpen && selectedCompetitor && (
            <CompetitorAnalysisModal
              competitor={selectedCompetitor}
              report={selectedCompetitorReport}
              onClose={() => setCompetitorModalOpen(false)}
              onRemove={() => {
                void runAction(() => apiFetch(`/api/competitors/${selectedCompetitor.id}/reject`, { method: 'POST' }), competitors.refetch).then(
                  (ok) => {
                    if (ok) setCompetitorModalOpen(false);
                  },
                );
              }}
            />
          )}
        </section>
      )}

      {selectedLive && (
        <TopicResearchModal
          topic={selectedLive}
          reports={selectedReports}
          finding={selectedFinding}
          onClose={() => setSelectedTopic(null)}
          onPromote={() => {
            void moveTopic(selectedLive, 'curated').then(() => setSelectedTopic(null));
          }}
          onDemote={() => {
            void moveTopic(selectedLive, 'candidate').then(() => setSelectedTopic(null));
          }}
          onResearch={() => showToast('Feature not implemented yet')}
        />
      )}
    </div>
  );
}
