// Joins Search Console pages with GA4 organic landing-page data. Pure helpers
// (host/path normalizing, property matching, join); the route does the I/O.

// 'sc-domain:example.com' or 'https://www.example.com/' -> 'example.com'
export function siteHost(site) {
  const s = String(site || '');
  const host = s.startsWith('sc-domain:') ? s.slice('sc-domain:'.length) : (() => {
    try { return new URL(s).hostname; } catch { return ''; }
  })();
  return host.toLowerCase().replace(/^www\./, '');
}

// The GA4 property whose web stream is on the same host (www ignored). When
// none is, a stream on the parent domain of a subdomain site (help.x.com ->
// x.com). Never the reverse: a help.x.com stream is not the x.com site.
export function matchProperty(site, streams) {
  const host = siteHost(site);
  if (!host) return null;
  let parent = null;
  for (const s of streams || []) {
    const h = siteHost(s.uri);
    if (!h) continue;
    if (h === host) return { id: s.propertyId, name: s.propertyName, account: s.account };
    if (!parent && host.endsWith(`.${h}`)) parent = { id: s.propertyId, name: s.propertyName, account: s.account };
  }
  return parent;
}

// Full URL or GA landingPage path -> '/path' (no query, hash or trailing slash; lowercase).
export function normalizePath(urlOrPath) {
  let p = String(urlOrPath || '');
  if (/^https?:\/\//i.test(p)) {
    try { p = new URL(p).pathname; } catch { return ''; }
  }
  p = p.split(/[?#]/)[0] || '/';
  if (!p.startsWith('/')) p = `/${p}`;
  if (p.length > 1) p = p.replace(/\/+$/, '');
  try { p = decodeURI(p); } catch { /* keep raw */ }
  return p.toLowerCase();
}

// rows: [{ path, sessions, engagedSessions, keyEvents }] -> Map(normalizedPath -> summed metrics)
export function ga4ByPath(rows) {
  const map = new Map();
  for (const r of rows || []) {
    const k = normalizePath(r.path);
    if (!k) continue;
    const e = map.get(k) || { sessions: 0, engagedSessions: 0, keyEvents: 0 };
    e.sessions += r.sessions || 0;
    e.engagedSessions += r.engagedSessions || 0;
    e.keyEvents += r.keyEvents || 0;
    map.set(k, e);
  }
  return map;
}

// Adds `ga` ({ sessions, engagedSessions, keyEvents } or null) to each page row.
// Several Search Console URLs can share a path (http/https, www): each gets the path's numbers.
export function joinPages(pages, ga4Map) {
  if (!ga4Map) return pages;
  return pages.map((p) => ({ ...p, ga: ga4Map.get(normalizePath(p.page)) || null }));
}
