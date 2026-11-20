// Pure Search Console request builder and response normalizer for the
// organic search report. No I/O: gscClient.js sends the requests built here.

export const SEARCH_TYPES = [
  { key: 'web', label: 'Web' },
  { key: 'image', label: 'Image' },
  { key: 'video', label: 'Video' },
  { key: 'news', label: 'News tab' },
  { key: 'discover', label: 'Discover' },
  { key: 'googleNews', label: 'Google News' },
];

// Row caps per request (the API maximum is 25,000). The page says when a list hits its cap.
export const LIMITS = { queries: 5000, pages: 10000, queryPages: 25000 };

// Discover and Google News have no query or device dimension and no position.
export function hasQueries(type) {
  return type !== 'discover' && type !== 'googleNews';
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function cleanBrandTerms(terms) {
  const seen = new Set();
  const out = [];
  for (const raw of terms || []) {
    const t = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!t || t.length > 60 || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  return out.slice(0, 20);
}

// Case-insensitive RE2 pattern matching any brand term as a substring; null if none.
export function brandRegex(terms) {
  const clean = cleanBrandTerms(terms);
  if (!clean.length) return null;
  return `(?i)(${clean.map(escapeRe).join('|')})`;
}

// Named requests: [{ key, body }]. Keys say which range and slice they are.
export function buildSearchRequests({ startDate, endDate, compareRange, type = 'web', brandTerms = [] }) {
  const out = [];
  const base = { type, dataState: 'all' };
  const add = (key, range, extra = {}) =>
    out.push({ key, body: { ...base, startDate: range.startDate, endDate: range.endDate, ...extra } });
  const cur = { startDate, endDate };
  const q = hasQueries(type);

  add('totals', cur);
  add('trend', cur, { dimensions: ['date'], rowLimit: 1000 });
  add('pages', cur, { dimensions: ['page'], rowLimit: LIMITS.pages });
  add('countries', cur, { dimensions: ['country'], rowLimit: 250 });
  if (q) {
    add('devices', cur, { dimensions: ['device'] });
    add('queries', cur, { dimensions: ['query'], rowLimit: LIMITS.queries });
    add('queryPages', cur, { dimensions: ['query', 'page'], rowLimit: LIMITS.queryPages });
    add('appearance', cur, { dimensions: ['searchAppearance'] });
  }
  if (compareRange) {
    add('totals:compare', compareRange);
    add('trend:compare', compareRange, { dimensions: ['date'], rowLimit: 1000 });
    add('pages:compare', compareRange, { dimensions: ['page'], rowLimit: LIMITS.pages });
    add('countries:compare', compareRange, { dimensions: ['country'], rowLimit: 250 });
    if (q) {
      add('devices:compare', compareRange, { dimensions: ['device'] });
      add('queries:compare', compareRange, { dimensions: ['query'], rowLimit: LIMITS.queries });
    }
  }

  const re = q ? brandRegex(brandTerms) : null;
  if (re) {
    const filter = (operator) => ({
      dimensionFilterGroups: [{ filters: [{ dimension: 'query', operator, expression: re }] }],
    });
    for (const [name, op] of [['brand', 'includingRegex'], ['nonBrand', 'excludingRegex']]) {
      add(`${name}:totals`, cur, filter(op));
      add(`${name}:trend`, cur, { dimensions: ['date'], rowLimit: 1000, ...filter(op) });
      if (compareRange) add(`${name}:totals:compare`, compareRange, filter(op));
    }
  }
  return out;
}

// ── normalizer ───────────────────────────────────────────────────────────

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// Rounded so a big report stays small (it is cached and sent to the browser).
const round = (v, d) => Math.round(num(v) * 10 ** d) / 10 ** d;

function metricsOf(r) {
  return {
    clicks: num(r?.clicks),
    impressions: num(r?.impressions),
    ctr: round(r?.ctr, 5),
    position: round(r?.position, 2),
  };
}

const ZERO = { clicks: 0, impressions: 0, ctr: 0, position: 0 };
const rowsOf = (res) => res?.rows || [];
const totalsOf = (res) => (rowsOf(res)[0] ? metricsOf(rowsOf(res)[0]) : { ...ZERO });

function keyed(res, names) {
  return rowsOf(res).map((r) => {
    const out = {};
    names.forEach((n, i) => { out[n] = r.keys?.[i] ?? ''; });
    return { ...out, ...metricsOf(r) };
  });
}

// Attach the compare-period row (or null) as `prev` by a key field.
function withPrev(rows, prevRows, field, hasCompare) {
  if (!hasCompare) return rows.map((r) => ({ ...r, prev: null }));
  const map = new Map(prevRows.map((r) => [r[field], r]));
  return rows.map((r) => {
    const p = map.get(r[field]);
    return { ...r, prev: p ? { clicks: p.clicks, impressions: p.impressions, ctr: p.ctr, position: p.position } : null };
  });
}

function trendOf(res) {
  return keyed(res, ['date']).sort((a, b) => a.date.localeCompare(b.date));
}

const DEVICE_LABELS = { DESKTOP: 'Desktop', MOBILE: 'Mobile', TABLET: 'Tablet' };

// results: { [key]: apiResponseData }
export function normalizeSearchReport(results, { site, range, compareRange, type, brandTerms, sitemaps = null }) {
  const R = results || {};
  const hasCompare = !!compareRange;
  const q = hasQueries(type);

  const devices = withPrev(
    keyed(R.devices, ['device']).map((d) => ({ ...d, device: DEVICE_LABELS[d.device] || d.device })),
    keyed(R['devices:compare'], ['device']).map((d) => ({ ...d, device: DEVICE_LABELS[d.device] || d.device })),
    'device', hasCompare,
  ).sort((a, b) => b.clicks - a.clicks);

  const countries = withPrev(keyed(R.countries, ['country']), keyed(R['countries:compare'], ['country']), 'country', hasCompare)
    .sort((a, b) => b.clicks - a.clicks);

  let brand = null;
  const terms = q ? cleanBrandTerms(brandTerms) : [];
  if (terms.length && R['brand:totals']) {
    const split = (suffix) => {
      const total = totalsOf(R[`totals${suffix}`]);
      const branded = totalsOf(R[`brand:totals${suffix}`]);
      const nonBranded = totalsOf(R[`nonBrand:totals${suffix}`]);
      return {
        branded,
        nonBranded,
        anonymized: {
          clicks: Math.max(0, total.clicks - branded.clicks - nonBranded.clicks),
          impressions: Math.max(0, total.impressions - branded.impressions - nonBranded.impressions),
        },
      };
    };
    const bTrend = new Map(trendOf(R['brand:trend']).map((t) => [t.date, t]));
    const nTrend = new Map(trendOf(R['nonBrand:trend']).map((t) => [t.date, t]));
    const dates = [...new Set([...bTrend.keys(), ...nTrend.keys()])].sort();
    brand = {
      terms,
      current: split(''),
      compare: hasCompare ? split(':compare') : null,
      trend: dates.map((date) => ({
        date,
        branded: bTrend.get(date)?.clicks || 0,
        nonBranded: nTrend.get(date)?.clicks || 0,
      })),
    };
  }

  return {
    site,
    type,
    range: { startDate: range.startDate, endDate: range.endDate },
    compareRange: hasCompare ? { startDate: compareRange.startDate, endDate: compareRange.endDate } : null,
    hasQueries: q,
    totals: totalsOf(R.totals),
    totalsCompare: hasCompare ? totalsOf(R['totals:compare']) : null,
    trend: trendOf(R.trend),
    trendCompare: hasCompare ? trendOf(R['trend:compare']) : null,
    firstIncompleteDate: R.trend?.metadata?.firstIncompleteDate || R.totals?.metadata?.firstIncompleteDate || null,
    queries: q ? withPrev(keyed(R.queries, ['query']), keyed(R['queries:compare'], ['query']), 'query', hasCompare) : [],
    pages: withPrev(keyed(R.pages, ['page']), keyed(R['pages:compare'], ['page']), 'page', hasCompare),
    // Pairs with a single impression are dropped: ~60% of rows, no signal.
    queryPages: q ? keyed(R.queryPages, ['query', 'page']).filter((r) => r.impressions >= 2) : [],
    limits: LIMITS,
    devices,
    countries,
    appearance: q ? keyed(R.appearance, ['appearance']).sort((a, b) => b.clicks - a.clicks) : [],
    brand,
    sitemaps,
    fetchedAt: new Date().toISOString(),
  };
}
