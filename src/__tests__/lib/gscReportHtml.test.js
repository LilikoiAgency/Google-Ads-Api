import { describe, it, expect } from 'vitest';
import { generateSearchReportHtml, searchReportFilename } from '@/lib/gscReportHtml';
import { cleanAnnotations } from '@/lib/gscSettings';

const m = (clicks, impressions, position = 5) => ({ clicks, impressions, ctr: impressions ? clicks / impressions : 0, position });
function report(over = {}) {
  return {
    site: 'sc-domain:acme.com',
    type: 'web',
    range: { startDate: '2026-10-01', endDate: '2026-10-31' },
    compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
    hasQueries: true,
    totals: m(100, 5000, 12),
    totalsCompare: m(80, 4000, 14),
    trend: [{ date: '2026-10-01', ...m(4, 100) }],
    trendCompare: [{ date: '2026-09-01', ...m(3, 90) }],
    firstIncompleteDate: null,
    queries: [{ query: 'acme roofing', ...m(30, 300, 1.2), prev: m(20, 250) }, { query: 'roof repair</td><script>', ...m(1, 500, 7), prev: null }],
    pages: [{ page: 'https://acme.com/services', ...m(40, 1000), prev: null }],
    queryPages: [],
    devices: [{ device: 'Mobile', ...m(60, 3000), prev: null }],
    countries: [{ country: 'usa', ...m(90, 4000), prev: null }],
    appearance: [],
    brand: { terms: ['acme'], current: { branded: m(30, 300), nonBranded: m(50, 4000), anonymized: { clicks: 20, impressions: 700 } }, compare: null, trend: [] },
    sitemaps: [],
    ...over,
  };
}

describe('gscReportHtml', () => {
  it('builds a client report with KPIs, brand split, tables and opportunities', () => {
    const html = generateSearchReportHtml(report(), { brandTerms: ['acme'] });
    expect(html).toContain('acme.com: Google organic search, Oct 2026');
    expect(html).toContain('▲ 25% vs Sep 2026');
    expect(html).toContain('Branded vs non-branded searches');
    expect(html).toContain('<span class="tag">brand</span>');
    expect(html).toContain('/services');
    expect(html).toContain('United States');
    expect(html).toContain('Opportunities: searches close to the top');
  });

  it('escapes data and never includes internal-only sections', () => {
    const html = generateSearchReportHtml(report());
    expect(html).not.toContain('roof repair</td><script>');
    expect(html).toContain('roof repair&lt;/td&gt;&lt;script&gt;');
    expect(html).not.toMatch(/cannibal|Competing pages|Low-CTR|URL Inspection/i);
  });

  it('drops position for Discover and names the file', () => {
    const html = generateSearchReportHtml(report({ type: 'discover', hasQueries: false, queries: [], brand: null, devices: [] }));
    expect(html).not.toContain('Average position');
    expect(searchReportFilename(report())).toBe('acme.com Organic Search - Oct 2026.html');
    expect(searchReportFilename(report({ type: 'image' }))).toBe('acme.com Organic Search Image - Oct 2026.html');
  });

  it('cleans annotations', () => {
    expect(cleanAnnotations([{ date: '2026-10-05', label: ' Launch ' }, { date: 'bad', label: 'x' }, { date: '2026-10-01', label: '' }]))
      .toEqual([expect.objectContaining({ date: '2026-10-05', label: 'Launch' })]);
  });
});

describe('segmented download', () => {
  it('labels a non-branded report in the title, file name and note', () => {
    const r = { ...report(), segment: 'nonbrand' };
    const html = generateSearchReportHtml(r, { brandTerms: ['acme'] });
    expect(html).toContain('acme.com: Google organic search, non-branded searches, Oct 2026');
    expect(html).toContain('Figures cover non-branded searches only: searches not containing &quot;acme&quot;');
    expect(searchReportFilename(r)).toBe('acme.com Organic Search (Non-branded) - Oct 2026.html');
  });
});
