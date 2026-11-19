// @vitest-environment jsdom
// SEO Audit v2 UI: action plan, progress steps, the job loop hook, and v1/v2 view selection.
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

vi.mock('@/lib/seoAuditV2/tasks', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, tasksToCsv: vi.fn(actual.tasksToCsv) };
});

import { tasksToCsv } from '@/lib/seoAuditV2/tasks';
import ActionPlan, { tasksToChecklist, pagePath } from '@/app/dashboard/seo-audit/v2/ActionPlan.jsx';
import ProgressSteps from '@/app/dashboard/seo-audit/v2/ProgressSteps.jsx';
import ClientSummary from '@/app/dashboard/seo-audit/v2/ClientSummary.jsx';
import PageCards from '@/app/dashboard/seo-audit/v2/PageCards.jsx';
import PassFindings from '@/app/dashboard/seo-audit/v2/PassFindings.jsx';
import { useAuditJob, friendlyError } from '@/app/dashboard/seo-audit/v2/useAuditJob.js';
import ResultsView, { isV2Audit } from '@/app/dashboard/seo-audit/ResultsView.jsx';
import AdvancedOptions, { EMPTY_ADVANCED, toRequestOptions, fromAuditOptions } from '@/app/dashboard/seo-audit/v2/AdvancedOptions.jsx';

const TASKS = [
  {
    id: 'T1', title: 'Add pricing section to turf page', page: 'https://acme.com/services/turf', category: 'content',
    impact: 5, effort: 2, confidence: 'high',
    evidence: ['Query "turf cost" has 1,200 impressions at position 14', 'No price mentioned on page'],
    change: 'Add an H2 "How much does turf cost?" with a price range table.', why: 'Ranks for cost queries but never answers them.',
  },
  {
    id: 'T2', title: 'Fix canonical pointing to staging', page: 'https://acme.com/', category: 'technical',
    impact: 4, effort: 1, confidence: 'high',
    evidence: ['Canonical is https://staging.acme.com/'], change: 'Set the canonical to https://acme.com/.', why: 'Search engines may drop the home page.',
  },
  {
    id: 'T3', title: 'Add LocalBusiness schema', page: 'site-wide', category: 'local',
    impact: 3, effort: 2, confidence: 'medium',
    evidence: ['No LocalBusiness markup on any of 12 pages'], change: 'Add LocalBusiness JSON-LD on /contact with the NAP.', why: 'Helps map results.',
  },
];

const V2_RESULT = {
  version: 2, domain: 'acme.com', audit_type: 'full', audit_date: '2026-11-18',
  client_summary: 'Your site is close to page one for turf pricing searches.',
  top_moves: [{ headline: 'Answer pricing questions on the turf page', task: TASKS[0] }],
  scores: { seo: { score: 6, reason: 'Good crawl health' }, geo: { score: 4, reason: 'Few facts' }, aeo: { score: 3, reason: 'No answers' } },
  action_plan: TASKS,
  pages: [{ page: 'https://acme.com/services/turf', fixes: [{ change: 'Add a pricing table', targets_queries: ['turf cost', 'artificial grass price'] }] }],
  findings: {
    technical: [{ title: 'Staging canonical', detail: 'Home page canonical points to staging.', evidence: ['link rel=canonical'] }],
    content: [], local: [], conversion: [],
  },
  data_gaps: ['Google Analytics: no GA4 property found for this site, so conversion analysis was skipped.'],
  data_sources: { crawl: { status: 'ok', pages: 12 }, search_console: { status: 'ok' }, ga4: { status: 'no_property' } },
};

const V1_AUDIT = {
  audit_summary: {
    domain: 'old.com', audit_type: 'full', audit_date: '2025-01-01',
    scores: { seo: { score: 5 }, geo: { score: 4 }, aeo: { score: 3 }, combined: { score: 12, max: 30 } },
    executive_summary: 'Old summary',
  },
  seo_analysis: { technical_on_page: [{ signal: 'Title', finding: 'Too long', status: 'Needs Attention' }] },
  geo_analysis: {}, aeo_analysis: {},
  priority_recommendations: [{ priority: 'high', issue: 'Fix titles', dimension: 'SEO', effort: 'low', impact: 'high', action: 'Shorten' }],
};

describe('ActionPlan', () => {
  beforeEach(() => { tasksToCsv.mockClear(); });

  it('filters by category', () => {
    render(<ActionPlan tasks={TASKS} domain="acme.com" auditDate="2026-11-18" />);
    expect(screen.getByText('Add pricing section to turf page')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'technical' } });
    expect(screen.getByText('Fix canonical pointing to staging')).toBeInTheDocument();
    expect(screen.queryByText('Add pricing section to turf page')).not.toBeInTheDocument();
    expect(screen.queryByText('Add LocalBusiness schema')).not.toBeInTheDocument();
  });

  it('filters by page', () => {
    render(<ActionPlan tasks={TASKS} domain="acme.com" />);
    fireEvent.change(screen.getByLabelText(/^page/i), { target: { value: 'site-wide' } });
    expect(screen.getByText('Add LocalBusiness schema')).toBeInTheDocument();
    expect(screen.queryByText('Fix canonical pointing to staging')).not.toBeInTheDocument();
  });

  it('an expanded row shows the evidence, the exact change and why', () => {
    render(<ActionPlan tasks={TASKS} domain="acme.com" />);
    expect(screen.queryByText('No price mentioned on page')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('Add pricing section to turf page'));
    expect(screen.getByText('No price mentioned on page')).toBeInTheDocument();
    expect(screen.getByText('Query "turf cost" has 1,200 impressions at position 14')).toBeInTheDocument();
    expect(screen.getByText('Add an H2 "How much does turf cost?" with a price range table.')).toBeInTheDocument();
    expect(screen.getByText('Ranks for cost queries but never answers them.')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Add pricing section to turf page'));
    expect(screen.queryByText('No price mentioned on page')).not.toBeInTheDocument();
  });

  it('formats the checklist as Markdown task lines with the page path', () => {
    expect(pagePath('https://acme.com/services/turf?x=1')).toBe('/services/turf');
    expect(pagePath('site-wide')).toBe('site-wide');
    expect(tasksToChecklist([TASKS[0], { ...TASKS[1], change: 'Line one\n  line two' }])).toBe(
      '- [ ] T1 · /services/turf · Add pricing section to turf page — Add an H2 "How much does turf cost?" with a price range table.\n'
      + '- [ ] T2 · / · Fix canonical pointing to staging — Line one\n'
      + '  - line two',
    );
  });

  it('checklist keeps the exact fix text as indented sub-lines', () => {
    const change = 'Rewrite the title.\nReplace the title with: "Turf Installation in Las Vegas, NV | Acme"\nReplace the meta description with: "Turf in Las Vegas."';
    expect(tasksToChecklist([{ ...TASKS[0], page: '/las-vegas', change }])).toBe(
      '- [ ] T1 · /las-vegas · Add pricing section to turf page — Rewrite the title.\n'
      + '  - Replace the title with: "Turf Installation in Las Vegas, NV | Acme"\n'
      + '  - Replace the meta description with: "Turf in Las Vegas."',
    );
  });

  it('Copy as checklist copies the visible tasks', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ActionPlan tasks={TASKS} domain="acme.com" />);
    fireEvent.change(screen.getByLabelText(/category/i), { target: { value: 'local' } });
    fireEvent.click(screen.getByRole('button', { name: /copy as checklist/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(tasksToChecklist([TASKS[2]])));
    expect(await screen.findByText(/copied/i)).toBeInTheDocument();
  });

  it('Download CSV calls tasksToCsv and names the file after the domain and date', () => {
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    globalThis.URL.createObjectURL = createObjectURL;
    globalThis.URL.revokeObjectURL = revokeObjectURL;
    let downloadName = null;
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { downloadName = this.download; });
    render(<ActionPlan tasks={TASKS} domain="acme.com" auditDate="2026-11-18" />);
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }));
    expect(tasksToCsv).toHaveBeenCalledWith(TASKS);
    expect(createObjectURL).toHaveBeenCalled();
    expect(downloadName).toBe('acme.com SEO action plan 2026-11-18.csv');
    clickSpy.mockRestore();
  });

  it('Copy change says Copied only when the copy worked, otherwise the failure', async () => {
    const writeText = vi.fn().mockResolvedValue();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<ActionPlan tasks={TASKS} domain="acme.com" />);
    fireEvent.click(screen.getByText('Add pricing section to turf page'));
    fireEvent.click(screen.getByRole('button', { name: /copy change/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(TASKS[0].change));
    expect(await screen.findByRole('button', { name: /^copied$/i })).toBeInTheDocument();

    writeText.mockRejectedValue(new Error('denied'));
    fireEvent.click(screen.getByText('Fix canonical pointing to staging'));
    const buttons = screen.getAllByRole('button', { name: /copy change/i });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByText(/couldn.t copy/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^copied$/i })).not.toBeInTheDocument();
  });

  it('each row has a real expand button with aria-expanded', () => {
    render(<ActionPlan tasks={TASKS} domain="acme.com" />);
    const btn = screen.getByRole('button', { name: 'Show details for T1' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('No price mentioned on page')).toBeInTheDocument();
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No price mentioned on page')).not.toBeInTheDocument();
  });

  it('shows an empty state when there are no tasks', () => {
    render(<ActionPlan tasks={[]} domain="acme.com" />);
    expect(screen.getByText(/no tasks/i)).toBeInTheDocument();
  });
});

const steps = (statuses, extra = {}) => [
  'Crawling pages', 'Reading Search Console, Analytics & page speed', 'Technical & indexing',
  'Content & keywords', 'Local & AI search', 'Conversion', 'Building action plan',
].map((label, i) => ({ key: `k${i}`, label, status: statuses[i] || 'pending', ...(extra[i] || {}) }));

describe('ProgressSteps', () => {
  it('shows done, running and pending states, and data gaps as they appear', () => {
    const progress = { domain: 'acme.com', status: 'running', steps: steps(['done', 'running']), dataGaps: ['Search Console: this site is not in our login.'] };
    render(<ProgressSteps progress={progress} onRetry={() => {}} />);
    expect(screen.getByTestId('step-k0')).toHaveAttribute('data-status', 'done');
    expect(screen.getByTestId('step-k1')).toHaveAttribute('data-status', 'running');
    expect(screen.getByTestId('step-k2')).toHaveAttribute('data-status', 'pending');
    expect(screen.getByText('Crawling pages')).toBeInTheDocument();
    expect(screen.getByText('Search Console: this site is not in our login.')).toBeInTheDocument();
    expect(screen.getByText(/elapsed/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it('shows the failed step error and a Retry button that calls onRetry', () => {
    const onRetry = vi.fn();
    const progress = { domain: 'acme.com', status: 'failed', steps: steps(['failed'], { 0: { error: 'crawl: no pages could be fetched' } }), dataGaps: [] };
    render(<ProgressSteps progress={progress} onRetry={onRetry} />);
    expect(screen.getByTestId('step-k0')).toHaveAttribute('data-status', 'failed');
    expect(screen.getByText('crawl: no pages could be fetched')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('shows a plain message per error code instead of the raw service text', () => {
    const progress = {
      domain: 'acme.com', status: 'failed', dataGaps: [],
      steps: steps(['failed', 'failed', 'failed', 'failed'], {
        0: { error: 'timeout: The request timed out' },
        1: { error: 'refusal: Declined (cyber)' },
        2: { error: 'max_tokens: The reply hit the output limit' },
        3: { error: 'api: 529 {"type":"error","error":{"type":"overloaded_error"}}' },
      }),
    };
    render(<ProgressSteps progress={progress} onRetry={() => {}} />);
    expect(screen.getByText('This step took too long and was stopped.')).toBeInTheDocument();
    expect(screen.getByText('The analysis service declined this step.')).toBeInTheDocument();
    expect(screen.getByText('The analysis ran too long to finish in one reply.')).toBeInTheDocument();
    expect(screen.getByText('The analysis service returned an error.')).toBeInTheDocument();
    expect(screen.queryByText(/overloaded_error/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined \(cyber\)/)).not.toBeInTheDocument();
  });

  it('shows a request error with Retry even while the job is running', () => {
    const onRetry = vi.fn();
    render(<ProgressSteps progress={{ status: 'running', steps: steps(['running']), dataGaps: [] }} error="Couldn't reach the server." onRetry={onRetry} />);
    expect(screen.getByText("Couldn't reach the server.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalled();
  });
});

const jsonRes = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

describe('useAuditJob', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('reads the job, then calls advance one at a time until done', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const advanceReplies = [
      { status: 'running', steps: steps(['done', 'running']), dataGaps: [] },
      { status: 'running', steps: steps(['done', 'done', 'running']), dataGaps: [] },
      { status: 'done', steps: steps(['done', 'done', 'done', 'done', 'done', 'done', 'done']), dataGaps: [], result: V2_RESULT },
    ];
    global.fetch = vi.fn(async (url) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      if (!String(url).endsWith('/advance')) return jsonRes({ status: 'running', steps: steps(['running']), dataGaps: [] });
      return jsonRes(advanceReplies.shift());
    });
    const { result } = renderHook(() => useAuditJob('job1', { minIntervalMs: 0 }));
    await waitFor(() => expect(result.current.result).toEqual(V2_RESULT));
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    expect(urls[0]).toBe('/api/seo-audit/v2/jobs/job1');
    expect(urls.slice(1)).toEqual(Array(3).fill('/api/seo-audit/v2/jobs/job1/advance'));
    expect(global.fetch.mock.calls[1][1]).toMatchObject({ method: 'POST' });
    expect(maxInFlight).toBe(1);
    expect(result.current.progress.status).toBe('done');
  });

  it('never exposes the previous job\'s result after switching to a new job', async () => {
    let hangNext = false;
    global.fetch = vi.fn(async (url) => {
      if (hangNext) return new Promise(() => {});
      if (String(url).endsWith('/advance')) return jsonRes({ status: 'done', steps: steps(['done']), dataGaps: [], result: V2_RESULT });
      return jsonRes({ status: 'running', steps: steps(['running']), dataGaps: [] });
    });
    const { result, rerender } = renderHook(({ id }) => useAuditJob(id, { minIntervalMs: 0 }), { initialProps: { id: 'jobA' } });
    await waitFor(() => expect(result.current.result).toEqual(V2_RESULT));
    rerender({ id: null });
    expect(result.current.result).toBeNull();
    hangNext = true;
    rerender({ id: 'jobB' });
    expect(result.current.result).toBeNull();
    expect(result.current.progress).toBeNull();
  });

  it('stops on failed; retry posts /retry and resumes advancing', async () => {
    const failed = { status: 'failed', steps: steps(['failed'], { 0: { error: 'crawl: timeout' } }), dataGaps: [] };
    const replies = {
      get: [jsonRes(failed)],
      retry: [jsonRes({ status: 'queued', steps: steps([]), dataGaps: [] })],
      advance: [jsonRes({ status: 'done', steps: steps(Array(7).fill('done')), dataGaps: [], result: V2_RESULT })],
    };
    global.fetch = vi.fn(async (url) => {
      const u = String(url);
      if (u.endsWith('/retry')) return replies.retry.shift();
      if (u.endsWith('/advance')) return replies.advance.shift();
      return replies.get.shift();
    });
    const { result } = renderHook(() => useAuditJob('job2', { minIntervalMs: 0 }));
    await waitFor(() => expect(result.current.progress?.status).toBe('failed'));
    expect(global.fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.result).toEqual(V2_RESULT));
    const urls = global.fetch.mock.calls.map((c) => c[0]);
    expect(urls).toEqual(['/api/seo-audit/v2/jobs/job2', '/api/seo-audit/v2/jobs/job2/retry', '/api/seo-audit/v2/jobs/job2/advance']);
  });

  it('surfaces a readable error on a failed request and retry resumes advancing', async () => {
    const replies = [
      jsonRes({ status: 'running', steps: steps(['running']), dataGaps: [] }),
      jsonRes({ error: 'Mongo exploded', code: 'E1' }, 500),
      jsonRes({ status: 'done', steps: steps(Array(7).fill('done')), dataGaps: [], result: V2_RESULT }),
    ];
    global.fetch = vi.fn(async () => replies.shift());
    const { result } = renderHook(() => useAuditJob('job3', { minIntervalMs: 0 }));
    await waitFor(() => expect(result.current.error).toMatch(/Mongo exploded/));
    await act(async () => { await result.current.retry(); });
    await waitFor(() => expect(result.current.result).toEqual(V2_RESULT));
    expect(result.current.error).toBeNull();
  });

  it('friendlyError explains auth, missing jobs and rate limits', () => {
    expect(friendlyError(401, {})).toMatch(/sign in/i);
    expect(friendlyError(404, { error: 'Job not found' })).toMatch(/no longer exists/i);
    expect(friendlyError(429, { error: 'Daily limit reached (5 audits per day).' })).toBe('Daily limit reached (5 audits per day).');
    expect(friendlyError(429, { error: 'Too many requests', retryAfterSeconds: 20 })).toMatch(/20s/);
    expect(friendlyError(500, {})).toMatch(/500/);
  });
});

describe('v2 results pieces', () => {
  it('ClientSummary shows the summary, top moves and the scores row', () => {
    render(<ClientSummary result={V2_RESULT} />);
    expect(screen.getByText('Your site is close to page one for turf pricing searches.')).toBeInTheDocument();
    expect(screen.getByText('Answer pricing questions on the turf page')).toBeInTheDocument();
    expect(screen.getByText('Good crawl health')).toBeInTheDocument();
    expect(screen.getByText('13')).toBeInTheDocument(); // combined 6+4+3
  });

  it('PageCards lists each page with its fixes and target queries', () => {
    render(<PageCards pages={V2_RESULT.pages} tasks={TASKS} />);
    expect(screen.getByText('/services/turf')).toBeInTheDocument();
    expect(screen.getByText('Add a pricing table')).toBeInTheDocument();
    expect(screen.getByText('turf cost')).toBeInTheDocument();
    expect(screen.getByText(/T1/)).toBeInTheDocument();
  });

  it('PageCards matches tasks by path and links path pages on the domain', () => {
    const pages = [{ page: '/services/turf', fixes: [{ change: 'Add a pricing table', targets_queries: [] }] }];
    const tasks = [{ ...TASKS[0], page: 'https://acme.com/services/turf/' }, { ...TASKS[1], id: 'T9', page: '/services/turf' }];
    render(<PageCards pages={pages} tasks={tasks} domain="acme.com" />);
    expect(screen.getByText('In the action plan: T1, T9')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '/services/turf' })).toHaveAttribute('href', 'https://acme.com/services/turf');
  });

  it('PageCards shows index status, speed and top queries, and hides empty blocks', () => {
    const pages = [
      {
        page: 'https://acme.com/services/turf', fixes: [],
        index: { verdict: 'PASS', coverage_state: 'Submitted and indexed', canonical_mismatch: false, google_canonical: null, last_crawl: null },
        speed: { score: 62, lcp_ms: 3100, inp_ms: 180, cls: 0.05, field: { lcp_ms: 2900, inp_ms: 150, cls: 0.04 } },
        top_queries: [{ query: 'turf cost', clicks: 12, impressions: 900, position: 8.4 }],
      },
      {
        page: 'https://acme.com/about', fixes: [],
        index: { verdict: 'NEUTRAL', coverage_state: 'Crawled - currently not indexed', canonical_mismatch: false, google_canonical: null, last_crawl: null },
        speed: { score: 80, lcp_ms: 2000, inp_ms: null, cls: 0.01, field: null },
        top_queries: [],
      },
      {
        page: 'https://acme.com/old', fixes: [{ change: 'Merge into /new', targets_queries: [] }],
        index: { verdict: 'PASS', coverage_state: 'Indexed', canonical_mismatch: true, google_canonical: 'https://acme.com/new', last_crawl: null },
        speed: null, top_queries: [],
      },
      { page: 'https://acme.com/plain', fixes: [{ change: 'Add an H1', targets_queries: [] }], index: null, speed: null, top_queries: [] },
    ];
    const { container } = render(<PageCards pages={pages} tasks={[]} />);
    const cards = container.querySelectorAll('[data-page-card]');
    expect(cards).toHaveLength(4);
    expect(cards[0]).toHaveTextContent('Indexed');
    expect(cards[0]).toHaveTextContent('Speed 62/100');
    expect(cards[0]).toHaveTextContent(/real users/i);
    expect(cards[0]).toHaveTextContent('LCP 2.9s');
    expect(cards[0]).toHaveTextContent('turf cost');
    expect(cards[1]).toHaveTextContent('Not indexed: Crawled - currently not indexed');
    expect(cards[1]).toHaveTextContent(/lab test/i);
    expect(cards[1]).toHaveTextContent('LCP 2.0s');
    expect(cards[1]).not.toHaveTextContent(/top queries/i);
    expect(cards[2]).toHaveTextContent('Google picked a different canonical: https://acme.com/new');
    expect(cards[2]).not.toHaveTextContent(/speed/i);
    expect(cards[3]).not.toHaveTextContent(/indexed|speed|top queries/i);
  });

  it('PassFindings lists findings and shows an empty state', () => {
    const { rerender } = render(<PassFindings findings={V2_RESULT.findings.technical} />);
    expect(screen.getByText('Staging canonical')).toBeInTheDocument();
    expect(screen.getByText('link rel=canonical')).toBeInTheDocument();
    rerender(<PassFindings findings={[]} />);
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });
});

describe('ResultsView picks the view by version', () => {
  it('detects v2 audits', () => {
    expect(isV2Audit(V2_RESULT)).toBe(true);
    expect(isV2Audit(V1_AUDIT)).toBe(false);
    expect(isV2Audit(null)).toBe(false);
  });

  it('renders a v1 audit with the v1 tabs (regression)', () => {
    render(<ResultsView audit={V1_AUDIT} domain="old.com" />);
    for (const tab of ['SEO Analysis', 'GEO Analysis', 'AEO Analysis', 'Recommendations']) {
      expect(screen.getByRole('button', { name: tab })).toBeInTheDocument();
    }
    expect(screen.getByText('Old summary')).toBeInTheDocument();
    expect(screen.getByText('Too long')).toBeInTheDocument();
    expect(screen.queryByText(/action plan/i)).not.toBeInTheDocument();
  });

  it('renders a v2 audit with the action plan, tabs and data gaps', () => {
    render(<ResultsView audit={V2_RESULT} domain="acme.com" />);
    expect(screen.getByRole('button', { name: /^action plan/i })).toBeInTheDocument();
    for (const tab of ['Pages', 'Technical', 'Local & AI search', 'Conversion']) {
      expect(screen.getByRole('button', { name: new RegExp(`^${tab}`) })).toBeInTheDocument();
    }
    expect(screen.getByText(V2_RESULT.data_gaps[0])).toBeInTheDocument();
    expect(screen.getByText('Fix canonical pointing to staging')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^technical/i }));
    expect(screen.getByText('Staging canonical')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'SEO Analysis' })).not.toBeInTheDocument();
  });

  it('shows a gap notice instead of an empty state for a pass that did not complete', () => {
    const result = {
      ...V2_RESULT,
      passes_completed: { technical: true, content: false, local: false, conversion: true },
    };
    render(<ResultsView audit={result} domain="acme.com" />);
    expect(screen.getByRole('button', { name: /^local & ai search\s*!/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^technical\s*1$/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^local & ai search/i }));
    expect(screen.getByText("Local & AI search analysis didn't complete — rerun to include it")).toBeInTheDocument();
    expect(screen.queryByText(/no findings/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^pages/i }));
    expect(screen.getByText("Content analysis didn't complete — rerun to include it")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^conversion/i }));
    expect(screen.getByText(/no findings/i)).toBeInTheDocument();
  });

  it('uses no automation or vendor wording in the v2 view', () => {
    const { container } = render(<ResultsView audit={V2_RESULT} domain="acme.com" />);
    expect(container.textContent).not.toMatch(/\bAI[- ]?(generated|powered)|claude|anthropic|\bLLM\b|\bGPT\b/i);
  });

  it('the page and view sources use no automation or vendor wording', () => {
    const dir = path.resolve(__dirname, '../../app/dashboard/seo-audit');
    const files = [
      ...fs.readdirSync(path.join(dir, 'v2')).filter((f) => /\.jsx?$/.test(f)).map((f) => path.join(dir, 'v2', f)),
      ...['page.js', 'ui.jsx', 'ResultsView.jsx', 'V1Results.jsx'].map((f) => path.join(dir, f)),
    ];
    // Explicit exceptions: the "Local & AI search" area label, and a v1 section
    // title kept verbatim so saved v1 audits render as before.
    const ALLOWED = ['Local & AI search', 'Content for AI Synthesis'];
    const BANNED = /\bAI\b|claude|anthropic|openai|\bLLM\b|\bGPT\b|gemini|chatbot|powered by|machine learning|language model/i;
    expect(files.length).toBeGreaterThan(8);
    const hits = [];
    for (const file of files) {
      let src = fs.readFileSync(file, 'utf8');
      for (const ok of ALLOWED) src = src.split(ok).join('');
      src.split('\n').forEach((line, i) => {
        if (BANNED.test(line)) hits.push(`${path.basename(file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });
});

describe('AdvancedOptions', () => {
  it('toRequestOptions: nothing set is undefined; lines and commas split; onlyListed needs pages', () => {
    expect(toRequestOptions(EMPTY_ADVANCED)).toBeUndefined();
    expect(toRequestOptions({ pagesText: '/a\n /b \n', skipText: '/blog/*, /tag/*', onlyListed: true, pageCount: '10' }))
      .toEqual({ pages: ['/a', '/b'], skip: ['/blog/*', '/tag/*'], onlyListed: true, pageCount: 10 });
    expect(toRequestOptions({ ...EMPTY_ADVANCED, onlyListed: true, skipText: '/x' }).onlyListed).toBe(false);
  });

  it('fromAuditOptions turns saved URLs back into paths', () => {
    expect(fromAuditOptions({ pages: ['https://acme.com/pet-turf'], onlyListed: true, skip: ['/blog/*'], pageCount: null }))
      .toEqual({ pagesText: '/pet-turf', onlyListed: true, skipText: '/blog/*', pageCount: '' });
    expect(fromAuditOptions(null)).toEqual(EMPTY_ADVANCED);
  });

  it('starts collapsed, opens on click and reports edits', () => {
    const onChange = vi.fn();
    render(<AdvancedOptions value={EMPTY_ADVANCED} onChange={onChange} auditType="quick" />);
    expect(screen.queryByLabelText('Pages to audit first')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    fireEvent.change(screen.getByLabelText('Pages to audit first'), { target: { value: '/pet-turf' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY_ADVANCED, pagesText: '/pet-turf' });
    expect(screen.getByRole('option', { name: 'Default (5)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeDisabled();
  });

  it('shows a summary when collapsed and Clear resets', () => {
    const onChange = vi.fn();
    render(<AdvancedOptions value={{ pagesText: '/a\n/b', onlyListed: false, skipText: '/blog/*', pageCount: '10' }} onChange={onChange} auditType="full" />);
    expect(screen.getByText('· 2 priority pages · skip /blog/* · 10 pages')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledWith(EMPTY_ADVANCED);
  });

  it('only-listed hides skip and page count', () => {
    render(<AdvancedOptions value={{ ...EMPTY_ADVANCED, pagesText: '/a', onlyListed: true }} onChange={() => {}} auditType="full" />);
    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.queryByLabelText('Skip pages matching')).toBeNull();
    expect(screen.queryByLabelText('Number of pages')).toBeNull();
  });
});
