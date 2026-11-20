// Target keywords for SEO Audit v2: the pass input, a guard on the pass output
// and the result section. Pure: no server imports.

import { pathKey } from './tasks';
import { matchesExclusion } from './corrections';

export const normKeyword = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();

const TEXT_CHARS = 8000;
const OTHER_PAGES = 60;
const MAX_ADDED = 8; // primary + secondary picked or added beyond the given list
const ROLES = ['primary', 'secondary', 'drop'];

const has = (v) => v !== null && v !== undefined;
const pageUrl = (p) => p.final_url || p.url;

const kwInput = (r) => ({
  keyword: r.keyword,
  monthly_searches: r.volume ?? null,
  competition: r.competition ?? null,
  ...(r.search_console ? { search_console: r.search_console } : {}),
});

// targetOptions: [{ url, keywords }] from the audit options. data.keywords: the
// gathered keyword data (null when Keyword Planner was unavailable; the pass
// then works from the page and Search Console alone).
// -> null when there are no targets.
export function targetsInput(crawl, data, targetOptions) {
  if (!targetOptions?.length) return null;
  const kw = data?.keywords || null;
  const pages = crawl?.pages_crawled || [];
  const byPath = new Map(pages.map((p) => [pathKey(pageUrl(p)), p]));
  const gscByPath = new Map((data?.gscPages || []).map((p) => [pathKey(p.page), p]));
  const targetPaths = new Set(targetOptions.map((t) => pathKey(t.url)));

  const targets = targetOptions.map((t) => {
    const path = pathKey(t.url);
    const p = byPath.get(path);
    const k = kw?.targets?.find((x) => x.page === path);
    const given = k ? k.given : (t.keywords || []).map((keyword) => ({ keyword: normKeyword(keyword), volume: null, competition: null }));
    const pageQueries = k?.page_queries
      || (gscByPath.get(path)?.queries || []).map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position }));
    return {
      page: path,
      url: t.url,
      mode: (t.keywords || []).length ? 'given' : 'recommend',
      crawled: !!p,
      ...(p ? {
        title_tag: p.title_tag || '',
        meta_description: p.meta_description || '',
        h1_tags: p.h1_tags || [],
        h2_tags: p.h2_tags || [],
        h3_tags: p.h3_tags || [],
        word_count: p.word_count ?? null,
        content_text: String(p.content_text || p.content_snippet || '').slice(0, TEXT_CHARS),
      } : {}),
      target_keywords: given.map(kwInput),
      page_queries: pageQueries,
      keyword_ideas: (k?.ideas || []).map(kwInput),
    };
  });

  return {
    volumes_for: kw?.geo || null,
    ...(has(data?.gsc?.range) ? { search_period: data.gsc.range } : {}),
    ...(kw && kw.volumes !== false ? {} : { note: 'Keyword Planner data is unavailable: there are no monthly searches or keyword ideas. Work from the page and Search Console only and say that search demand could not be checked.' }),
    targets,
    other_pages: pages
      .filter((p) => !targetPaths.has(pathKey(pageUrl(p))))
      .slice(0, OTHER_PAGES)
      .map((p) => ({ page: pathKey(pageUrl(p)), title_tag: p.title_tag || '', h1: (p.h1_tags || [])[0] || '' })),
  };
}

// Keywords must come from the input (given, ideas or the page's own queries),
// with at most one primary; conflicts must name another known page.
export function guardTargets(outTargets, input, { exclude } = {}) {
  const known = new Set([
    ...(input?.other_pages || []).map((p) => p.page),
    ...(input?.targets || []).map((t) => t.page),
  ]);
  for (const t of input?.targets || []) {
    for (const k of [...t.target_keywords, ...t.keyword_ideas]) for (const r of k.search_console || []) known.add(r.page);
  }
  return (input?.targets || []).map((t) => {
    const out = (outTargets || []).find((o) => pathKey(o?.page) === t.page) || {};
    const givenSet = new Set(t.target_keywords.map((k) => normKeyword(k.keyword)));
    const allowed = new Set([
      ...givenSet,
      ...t.keyword_ideas.map((k) => normKeyword(k.keyword)),
      ...(t.page_queries || []).map((q) => normKeyword(q.query)),
    ]);
    const seen = new Set();
    let primary = false;
    let added = 0;
    const keywords = [];
    for (const k of out.keywords || []) {
      const keyword = normKeyword(k?.keyword);
      if (!keyword || !allowed.has(keyword) || seen.has(keyword) || !ROLES.includes(k.role)) continue;
      if (matchesExclusion({ title: keyword }, exclude)) continue;
      let role = k.role;
      if (role === 'primary' && primary) role = 'secondary';
      if (!givenSet.has(keyword)) {
        if (role === 'drop') continue; // only given keywords are dropped
        if (added >= MAX_ADDED) continue;
        added += 1;
      }
      if (role === 'primary') primary = true;
      seen.add(keyword);
      keywords.push({ keyword, role, note: String(k.note || ''), given: givenSet.has(keyword) });
    }
    // Every given keyword is listed, even when the reply skipped it.
    for (const g of givenSet) if (!seen.has(g)) keywords.push({ keyword: g, role: 'secondary', note: '', given: true });
    const conflicts = (out.conflicts || [])
      .map((c) => ({ keyword: normKeyword(c?.keyword), other_page: pathKey(c?.other_page), note: String(c?.note || '') }))
      .filter((c) => c.keyword && c.other_page && c.other_page !== t.page && known.has(c.other_page));
    return { page: t.page, keywords, conflicts };
  });
}

const ROLE_ORDER = { primary: 0, secondary: 1, drop: 2 };

// The result section: each target page's keywords with the numbers attached in
// code (never from the model), and the action plan tasks for that page.
// keywordData: data.keywords (may be null); guarded: guardTargets output.
export function buildTargetsResult({ targetOptions, keywordData, guarded, plan }) {
  if (!targetOptions?.length) return undefined;
  const flat = (plan || []).flatMap((t) => [t, ...(t.items || []), ...(t.follow_ups || [])]);
  const targets = targetOptions.map((opt) => {
    const page = pathKey(opt.url);
    const k = keywordData?.targets?.find((x) => x.page === page);
    const rows = new Map();
    for (const r of [...(k?.ideas || []), ...(k?.given || [])]) rows.set(normKeyword(r.keyword), r);
    const pageQueries = new Map((k?.page_queries || []).map((q) => [normKeyword(q.query), q]));
    const g = (guarded || []).find((x) => x.page === page);
    const fallback = (opt.keywords || []).map((kw) => ({ keyword: normKeyword(kw), role: 'secondary', note: '', given: true }));
    const keywords = (g?.keywords?.length ? g.keywords : fallback).map((x) => {
      const r = rows.get(x.keyword);
      const sc = r?.search_console || [];
      // The target page's own numbers first (its query list is longer than the
      // per-keyword top pages); another page only when the target has none.
      const ownQuery = pageQueries.get(x.keyword);
      const best = sc.find((s) => s.page === page) || (ownQuery ? { ...ownQuery, page } : null) || sc[0] || null;
      return {
        ...x,
        volume: r?.volume ?? null,
        competition: r?.competition ?? null,
        position: best?.position ?? null,
        ranking_page: best ? best.page : null,
        clicks: best?.clicks ?? null,
        impressions: best?.impressions ?? null,
      };
    }).sort((a, b) => ROLE_ORDER[a.role] - ROLE_ORDER[b.role] || (b.volume ?? -1) - (a.volume ?? -1));
    const taskIds = flat
      .filter((t) => t.page === page || (t.pages || []).includes(page))
      .map((t) => t.id);
    return {
      page,
      mode: (opt.keywords || []).length ? 'given' : 'recommend',
      keywords,
      conflicts: g?.conflicts || [],
      task_ids: [...new Set(taskIds)],
    };
  });
  return { volumes_for: keywordData?.geo || null, pages: targets };
}
