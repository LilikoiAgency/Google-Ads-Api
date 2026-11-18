// Analysis pass definitions for SEO Audit v2: what each pass sees (input
// slicing), what it is told (prompts), and what it must return (schemas).
// Pure: no server imports. A source that is unavailable is left out of the
// input entirely, never sent as an empty list.

import { TASK_JSON_SCHEMA } from './tasks';

export const PASSES = ['technical', 'content', 'local', 'conversion'];

export const CONTENT_CHUNK_SIZE = 8;
const HOMEPAGE_TEXT_CHARS = 1500;
const LOCAL_TEXT_CHARS = 1500;
const SCHEMA_CHARS = 3000;

// ── helpers ──────────────────────────────────────────────────────────────────

const has = (v) => v !== null && v !== undefined;
const pageUrl = (p) => p.final_url || p.url;

// Host without www, path without trailing slash, no query: joins crawl URLs
// to Search Console / GA4 URLs.
function matchKey(u) {
  try {
    const url = new URL(u);
    const host = url.host.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : '/';
    return `${host}${path}`;
  } catch {
    return String(u || '').toLowerCase().replace(/^https?:\/\/(www\.)?/, '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';
  }
}

// Only set keys whose value is available.
function compact(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) if (has(v)) out[k] = v;
  return out;
}

function schemaTypes(node, acc = new Set()) {
  if (Array.isArray(node)) {
    for (const n of node) schemaTypes(n, acc);
  } else if (node && typeof node === 'object') {
    const t = node['@type'];
    if (Array.isArray(t)) t.forEach((x) => acc.add(String(x)));
    else if (t) acc.add(String(t));
    for (const v of Object.values(node)) if (v && typeof v === 'object') schemaTypes(v, acc);
  }
  return acc;
}

function schemaSummary(markup) {
  const blocks = (markup || []).map((b) => (b.raw_json ?? (b.parse_error ? { parse_error: true, raw_text: b.raw_text } : null))).filter(Boolean);
  if (!blocks.length) return { schema_types: [] };
  const types = [...schemaTypes(blocks)];
  const json = JSON.stringify(blocks);
  return json.length <= SCHEMA_CHARS
    ? { schema_types: types, schema: blocks }
    : { schema_types: types, schema_excerpt: `${json.slice(0, SCHEMA_CHARS)}… [truncated]` };
}

const QUESTION = /^(who|what|when|where|why|how|which|can|do|does|is|are|should|will)\b|\?\s*$/i;
const isQuestion = (s) => QUESTION.test(String(s || '').trim());

const PHONE = /(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;
function phonesIn(text) {
  return [...new Set(String(text || '').match(PHONE) || [])].map((s) => s.trim()).slice(0, 5);
}

function gscPageMap(gscPages) {
  const map = new Map();
  for (const p of gscPages || []) map.set(matchKey(p.page), p);
  return map;
}

const searchFor = (gscMap, page) => {
  if (!gscMap) return null;
  const g = gscMap.get(matchKey(pageUrl(page)));
  if (!g) return null;
  return { clicks: g.clicks, impressions: g.impressions, ctr: g.ctr, position: g.position, queries: g.queries || [] };
};

// ── input slices ─────────────────────────────────────────────────────────────

function technicalInput(crawl, data) {
  const sitemap = {
    ours: compact({
      url_count: crawl.sitemap_url_count ?? 0,
      source: crawl.sitemap_source || null,
      accessible: crawl.sitemap_accessible ?? crawl.site_wide?.sitemap_accessible ?? null,
      child_sitemaps: crawl.sitemaps || null,
      note: 'url_count is the total across every child sitemap of the index.',
    }),
  };
  if (has(data.googleSitemaps)) sitemap.google = data.googleSitemaps;
  return compact({
    sitemap,
    robots_txt: crawl.site_wide ? compact({
      accessible: crawl.site_wide.robots_txt_accessible ?? null,
      content: crawl.site_wide.robots_txt_content || null,
    }) : null,
    pages: (crawl.pages_crawled || []).map((p) => compact({
      url: p.url,
      final_url: p.final_url && p.final_url !== p.url ? p.final_url : null,
      status_code: p.status_code ?? p.http_status ?? null,
      response_ms: p.response_ms ?? null,
      canonical_url: p.canonical_url || '',
      robots_meta: p.robots_meta || '',
      has_viewport_meta: p.has_viewport_meta ?? null,
      has_https: p.has_https ?? null,
      internal_links_count: p.internal_links_count ?? null,
    })),
    crawl_errors: crawl.crawl_errors?.length ? crawl.crawl_errors : null,
    inspection: data.inspection,
    pagespeed: data.pagespeed,
  });
}

function contentInput(crawl, data) {
  const gscMap = has(data.gscPages) ? gscPageMap(data.gscPages) : null;
  const pages = (crawl.pages_crawled || []).map((p) => compact({
    url: pageUrl(p),
    title_tag: p.title_tag || '',
    meta_description: p.meta_description || '',
    h1_tags: p.h1_tags || [],
    h2_tags: p.h2_tags || [],
    h3_tags: p.h3_tags || [],
    word_count: p.word_count ?? null,
    content_text: p.content_text || p.content_snippet || '',
    search: searchFor(gscMap, p),
  }));
  const shared = has(data.gsc) ? compact({
    search_period: data.gsc.range || null,
    striking_distance: data.gsc.striking_distance || null,
    low_ctr_page_one: data.gsc.low_ctr_page_one || null,
  }) : {};
  const chunks = [];
  for (let i = 0; i < pages.length; i += CONTENT_CHUNK_SIZE) chunks.push(pages.slice(i, i + CONTENT_CHUNK_SIZE));
  return chunks.map((chunkPages, i) => ({ chunk: i + 1, of: chunks.length, ...shared, pages: chunkPages }));
}

function localInput(crawl, data) {
  const sw = crawl.site_wide || {};
  const questionQueries = has(data.gscPages)
    ? [...new Set(data.gscPages.flatMap((p) => (p.queries || []).map((q) => q.query)).filter(isQuestion))].slice(0, 25)
    : null;
  return compact({
    site_contact: compact({
      contact_info: sw.contact_info || null,
      social_links: sw.social_links?.length ? sw.social_links : null,
      footer_links: sw.footer_links?.length ? sw.footer_links.slice(0, 30) : null,
    }),
    pages: (crawl.pages_crawled || []).map((p) => compact({
      url: pageUrl(p),
      title_tag: p.title_tag || '',
      h1_tags: p.h1_tags || [],
      ...schemaSummary(p.schema_markup),
      question_headings: [...(p.h2_tags || []), ...(p.h3_tags || [])].filter(isQuestion),
      phones_in_text: phonesIn(p.content_text),
      text_excerpt: String(p.content_text || '').slice(0, LOCAL_TEXT_CHARS),
    })),
    question_queries: questionQueries?.length ? questionQueries : null,
  });
}

function conversionInput(crawl, data) {
  if (!has(data.ga4)) return null;
  return compact({
    ga4: data.ga4,
    ga4_pages: data.ga4Pages,
    pages: (crawl.pages_crawled || []).map((p) => ({ url: pageUrl(p), title_tag: p.title_tag || '', h1_tags: p.h1_tags || [] })),
    site_contact: crawl.site_wide?.contact_info || null,
  });
}

// content -> array of chunks (may be empty); conversion -> null when GA4 is
// unavailable (the pass is skipped); others -> one object.
export function buildPassInput(passKey, { crawl, data } = {}) {
  const c = crawl || {};
  const d = data || {};
  switch (passKey) {
    case 'technical': return technicalInput(c, d);
    case 'content': return contentInput(c, d);
    case 'local': return localInput(c, d);
    case 'conversion': return conversionInput(c, d);
    default: throw new Error(`Unknown pass: ${passKey}`);
  }
}

// ── shared context (cached across calls) ─────────────────────────────────────

function gapLine(g) {
  if (typeof g === 'string') return g;
  return `${g.source}: ${g.status}${g.detail ? ` (${g.detail})` : ''}`;
}

// gaps: describeGaps() output (strings) or raw gap objects.
export function buildSharedContext({ domain, profile, homepage, gaps } = {}) {
  const lines = [
    '# Audit context',
    `Domain: ${domain}`,
    `Audit type: ${profile}`,
    '',
    '## Homepage (to infer what the business is, what it sells, and where it operates)',
  ];
  if (homepage) {
    lines.push(
      `URL: ${pageUrl(homepage)}`,
      `Title: ${homepage.title_tag || '(none)'}`,
      `Meta description: ${homepage.meta_description || '(none)'}`,
      `H1: ${(homepage.h1_tags || []).join(' | ') || '(none)'}`,
      `Text excerpt: ${String(homepage.content_text || '').slice(0, HOMEPAGE_TEXT_CHARS)}`,
    );
  } else {
    lines.push('(homepage not available)');
  }
  const gapLines = (gaps || []).map(gapLine).filter(Boolean);
  lines.push(
    '',
    '## Data gaps (sources that are missing; do not judge anything that depends on them)',
    ...(gapLines.length ? gapLines.map((g) => `- ${g}`) : ['- None: every source returned data.']),
  );
  return lines.join('\n');
}

// ── prompts ──────────────────────────────────────────────────────────────────

const ROLE = 'You are a senior SEO specialist auditing one website for an agency. Your output becomes a task list that the agency team, a developer, or a writer will execute as-is, so every task must be specific enough to do without further research.';

const RULES = `Rules (these override everything else):
1. Evidence. Every task must quote at least one evidence item taken from the input: a real number with its source and period (for example "4,210 impressions, 0.8% CTR, position 6.3 (Search Console, last 90 days)"), or exact text found on the page (for example 'Current title: "Home | Big Bully Turf"'). Copy numbers exactly as they appear in the input; do not round them into new claims or invent any. A task without input evidence must not be written.
2. Data gaps. The audit context lists data gaps. If the data needed to judge something is in the data gaps, or simply absent from the input, do not produce a task about it; instead add a finding that says it can't be verified and why. Never cite Search Console, Analytics, index status or page speed figures that are not in the input.
3. No generic tasks. Generic tasks are forbidden: "improve content quality", "build backlinks", "optimize title tags", "add more keywords", "improve page speed", "add schema" and anything else that could apply to any website. Each task names one page (its path, such as "/artificial-grass-installation") or "site-wide" only when the change truly applies to every page (robots.txt, sitemap, a template), and states the exact change: the exact new text, the exact section heading and what it covers, the exact schema type and properties, the exact redirect source and target, or the exact setting.

Writing rules:
- Use the page path (for example "/pricing" or "/"), not the full URL, in "page".
- Do not invent business facts (prices, years in business, awards, service areas, licence numbers). Where a change needs one, write a placeholder such as [confirm: years in business].
- Fewer, stronger tasks beat many weak ones. Do not repeat the same change on several tasks.
- impact: 1 (minor) to 5 (likely to move traffic or leads noticeably). effort: 1 (minutes, a text edit) to 5 (multi-day build). confidence: high when the evidence directly shows the problem, medium when it strongly suggests it, low when it is a reasoned bet.
- id: a short label such as "TECH-1"; it will be renumbered later.
- Write in plain, professional English that the agency can show a client. Never mention how this analysis was produced or the tools behind it.
- findings: what you observed, each with the evidence that supports it, including "can't verify" notes for data gaps. Keep each detail to a few sentences.`;

export const PASS_SYSTEM = {
  technical: `${ROLE}

This is the technical and indexing pass. The input has: our own sitemap read (url_count is the total across every child sitemap of an index, so a small child sitemap is not a problem by itself), Google's view of the submitted sitemaps when available, URL Inspection results when available (index verdict, coverage state, Google-chosen vs declared canonical, last crawl), each crawled page's status code, redirect target, response time, canonical tag, robots meta and viewport, robots.txt, crawl errors, and mobile PageSpeed results when available (performance score, LCP, INP, CLS, and real-user field data when present).

Look for, and only report what the input shows:
- Pages that are not indexed, excluded, or where Google chose a different canonical than the one declared; name the page and the coverage state.
- Mismatch between our sitemap count and Google's submitted count, sitemap errors or warnings, sitemaps Google hasn't read recently.
- Non-200 status codes, redirect chains or pages redirecting to a different URL than their canonical, canonicals pointing elsewhere, noindex/nofollow on pages that should rank, robots.txt rules blocking important paths.
- Core Web Vitals against Google's thresholds (LCP 2.5 s, INP 200 ms, CLS 0.1); when field data is present prefer it over lab data and say which one you used. Name the specific fix the numbers point to only when the input supports it.
Do not report issues on pages or sources that are not in the input.

${RULES}`,

  content: `${ROLE}

This is the content and keywords pass. The input is a batch of the site's top pages, each with its full visible text (content_text, up to 8,000 characters), title tag, meta description, headings, word count and, when Search Console is available, the page's own top queries (search.queries) with clicks, impressions, CTR and average position. It may also include site-level striking-distance queries (positions 4 to 20) and page-one queries with low CTR.

For every page in the input, write a per-page fix list in "pages":
- The exact new title: write the full replacement title in quotes (about 50 to 60 characters), built around the page's highest-value query when query data exists, and keep the brand name where the current title has it.
- The exact new meta description: write the full replacement text in quotes (about 140 to 155 characters), specific to what the page offers, with a reason to click.
- Named sections to add: for each, give the exact H2 heading in quotes and two or three sentences on what the section must cover, based on queries the page ranks for but does not answer, or on gaps visible in the page text. Never suggest a section the page already has.
- Each fix lists the queries it targets in targets_queries, copied exactly from the input; leave it empty when the page has no query data.
- If the current title or meta is already strong, say so in a fix instead of rewriting it for its own sake.

Then write "tasks" for the changes that matter most (a title and meta rewrite for a page is one task; a missing section is one task). Each task's evidence must quote the page's current title or text and, when available, the query numbers that justify it. Quote the current text exactly. When Search Console data is a data gap, base tasks on the page text alone and set confidence no higher than medium.

${RULES}`,

  local: `${ROLE}

This is the local, answer-engine and AI-search pass. The input has, per page: the JSON-LD schema types found (and the markup, or an excerpt when it is long), question-style headings, phone numbers found in the text, and a text excerpt; plus the site's contact details, social and footer links, and, when Search Console is available, the question-style queries people use to find the site.

Judge, from on-site evidence only:
- Business schema: is there a LocalBusiness (or a more specific subtype) with name, address, phone, opening hours, area served, and sameAs links that match the contact details and social links in the input? Name the page and the exact properties to add, with values copied from the input or placeholders.
- NAP consistency: different phone numbers or business names across pages, or a phone in the text that differs from the site contact phone.
- Location and service-area pages: whether cities or areas mentioned in the text have their own page, based only on what the text shows.
- Answer-engine readiness: question headings without a direct two-to-three sentence answer right below them, and question queries from the input that no page answers. Name the page, the exact question heading, and what the answer must state.
- AI-search readiness: whether the first paragraph of key pages states plainly who the business is, what it does and where. Give the exact replacement opening sentence when it does not.
- Review markup only when genuine reviews are shown on the page itself; never recommend marking up reviews the page doesn't show. Do not promise FAQ rich results in Google; FAQ markup is still worth adding where the page shows real questions and answers, because answer engines read it.

${RULES}`,

  conversion: `${ROLE}

This is the conversion pass, based on Google Analytics (GA4). The input has the site's traffic summary (all traffic and organic search, with change against the previous period), the channel mix, the organic landing pages, whether key events are configured (key_events_configured), per-page organic sessions, engagement rate and key events for the audited pages, the list of audited pages, and the site's contact details.

- If key_events_configured is false, return exactly one task: set up lead tracking. Name the exact key events to create (for example a form submission event on the contact form page, a click on tel: links using the phone number from the input, a click on mailto: links), and mark the key events in GA4. Do not write any other task that depends on key events, and set key_events_configured to false.
- Otherwise set key_events_configured to true and look for: organic landing pages with many sessions but few or no key events; pages with a low engagement rate compared with the site's organic average; shifts in the channel mix or organic trend that need action. Name the page, quote the numbers, and give the exact change (for example a specific call-to-action block, its heading and where on the page it goes).
- Engagement rate may be missing for some pages; never guess it.

${RULES}`,
};

export const SYNTH_SYSTEM = `${ROLE}

This is the final step. The input has the findings and tasks from four focused analysis passes (technical, content, local and answer-engine, conversion), the data gaps, and the headline numbers. Produce the final audit:

- client_summary: three to five plain sentences a business owner understands, with no jargon. State the most important opportunity and the biggest problem, using real numbers from the input. Never mention how the audit was produced or the tools behind it.
- top_moves: exactly three items, the three highest-value tasks from the action plan, rephrased for the client: a short title, one or two sentences on why it matters in business terms, and the page.
- scores: SEO (search visibility and technical health), GEO (readiness for AI-powered search: clear entity facts, structured data, quotable content) and AEO (readiness for answer engines: direct answers to questions, question coverage), each 0 to 10 with a one-line reason that cites the evidence. Base scores only on the input; where data gaps limit a score, say so in the reason.
- action_plan: every task from the passes, with duplicates and overlapping tasks merged into one (keep the most specific exact change and combine the evidence). Keep each task's evidence and exact change; do not shorten them into generic advice. Drop any task that has no evidence from the input, that depends on a data gap, or that is generic. Do not add new tasks that the passes did not support.
- data_gaps: each data gap restated for a client in one plain sentence (what is missing and what it means for the audit). Include passes that are marked as not completed.

Every task in the action plan must keep at least one evidence item copied from the pass outputs. Generic tasks are forbidden.`;

// ── schemas ──────────────────────────────────────────────────────────────────

const str = { type: 'string' };
const strList = { type: 'array', items: str };
const closed = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });

const FINDINGS = { type: 'array', items: closed({ title: str, detail: str, evidence: strList }) };
const TASKS = { type: 'array', items: TASK_JSON_SCHEMA };

export function passSchema(passKey) {
  if (!PASSES.includes(passKey)) throw new Error(`Unknown pass: ${passKey}`);
  const props = { findings: FINDINGS, tasks: TASKS };
  if (passKey === 'content') {
    props.pages = {
      type: 'array',
      items: closed({ page: str, fixes: { type: 'array', items: closed({ change: str, targets_queries: strList }) } }),
    };
  }
  if (passKey === 'conversion') props.key_events_configured = { type: 'boolean' };
  return closed(props);
}

const SCORE = closed({ score: { type: 'integer', enum: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10] }, reason: str });

export const synthSchema = closed({
  client_summary: str,
  top_moves: { type: 'array', items: closed({ title: str, why: str, page: str }), minItems: 1 },
  scores: closed({ seo: SCORE, geo: SCORE, aeo: SCORE }),
  action_plan: TASKS,
  data_gaps: strList,
});
