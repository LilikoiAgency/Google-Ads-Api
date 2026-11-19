// Real-traffic context for the SEO audit: finds the audited domain's Search
// Console site and GA4 property, pulls the last 90 days (vs the 90 before),
// and boils it down to compact summaries the audit model can reason over.
// Everything here is best-effort: a missing source never fails the audit.

import { google } from 'googleapis';
import { createAuthedGscClient } from './gscClient';
import { listProperties, listWebStreams, fetchTrafficReport } from './ga4Client';
import { getCached, setCached } from './serverCache';

const DAY = 86400000;
const round = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : 0);
const pctChange = (cur, prev) => (prev > 0 ? round(((cur - prev) / prev) * 100) : null);
const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);

export function normalizeDomain(input) {
  return String(input || '')
    .toLowerCase()
    .replace(/^sc-domain:/, '')
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .split(/[/?#:]/)[0];
}

// Search Console site for a domain: the domain property first, then URL-prefix ones.
export function pickGscSite(domain, siteUrls) {
  const d = normalizeDomain(domain);
  const candidates = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  return candidates.find((c) => siteUrls.includes(c)) || null;
}

export function streamMatchesDomain(uri, domain) {
  if (!uri) return false;
  return normalizeDomain(uri) === normalizeDomain(domain);
}

// Branded = the query contains the brand (domain name without TLD), or a run of
// 2+ consecutive words that together spell part of it ("big bully" in "bigbullyturf").
export function isBrandedQuery(query, domain) {
  const root = normalizeDomain(domain).split('.')[0];
  if (!root) return false;
  const words = String(query || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.join('').includes(root)) return true;
  for (let i = 0; i < words.length; i++) {
    let run = words[i];
    for (let j = i + 1; j < words.length; j++) {
      run += words[j];
      if (run.length >= 6 && root.includes(run)) return true;
    }
    if (words[i].length >= 6 && root === words[i]) return true;
  }
  return false;
}

// Last 90 days ending 4 days ago (Search Console data lags 2-3 days), plus the 90 days before.
export function auditRanges(today) {
  const t = Date.parse(`${today}T00:00:00Z`);
  const end = t - 4 * DAY;
  const start = end - 89 * DAY;
  return {
    current: { startDate: ymd(start), endDate: ymd(end) },
    previous: { startDate: ymd(start - 90 * DAY), endDate: ymd(start - DAY) },
  };
}

const queryRow = (r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr, 3), position: round(r.position, 1) });

export function summarizeGsc({ site, domain, ranges, queryRows, pageRows, totals, prevTotals }) {
  let branded = 0;
  let nonbranded = 0;
  for (const r of queryRows) {
    if (isBrandedQuery(r.keys[0], domain)) branded += r.clicks;
    else nonbranded += r.clicks;
  }
  const brandedTotal = branded + nonbranded;
  const byImpressions = [...queryRows].sort((a, b) => b.impressions - a.impressions);
  return {
    site,
    range: ranges.current,
    compare_range: ranges.previous,
    totals: {
      clicks: totals.clicks,
      impressions: totals.impressions,
      ctr: round(totals.ctr, 3),
      avg_position: round(totals.position, 1),
      clicks_change_pct: pctChange(totals.clicks, prevTotals?.clicks),
      impressions_change_pct: pctChange(totals.impressions, prevTotals?.impressions),
      avg_position_prev: prevTotals ? round(prevTotals.position, 1) : null,
    },
    branded_split: {
      branded_clicks: branded,
      nonbranded_clicks: nonbranded,
      branded_click_share: brandedTotal ? round(branded / brandedTotal, 3) : null,
      note: 'Computed from the top 1,000 queries; Google hides some rare queries.',
    },
    top_queries: [...queryRows].sort((a, b) => b.clicks - a.clicks).slice(0, 25).map(queryRow),
    striking_distance: byImpressions.filter((r) => r.position >= 4 && r.position <= 20).slice(0, 15).map(queryRow),
    low_ctr_page_one: byImpressions.filter((r) => r.position <= 10 && r.impressions >= 100 && r.ctr < 0.02).slice(0, 10).map(queryRow),
    top_pages: pageRows.slice(0, 15).map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: round(r.ctr, 3), position: round(r.position, 1) })),
  };
}

export function summarizeGa4(report) {
  const all = report.totalsByView.all;
  const org = report.totalsByView.organic;
  const allPrev = report.totalsByViewCompare?.all;
  const orgPrev = report.totalsByViewCompare?.organic;
  return {
    property: report.property.name,
    range: report.range,
    compare_range: report.compareRange,
    all_traffic: {
      users: all.users, sessions: all.sessions, key_events: all.keyEvents, engagement_rate: round(all.engagementRate, 3),
      sessions_change_pct: pctChange(all.sessions, allPrev?.sessions),
    },
    organic_search: {
      users: org.users, sessions: org.sessions, key_events: org.keyEvents, engagement_rate: round(org.engagementRate, 3),
      sessions_change_pct: pctChange(org.sessions, orgPrev?.sessions),
      key_events_change_pct: pctChange(org.keyEvents, orgPrev?.keyEvents),
    },
    organic_share_of_sessions: all.sessions ? round(org.sessions / all.sessions, 3) : null,
    channels: report.channels.slice(0, 10).map((c) => ({
      channel: c.channel,
      sessions: c.current.sessions,
      users: c.current.users,
      key_events: c.current.keyEvents,
      engagement_rate: round(c.current.engagementRate, 3),
      sessions_change_pct: pctChange(c.current.sessions, c.compare?.sessions),
    })),
    organic_landing_pages: report.landingPages
      .filter((p) => p.channel === 'Organic Search')
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 15)
      .map((p) => ({ page: p.page, sessions: p.sessions, users: p.users, key_events: p.keyEvents })),
    key_events_configured: (all.keyEvents || 0) > 0 || (allPrev?.keyEvents || 0) > 0,
    data_quality: report.dataQuality || null,
  };
}

// ── fetchers ──────────────────────────────────────────────────────────────────

async function gscSites(auth) {
  const res = await google.webmasters({ version: 'v3', auth }).sites.list();
  return (res.data.siteEntry || []).map((s) => s.siteUrl);
}

// The Search Console site for a domain plus the authed client to query it with.
// status: ok | not_connected | no_site. Throws only on an API failure.
export async function findGscSite(domain) {
  const auth = await createAuthedGscClient();
  if (!auth) return { status: 'not_connected', site: null, auth: null };
  const site = pickGscSite(domain, await gscSites(auth));
  if (!site) return { status: 'no_site', site: null, auth };
  return { status: 'ok', site, auth };
}

async function fetchGscSummary(domain, ranges) {
  const { status, site, auth } = await findGscSite(domain);
  if (status !== 'ok') return { status };
  const wm = google.webmasters({ version: 'v3', auth });
  const query = (range, dimensions, rowLimit) =>
    wm.searchanalytics.query({ siteUrl: site, requestBody: { ...range, dimensions, rowLimit } }).then((r) => r.data.rows || []);
  const [queryRows, pageRows, tot, prevTot] = await Promise.all([
    query(ranges.current, ['query'], 1000),
    query(ranges.current, ['page'], 50),
    query(ranges.current, [], 1),
    query(ranges.previous, [], 1),
  ]);
  if (!tot[0] || !tot[0].impressions) return { status: 'no_data', site };
  return { status: 'ok', site, data: summarizeGsc({ site, domain, ranges, queryRows, pageRows, totals: tot[0], prevTotals: prevTot[0] }) };
}

export async function findGa4Property(domain) {
  let streams = await getCached('ga4:webstreams');
  if (!streams) {
    const props = await listProperties();
    streams = await listWebStreams(props);
    await setCached('ga4:webstreams', streams, 6 * 60 * 60 * 1000);
  }
  // Prefer the property with the most recent stream if several match.
  return streams.find((s) => streamMatchesDomain(s.uri, domain)) || null;
}

async function fetchGa4Summary(domain, ranges) {
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
  if (!report.totalsByView.all.sessions) return { status: 'no_data', property: match.propertyName };
  return { status: 'ok', property: match.propertyName, data: summarizeGa4(report) };
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out`)), ms)),
  ]);
}

// Gathers both sources in parallel. Never throws; each source reports a status:
// ok | not_connected | no_site / no_property | no_data | error.
export async function gatherSiteData(domain, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const ranges = auditRanges(today);
  const settle = (p, label) => withTimeout(p, 30000, label).catch((err) => {
    console.warn(`[seo-audit] ${label} unavailable:`, err?.message || err);
    return { status: 'error' };
  });
  const [gsc, ga4] = await Promise.all([
    settle(fetchGscSummary(domain, ranges), 'Search Console'),
    settle(fetchGa4Summary(domain, ranges), 'GA4'),
  ]);
  return {
    gsc: gsc.status === 'ok' ? gsc.data : null,
    ga4: ga4.status === 'ok' ? ga4.data : null,
    sources: {
      search_console: { status: gsc.status, site: gsc.site || null },
      ga4: { status: ga4.status, property: ga4.property || null },
      range: ranges.current,
    },
  };
}
