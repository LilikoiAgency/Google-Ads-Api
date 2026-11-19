// Gather step for SEO Audit v2: pulls every data source in parallel, each with
// its own timeout, and reports anything missing as an explicit data gap.
// gatherAll never throws.

import { google } from 'googleapis';
import { findGscSite, findGa4Property, summarizeGsc, summarizeGa4, auditRanges } from '../seoAuditData';
import { fetchTrafficReport } from '../ga4Client';
import { joinPagesToQueries, inspectUrls, listGoogleSitemaps, ga4PerPage } from './gsc';
import { fetchPageSpeed } from './pagespeed';
import { filterSkipped } from './options';

export const AUDIT_PROFILES = {
  quick: { pages: 5, inspect: 5, pagespeed: 2, effort: 'medium' },
  full: { pages: 50, inspect: 20, pagespeed: 5, effort: 'high' },
};

const SOURCE_TIMEOUT_MS = 60000;
const TIMEOUT = Symbol('timeout');

const profileOf = (profile) => AUDIT_PROFILES[profile] || AUDIT_PROFILES.quick;
const errText = (err) => err?.message || String(err);
const today = () => new Date().toISOString().slice(0, 10);

function withTimeout(promise, ms = SOURCE_TIMEOUT_MS) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(TIMEOUT), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Runs fn under the timeout and always resolves to a { status, ... } object.
async function settle(fn) {
  try {
    return await withTimeout(Promise.resolve().then(fn));
  } catch (err) {
    if (err === TIMEOUT) return { status: 'timeout' };
    return { status: 'error', error: errText(err) };
  }
}

// findGscSite can throw on a sites.list failure; turn that into a status.
async function safeFindGscSite(domain) {
  try {
    return await withTimeout(findGscSite(domain));
  } catch (err) {
    if (err === TIMEOUT) return { status: 'timeout', site: null, auth: null };
    return { status: 'error', site: null, auth: null, error: errText(err) };
  }
}

const pageQueryRows = (auth, site, range) =>
  google.webmasters({ version: 'v3', auth }).searchanalytics
    .query({ siteUrl: site, requestBody: { ...range, dimensions: ['page', 'query'], rowLimit: 5000 } })
    .then((r) => r.data.rows || []);

export const SEED_TIMEOUT_MS = 30000;

// Top Search Console pages (query-free URLs) to seed the crawl, or [] (also
// when Search Console takes longer than SEED_TIMEOUT_MS).
export async function seedPages(domain, profile = 'quick', count) {
  try {
    return await withTimeout((async () => {
      const { status, site, auth } = await findGscSite(domain);
      if (status !== 'ok') return [];
      const rows = await pageQueryRows(auth, site, auditRanges(today()).current);
      const n = count || (profile === 'full' ? 25 : 5);
      return joinPagesToQueries(rows, { topPages: n, perPage: 1 }).map((p) => p.page);
    })(), SEED_TIMEOUT_MS);
  } catch (err) {
    console.warn('[seo-audit-v2] seedPages failed:', err === TIMEOUT ? 'timed out' : errText(err));
    return [];
  }
}

async function fetchGsc({ site, auth, domain, ranges }) {
  const wm = google.webmasters({ version: 'v3', auth });
  const query = (range, dimensions, rowLimit) =>
    wm.searchanalytics.query({ siteUrl: site, requestBody: { ...range, dimensions, rowLimit } }).then((r) => r.data.rows || []);
  const [queryRows, pageRows, tot, prevTot, pqRows] = await Promise.all([
    query(ranges.current, ['query'], 1000),
    query(ranges.current, ['page'], 50),
    query(ranges.current, [], 1),
    query(ranges.previous, [], 1),
    pageQueryRows(auth, site, ranges.current),
  ]);
  if (!tot[0] || !tot[0].impressions) return { status: 'no_data' };
  return {
    status: 'ok',
    gsc: summarizeGsc({ site, domain, ranges, queryRows, pageRows, totals: tot[0], prevTotals: prevTot[0] }),
    gscPages: joinPagesToQueries(pqRows, { topPages: 25, perPage: 10 }),
  };
}

async function fetchGa4(domain, ranges) {
  if (!process.env.GA4_SA_KEY) return { status: 'not_connected' };
  const match = await findGa4Property(domain);
  if (!match) return { status: 'no_property' };
  const report = await fetchTrafficReport({
    property: { id: match.propertyId, name: match.propertyName, account: match.account },
    startDate: ranges.current.startDate,
    endDate: ranges.current.endDate,
    compare: 'prev',
    granularity: 'month',
  });
  if (!report.totalsByView.all.sessions) return { status: 'no_data' };
  return { status: 'ok', report, ga4: summarizeGa4(report) };
}

const crawlUrls = (crawl) => (crawl?.pages_crawled || []).map((p) => p.final_url || p.url).filter(Boolean);

const emptyData = () => ({ gsc: null, gscPages: null, inspection: null, googleSitemaps: null, ga4: null, ga4Pages: null, pagespeed: null });

const blocked = (s) => ({ status: s.status, error: s.error });

async function runPageSpeed(urls) {
  if (!urls.length) return { status: 'no_data', results: [] };
  const results = await Promise.all(urls.map((u) => withTimeout(fetchPageSpeed(u)).catch((err) => (
    err === TIMEOUT ? { status: 'timeout', url: u } : { status: 'error', url: u, error: errText(err) }))));
  return { status: 'ok', results };
}

// priorityUrls (listed by the user) are inspected and speed-tested first; skip
// patterns drop Search Console pages; onlyListed limits targets to the crawl.
export async function gatherAll({ domain, crawl, profile = 'quick', priorityUrls = [], onlyListed = false, skip = [] } = {}) {
  try {
    const prof = profileOf(profile);
    const ranges = auditRanges(today());

    const siteP = safeFindGscSite(domain);
    const gscP = siteP.then((s) => (s.status === 'ok' ? settle(() => fetchGsc({ ...s, domain, ranges })) : blocked(s)));
    const sitemapsP = siteP.then((s) => (s.status === 'ok' ? settle(() => listGoogleSitemaps(s.auth, s.site)) : blocked(s)));
    const targetsP = gscP.then((g) => {
      const fromGsc = filterSkipped((g.gscPages || []).map((p) => p.page), skip);
      const base = onlyListed || !fromGsc.length ? crawlUrls(crawl) : fromGsc;
      return [...new Set([...(priorityUrls || []), ...base])];
    });
    const inspectionP = Promise.all([siteP, targetsP]).then(([s, urls]) => (s.status === 'ok'
      ? settle(() => inspectUrls(s.auth, s.site, urls.slice(0, prof.inspect), { concurrency: 5 }))
      : blocked(s)));
    const ga4P = settle(() => fetchGa4(domain, ranges));
    const pagespeedP = targetsP.then((urls) => runPageSpeed(urls.slice(0, prof.pagespeed)));

    const [gsc, sitemaps, inspection, ga4, pagespeed, targets] = await Promise.all([gscP, sitemapsP, inspectionP, ga4P, pagespeedP, targetsP]);

    const data = emptyData();
    const gaps = [];
    const gap = (source, status, detail = '') => gaps.push({ source, status, detail });

    if (gsc.status === 'ok') {
      data.gsc = gsc.gsc;
      data.gscPages = gsc.gscPages;
    } else gap('search_console', gsc.status, gsc.error || '');

    if (inspection.status === 'ok') data.inspection = inspection.results;
    else gap('url_inspection', inspection.status, inspection.error || '');

    if (sitemaps.status === 'ok') data.googleSitemaps = sitemaps.sitemaps;
    else gap('sitemaps', sitemaps.status, sitemaps.error || '');

    if (ga4.status === 'ok') {
      data.ga4 = ga4.ga4;
      try {
        data.ga4Pages = ga4PerPage(ga4.report, targets);
      } catch (err) {
        data.ga4Pages = null;
        gap('ga4', 'error', errText(err));
      }
    } else gap('ga4', ga4.status, ga4.error || '');

    if (pagespeed.status !== 'ok') gap('pagespeed', pagespeed.status, pagespeed.error || '');
    else {
      const ok = pagespeed.results.filter((r) => r.status === 'ok');
      if (ok.length) data.pagespeed = ok;
      let quotaSeen = false;
      for (const r of pagespeed.results.filter((x) => x.status !== 'ok')) {
        if (r.status === 'error' && /HTTP 429/.test(r.error || '')) {
          if (!quotaSeen) gap('pagespeed', 'error', r.error);
          quotaSeen = true;
        } else if (r.status === 'timeout') gap('pagespeed', 'timeout', r.url);
        else gap('pagespeed', r.status, `${r.url}: ${r.error || ''}`);
      }
    }
    return { data, gaps };
  } catch (err) {
    return { data: emptyData(), gaps: [{ source: 'gather', status: 'error', detail: errText(err) }] };
  }
}

const SOURCE_LABEL = {
  search_console: 'Search Console data',
  url_inspection: "Google's index status for each page",
  sitemaps: "Google's sitemap report",
  ga4: 'Google Analytics data',
  pagespeed: 'Page speed',
  gather: 'Search and analytics data',
};

const REASON = {
  not_connected: 'this source is not connected.',
  no_site: 'this website is not in a Search Console account we can access.',
  no_property: 'no Google Analytics property was found for this website.',
  no_data: 'no data was returned for the period.',
  permission: "our Search Console access doesn't cover this website.",
  timeout: 'the request took too long.',
};

export function describeGaps(gaps) {
  return (gaps || []).map(({ source, status, detail }) => {
    if (source === 'pagespeed') {
      if (status === 'timeout') return `Page speed timed out for ${detail || 'a page'}.`;
      if (/HTTP 429/.test(detail || '')) {
        return 'Page speed is unavailable because the free PageSpeed quota ran out; adding a PAGESPEED_API_KEY fixes it.';
      }
    }
    if (source === 'ga4' && status === 'no_property') return 'No Google Analytics property was found for this website.';
    const label = SOURCE_LABEL[source] || source;
    let reason = REASON[status];
    if (source === 'ga4' && status === 'not_connected') reason = 'Google Analytics is not connected.';
    if (source === 'search_console' && status === 'not_connected') reason = 'Search Console is not connected.';
    if (source === 'url_inspection' && status === 'no_data') reason = 'there were no pages to inspect.';
    if (source === 'sitemaps' && status === 'no_data') reason = 'no sitemaps are submitted in Search Console.';
    // The raw error stays on the job (data.gaps); the sentence stays plain.
    if (!reason) reason = 'it could not be loaded.';
    return `${label} unavailable: ${reason}`;
  });
}
