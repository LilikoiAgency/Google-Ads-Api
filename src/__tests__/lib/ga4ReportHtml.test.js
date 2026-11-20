import { describe, it, expect } from 'vitest';
import { normalizeTrafficReport } from '@/lib/ga4Report';
import { generateTrafficReportHtml, reportFilename, formatDelta } from '@/lib/ga4ReportHtml';
import semper from '../fixtures/ga4/semper-oct-2026.json';
import empty from '../fixtures/ga4/empty.json';

const ctx = {
  property: { id: 'properties/349447933', name: 'Semper Solaris - GA4', account: 'Semper Solaris' },
  range: { startDate: '2026-10-01', endDate: '2026-10-31' },
  compareRange: { startDate: '2026-09-01', endDate: '2026-09-30' },
  granularity: 'day',
};
const report = normalizeTrafficReport(semper.reports, ctx);
const noCompare = normalizeTrafficReport(semper.reports, { ...ctx, compareRange: null });

// The inlined data blob, parsed back out of the page.
function dataOf(html) {
  const m = html.match(/const D=(\{.*?\});\n/s);
  return JSON.parse(m[1]);
}

describe('ga4ReportHtml', () => {
  it('includes title, all views and opens on the chosen view', () => {
    const html = generateTrafficReportHtml(report, { view: 'nonPaid', views: ['organic', 'nonPaid', 'paid', 'all'] });
    expect(html).toContain('Semper Solaris - GA4: Web Traffic, Oct 2026');
    for (const l of ['Organic search', 'All non-paid', 'Paid', 'Everything']) expect(html).toContain(l);
    expect(html).toMatch(/let mode\s*=\s*'nonPaid'/);
  });

  it('only external URLs are pinned Chart.js and Google Fonts', () => {
    const urls = generateTrafficReportHtml(report, { view: 'all' }).match(/https?:\/\/[^"')\s]+/g);
    for (const u of urls) expect(u).toMatch(/^https:\/\/(cdnjs\.cloudflare\.com\/ajax\/libs\/Chart\.js\/4\.4\.1\/|fonts\.googleapis\.com|fonts\.gstatic\.com)/);
  });

  it('omits internal warnings', () => {
    const html = generateTrafficReportHtml({ ...report, warnings: ['UNTAGGED-PAID-XYZ'] }, { view: 'all' });
    expect(html).not.toContain('UNTAGGED-PAID-XYZ');
  });

  it('escapes property name and page paths', () => {
    const evil = { ...report, property: { ...report.property, name: 'A&B <script>x</script>' } };
    const html = generateTrafficReportHtml(evil, { view: 'all' });
    expect(html).toContain('A&amp;B &lt;script&gt;');
    expect(html).not.toContain('<script>x</script>');
  });

  it('filename', () => { expect(reportFilename(report)).toBe('Semper Solaris - GA4 Web Traffic - Oct 2026.html'); });

  it('filename strips characters Windows rejects', () => {
    const r = { ...report, property: { ...report.property, name: 'A/B: "C"*?<>|\\' } };
    expect(reportFilename(r)).toBe('AB C Web Traffic - Oct 2026.html');
  });

  it('inlines data for all 4 views with < escaped', () => {
    const r = JSON.parse(JSON.stringify(report));
    r.landingPages.unshift({ page: '/x</script><img src=x>', channel: 'Direct', bucket: 'otherNonPaid', sessions: 1e9, users: 1, keyEvents: 0 });
    const html = generateTrafficReportHtml(r, { view: 'all', views: ['organic', 'nonPaid', 'paid', 'all'] });
    expect(html).not.toContain('</script><img');
    const D = dataOf(html);
    expect(Object.keys(D.views)).toEqual(['organic', 'nonPaid', 'paid', 'all']);
    expect(D.views.all.pages[0].page).toBe('/x</script><img src=x>');
    expect(D.views.all.pages.length).toBeLessThanOrEqual(15);
    expect(D.views.all.sources.length).toBeLessThanOrEqual(15);
    expect(D.views.organic.rows.map((x) => x.channel)).toEqual(['Organic Search']);
    expect(D.views.all.total.label).toBe('Total (unique users)');
    expect(D.views.all.total.users).toBe(report.totalsByView.all.users.toLocaleString('en-US'));
  });

  it('chart series use the shared channel colors', () => {
    const D = dataOf(generateTrafficReportHtml(report, { view: 'organic' }));
    expect(D.views.organic.datasets[0]).toMatchObject({ label: 'Organic Search', color: '#2f7d32' });
    expect(D.labels).toEqual(report.series.labels);
  });

  it('KPIs carry deltas vs the comparison label', () => {
    const D = dataOf(generateTrafficReportHtml(report, { view: 'all' }));
    const labels = D.views.all.kpis.map((k) => k.label);
    expect(labels.slice(0, 4)).toEqual(['Users', 'Sessions', 'New users', 'Engagement rate']);
    for (const k of D.views.all.kpis) expect(k.delta).toMatch(/(vs Sep 2026|^—$)/);
    expect(D.views.all.kpis[3].delta).toMatch(/pts|—/);
    expect(D.compareLabel).toBe('Sep 2026');
  });

  it('without a comparison there are no delta lines', () => {
    const html = generateTrafficReportHtml(noCompare, { view: 'all' });
    const D = dataOf(html);
    expect(D.compareLabel).toBeNull();
    for (const k of D.views.all.kpis) expect(k.delta).toBeNull();
    expect(html).not.toContain('Compared with');
    expect(html).toContain('Source: Google Analytics 4, Session primary channel group, Oct 2026. Users are unique visitors');
  });

  it('source note names the comparison and the chart granularity', () => {
    const html = generateTrafficReportHtml(report, { view: 'all' });
    expect(html).toContain('Source: Google Analytics 4, Session primary channel group, Oct 2026. Compared with Sep 2026. Users are unique visitors for the whole period; the chart counts users per day, so someone who visits in several periods appears in each.');
    const weekly = generateTrafficReportHtml({ ...report, granularity: 'week' }, { view: 'all' });
    expect(weekly).toContain('counts users per week');
  });

  it('hides key events when zero in both periods', () => {
    const r = JSON.parse(JSON.stringify(report));
    for (const k of Object.keys(r.totalsByView)) {
      r.totalsByView[k].keyEvents = 0;
      r.totalsByViewCompare[k].keyEvents = 0;
    }
    const D = dataOf(generateTrafficReportHtml(r, { view: 'all' }));
    expect(D.views.all.kpis.map((k) => k.label)).not.toContain('Key events');
    expect(D.views.all.showKeyEvents).toBe(false);
  });

  it('key events column follows the whole property, not the view', () => {
    const r = JSON.parse(JSON.stringify(report));
    r.totalsByView.all.keyEvents = 5;
    r.totalsByViewCompare.all.keyEvents = 0;
    r.totalsByView.paid.keyEvents = 0;
    r.totalsByViewCompare.paid.keyEvents = 0;
    const D = dataOf(generateTrafficReportHtml(r, { view: 'paid' }));
    expect(D.views.paid.showKeyEvents).toBe(true);
    for (const k of Object.keys(r.totalsByView)) {
      r.totalsByView[k].keyEvents = k === 'paid' ? 3 : 0;
      r.totalsByViewCompare[k].keyEvents = 0;
    }
    expect(dataOf(generateTrafficReportHtml(r, { view: 'paid' })).views.paid.showKeyEvents).toBe(false);
  });

  it('labels landing-page users as approximate and explains why', () => {
    const html = generateTrafficReportHtml(report, { view: 'all' });
    expect(html).toContain('<th>Users (approx.)</th>');
    expect(html).toContain('Landing-page and city users are added up across channels, so someone who arrived through two channels counts twice there.');
  });

  it('discloses sampled / grouped / thresholded data, never the suspected-paid text', () => {
    const SENTENCE = 'Google Analytics sampled or grouped some of this data, so small numbers may be approximate.';
    const clean = { ...report, dataQuality: { sampled: false, otherRow: false, thresholded: false } };
    expect(generateTrafficReportHtml(clean, { view: 'all' })).not.toContain(SENTENCE);
    for (const flag of ['sampled', 'otherRow', 'thresholded']) {
      const r = { ...clean, dataQuality: { ...clean.dataQuality, [flag]: true }, warnings: ['~5 sessions labeled X look like paid ads'] };
      const html = generateTrafficReportHtml(r, { view: 'all' });
      expect(html).toContain(SENTENCE);
      expect(html).not.toContain('look like paid ads');
    }
  });

  it('empty report renders with zeros and dashes, never NaN', () => {
    const r = normalizeTrafficReport(empty.reports, ctx);
    const html = generateTrafficReportHtml(r, { view: 'paid' });
    expect(html).not.toMatch(/NaN|Infinity|undefined/);
    const D = dataOf(html);
    expect(D.views.paid.kpis[0]).toMatchObject({ value: '0', delta: '—' });
  });

  it('formats deltas', () => {
    expect(formatDelta(0.123, { vs: 'Sep 2026' })).toBe('▲ 12% vs Sep 2026');
    expect(formatDelta(-0.03)).toBe('▼ 3%');
    expect(formatDelta(-0.011, { pts: true })).toBe('▼ 1.1 pts');
    expect(formatDelta(12.5)).toBe('▲ 1,250%');
    expect(formatDelta(0.001)).toBe('0%');
    expect(formatDelta(null, { vs: 'Sep 2026' })).toBe('—');
  });

  it('rejects an unknown view', () => {
    expect(() => generateTrafficReportHtml(report, { view: 'nope' })).toThrow();
  });

  describe('choosing which views go in the file', () => {
    it('defaults to only the chosen view, with no toggle', () => {
      const html = generateTrafficReportHtml(report, { view: 'nonPaid' });
      expect(Object.keys(dataOf(html).views)).toEqual(['nonPaid']);
      expect(html).not.toContain('class="toggle"');
      expect(html).not.toContain('data-v="paid"');
    });

    it('a single non-paid view carries no paid numbers at all', () => {
      const paidChannels = report.channels.filter((c) => c.bucket === 'paid').map((c) => c.channel);
      expect(paidChannels.length).toBeGreaterThan(0);
      const D = dataOf(generateTrafficReportHtml(report, { view: 'organic', views: ['organic'] }));
      const json = JSON.stringify(D);
      for (const ch of paidChannels) expect(json).not.toContain(ch);
      expect(D.views.all).toBeUndefined();
    });

    it('includes only the chosen subset, in standard order, with a toggle', () => {
      const html = generateTrafficReportHtml(report, { view: 'nonPaid', views: ['nonPaid', 'organic'] });
      expect(Object.keys(dataOf(html).views)).toEqual(['organic', 'nonPaid']);
      expect(html).toContain('class="toggle"');
      expect(html).toContain('data-v="organic"');
      expect(html).not.toContain('data-v="paid"');
      expect(html).not.toContain('data-v="all"');
      expect(html).toMatch(/let mode\s*=\s*'nonPaid'/);
    });

    it('always includes the view it opens on', () => {
      const D = dataOf(generateTrafficReportHtml(report, { view: 'paid', views: ['organic'] }));
      expect(Object.keys(D.views)).toEqual(['organic', 'paid']);
    });

    it('rejects unknown view keys in the list', () => {
      expect(() => generateTrafficReportHtml(report, { view: 'all', views: ['all', 'nope'] })).toThrow();
    });

    it('names a single-view file after its view', () => {
      expect(reportFilename(report, { views: ['organic'] })).toBe('Semper Solaris - GA4 Web Traffic (Organic search) - Oct 2026.html');
      expect(reportFilename(report, { views: ['paid'] })).toBe('Semper Solaris - GA4 Web Traffic (Paid) - Oct 2026.html');
      expect(reportFilename(report, { views: ['all'] })).toBe('Semper Solaris - GA4 Web Traffic - Oct 2026.html');
      expect(reportFilename(report, { views: ['organic', 'paid'] })).toBe('Semper Solaris - GA4 Web Traffic - Oct 2026.html');
    });

    it('puts a single view in the page title', () => {
      expect(generateTrafficReportHtml(report, { view: 'organic' }))
        .toContain('<title>Semper Solaris - GA4: Web Traffic (Organic search), Oct 2026</title>');
    });
  });
});
