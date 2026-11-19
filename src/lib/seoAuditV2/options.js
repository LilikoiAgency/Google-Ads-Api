// Advanced audit options: pages to audit first, "only these pages", skip patterns
// and a page count. Pure helpers shared by the jobs route, the crawl step and the UI.

export const MAX_LISTED_PAGES = 50;
export const MAX_SKIP_PATTERNS = 20;
export const MAX_PAGE_COUNT = 50;
export const DEFAULT_PAGES = { quick: 5, full: 50 };

const bareHost = (h) => h.toLowerCase().replace(/^www\./, '');

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

  if (!pages.length && !skip.length && pageCount == null) return { options: null };
  return { options: { pages, onlyListed, skip, pageCount } };
}

export const hasOptions = (o) => !!o && (o.pages?.length > 0 || o.skip?.length > 0 || o.pageCount != null);

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
  if (o.pages?.length) parts.push(o.onlyListed ? `only ${o.pages.length} listed page${o.pages.length === 1 ? '' : 's'}` : `${o.pages.length} priority page${o.pages.length === 1 ? '' : 's'}`);
  if (o.skip?.length) parts.push(`skip ${o.skip.join(', ')}`);
  if (o.pageCount && !o.onlyListed) parts.push(`${o.pageCount} pages`);
  return parts.join(' · ');
}
