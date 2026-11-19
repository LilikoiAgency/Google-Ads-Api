// Search Console depth for the v2 audit: the page x query join, URL Inspection,
// Google's view of the submitted sitemaps, and the GA4 per-page join.
// Fetchers never throw; each returns a status from the shared vocabulary
// (ok | no_data | permission | error).

import { google } from 'googleapis';

const round = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const byClicksThenImpressions = (a, b) => b.clicks - a.clicks || b.impressions - a.impressions;

const httpStatus = (err) => err?.code ?? err?.status ?? err?.response?.status;
const isPermission = (err) => Number(httpStatus(err)) === 403;
const errMessage = (err) => err?.message || String(err);

// Search Console reports UTM variants (e.g. from Business Profile links) as
// separate pages; keep scheme + host + path so they merge into one page.
function stripQuery(page) {
  try {
    const u = new URL(page);
    return `${u.protocol}//${u.host}${u.pathname}`;
  } catch {
    return String(page).split(/[?#]/)[0];
  }
}

const addMetrics = (acc, r) => {
  acc.clicks += r.clicks || 0;
  acc.impressions += r.impressions || 0;
  acc.posWeight += (r.position || 0) * (r.impressions || 0);
};
const finishMetrics = (a) => ({
  clicks: a.clicks,
  impressions: a.impressions,
  ctr: a.impressions ? round(a.clicks / a.impressions, 4) : 0,
  position: a.impressions ? round(a.posWeight / a.impressions, 1) : 0,
});

// A domain property reports https://www.x.com/a, https://x.com/a and http://x.com/a
// as separate pages, though the extras just redirect. Key them as one page.
function variantKey(page) {
  try {
    const u = new URL(page);
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname}`;
  } catch {
    return page;
  }
}

function originOf(page) {
  try {
    return new URL(page).origin.toLowerCase();
  } catch {
    return '';
  }
}

const mostImpressions = (map) => [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

// Rows come from a ['page','query'] Search Console query (rowLimit 5000).
// Pages are query-free; rows for the same page (and same query) are merged,
// including the www / no-www / http versions of a page. A merged page is labelled
// with the site's main address (most impressions overall) when it has one.
export function joinPagesToQueries(pageQueryRows, { topPages = 25, perPage = 10 } = {}) {
  const pages = new Map();
  const originImpressions = new Map();
  for (const r of pageQueryRows || []) {
    const [rawPage, query] = r.keys || [];
    if (!rawPage) continue;
    const url = stripQuery(rawPage);
    const key = variantKey(url);
    let p = pages.get(key);
    if (!p) {
      p = { clicks: 0, impressions: 0, posWeight: 0, queries: new Map(), variants: new Map() };
      pages.set(key, p);
    }
    p.variants.set(url, (p.variants.get(url) || 0) + (r.impressions || 0));
    const origin = originOf(url);
    originImpressions.set(origin, (originImpressions.get(origin) || 0) + (r.impressions || 0));
    addMetrics(p, r);
    let q = p.queries.get(query);
    if (!q) {
      q = { query, clicks: 0, impressions: 0, posWeight: 0 };
      p.queries.set(query, q);
    }
    addMetrics(q, r);
  }
  const mainOrigin = mostImpressions(originImpressions);
  for (const p of pages.values()) {
    const onMain = new Map([...p.variants].filter(([u]) => originOf(u) === mainOrigin));
    p.page = mostImpressions(onMain.size ? onMain : p.variants);
  }
  return [...pages.values()]
    .sort(byClicksThenImpressions)
    .slice(0, topPages)
    .map((p) => ({
      page: p.page,
      ...finishMetrics(p),
      queries: [...p.queries.values()]
        .sort(byClicksThenImpressions)
        .slice(0, perPage)
        .map((q) => ({ query: q.query, ...finishMetrics(q) })),
    }));
}

function canonicalKey(u) {
  try {
    const url = new URL(u);
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}${url.search}`;
  } catch {
    return String(u).trim().replace(/\/+$/, '');
  }
}

// Accepts the urlInspection.index.inspect response data ({ inspectionResult }).
export function mapInspection(apiResult, url = apiResult?.url ?? null) {
  const result = apiResult?.inspectionResult || {};
  const idx = result.indexStatusResult || {};
  const google_canonical = idx.googleCanonical || null;
  const user_canonical = idx.userCanonical || null;
  return {
    url,
    verdict: idx.verdict || null,
    coverage_state: idx.coverageState || null,
    google_canonical,
    user_canonical,
    canonical_mismatch: !!(google_canonical && user_canonical && canonicalKey(google_canonical) !== canonicalKey(user_canonical)),
    last_crawl: idx.lastCrawlTime || null,
  };
}

// Inspects URLs a few at a time (quota: 2,000/day per property). Needs Owner or
// Full permission on the property; a 403 stops the run with status 'permission'.
export async function inspectUrls(auth, siteUrl, urls, { concurrency = 5 } = {}) {
  if (!urls?.length) return { status: 'no_data', results: [] };
  const sc = google.searchconsole({ version: 'v1', auth });
  const results = new Array(urls.length);
  let next = 0;
  let denied = null;
  const worker = async () => {
    while (!denied && next < urls.length) {
      const i = next++;
      const inspectionUrl = urls[i];
      try {
        const res = await sc.urlInspection.index.inspect({ requestBody: { inspectionUrl, siteUrl } });
        results[i] = mapInspection(res.data, inspectionUrl);
      } catch (err) {
        if (isPermission(err)) denied = err;
        results[i] = { url: inspectionUrl, error: errMessage(err) };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  if (denied) return { status: 'permission', results: [], error: errMessage(denied) };
  const done = results.filter(Boolean);
  if (done.length && done.every((r) => r.error)) return { status: 'error', results: done, error: done[0].error };
  return { status: 'ok', results: done };
}

const toNum = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

// Sitemaps as Google sees them (submitted in Search Console).
export async function listGoogleSitemaps(auth, siteUrl) {
  try {
    const res = await google.searchconsole({ version: 'v1', auth }).sitemaps.list({ siteUrl });
    const sitemaps = (res.data?.sitemap || []).map((s) => {
      const contents = s.contents || [];
      const indexedVals = contents.map((c) => toNum(c.indexed)).filter((n) => n !== null);
      const out = {
        path: s.path,
        submitted: contents.reduce((sum, c) => sum + (toNum(c.submitted) || 0), 0),
        lastDownloaded: s.lastDownloaded || null,
        errors: toNum(s.errors) || 0,
        warnings: toNum(s.warnings) || 0,
      };
      // Google stopped populating `indexed` (it now returns "0"); keep it only when real.
      const indexed = indexedVals.reduce((a, b) => a + b, 0);
      if (indexed > 0) out.indexed = indexed;
      return out;
    });
    return { status: sitemaps.length ? 'ok' : 'no_data', sitemaps };
  } catch (err) {
    return { status: isPermission(err) ? 'permission' : 'error', sitemaps: [], error: errMessage(err) };
  }
}

// GA4 landingPage values are paths (sometimes with a query string); pages may be
// full URLs. Key both by path without query or trailing slash.
function pathKey(page) {
  let path;
  try {
    path = new URL(page, 'https://placeholder.invalid').pathname;
  } catch {
    path = String(page).split(/[?#]/)[0];
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

// Per-page organic metrics from a TrafficReport. engagement_rate is null unless
// the landing page rows carry engagedSessions or engagementRate.
export function ga4PerPage(report, pages) {
  const agg = new Map();
  for (const p of report?.landingPages || []) {
    if (p.channel !== 'Organic Search') continue;
    const k = pathKey(p.page);
    const a = agg.get(k) || { sessions: 0, keyEvents: 0, engaged: 0, hasEngaged: false };
    a.sessions += p.sessions || 0;
    a.keyEvents += p.keyEvents || 0;
    if (Number.isFinite(p.engagedSessions)) {
      a.engaged += p.engagedSessions;
      a.hasEngaged = true;
    } else if (Number.isFinite(p.engagementRate)) {
      a.engaged += p.engagementRate * (p.sessions || 0);
      a.hasEngaged = true;
    }
    agg.set(k, a);
  }
  return (pages || []).map((page) => {
    const a = agg.get(pathKey(page));
    return {
      page,
      organic_sessions: a?.sessions || 0,
      engagement_rate: a?.hasEngaged && a.sessions ? round(a.engaged / a.sessions, 3) : null,
      key_events: a?.keyEvents || 0,
    };
  });
}
