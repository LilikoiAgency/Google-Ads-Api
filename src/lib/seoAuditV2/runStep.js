// Runs one SEO Audit v2 step for a job whose step is already marked running.
// Never throws: resolves to { ok, patch, error, gaps? }, where patch holds dotted
// fields to store on the job (data.*, passes.*, result) and gaps holds
// sentences to add to the job's data gaps.

import { crawlSite } from '../seoCrawler';
import { seedPages, gatherAll, describeGaps, AUDIT_PROFILES } from './gather';
import {
  PASSES, PASS_SYSTEM, SYNTH_SYSTEM, buildPassInput, buildSharedContext, passSchema, synthSchema,
  normalizeTaskIds, buildSynthInput, buildActionPlan, resolveTopMoves, resolveContentChunk,
} from './passes';
import { runStructured } from './llm';
import { isGenericTask, isEmptyTask, pathKey } from './tasks';
import { effortForAttempt } from './jobs';
import { pageLimit, filterSkipped, bareHost } from './options';
import { buildSearchSummary } from './overview';
import { getSavedLocations, saveReviewTexts, getReviewTexts } from './reputationStore';
import { brandName, businessCity } from './reviews';
import { buildSearchQueries, runWebSearch } from './search';
import { guardTargets, buildTargetsResult } from './targets';

const SOURCES = {
  search_console: 'gsc',
  url_inspection: 'inspection',
  sitemaps: 'googleSitemaps',
  ga4: 'ga4',
  pagespeed: 'pagespeed',
  reviews: 'reviews',
  ai_search: 'aiSearch',
  keyword_planner: 'keywords',
};

const PASS_AREA = {
  technical: 'Technical & indexing',
  content: 'Content & keywords',
  local: 'Local & AI search',
  conversion: 'Conversion',
  reputation: 'Reputation',
  targets: 'Target keywords',
};

const errText = (err) => {
  const msg = err?.message || String(err);
  return err?.code ? `${err.code}: ${msg}` : msg;
};

const profileOf = (job) => AUDIT_PROFILES[job.auditType] || AUDIT_PROFILES.quick;
const stepOf = (job, key) => job.steps.find((s) => s.key === key) || {};
const effortFor = (job, key) => effortForAttempt(profileOf(job).effort, stepOf(job, key).attempts || 1);

// Overall time budget for fetching pages, leaving room in the 300s request for the rest.
export const CRAWL_DEADLINE_MS = 200_000;

async function crawlWith(job) {
  const o = job.options;
  if (!o) {
    const seedUrls = await seedPages(job.domain, job.auditType);
    return crawlSite(job.domain, job.auditType, null, { seedUrls, deadlineMs: CRAWL_DEADLINE_MS });
  }
  // Listed pages first (never skipped), then Search Console pages minus skip patterns.
  const limit = pageLimit(job.auditType, o);
  const listed = o.pages || [];
  const fromGsc = o.onlyListed
    ? []
    : filterSkipped(await seedPages(job.domain, job.auditType, Math.min(25, Math.max(5, Math.ceil(limit / 2))), { gscSite: o.gscSite }), o.skip)
      .filter((u) => !listed.includes(u));
  return crawlSite(job.domain, job.auditType, o.onlyListed ? listed : null, {
    seedUrls: o.onlyListed ? [] : [...listed, ...fromGsc], deadlineMs: CRAWL_DEADLINE_MS, pageLimit: limit, skip: o.skip || [],
  });
}

async function runCrawl(job) {
  const crawl = await crawlWith(job);
  if (!crawl?.pages_crawled?.length) {
    return { ok: false, error: `No pages could be crawled on ${job.domain}` };
  }
  const res = { ok: true, patch: { 'data.crawl': crawl } };
  const gaps = [];
  if (crawl.crawl_truncated) {
    const n = crawl.pages_crawled.length;
    gaps.push(`Crawl stopped early after ${n} page${n === 1 ? '' : 's'} because the site responded slowly.`);
  }
  if (crawl.sitemap_partial) gaps.push('Reading the sitemaps stopped early because they were slow to load, so the sitemap check is incomplete.');
  if (gaps.length) res.gaps = gaps;
  return res;
}

async function runGather(job) {
  const crawl = job.data?.crawl;
  const o = job.options;
  let locations = o?.locations ?? null;
  if (!locations) {
    try {
      locations = (await getSavedLocations(job.domain)) ?? null;
    } catch (err) {
      console.warn('[seo-audit-v2] saved review locations unavailable:', errText(err));
    }
  }
  const { data, gaps, reviewTexts } = await gatherAll(o
    ? {
      domain: job.domain, crawl, profile: job.auditType, priorityUrls: o.pages || [], onlyListed: !!o.onlyListed, skip: o.skip || [],
      ...(o.gscSite ? { gscSite: o.gscSite } : {}),
      ...(o.ga4Property ? { ga4Property: o.ga4Property } : {}),
      ...(o.targets?.length ? { targets: o.targets } : {}),
      locations,
    }
    : { domain: job.domain, crawl, profile: job.auditType, locations });
  // Review text is cached by job id for the reputation step and kept off the job document.
  if (reviewTexts && Object.keys(reviewTexts).length) {
    try {
      await saveReviewTexts(job.id, reviewTexts);
    } catch (err) {
      console.warn('[seo-audit-v2] saving review text failed:', errText(err));
    }
  }
  const pages = crawl?.pages_crawled || [];
  const homepage = pages.find((p) => p.page_type === 'homepage') || pages[0] || null;
  const sharedContext = buildSharedContext({ domain: job.domain, profile: job.auditType, homepage, gaps: describeGaps(gaps) });
  return { ok: true, patch: { 'data.sources': data, 'data.gaps': gaps, 'data.sharedContext': sharedContext } };
}

const SEARCH_GAP = "Web search check didn't complete.";

// A search or API failure only leaves a gap; a timeout fails the step so it retries.
async function runSearch(job) {
  const sources = job.data?.sources || {};
  const crawl = job.data?.crawl;
  const brand = brandName(crawl, job.domain);
  const loc = businessCity(sources.reviews, crawl);
  const city = loc?.city || null;
  const region = loc?.region || null;
  const queries = buildSearchQueries({ gscPages: sources.gscPages, crawl, brand, city });
  const failed = { ok: true, patch: { 'data.sources.aiSearch': null }, gaps: [SEARCH_GAP] };
  if (!queries.length) return failed;
  try {
    const out = await runWebSearch({ queries, brand, domain: job.domain, city, region, email: job.email });
    if (out.status === 'error') {
      console.warn('[seo-audit-v2] web search failed:', out.error);
      return failed;
    }
    return { ok: true, patch: { 'data.sources.aiSearch': out } };
  } catch (err) {
    if (err?.code === 'timeout') return { ok: false, error: errText(err) };
    console.warn('[seo-audit-v2] web search failed:', errText(err));
    return failed;
  }
}

const MAX_QUOTE_CHARS = 200;

// Theme quotes must be short and really appear in a cached review; counts can't exceed the reviews given.
function guardThemes(themes, locations, reviewTexts) {
  if (!Array.isArray(themes)) return themes;
  const byLoc = {};
  const all = [];
  for (const l of locations || []) {
    const list = (reviewTexts?.[l.id] || []).map((r) => String(r.text || '').toLowerCase());
    byLoc[l.name] = list;
    all.push(...list);
  }
  const known = all.length > 0;
  return themes.map((t) => {
    const pool = byLoc[t.location]?.length ? byLoc[t.location] : all;
    const quotes = known
      ? (t.quotes || []).filter((q) => {
        const lq = String(q || '').trim().toLowerCase();
        return lq && lq.length <= MAX_QUOTE_CHARS && pool.some((x) => x.includes(lq));
      })
      : [];
    const count = known && Number.isFinite(t.count) ? Math.min(t.count, pool.length) : t.count;
    return { ...t, quotes, count };
  });
}

async function runPass(job, key) {
  const pass = key.slice('pass:'.length);
  const data = job.data?.sources;
  let passData = data;
  let reviewTexts = null;
  if (pass === 'reputation') {
    // Review text is cached by job id, never stored on the job; a failed lookup just means stats only.
    reviewTexts = await getReviewTexts(job.id).catch(() => null);
    passData = { ...data, reviewTexts };
  }
  const input = buildPassInput(pass, { crawl: job.data?.crawl, data: passData, domain: job.domain, targetOptions: job.options?.targets });
  const call = (inp) => runStructured({
    system: PASS_SYSTEM[pass],
    sharedContext: job.data?.sharedContext,
    input: inp,
    schema: passSchema(pass),
    effort: effortFor(job, key),
    label: key,
    email: job.email,
  });

  let out;
  const gaps = [];
  if (input == null) {
    // Source the pass depends on (GA4 for conversion) is unavailable; the gap is already listed.
    out = { skipped: true, findings: [], tasks: [] };
  } else if (pass === 'content') {
    // A chunk that errors, leaves a page without a fix list, or returns a task
    // without a change or reason counts as failed. The pass succeeds when at
    // least one chunk does; pages from failed chunks become a job gap.
    const settled = await Promise.allSettled(input.map((chunk) => call(chunk)));
    out = { findings: [], tasks: [], pages: [] };
    const missed = [];
    const errors = []; // call errors first: they carry a PassError code
    let okCount = 0;
    settled.forEach((s, i) => {
      const chunkPages = (input[i].pages || []).map((p) => pathKey(p.url));
      if (s.status === 'rejected') {
        errors.unshift(errText(s.reason));
        missed.push(...chunkPages);
        return;
      }
      const r = resolveContentChunk(input[i], s.value?.output);
      if (!r.ok) {
        errors.push(`Content chunk ${input[i].chunk ?? i + 1} was incomplete${r.uncovered.length ? ` (no fixes for ${r.uncovered.join(', ')})` : ''}`);
        missed.push(...chunkPages);
        return;
      }
      okCount += 1;
      out.findings.push(...r.findings);
      out.tasks.push(...normalizeTaskIds(pass, input[i].chunk ?? i + 1, r.tasks));
      out.pages.push(...r.pages);
    });
    if (input.length && !okCount) return { ok: false, error: errors[0] };
    if (missed.length) {
      gaps.push(`${PASS_AREA.content} analysis didn't cover ${[...new Set(missed)].join(', ')} — rerun to include them`);
    }
  } else {
    const { output } = await call(input);
    out = { ...output, tasks: normalizeTaskIds(pass, null, output?.tasks) };
    if (pass === 'reputation') out.themes = guardThemes(out.themes, data?.reviews, reviewTexts);
    if (pass === 'targets') out.targets = guardTargets(out.targets, input);
  }
  out.tasks = (out.tasks || [])
    .map((t) => ({ ...t, page: pathKey(t.page) }))
    .filter((t) => !isGenericTask(t) && !isEmptyTask(t));
  const res = { ok: true, patch: { [`passes.${pass}`]: out } };
  if (gaps.length) res.gaps = gaps;
  return res;
}

function dataSources(job) {
  const sources = job.data?.sources || {};
  const gaps = job.data?.gaps || [];
  const out = { crawl: { status: 'ok', pages: job.data?.crawl?.pages_crawled?.length || 0 } };
  for (const [name, field] of Object.entries(SOURCES)) {
    if (name === 'keyword_planner' && !job.options?.targets?.length) continue; // only fetched for target pages
    const gap = gaps.find((g) => g.source === name);
    out[name] = { status: sources[field] != null ? 'ok' : gap?.status || 'no_data' };
  }
  // Which properties the numbers came from, so a wrong match is easy to spot.
  if (sources.gsc?.site) out.search_console.site = sources.gsc.site;
  else if (job.options?.gscSite) out.search_console.site = job.options.gscSite;
  if (sources.ga4Property) out.ga4.property = sources.ga4Property;
  else if (job.options?.ga4Property?.name) out.ga4.property = job.options.ga4Property.name;
  return out;
}

const byPath = (list) => new Map((list || []).filter((x) => x?.url || x?.page).map((x) => [pathKey(x.url || x.page), x]));

// Older audits checked both "https://x.com/" and "https://www.x.com/", which share
// a path. Keep the indexed result over a redirect (first wins on a tie).
function inspectionByPath(list) {
  const out = new Map();
  for (const r of list || []) {
    if (!r?.url || r.error) continue;
    const k = pathKey(r.url);
    const held = out.get(k);
    if (!held || (held.verdict !== 'PASS' && r.verdict === 'PASS')) out.set(k, r);
  }
  return out;
}

// Speed for the same address the index result came from, when there are several.
function speedByPath(list, inspection) {
  const out = byPath(list);
  for (const s of list || []) {
    const i = s?.url && inspection.get(pathKey(s.url));
    if (i && s.url === i.url) out.set(pathKey(s.url), s);
  }
  return out;
}

// Content-pass pages plus any page that was inspected or measured, each with its
// index status, speed and top Search Console queries (null / [] when unavailable).
// Every page is keyed and labelled by its path ("/services/turf"), as tasks are.
function buildPages(job) {
  const sources = job.data?.sources || {};
  const inspection = inspectionByPath(sources.inspection);
  const speed = speedByPath(sources.pagespeed, inspection);
  const gsc = byPath(sources.gscPages);

  const entries = new Map();
  for (const p of job.passes?.content?.pages || []) {
    const k = pathKey(p.page);
    if (!entries.has(k)) entries.set(k, { ...p, page: k, fixes: p.fixes || [] });
  }
  for (const k of [...inspection.keys(), ...speed.keys()]) {
    if (!entries.has(k)) entries.set(k, { page: k, fixes: [] });
  }

  return [...entries.entries()].map(([k, p]) => {
    const i = inspection.get(k);
    const s = speed.get(k);
    const g = gsc.get(k);
    return {
      ...p,
      index: i ? {
        verdict: i.verdict, coverage_state: i.coverage_state, canonical_mismatch: i.canonical_mismatch,
        google_canonical: i.google_canonical, last_crawl: i.last_crawl,
      } : null,
      speed: s ? { score: s.score, lcp_ms: s.lcp_ms, inp_ms: s.inp_ms, cls: s.cls, field: s.field ?? null } : null,
      top_queries: (g?.queries || []).slice(0, 5).map((q) => ({
        query: q.query, clicks: q.clicks, impressions: q.impressions, position: q.position,
      })),
    };
  });
}

// Skipped on purpose (quick audit, no target pages), or a step an older job never had.
const OPTIONAL_PASSES = ['reputation', 'targets'];
function passSkipped(job, pass) {
  const step = stepOf(job, `pass:${pass}`);
  return step.skipped === true || (OPTIONAL_PASSES.includes(pass) && !step.key);
}

function resultHost(r) {
  if (r?.host) return bareHost(r.host);
  try {
    return bareHost(new URL(r?.url).hostname);
  } catch {
    return '';
  }
}

// Reviews stats, themes and the web search check, or undefined when neither source has data.
function buildReputation(job, reputationDone) {
  const reviews = job.data?.sources?.reviews;
  const search = job.data?.sources?.aiSearch;
  const hasReviews = Array.isArray(reviews) && reviews.length > 0;
  const hasSearch = Array.isArray(search?.queries) && search.queries.length > 0;
  if (!hasReviews && !hasSearch) return undefined;
  const pass = reputationDone ? job.passes.reputation : null;
  const domain = bareHost(job.domain);
  const queries = hasSearch ? search.queries : [];
  const checked = queries.filter((q) => !q.error); // an errored query was never really searched
  return {
    locations: hasReviews
      ? reviews.map((l) => ({ name: l.name, city: l.city, source: l.source, coverage: l.coverage, stats: l.stats }))
      : [],
    themes: pass?.themes || [],
    search: hasSearch
      ? {
        appear_count: checked.filter((q) => q.you_appear).length,
        total: checked.length,
        summary: pass?.search_summary?.summary ?? null,
        queries: queries.map((q) => ({
          query: q.query,
          you_appear: !!q.you_appear,
          ...(q.error ? { error: String(q.error) } : {}),
          others: [...new Set((q.results || []).map(resultHost).filter((h) => h && h !== domain))].slice(0, 3),
        })),
      }
      : null,
    attribution: hasReviews && reviews.some((l) => l.source === 'places') ? 'Source: Google reviews' : null,
  };
}

async function runSynthesize(job) {
  const done = PASSES.filter((p) => stepOf(job, `pass:${p}`).status === 'done' && !passSkipped(job, p) && job.passes?.[p]);
  const notCompleted = PASSES.filter((p) => !done.includes(p) && !passSkipped(job, p)).map((p) => PASS_AREA[p]);
  const passOutputs = Object.fromEntries(done.map((p) => [p, job.passes[p]]));

  const { output: synth } = await runStructured({
    system: SYNTH_SYSTEM,
    sharedContext: job.data?.sharedContext,
    input: buildSynthInput(passOutputs, notCompleted.length ? { passes_not_completed: notCompleted } : {}),
    schema: synthSchema,
    effort: effortFor(job, 'synthesize'),
    label: 'synthesize',
    email: job.email,
  });

  const plan = buildActionPlan(done.map((p) => job.passes[p].tasks || []), synth);
  // One deterministic list: source gaps plus job gaps (incomplete passes, crawl cut short).
  const dataGaps = [...new Set([...describeGaps(job.data?.gaps), ...(job.gaps || [])])];
  const reputation = buildReputation(job, done.includes('reputation'));
  const targets = buildTargetsResult({
    targetOptions: job.options?.targets,
    keywordData: job.data?.sources?.keywords,
    guarded: done.includes('targets') ? job.passes.targets.targets : null,
    plan,
  });
  const result = {
    version: 2,
    domain: job.domain,
    audit_type: job.auditType,
    ...(job.options ? { audit_options: job.options } : {}),
    audit_date: new Date().toISOString().slice(0, 10),
    client_summary: synth.client_summary,
    top_moves: resolveTopMoves(plan, synth),
    scores: synth.scores,
    action_plan: plan,
    pages: buildPages(job),
    findings: Object.fromEntries(
      PASSES.filter((p) => !OPTIONAL_PASSES.includes(p) || done.includes(p)).map((p) => [p, done.includes(p) ? job.passes[p].findings || [] : []]),
    ),
    passes_completed: Object.fromEntries(PASSES.filter((p) => !passSkipped(job, p)).map((p) => [p, done.includes(p)])),
    data_gaps: dataGaps,
    data_sources: dataSources(job),
    ...(reputation ? { reputation } : {}),
    ...(targets ? { targets } : {}),
    // Headline search numbers and index counts for the overview.
    ...buildSearchSummary(job.data?.sources?.gsc, job.data?.sources?.inspection),
  };
  return { ok: true, patch: { result } };
}

export async function runStep(job, key) {
  try {
    if (key === 'crawl') return await runCrawl(job);
    if (key === 'gather') return await runGather(job);
    if (key === 'search') return await runSearch(job);
    if (key.startsWith('pass:')) return await runPass(job, key);
    if (key === 'synthesize') return await runSynthesize(job);
    return { ok: false, error: `Unknown step: ${key}` };
  } catch (err) {
    console.error(`[seo-audit-v2] step ${key} failed:`, errText(err));
    return { ok: false, error: errText(err) };
  }
}
