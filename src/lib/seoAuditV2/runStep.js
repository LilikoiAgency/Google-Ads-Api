// Runs one SEO Audit v2 step for a job whose step is already marked running.
// Never throws: resolves to { ok, patch, error }, where patch holds dotted
// fields to store on the job (data.*, passes.*, result).

import { crawlSite } from '../seoCrawler';
import { seedPages, gatherAll, describeGaps, AUDIT_PROFILES } from './gather';
import {
  PASSES, PASS_SYSTEM, SYNTH_SYSTEM, buildPassInput, buildSharedContext, passSchema, synthSchema,
  normalizeTaskIds, buildSynthInput, buildActionPlan, resolveTopMoves,
} from './passes';
import { runStructured } from './llm';
import { isGenericTask } from './tasks';
import { effortForAttempt } from './jobs';

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

async function runCrawl(job) {
  const seedUrls = await seedPages(job.domain, job.auditType);
  const crawl = await crawlSite(job.domain, job.auditType, null, { seedUrls });
  if (!crawl?.pages_crawled?.length) {
    return { ok: false, error: `No pages could be crawled on ${job.domain}` };
  }
  return { ok: true, patch: { 'data.crawl': crawl } };
}

async function runGather(job) {
  const crawl = job.data?.crawl;
  const { data, gaps } = await gatherAll({ domain: job.domain, crawl, profile: job.auditType });
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
  if (input == null) {
    // Source the pass depends on (GA4 for conversion) is unavailable; the gap is already listed.
    out = { skipped: true, findings: [], tasks: [] };
  } else if (pass === 'content') {
    const settled = await Promise.allSettled(input.map((chunk) => call(chunk)));
    const failed = settled.find((s) => s.status === 'rejected');
    if (failed) return { ok: false, error: errText(failed.reason) };
    out = { findings: [], tasks: [], pages: [] };
    settled.forEach((s, i) => {
      const o = s.value.output || {};
      out.findings.push(...(o.findings || []));
      out.tasks.push(...normalizeTaskIds(pass, input[i].chunk ?? i + 1, o.tasks));
      out.pages.push(...(o.pages || []));
    });
  } else {
    const { output } = await call(input);
    out = { ...output, tasks: normalizeTaskIds(pass, null, output?.tasks) };
  }
  out.tasks = (out.tasks || []).filter((t) => !isGenericTask(t));
  return { ok: true, patch: { [`passes.${pass}`]: out } };
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
  const dataGaps = [...new Set([
    ...describeGaps(job.data?.gaps),
    ...(job.gaps || []),
    ...(synth.data_gaps || []),
  ])];
  const result = {
    version: 2,
    domain: job.domain,
    audit_type: job.auditType,
    audit_date: new Date().toISOString().slice(0, 10),
    client_summary: synth.client_summary,
    top_moves: resolveTopMoves(plan, synth),
    scores: synth.scores,
    action_plan: plan,
    pages: job.passes?.content?.pages || [],
    findings: Object.fromEntries(PASSES.map((p) => [p, done.includes(p) ? job.passes[p].findings || [] : []])),
    data_gaps: dataGaps,
    data_sources: dataSources(job),
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
