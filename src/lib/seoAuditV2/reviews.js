// Google reviews source for SEO Audit v2: brand name from the crawl, location
// matching through Places, and rating / volume / recency stats per location.

import { searchPlaces, getPlace, matchesDomain, PlacesError } from './places';

const MAX_LOCATIONS = 10;
const DAY_MS = 86400000;
const BUSINESS_TYPE = /^(LocalBusiness|Organization)$/;

const homePage = (crawl) => {
  const pages = crawl?.pages_crawled || [];
  return pages.find((p) => p.page_type === 'homepage') || pages[0] || null;
};

function schemaNodes(raw) {
  if (Array.isArray(raw)) return raw.flatMap(schemaNodes);
  if (!raw || typeof raw !== 'object') return [];
  return [raw, ...schemaNodes(raw['@graph'])];
}

function schemaName(page) {
  for (const block of page?.schema_markup || []) {
    for (const node of schemaNodes(block?.raw_json)) {
      const types = [].concat(node['@type'] || []);
      if (types.some((t) => BUSINESS_TYPE.test(t)) && typeof node.name === 'string' && node.name.trim()) {
        return node.name.trim();
      }
    }
  }
  return '';
}

const ENTITIES = { '&amp;': '&', '&#39;': "'", '&quot;': '"', '&lt;': '<', '&gt;': '>' };
export const decodeEntities = (text) => String(text || '').replace(/&(?:amp|#39|quot|lt|gt);/g, (e) => ENTITIES[e]);

const GENERIC_SEGMENT = /^(home|homepage|welcome)$/i;

// The brand part of a page title: the first segment that isn't "Home" / "Welcome".
export function brandFromTitle(title) {
  const parts = decodeEntities(title).split(/\s+(?:\||-|—)\s+/).map((s) => s.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return parts.find((s) => !GENERIC_SEGMENT.test(s)) || '';
}

export function brandName(crawl, domain) {
  const page = homePage(crawl);
  const fromSchema = schemaName(page);
  if (fromSchema) return fromSchema;
  const og = decodeEntities(page?.open_graph?.og_site_name).trim();
  if (og) return og;
  const title = brandFromTitle(page?.title_tag);
  if (title) return title;
  return String(domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
}

const ageDays = (date, now) => Math.floor((now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS);
const uniqueById = (list) => [...new Map(list.map((l) => [l.id, l])).values()];

// per_month, star_split and reply_rate need every review, so they exist only for
// coverage 'full'; a Places sample (5 reviews) would make them misleading.
export function reviewStats(reviews, { rating, count, coverage }, now = new Date()) {
  const dated = (reviews || []).filter((r) => r.date && Number.isFinite(ageDays(r.date, now)));
  const newest = dated.length ? Math.min(...dated.map((r) => ageDays(r.date, now))) : null;
  const stats = {
    rating: rating ?? null,
    count: count ?? null,
    coverage,
    per_month: null,
    star_split: null,
    days_since_newest: newest,
    reply_rate: null,
  };
  if (coverage !== 'full') return stats;
  const list = reviews || [];
  const lastYear = dated.filter((r) => ageDays(r.date, now) <= 365).length;
  stats.per_month = Math.round((lastYear / 12) * 10) / 10;
  stats.star_split = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of list) if (stats.star_split[r.stars] != null) stats.star_split[r.stars] += 1;
  stats.reply_rate = list.length ? list.filter((r) => r.replied === true).length / list.length : null;
  return stats;
}

const blockedStatus = (err) => (err instanceof PlacesError && (err.code === 'not_connected' || err.code === 'permission') ? err.code : null);

// Places listings whose website is this domain, found by the domain label, its
// hyphen-split words and any brand guesses. Shared by the picker and the audit
// so both see the same locations.
export async function findLocationsForDomain(domain, { brands = [] } = {}) {
  const label = String(domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
  const queries = [];
  const add = (q) => {
    const text = String(q || '').trim();
    if (text && !queries.some((x) => x.toLowerCase() === text.toLowerCase())) queries.push(text);
  };
  add(label);
  if (label.includes('-')) add(label.split('-').filter(Boolean).join(' '));
  brands.forEach(add);
  const results = await Promise.all(queries.map((q) => searchPlaces(q)));
  const seen = new Set();
  const found = [];
  for (const place of results.flat()) {
    if (seen.has(place.id) || !matchesDomain(place.website, domain)) continue;
    seen.add(place.id);
    found.push(place);
  }
  return found.slice(0, MAX_LOCATIONS);
}

async function matchLocations(domain, crawl) {
  const found = await findLocationsForDomain(domain, { brands: [brandName(crawl, domain)] });
  return found.map((p) => ({ source: 'places', id: p.id, name: p.name }));
}

export async function fetchReviews({ domain, crawl, locations }) {
  let picked;
  try {
    picked = locations
      ? uniqueById(locations.filter((l) => l.source === 'places')).slice(0, MAX_LOCATIONS) // 'gbp' arrives in phase 2
      : uniqueById(await matchLocations(domain, crawl));
  } catch (err) {
    return { status: blockedStatus(err) || 'error', error: err?.message || String(err), locations: [], texts: {} };
  }
  if (!picked.length) return { status: 'no_data', locations: [], texts: {} };

  const now = new Date();
  const results = await Promise.allSettled(picked.map((l) => getPlace(l.id)));
  const out = [];
  const texts = {};
  let firstError = null;
  results.forEach((r, i) => {
    if (r.status === 'rejected') {
      firstError ||= r.reason;
      return;
    }
    const p = r.value;
    const { reviews = [], ...summary } = p;
    texts[picked[i].id] = reviews;
    out.push({
      source: 'places',
      id: picked[i].id,
      name: summary.name || picked[i].name,
      city: summary.city ?? null,
      region: summary.region ?? null,
      coverage: 'sample',
      stats: reviewStats(reviews, { rating: summary.rating, count: summary.count, coverage: 'sample' }, now),
    });
  });
  if (!out.length) {
    return { status: blockedStatus(firstError) || 'error', error: firstError?.message || String(firstError), locations: [], texts: {} };
  }
  return { status: 'ok', locations: out, texts };
}
