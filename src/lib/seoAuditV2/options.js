// Advanced audit options: pages to audit first, "only these pages", skip patterns
// and a page count. Pure helpers shared by the jobs route, the crawl step and the UI.

export const MAX_LISTED_PAGES = 50;
export const MAX_SKIP_PATTERNS = 20;
export const MAX_PAGE_COUNT = 50;
export const MAX_LOCATIONS = 10;
export const MAX_TARGETS = 5;
export const MAX_TARGET_KEYWORDS = 10;
const MAX_KEYWORD_CHARS = 80;
export const DEFAULT_PAGES = { quick: 5, full: 50 };

export const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');

// A pasted line (full URL, host/path or /path) -> https URL on the domain, or null.
function toUrl(line, domain) {
  const raw = line.trim();
  if (!raw) return null;
  let url;
  try {
    if (raw.startsWith('/')) url = new URL(raw, `https://${domain}`);
    else url = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { bad: raw };
  }
  if (bareHost(url.hostname) !== bareHost(domain)) return { bad: raw };
  const path = url.pathname.replace(/\/+$/, '') || '/';
  return { url: `https://${bareHost(domain)}${path === '/' ? '/' : path}${url.search}` };
}

const lines = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [])
  .map((s) => String(s).trim()).filter(Boolean);

/**
 * Validates raw options from the request against the audited domain.
 * Returns { options } (null when nothing is set) or { error }.
 */
export function parseAuditOptions(raw, domain) {
  if (!raw || typeof raw !== 'object') return { options: null };
  const pageLines = lines(raw.pages);
  if (pageLines.length > MAX_LISTED_PAGES) return { error: `List at most ${MAX_LISTED_PAGES} pages.` };
  const pages = [];
  const bad = [];
  for (const line of pageLines) {
    const r = toUrl(line, domain);
    if (r?.bad) bad.push(r.bad);
    else if (r?.url && !pages.includes(r.url)) pages.push(r.url);
  }
  if (bad.length) return { error: `These pages aren't on ${domain}: ${bad.join(', ')}` };

  const skip = lines(raw.skip).map((p) => (p.startsWith('/') || p.startsWith('*') ? p : `/${p}`));
  if (skip.length > MAX_SKIP_PATTERNS) return { error: `Use at most ${MAX_SKIP_PATTERNS} skip patterns.` };

  let pageCount = null;
  if (raw.pageCount != null && raw.pageCount !== '') {
    const n = Number(raw.pageCount);
    if (!Number.isInteger(n) || n < 1 || n > MAX_PAGE_COUNT) return { error: `Number of pages must be between 1 and ${MAX_PAGE_COUNT}.` };
    pageCount = n;
  }
  const onlyListed = raw.onlyListed === true;
  if (onlyListed && !pages.length) return { error: 'List at least one page to audit only those pages.' };

  // Data sources picked by hand instead of matched by domain.
  let gscSite = null;
  if (raw.gscSite != null && raw.gscSite !== "") {
    const site = String(raw.gscSite).trim();
    if (!/^(sc-domain:[a-z0-9.-]+|https?:\/\/\S+)$/i.test(site)) return { error: "Pick a Search Console property from the list." };
    gscSite = site;
  }
  let ga4Property = null;
  if (raw.ga4Property && typeof raw.ga4Property === "object" && raw.ga4Property.id) {
    const id = String(raw.ga4Property.id).trim();
    if (!/^properties\/\d+$/.test(id)) return { error: "Pick a Google Analytics property from the list." };
    ga4Property = { id, name: String(raw.ga4Property.name || id).slice(0, 200), account: String(raw.ga4Property.account || "").slice(0, 200) };
  }

  // Business locations whose Google reviews to check (picked from GBP or Places).
  // An explicit empty list means "no locations" (the user unticked them all) and is kept.
  const locations = [];
  const locationsGiven = Array.isArray(raw.locations);
  if (locationsGiven) {
    for (const loc of raw.locations) {
      const id = typeof loc?.id === 'string' ? loc.id.trim() : '';
      const ok = (loc?.source === 'places' && /^[A-Za-z0-9_-]{10,}$/.test(id))
        || (loc?.source === 'gbp' && /^locations\/\d+$/.test(id));
      if (!ok) return { error: 'Pick locations from the list.' };
      if (locations.some((l) => l.id === id)) continue;
      locations.push({ source: loc.source, id, name: String(loc.name || id).trim().slice(0, 200) });
    }
    locations.splice(MAX_LOCATIONS);
  }

  // Pages to rank for chosen keywords (no keywords = recommend some). Each
  // target page is also a priority page, so it is crawled and inspected.
  const targets = [];
  for (const t of Array.isArray(raw.targets) ? raw.targets : []) {
    const pageLine = String(t?.page ?? '').trim();
    const kwLines = lines(t?.keywords);
    if (!pageLine && !kwLines.length) continue;
    if (!pageLine) return { error: 'Add the page for each set of target keywords.' };
    const r = toUrl(pageLine, domain);
    if (!r?.url) return { error: `This page isn't on ${domain}: ${pageLine}` };
    const keywords = [...new Set(kwLines.map((k) => k.toLowerCase().replace(/\s+/g, ' ')))];
    if (keywords.some((k) => k.length > MAX_KEYWORD_CHARS)) return { error: `Keep each keyword under ${MAX_KEYWORD_CHARS} characters.` };
    const same = targets.find((x) => x.url === r.url);
    const merged = same ? [...new Set([...same.keywords, ...keywords])] : keywords;
    if (merged.length > MAX_TARGET_KEYWORDS) return { error: `Use at most ${MAX_TARGET_KEYWORDS} keywords per page.` };
    if (same) same.keywords = merged;
    else targets.push({ url: r.url, keywords });
  }
  if (targets.length > MAX_TARGETS) return { error: `Add target keywords for at most ${MAX_TARGETS} pages.` };
  for (const t of targets) if (!pages.includes(t.url)) pages.push(t.url);
  if (pages.length > MAX_LISTED_PAGES) return { error: `List at most ${MAX_LISTED_PAGES} pages.` };

  if (!pages.length && !skip.length && pageCount == null && !gscSite && !ga4Property && !locationsGiven) return { options: null };
  return {
    options: {
      pages, onlyListed, skip, pageCount,
      ...(gscSite ? { gscSite } : {}),
      ...(ga4Property ? { ga4Property } : {}),
      ...(locationsGiven ? { locations } : {}),
      ...(targets.length ? { targets } : {}),
    },
  };
}

export const hasOptions = (o) => !!o && (o.pages?.length > 0 || o.skip?.length > 0 || o.pageCount != null || !!o.gscSite || !!o.ga4Property || Array.isArray(o.locations));
export const hasTargets = (o) => Array.isArray(o?.targets) && o.targets.length > 0;

// How many pages the crawl may fetch.
export function pageLimit(auditType, options) {
  if (options?.onlyListed && options.pages?.length) return options.pages.length;
  return options?.pageCount || DEFAULT_PAGES[auditType] || DEFAULT_PAGES.quick;
}

function patternRegex(pattern) {
  const body = pattern.replace(/\/+$/, '').split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  // "/blog/*" also matches "/blog" itself.
  const tail = body.endsWith('/.*') ? `(?:${body})|${body.slice(0, -3)}` : body;
  return new RegExp(`^(?:${tail})$`, 'i');
}

const pathOf = (url) => {
  try {
    return new URL(url).pathname.replace(/\/+$/, '') || '/';
  } catch {
    return String(url);
  }
};

export function matchesSkip(url, patterns) {
  if (!patterns?.length) return false;
  const path = pathOf(url);
  return patterns.some((p) => patternRegex(p).test(path));
}

export const filterSkipped = (urls, patterns) => (patterns?.length ? urls.filter((u) => !matchesSkip(u, patterns)) : urls);

// One-line summary for the UI and history ("3 priority pages · skip /blog/* · 10 pages").
export function describeOptions(o) {
  if (!hasOptions(o)) return '';
  const parts = [];
  // Target pages are added to pages; count them once, under target keywords.
  const targetUrls = new Set((o.targets || []).map((t) => t.url));
  const listed = (o.pages || []).filter((u) => o.onlyListed || !targetUrls.has(u));
  if (o.targets?.length) parts.push(`target keywords for ${o.targets.length} page${o.targets.length === 1 ? '' : 's'}`);
  if (listed.length) parts.push(o.onlyListed ? `only ${listed.length} listed page${listed.length === 1 ? '' : 's'}` : `${listed.length} priority page${listed.length === 1 ? '' : 's'}`);
  if (o.skip?.length) parts.push(`skip ${o.skip.join(', ')}`);
  if (o.gscSite) parts.push(`Search Console ${o.gscSite}`);
  if (o.ga4Property) parts.push(`Analytics ${o.ga4Property.name}`);
  if (Array.isArray(o.locations) && !o.locations.length) parts.push('no locations');
  else if (o.locations?.length) parts.push(`${o.locations.length} location${o.locations.length === 1 ? '' : 's'}`);
  if (o.pageCount && !o.onlyListed) parts.push(`${o.pageCount} pages`);
  return parts.join(' · ');
}
