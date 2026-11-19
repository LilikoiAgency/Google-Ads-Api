import { describe, it, expect } from 'vitest';
import { generateSeoReportHtml, seoReportFilename, stripConfirm, CLIENT_TOP } from '@/lib/seoAuditReportHtml';

const task = (n, o = {}) => ({
  id: `T${n}`, title: `Task ${n} [confirm: owner name]`, page: `/p${n}`, category: 'content', impact: 3, effort: 1, confidence: 'high',
  evidence: [`secret evidence ${n}`], change: `Exact change ${n}`, why: `Why ${n}`, ...o,
});

const RESULT = {
  version: 2, domain: 'acme.com', audit_type: 'full', audit_date: '2026-11-19',
  client_summary: 'Acme is <strong> on brand searches [confirm: check].',
  scores: { seo: { score: 5, reason: 'Cost guides 404' }, geo: { score: 4, reason: 'r' }, aeo: { score: 3, reason: 'r' } },
  top_moves: [{ headline: 'Bring back the cost guide', task: task(1) }],
  action_plan: [
    ...Array.from({ length: 11 }, (_, i) => task(i + 1)),
    { ...task(12), group: true, title: 'Remove keyword lists from 2 pages', page: 'multiple pages', items: [task(12.1, { id: 'T12.1', page: '/a' }), task(12.2, { id: 'T12.2', page: '/b' })] },
  ],
  data_gaps: ['Page speed unavailable.'],
  data_sources: { crawl: { status: 'ok', pages: 40 }, search_console: { status: 'ok' }, ga4: { status: 'no_property' } },
};

describe('seo audit report html', () => {
  it('client report: summary, scores, moves and the top 10 only, without evidence or confirm notes', () => {
    const html = generateSeoReportHtml(RESULT, { kind: 'client' });
    expect(html).toContain('<title>acme.com: SEO Audit</title>');
    expect(html).toContain('November 19, 2026 · 40 pages reviewed');
    expect(html).toContain('Acme is &lt;strong&gt; on brand searches.');
    expect(html).toContain('Bring back the cost guide');
    expect(html).toContain('Task 10');
    expect(html).not.toContain('Task 11');
    expect(html).toContain(`Plus ${RESULT.action_plan.length - CLIENT_TOP} more improvements`);
    expect(html).not.toMatch(/confirm:/i);
    expect(html).not.toContain('secret evidence');
    expect(html).not.toContain('Exact change');
    expect(html).not.toContain('Page speed unavailable');
    expect(html).not.toMatch(/<script/i);
    expect(html).toContain('Google Search Console');
    expect(html).not.toContain('Google Analytics.');
  });

  it('full plan: every task with change, evidence, group items and data gaps', () => {
    const html = generateSeoReportHtml(RESULT, { kind: 'full' });
    expect(html).toContain('<title>acme.com: SEO Action Plan</title>');
    expect(html).toContain('Task 11');
    expect(html).toContain('Exact change 11');
    expect(html).toContain('secret evidence 3');
    expect(html).toContain('Each page (2)');
    expect(html).toContain('T12.2');
    expect(html).toContain('2 pages');
    expect(html).toContain('Page speed unavailable.');
  });

  it('escapes task text', () => {
    const html = generateSeoReportHtml({ ...RESULT, action_plan: [task(1, { change: '<img src=x onerror=alert(1)>' })] }, { kind: 'full' });
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
  });

  it('names the file after the domain, kind and date', () => {
    expect(seoReportFilename(RESULT, { kind: 'client' })).toBe('acme.com SEO Audit - 2026-11-19.html');
    expect(seoReportFilename(RESULT, { kind: 'full' })).toBe('acme.com SEO Action Plan - 2026-11-19.html');
  });

  it('stripConfirm removes analyst notes', () => {
    expect(stripConfirm('Price is [confirm: price range] per sq ft.')).toBe('Price is per sq ft.');
  });
});

const REPUTATION = {
  locations: [
    { name: 'Acme <Dental>', city: 'Austin', source: 'places', coverage: 'sample', stats: { rating: 4.6, count: 120, coverage: 'sample', per_month: null, star_split: null, days_since_newest: null, reply_rate: null, sample_size: 5 } },
    { name: 'Acme Downtown', city: null, source: 'gbp', coverage: 'full', stats: { rating: 4.25, count: 1, coverage: 'full', per_month: 6.4, star_split: null, days_since_newest: 1, reply_rate: 0.5 } },
  ],
  themes: [
    { kind: 'praise', theme: 'Friendly staff', count: 4, location: 'Acme Downtown', quotes: ['Lovely <b>team</b>'] },
    { kind: 'complaint', theme: 'Long waits', count: 2, location: 'Acme Downtown', quotes: ['Waited an hour'] },
  ],
  search: { appear_count: 1, total: 2, summary: 'Found on brand searches.', queries: [
    { query: 'dentist austin', you_appear: false, others: ['Rival Dental', 'Other Co'] },
    { query: 'acme dental', you_appear: true, others: [] },
  ] },
  attribution: 'Source: Google reviews',
};

describe('seo audit report reputation', () => {
  it('report includes reputation section with attribution', () => {
    for (const kind of ['client', 'full']) {
      const html = generateSeoReportHtml({ ...RESULT, reputation: REPUTATION }, { kind });
      expect(html).toContain('Reputation');
      expect(html).toContain('Acme &lt;Dental&gt;');
      expect(html).toContain('4.6 ★ · 120 reviews · (5 sample reviews)');
      expect(html).toContain('Public data');
      expect(html).toContain('4.3 ★ · 1 review · ≈6/month · replies 50% · newest 1 day ago');
      expect(html).toContain('Managed');
      expect(html).toContain('Friendly staff (4)');
      expect(html).toContain('Lovely &lt;b&gt;team&lt;/b&gt;');
      expect(html).not.toContain('<b>team</b>');
      expect(html).toContain('Long waits (2)');
      expect(html).toContain('What a web search finds');
      expect(html).toContain('A web search run during this audit, not Google rankings.');
      expect(html).toContain('You appear in 1 of 2 searches');
      expect(html).toContain('Source: Google reviews');
      expect(html.indexOf('Reputation')).toBeGreaterThan(html.indexOf('Action plan by area'));
    }
  });

  it('sample size comes from the stats, singular for one, hidden when missing', () => {
    const withSample = (sample_size) => {
      const loc = { ...REPUTATION.locations[0], stats: { ...REPUTATION.locations[0].stats, sample_size } };
      return generateSeoReportHtml({ ...RESULT, reputation: { ...REPUTATION, locations: [loc] } }, { kind: 'client' });
    };
    expect(withSample(3)).toContain('(3 sample reviews)');
    expect(withSample(1)).toContain('(1 sample review)');
    expect(withSample(0)).not.toContain('sample review');
    expect(withSample(undefined)).not.toContain('sample review');
  });

  it('footer names Google reviews and the web search check only when they have data', () => {
    const on = generateSeoReportHtml({ ...RESULT, data_sources: { ...RESULT.data_sources, reviews: { status: 'ok' }, ai_search: { status: 'ok' } } }, { kind: 'client' });
    expect(on).toContain('Google reviews');
    expect(on).toContain('a web search check');
    const off = generateSeoReportHtml({ ...RESULT, data_sources: { ...RESULT.data_sources, reviews: { status: 'no_data' }, ai_search: { status: 'no_data' } } }, { kind: 'client' });
    expect(off).not.toContain('a web search check');
    expect(off.slice(off.indexOf('<footer>'))).not.toContain('Google reviews');
  });

  it('report omits reputation when absent', () => {
    const html = generateSeoReportHtml(RESULT, { kind: 'full' });
    expect(html).not.toContain('Reputation');
    expect(html).not.toContain('What a web search finds');
  });

  it('errored queries read could-not-check and are left out of the count', () => {
    const search = { appear_count: 1, total: 2, summary: null, queries: [
      { query: 'acme dental', you_appear: true, others: [] },
      { query: 'dentist waco', you_appear: false, error: 'x', others: ['Rival'] },
      { query: 'dentist austin', you_appear: false, others: [] },
    ] };
    const html = generateSeoReportHtml({ ...RESULT, reputation: { ...REPUTATION, search } }, { kind: 'client' });
    const block = html.slice(html.indexOf('What a web search finds'));
    expect(block).toContain('You appear in 1 of 2 searches');
    expect(block).toContain("couldn't check");
    expect(block.match(/aria-label="does not appear"/g)).toHaveLength(1);
    expect(block).not.toContain('Rival');
    const none = { appear_count: 0, total: 0, summary: null, queries: [{ query: 'x', you_appear: false, error: 'x', others: [] }] };
    const html2 = generateSeoReportHtml({ ...RESULT, reputation: { ...REPUTATION, search: none } }, { kind: 'client' });
    expect(html2).not.toContain('You appear in');
  });

  it('search rows show appear/not appear and no position', () => {
    const html = generateSeoReportHtml({ ...RESULT, reputation: REPUTATION }, { kind: 'client' });
    const block = html.slice(html.indexOf('What a web search finds'));
    expect(block).toContain('dentist austin');
    expect(block).toContain('does not appear');
    expect(block).toContain('Rival Dental, Other Co');
    expect(block).toContain('aria-label="appears"');
    expect(block).not.toMatch(/position|\brank\b/i);
  });
});
