// Target keywords data for SEO Audit v2: monthly searches from Google Ads
// Keyword Planner (called from the agency's manager account) joined with the
// Search Console page/query rows the gather step already fetched.

import { GoogleAdsApi, enums } from 'google-ads-api';
import { getCredentials } from '../dbFunctions';
import { pathKey } from './tasks';
import { normKeyword } from './targets';

export const MAX_IDEAS = 25;
const IDEA_PAGE_SIZE = 60;
const MAX_SEEDS = 10; // Keyword Planner seeds at most 20 keywords; fewer keeps ideas on topic
const PAGE_QUERIES = 25;
const ROWS_PER_KEYWORD = 3;
const US = { id: 'geoTargetConstants/2840', name: 'United States' };
const ENGLISH = 'languageConstants/1000';

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const COMPETITION = { LOW: 'low', MEDIUM: 'medium', HIGH: 'high', 2: 'low', 3: 'medium', 4: 'high' };
const competitionOf = (v) => COMPETITION[v] ?? null;

const round1 = (n) => Math.round(n * 10) / 10;

// Raw Search Console rows ({ keys: [page, query], clicks, impressions, position })
// -> per-path query lists and per-query page lists. Variants of one page
// (www / no-www) share a path and are merged.
export function indexGscRows(rows) {
  const byPath = new Map();
  const byQuery = new Map();
  const add = (map, k1, k2, label, r) => {
    if (!map.has(k1)) map.set(k1, new Map());
    const m = map.get(k1);
    const cur = m.get(k2) || { [label]: k2, clicks: 0, impressions: 0, posWeight: 0 };
    cur.clicks += r.clicks || 0;
    cur.impressions += r.impressions || 0;
    cur.posWeight += (r.position || 0) * (r.impressions || 0);
    m.set(k2, cur);
  };
  for (const r of rows || []) {
    const [page, query] = r.keys || [];
    if (!page || !query) continue;
    const path = pathKey(page);
    add(byPath, path, query, 'query', r);
    add(byQuery, normKeyword(query), path, 'page', r);
  }
  const finish = (m) => [...m.values()]
    .map(({ posWeight, ...x }) => ({ ...x, position: x.impressions ? round1(posWeight / x.impressions) : null }))
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
  return {
    pageQueries: (path) => finish(byPath.get(path) || new Map()).slice(0, PAGE_QUERIES),
    keywordPages: (kw) => finish(byQuery.get(normKeyword(kw)) || new Map()).slice(0, ROWS_PER_KEYWORD),
  };
}

// Keyword Planner result -> { keyword, volume, competition } (volume null when Google has none).
function metricRow(text, metrics) {
  return { keyword: text, volume: num(metrics?.avg_monthly_searches), competition: competitionOf(metrics?.competition) };
}

// targets: [{ url, keywords }] from the audit options. city: { city, region } or null.
// gscRows: raw page/query rows, or null when Search Console is unavailable.
// -> { status: 'ok', keywords } | { status, error }
export async function fetchKeywordData({ targets, gscRows = null, city = null, client = null } = {}) {
  if (!targets?.length) return { status: 'no_data' };
  const cred = await getCredentials();
  if (!cred?.developer_token || !cred?.customer_id) return { status: 'not_connected' };
  const customerId = String(cred.customer_id).replace(/-/g, '');
  const api = client || new GoogleAdsApi({ client_id: cred.client_id, client_secret: cred.client_secret, developer_token: cred.developer_token });
  const customer = api.Customer({ customer_id: customerId, refresh_token: cred.refresh_token, login_customer_id: customerId });

  const geo = (await findGeo(customer, city)) || US;
  const base = {
    customer_id: customerId,
    language: ENGLISH,
    geo_target_constants: [geo.id],
    keyword_plan_network: enums.KeywordPlanNetwork.GOOGLE_SEARCH,
  };
  const gsc = gscRows ? indexGscRows(gscRows) : null;
  const withGsc = (row) => ({ ...row, search_console: gsc ? gsc.keywordPages(row.keyword) : null });

  const out = [];
  // One page at a time: Keyword Planner has a low request rate limit.
  for (const t of targets) {
    const path = pathKey(t.url);
    const given = (t.keywords || []).map(normKeyword).filter(Boolean);
    const pageQueries = gsc ? gsc.pageQueries(path) : null;

    let givenRows = [];
    if (given.length) {
      const res = await customer.keywordPlanIdeas.generateKeywordHistoricalMetrics({ ...base, keywords: given });
      const byText = new Map();
      for (const r of res?.results || []) {
        const m = metricRow(r.text, r.keyword_metrics);
        byText.set(normKeyword(r.text), m);
        for (const v of r.close_variants || []) if (!byText.has(normKeyword(v))) byText.set(normKeyword(v), m);
      }
      givenRows = given.map((k) => withGsc({ ...(byText.get(k) || { volume: null, competition: null }), keyword: k }));
    }

    const seeds = (given.length ? given : (pageQueries || []).map((q) => normKeyword(q.query))).slice(0, MAX_SEEDS);
    const ideaReq = seeds.length
      ? { ...base, page_size: IDEA_PAGE_SIZE, keyword_and_url_seed: { url: t.url, keywords: seeds } }
      : { ...base, page_size: IDEA_PAGE_SIZE, url_seed: { url: t.url } };
    const ideaRes = await customer.keywordPlanIdeas.generateKeywordIdeas(ideaReq);
    const ideaList = Array.isArray(ideaRes) ? ideaRes : ideaRes?.results || [];
    const givenSet = new Set(given);
    const seen = new Set();
    const ideas = ideaList
      .map((r) => metricRow(normKeyword(r.text), r.keyword_idea_metrics))
      .filter((r) => r.keyword && r.volume > 0 && !givenSet.has(r.keyword) && !seen.has(r.keyword) && seen.add(r.keyword))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, MAX_IDEAS)
      .map(withGsc);

    out.push({
      page: path,
      url: t.url,
      mode: given.length ? 'given' : 'recommend',
      given: givenRows,
      page_queries: pageQueries,
      ideas,
    });
  }
  return { status: 'ok', keywords: { geo: geo.name, targets: out } };
}

// City-level volumes when the business's city is known; null falls back to the US.
async function findGeo(customer, city) {
  if (!city?.city) return null;
  try {
    const name = city.region ? `${city.city}, ${city.region}` : city.city;
    const res = await customer.geoTargetConstants.suggestGeoTargetConstants({
      locale: 'en', country_code: 'US', location_names: { names: [name] },
    });
    const hit = (res?.geo_target_constant_suggestions || [])
      .map((s) => s.geo_target_constant)
      .find((g) => g?.resource_name && /^(City|DMA Region)$/i.test(String(g.target_type || '')));
    if (!hit) return null;
    return { id: hit.resource_name, name: String(hit.canonical_name || name).split(',').slice(0, 2).join(', ') };
  } catch (err) {
    console.warn('[seo-audit-v2] geo lookup failed:', err?.message || err);
    return null;
  }
}
