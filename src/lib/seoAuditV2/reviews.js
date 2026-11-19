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

export function brandName(crawl, domain) {
  const page = homePage(crawl);
  const fromSchema = schemaName(page);
  if (fromSchema) return fromSchema;
  const og = page?.open_graph?.og_site_name?.trim();
  if (og) return og;
  const title = String(page?.title_tag || '').split(/ \| | - | — /)[0].trim();
  if (title) return title;
  return String(domain || '').toLowerCase().replace(/^www\./, '').split('.')[0];
}

const ageDays = (date, now) => Math.floor((now.getTime() - new Date(`${date}T00:00:00Z`).getTime()) / DAY_MS);

// per_month, star_split and reply_rate need every review, so they exist only for
// coverage 'full'; a Places sample (5 reviews) would make them misleading.
export function reviewStats(reviews, { rating, count, coverage }, now = new Date()) {
  const dated = (reviews || []).filter((r) => r.date);
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

async function matchLocations(domain, crawl) {
  const found = await searchPlaces(brandName(crawl, domain));
  return found
    .filter((p) => matchesDomain(p.website, domain))
    .slice(0, MAX_LOCATIONS)
    .map((p) => ({ source: 'places', id: p.id, name: p.name }));
}

export async function fetchReviews({ domain, crawl, locations }) {
  let picked;
  try {
    picked = locations
      ? locations.filter((l) => l.source === 'places').slice(0, MAX_LOCATIONS) // 'gbp' arrives in phase 2
      : await matchLocations(domain, crawl);
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
