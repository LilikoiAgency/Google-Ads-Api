// Pure insight helpers for the organic search report. All CTRs are fractions
// (0..1); positions are Google's average position (1 = top).

// Typical organic CTR by position (rough industry curve, used when the site
// itself has too little data at that position).
const DEFAULT_CTR = [0, 0.28, 0.16, 0.11, 0.08, 0.06, 0.045, 0.035, 0.03, 0.025, 0.02];
const DEFAULT_TAIL = 0.01; // positions 11-20
const MIN_SAMPLES = 5;
const MIN_IMPR = 20;

function defaultCtr(pos) {
  const p = Math.max(1, Math.round(pos));
  if (p <= 10) return DEFAULT_CTR[p];
  if (p <= 20) return DEFAULT_TAIL;
  return 0.005;
}

// Returns ctrAt(position). Starts from the default curve; where the site has 5+
// queries at a rounded position, its own click-weighted CTR there pulls the
// value, but only within 0.5x-1.5x of the default. (Sites full of zero-click
// impressions, e.g. map packs and AI answers, would otherwise expect ~0 and
// never flag anything.) Never rises with position.
export function expectedCtrModel(queries) {
  const buckets = new Map();
  for (const q of queries || []) {
    if (q.impressions < MIN_IMPR || !(q.position > 0)) continue;
    const p = Math.round(q.position);
    if (p > 20) continue;
    const b = buckets.get(p) || { n: 0, clicks: 0, impressions: 0 };
    b.n += 1;
    b.clicks += q.clicks;
    b.impressions += q.impressions;
    buckets.set(p, b);
  }
  const table = [];
  for (let p = 1; p <= 20; p++) {
    const b = buckets.get(p);
    const base = defaultCtr(p);
    table[p] = b && b.n >= MIN_SAMPLES
      ? Math.min(base * 1.5, Math.max(base * 0.5, b.clicks / b.impressions))
      : base;
  }
  // Smooth so a deeper position never "expects" more than a higher one.
  for (let p = 2; p <= 20; p++) table[p] = Math.min(table[p], table[p - 1]);
  return (pos) => {
    const p = Math.max(1, Math.round(pos));
    return p <= 20 ? table[p] : Math.min(table[20], 0.005);
  };
}

// Queries ranking 4-15 with real impressions, by extra clicks if they reached position 3.
export function strikingDistance(queries, ctrAt, { minImpressions = 50, limit = 100 } = {}) {
  const target = ctrAt(3);
  return (queries || [])
    .filter((q) => q.position >= 3.5 && q.position < 15.5 && q.impressions >= minImpressions)
    .map((q) => ({ ...q, potential: Math.max(0, Math.round(q.impressions * target - q.clicks)) }))
    .filter((q) => q.potential > 0)
    .sort((a, b) => b.potential - a.potential)
    .slice(0, limit);
}

// Rows in the top 10 whose CTR is under half of what their position should get.
export function lowCtr(rows, ctrAt, { minImpressions = 100, limit = 100 } = {}) {
  return (rows || [])
    .filter((r) => r.position > 0 && r.position <= 10.5 && r.impressions >= minImpressions)
    .map((r) => {
      const expected = ctrAt(r.position);
      return { ...r, expectedCtr: expected, lostClicks: Math.max(0, Math.round(r.impressions * expected - r.clicks)) };
    })
    .filter((r) => r.ctr < r.expectedCtr * 0.5 && r.lostClicks > 0)
    .sort((a, b) => b.lostClicks - a.lostClicks)
    .slice(0, limit);
}

// 'https://www.x.com/a/?utm=1#b' -> 'https://www.x.com/a/': tracking-link variants are one page.
export function stripQuery(url) {
  return String(url || '').split(/[?#]/)[0];
}

// Queries where 2+ pages each take 10%+ of the impressions. Branded queries are
// skipped (Google shows several sitelinks for a brand search on purpose), and
// URLs that differ only by query string (UTM tags) count as one page.
export function cannibalization(queryPages, { brandTerms = [], minImpressions = 50, minShare = 0.1, limit = 100 } = {}) {
  const byQuery = new Map();
  for (const r of queryPages || []) {
    if (brandTerms.length && isBranded(r.query, brandTerms)) continue;
    if (!byQuery.has(r.query)) byQuery.set(r.query, new Map());
    const pages = byQuery.get(r.query);
    const page = stripQuery(r.page);
    const e = pages.get(page) || { page, clicks: 0, impressions: 0, posW: 0 };
    e.clicks += r.clicks;
    e.impressions += r.impressions;
    e.posW += r.position * r.impressions;
    pages.set(page, e);
  }
  const out = [];
  for (const [query, pageMap] of byQuery) {
    const rows = [...pageMap.values()];
    const impressions = rows.reduce((s, r) => s + r.impressions, 0);
    if (impressions < minImpressions) continue;
    const pages = rows
      .map((r) => ({
        page: r.page, clicks: r.clicks, impressions: r.impressions,
        position: r.impressions ? r.posW / r.impressions : 0, share: r.impressions / impressions,
      }))
      .filter((p) => p.share >= minShare)
      .sort((a, b) => b.impressions - a.impressions);
    if (pages.length < 2) continue;
    out.push({ query, impressions, clicks: rows.reduce((s, r) => s + r.clicks, 0), pages });
  }
  return out.sort((a, b) => b.impressions - a.impressions).slice(0, limit);
}

// Sums rows into { clicks, impressions, ctr, position } with impression-weighted position.
export function aggregate(rows) {
  let clicks = 0;
  let impressions = 0;
  let posW = 0;
  for (const r of rows) {
    clicks += r.clicks || 0;
    impressions += r.impressions || 0;
    posW += (r.position || 0) * (r.impressions || 0);
  }
  return { clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: impressions ? posW / impressions : 0 };
}

// '/services/solar/x' -> '/services'; home and bare pages -> '/'.
export function groupOf(url) {
  let path = String(url || '');
  try { path = new URL(path).pathname; } catch { /* already a path */ }
  const seg = path.split('/').filter(Boolean);
  return seg.length > 1 ? `/${seg[0].toLowerCase()}` : '/';
}

export function pageGroups(pages) {
  const map = new Map();
  for (const p of pages || []) {
    const g = groupOf(p.page);
    if (!map.has(g)) map.set(g, { cur: [], prev: [], count: 0 });
    const e = map.get(g);
    e.cur.push(p);
    e.count += 1;
    if (p.prev) e.prev.push(p.prev);
  }
  const hasPrev = (pages || []).some((p) => p.prev !== undefined && p.prev !== null);
  return [...map].map(([group, e]) => ({
    group,
    pages: e.count,
    ...aggregate(e.cur),
    prev: hasPrev ? aggregate(e.prev) : null,
  })).sort((a, b) => b.clicks - a.clicks);
}

export function pagesForQuery(queryPages, query) {
  return (queryPages || []).filter((r) => r.query === query).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export function queriesForPage(queryPages, page) {
  return (queryPages || []).filter((r) => r.page === page).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

// Rows matching the brand terms (same rule as the API filter: case-insensitive substring).
export function isBranded(query, terms) {
  const q = String(query || '').toLowerCase();
  return (terms || []).some((t) => t && q.includes(t));
}

// Daily trend -> week (ISO, Monday start) or month buckets. Position is impression-weighted.
export function rollupTrend(trend, granularity) {
  if (granularity === 'day' || !trend?.length) return trend || [];
  const keyOf = (date) => {
    if (granularity === 'month') return `${date.slice(0, 7)}-01`;
    const [y, m, d] = date.split('-').map(Number);
    const ms = Date.UTC(y, m - 1, d);
    const dow = (new Date(ms).getUTCDay() + 6) % 7;
    return new Date(ms - dow * 86400000).toISOString().slice(0, 10);
  };
  const map = new Map();
  for (const t of trend) {
    const k = keyOf(t.date);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(t);
  }
  return [...map].map(([date, rows]) => ({ date, ...aggregate(rows) }));
}

// Fractional change, null without a usable previous value.
export function change(cur, prev) {
  if (prev === null || prev === undefined || prev === 0 || !Number.isFinite(prev)) return null;
  return (cur - prev) / prev;
}

// Suggested brand term from the site: 'sc-domain:rangerelectric.com' -> 'rangerelectric'.
export function guessBrandTerm(site) {
  const s = String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '');
  const host = s.split('/')[0];
  const parts = host.split('.');
  return parts.length > 1 ? parts[parts.length - 2] : parts[0] || '';
}
