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
import { pageLimit, filterSkipped } from './options';
import { buildSearchSummary } from './overview';

const SOURCES = {
  search_console: 'gsc',
  url_inspection: 'inspection',
  sitemaps: 'googleSitemaps',
  ga4: 'ga4',
  pagespeed: 'pagespeed',
};

const PASS_AREA = {
  technical: 'Technical & indexing',
  content: 'Content & keywords',
  local: 'Local & AI search',
  conversion: 'Conversion',
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
    : filterSkipped(await seedPages(job.domain, job.auditType, Math.min(25, Math.max(5, Math.ceil(limit / 2)))), o.skip)
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
  const { data, gaps } = await gatherAll(o
    ? { domain: job.domain, crawl, profile: job.auditType, priorityUrls: o.pages || [], onlyListed: !!o.onlyListed, skip: o.skip || [] }
    : { domain: job.domain, crawl, profile: job.auditType });
  const pages = crawl?.pages_crawled || [];
  const homepage = pages.find((p) => p.page_type === 'homepage') || pages[0] || null;
  const sharedContext = buildSharedContext({ domain: job.domain, profile: job.auditType, homepage, gaps: describeGaps(gaps) });
  return { ok: true, patch: { 'data.sources': data, 'data.gaps': gaps, 'data.sharedContext': sharedContext } };
}

async function runPass(job, key) {
  const pass = key.slice('pass:'.length);
  const input = buildPassInput(pass, { crawl: job.data?.crawl, data: job.data?.sources });
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
    const gap = gaps.find((g) => g.source === name);
    out[name] = { status: sources[field] != null ? 'ok' : gap?.status || 'no_data' };
  }
  return out;
}

const byPath = (list) => new Map((list || []).filter((x) => x?.url || x?.page).map((x) => [pathKey(x.url || x.page), x]));

// Content-pass pages plus any page that was inspected or measured, each with its
// index status, speed and top Search Console queries (null / [] when unavailable).
// Every page is keyed and labelled by its path ("/services/turf"), as tasks are.
function buildPages(job) {
  const sources = job.data?.sources || {};
  const inspection = byPath((sources.inspection || []).filter((r) => !r.error));
  const speed = byPath(sources.pagespeed);
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

async function runSynthesize(job) {
  const done = PASSES.filter((p) => stepOf(job, `pass:${p}`).status === 'done' && job.passes?.[p]);
  const notCompleted = PASSES.filter((p) => !done.includes(p)).map((p) => PASS_AREA[p]);
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
    findings: Object.fromEntries(PASSES.map((p) => [p, done.includes(p) ? job.passes[p].findings || [] : []])),
    passes_completed: Object.fromEntries(PASSES.map((p) => [p, done.includes(p)])),
    data_gaps: dataGaps,
    data_sources: dataSources(job),
    // Headline search numbers and index counts for the overview.
    ...buildSearchSummary(job.data?.sources?.gsc, job.data?.sources?.inspection),
  };
  return { ok: true, patch: { result } };
}

export async function runStep(job, key) {
  try {
    if (key === 'crawl') return await runCrawl(job);
    if (key === 'gather') return await runGather(job);
    if (key.startsWith('pass:')) return await runPass(job, key);
    if (key === 'synthesize') return await runSynthesize(job);
    return { ok: false, error: `Unknown step: ${key}` };
  } catch (err) {
    console.error(`[seo-audit-v2] step ${key} failed:`, errText(err));
    return { ok: false, error: errText(err) };
  }
}
