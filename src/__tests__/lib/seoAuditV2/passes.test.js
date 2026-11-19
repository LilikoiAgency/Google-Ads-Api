import { describe, it, expect } from 'vitest';
import {
  PASSES, PASS_SYSTEM, SYNTH_SYSTEM, CONTENT_CHUNK_SIZE, buildPassInput, buildSharedContext, passSchema, synthSchema,
  normalizeTaskIds, buildSynthInput, buildActionPlan, resolveTopMoves, resolveContentChunk, fixPageCount,
} from '@/lib/seoAuditV2/passes';

const page = (i, extra = {}) => ({
  url: `https://x.com/p${i}`,
  final_url: `https://x.com/p${i}`,
  status_code: 200,
  title_tag: `Title ${i}`,
  meta_description: `Meta ${i}`,
  canonical_url: `https://x.com/p${i}`,
  robots_meta: '',
  h1_tags: [`H1 ${i}`],
  h2_tags: ['What does turf cost?'],
  h3_tags: [],
  schema_markup: [{ type: 'application/ld+json', raw_json: { '@type': 'LocalBusiness', name: 'X' } }],
  images: { count: 3, missing_alt: 1, examples_missing_alt: ['a.jpg'] },
  content_text: `Body text ${i}. Call (555) 123-4567.`,
  word_count: 300,
  ...extra,
});

const crawl = (n) => ({
  pages_crawled: Array.from({ length: n }, (_, i) => page(i)),
  sitemap_url_count: 120,
  sitemap_source: 'sitemap_index',
  sitemaps: [{ url: 'https://x.com/post-sitemap.xml', count: 3 }, { url: 'https://x.com/page-sitemap.xml', count: 117 }],
  site_wide: { robots_txt_accessible: true, robots_txt_content: 'User-agent: *', contact_info: { phone: '5551234567' } },
  crawl_errors: [],
});

const emptyData = { gsc: null, gscPages: null, inspection: null, googleSitemaps: null, ga4: null, ga4Pages: null, pagespeed: null };

const fullData = {
  gsc: {
    range: { startDate: '2026-08-20', endDate: '2026-11-17' },
    totals: { clicks: 10, impressions: 1000 },
    striking_distance: [{ query: 'turf cost', impressions: 500, position: 8 }],
    low_ctr_page_one: [{ query: 'artificial turf', impressions: 900, ctr: 0.01, position: 3 }],
    top_queries: [],
  },
  gscPages: [{ page: 'https://www.x.com/p1/', clicks: 5, impressions: 400, ctr: 0.0125, position: 6.1, queries: [{ query: 'how much is turf', clicks: 1, impressions: 50, ctr: 0.02, position: 7 }] }],
  inspection: [{ url: 'https://x.com/p0', verdict: 'PASS', coverage_state: 'Submitted and indexed' }],
  googleSitemaps: [{ path: 'https://x.com/sitemap_index.xml', submitted: 120 }],
  ga4: { organic_search: { sessions: 100, key_events: 0 }, key_events_configured: false, channels: [] },
  ga4Pages: [{ page: 'https://x.com/p0', organic_sessions: 40, engagement_rate: 0.5, key_events: 0 }],
  pagespeed: [{ url: 'https://x.com/p0', performance: 41 }],
};

describe('PASSES', () => {
  it('lists the four passes', () => {
    expect(PASSES).toEqual(['technical', 'content', 'local', 'conversion']);
  });
});

describe('buildPassInput', () => {
  it('technical gets no page content', () => {
    const input = buildPassInput('technical', { crawl: crawl(3), data: fullData });
    const json = JSON.stringify(input);
    expect(json).not.toContain('Body text');
    expect(input.pages).toHaveLength(3);
    expect(input.pages[0]).not.toHaveProperty('content_text');
    expect(input.sitemap.ours.url_count).toBe(120);
    expect(input.sitemap.google).toEqual(fullData.googleSitemaps);
    expect(input.inspection).toEqual(fullData.inspection);
    expect(input.pagespeed).toEqual(fullData.pagespeed);
  });

  it('content chunks 10 pages into 3 chunks of at most 4', () => {
    expect(CONTENT_CHUNK_SIZE).toBe(4);
    const chunks = buildPassInput('content', { crawl: crawl(10), data: fullData });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.pages.length)).toEqual([4, 4, 2]);
    expect(chunks.map((c) => [c.chunk, c.of])).toEqual([[1, 3], [2, 3], [3, 3]]);
    expect(chunks[1].note).toMatch(/^This is chunk 2 of 3; other chunks cover other pages\./);
    const p = chunks[0].pages[0];
    expect(p).toMatchObject({ title_tag: 'Title 0', meta_description: 'Meta 0', h1_tags: ['H1 0'] });
    expect(p.content_text).toContain('Body text 0');
  });

  it('content joins each page to its queries across www and trailing slash', () => {
    const [chunk] = buildPassInput('content', { crawl: crawl(3), data: fullData });
    expect(chunk.pages[1].search.queries[0].query).toBe('how much is turf');
    expect(chunk.pages[0]).not.toHaveProperty('search');
    expect(chunk.striking_distance).toEqual(fullData.gsc.striking_distance);
  });

  it('pass input omits unavailable sources', () => {
    const tech = buildPassInput('technical', { crawl: crawl(2), data: emptyData });
    expect(tech).not.toHaveProperty('inspection');
    expect(tech).not.toHaveProperty('pagespeed');
    expect(tech.sitemap).not.toHaveProperty('google');
    const [content] = buildPassInput('content', { crawl: crawl(2), data: emptyData });
    expect(content).not.toHaveProperty('striking_distance');
    expect(content).not.toHaveProperty('low_ctr_page_one');
    for (const p of content.pages) expect(p).not.toHaveProperty('search');
    const local = buildPassInput('local', { crawl: crawl(2), data: emptyData });
    expect(local).not.toHaveProperty('question_queries');
    for (const key of ['gsc', 'search_console', 'inspection', 'pagespeed', 'ga4', 'google_sitemaps']) {
      expect(JSON.stringify([tech, content, local])).not.toContain(`"${key}"`);
    }
  });

  it('conversion is omitted when GA4 is null', () => {
    expect(buildPassInput('conversion', { crawl: crawl(2), data: emptyData })).toBeNull();
    const conv = buildPassInput('conversion', { crawl: crawl(2), data: fullData });
    expect(conv.ga4).toEqual(fullData.ga4);
    expect(conv.ga4_pages).toEqual(fullData.ga4Pages);
  });

  it('local gets schema types, question headings and phone numbers', () => {
    const local = buildPassInput('local', { crawl: crawl(1), data: fullData });
    const p = local.pages[0];
    expect(p.schema_types).toEqual(['LocalBusiness']);
    expect(p.question_headings).toEqual(['What does turf cost?']);
    expect(p.phones_in_text).toEqual(['(555) 123-4567']);
    expect(local.question_queries).toEqual(['how much is turf']);
  });

  it('bounds large schema blocks', () => {
    const big = { '@type': 'Organization', description: 'x'.repeat(10000) };
    const c = crawl(1);
    c.pages_crawled[0].schema_markup = [{ raw_json: big }];
    const local = buildPassInput('local', { crawl: c, data: emptyData });
    expect(JSON.stringify(local).length).toBeLessThan(6000);
    expect(local.schema_blocks[0].schema_excerpt).toMatch(/\[truncated\]$/);
  });

  it('local sends each identical schema block once with the pages carrying it', () => {
    const c = crawl(3);
    const extra = { '@type': 'FAQPage', mainEntity: [] };
    c.pages_crawled[2].schema_markup = [...c.pages_crawled[2].schema_markup, { raw_json: extra }];
    const local = buildPassInput('local', { crawl: c, data: emptyData });
    expect(local.schema_blocks).toEqual([
      { pages: ['https://x.com/p0', 'https://x.com/p1', 'https://x.com/p2'], schema: { '@type': 'LocalBusiness', name: 'X' } },
      { pages: ['https://x.com/p2'], schema: extra },
    ]);
    for (const p of local.pages) {
      expect(p).not.toHaveProperty('schema');
      expect(p).not.toHaveProperty('schema_excerpt');
    }
    expect(local.pages[2].schema_types).toEqual(['LocalBusiness', 'FAQPage']);
  });

  it('local omits schema_blocks when no page has schema', () => {
    const c = crawl(2);
    for (const p of c.pages_crawled) p.schema_markup = [];
    expect(buildPassInput('local', { crawl: c, data: emptyData })).not.toHaveProperty('schema_blocks');
  });

  it('throws on an unknown pass', () => {
    expect(() => buildPassInput('nope', { crawl: crawl(1), data: emptyData })).toThrow();
  });
});

describe('prompts', () => {
  const ctx = buildSharedContext({ domain: 'x.com', profile: 'full', homepage: null, gaps: [] });

  it('the shared (cached) block carries the rules: evidence, data gaps, no generic tasks', () => {
    expect(ctx).toMatch(/evidence/i);
    expect(ctx).toMatch(/data gaps/i);
    expect(ctx).toMatch(/generic/i);
    // Static rules come before anything audit-specific so the cached prefix is shared.
    expect(ctx.indexOf('Rules')).toBeLessThan(ctx.indexOf('Domain: x.com'));
    for (const key of PASSES) {
      expect(PASS_SYSTEM[key]).toMatch(/evidence/i);
      expect(PASS_SYSTEM[key]).toContain("Only write tasks in this pass's area; leave others to their own pass.");
    }
  });

  it('no prompt hints at automation and the ambiguous tools line is gone', () => {
    const line = 'Never say or imply the analysis was automated or AI-generated, and never name any AI model or vendor. Naming data sources (Search Console, Google Analytics, PageSpeed Insights) is fine.';
    expect(ctx).toContain(line);
    for (const s of [ctx, ...Object.values(PASS_SYSTEM), SYNTH_SYSTEM]) expect(s).not.toMatch(/tools behind it/i);
  });

  it('synthesis prompt bans new figures and jargon in client text', () => {
    expect(SYNTH_SYSTEM).toContain('Use only numbers that appear in the input exactly as written. Do not add, average, or convert them into new figures (no new percentages or totals).');
    expect(SYNTH_SYSTEM).toContain('avoid terms like meta description, canonical, schema, CTR, SERP, indexing, LCP');
    expect(SYNTH_SYSTEM).toContain('Never include [confirm: …] placeholders in client text');
    expect(SYNTH_SYSTEM).toContain('drop_task_ids');
  });

  it('content prompt scopes chunks and keeps fixes out of tasks', () => {
    expect(PASS_SYSTEM.content).toContain('other chunks cover other pages');
    expect(PASS_SYSTEM.content).toContain("copied exactly from the page's queries or the site-level lists");
    expect(PASS_SYSTEM.content).toMatch(/fix_ids/);
    expect(PASS_SYSTEM.content).toContain('do not write "see page fixes"');
    expect(PASS_SYSTEM.content).toContain('Never point a task at a fix that only says to keep the current text');
  });

  it('conversion prompt makes lead tracking the first task when no key events', () => {
    expect(PASS_SYSTEM.conversion).toContain('If key_events_configured is false (no key events were recorded in either period), the first task is to check whether lead tracking is set up and, if missing, set it up');
  });

  it('content prompt requires exact title and meta text and named sections', () => {
    expect(PASS_SYSTEM.content).toMatch(/exact new title/i);
    expect(PASS_SYSTEM.content).toMatch(/exact new meta description/i);
    expect(PASS_SYSTEM.content).toMatch(/section/i);
  });

  it('prompts never mention the mobile usability verdict', () => {
    for (const s of [...Object.values(PASS_SYSTEM), SYNTH_SYSTEM]) expect(s).not.toMatch(/mobile usability/i);
  });
});

describe('buildSharedContext', () => {
  it('includes domain, profile, homepage signals and gaps', () => {
    const ctx = buildSharedContext({
      domain: 'x.com', profile: 'quick', homepage: page(0), gaps: ['Page speed unavailable: the request timed out.'],
    });
    expect(ctx).toContain('x.com');
    expect(ctx).toContain('quick');
    expect(ctx).toContain('Title 0');
    expect(ctx).toContain('Page speed unavailable');
  });

  it('says there are no gaps when none', () => {
    expect(buildSharedContext({ domain: 'x.com', profile: 'full', homepage: null, gaps: [] })).toMatch(/none/i);
  });
});

// Structured-output schema limits: only these keywords; every object closed with all keys required.
const ALLOWED = new Set(['type', 'enum', 'properties', 'required', 'items', 'additionalProperties', 'minItems']);
function checkSchema(s, path = '$') {
  for (const k of Object.keys(s)) if (!ALLOWED.has(k)) throw new Error(`${path}: keyword ${k}`);
  if (s.minItems !== undefined && ![0, 1].includes(s.minItems)) throw new Error(`${path}: minItems ${s.minItems}`);
  if (s.type === 'object') {
    if (s.additionalProperties !== false) throw new Error(`${path}: additionalProperties`);
    expect([...s.required].sort()).toEqual(Object.keys(s.properties).sort());
    for (const [k, v] of Object.entries(s.properties)) checkSchema(v, `${path}.${k}`);
  }
  if (s.type === 'array') checkSchema(s.items, `${path}[]`);
}

describe('schemas', () => {
  it('pass schemas have findings and tasks and stay within schema limits', () => {
    for (const key of PASSES) {
      const s = passSchema(key);
      expect(s.properties).toHaveProperty('findings');
      expect(s.properties.tasks.items.required).toContain('evidence');
      checkSchema(s);
    }
    expect(passSchema('content').properties).toHaveProperty('pages');
    expect(passSchema('content').properties.pages.items.properties.fixes.items.required).toEqual(['id', 'change', 'targets_queries']);
    expect(passSchema('content').properties.tasks.items.required).toContain('fix_ids');
    expect(passSchema('technical').properties.tasks.items.properties).not.toHaveProperty('fix_ids');
    expect(passSchema('conversion').properties).toHaveProperty('key_events_configured');
    expect(passSchema('technical').properties).not.toHaveProperty('pages');
  });

  it('synth schema returns decisions, not rewritten tasks', () => {
    checkSchema(synthSchema);
    expect(Object.keys(synthSchema.properties).sort()).toEqual(['client_summary', 'drop_task_ids', 'follow_ups', 'groups', 'scores', 'top_moves']);
    expect(Object.keys(synthSchema.properties.groups.items.properties).sort()).toEqual(['task_ids', 'title', 'why']);
    expect(Object.keys(synthSchema.properties.follow_ups.items.properties).sort()).toEqual(['parent_id', 'task_ids']);
    expect(SYNTH_SYSTEM).not.toMatch(/data_gaps:/);
    expect(Object.keys(synthSchema.properties.top_moves.items.properties).sort()).toEqual(['headline', 'task_id']);
    expect(synthSchema.properties.drop_task_ids).toEqual({ type: 'array', items: { type: 'string' } });
    expect(Object.keys(synthSchema.properties.scores.properties).sort()).toEqual(['aeo', 'geo', 'seo']);
    expect(synthSchema.properties.scores.properties.seo.properties.score.enum).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});

// ── task ids, synthesis input, action plan ───────────────────────────────────

const task = (id, over = {}) => ({
  id, title: `Task ${id}`, category: 'content', page: `/${id.toLowerCase()}`, evidence: [`ev ${id}`, 'ev 2'],
  change: `change ${id}`, why: 'why', impact: 3, effort: 2, confidence: 'high', ...over,
});

describe('normalizeTaskIds', () => {
  it('prefixes ids by pass, and by chunk for content', () => {
    const ts = [task('X'), task('Y')];
    expect(normalizeTaskIds('technical', null, ts).map((t) => t.id)).toEqual(['TECH-1', 'TECH-2']);
    expect(normalizeTaskIds('content', 2, ts).map((t) => t.id)).toEqual(['CONT-2-1', 'CONT-2-2']);
    expect(normalizeTaskIds('local', null, ts).map((t) => t.id)).toEqual(['LOCAL-1', 'LOCAL-2']);
    expect(normalizeTaskIds('conversion', undefined, ts).map((t) => t.id)).toEqual(['CONV-1', 'CONV-2']);
    expect(ts[0].id).toBe('X');
  });

  it('handles a missing task list and unknown passes', () => {
    expect(normalizeTaskIds('technical', null, undefined)).toEqual([]);
    expect(() => normalizeTaskIds('nope', null, [])).toThrow();
  });
});

describe('buildSynthInput', () => {
  it('sends every pass task compactly plus findings', () => {
    const outputs = {
      technical: { findings: [{ title: 'F', detail: 'D', evidence: ['e'] }], tasks: [task('TECH-1')] },
      content: [{ findings: [], tasks: [task('CONT-1-1')], pages: [{ page: '/', fixes: [] }] }, { findings: [], tasks: [task('CONT-2-1')] }],
      local: null,
    };
    const input = buildSynthInput(outputs, { passes_not_completed: ['local'] });
    expect(input.passes_not_completed).toEqual(['local']);
    expect(input.findings).toEqual([{ pass: 'technical', title: 'F', detail: 'D', evidence: ['e'] }]);
    expect(input.tasks.map((t) => t.id)).toEqual(['TECH-1', 'CONT-1-1', 'CONT-2-1']);
    expect(input.tasks[0]).toEqual({
      id: 'TECH-1', title: 'Task TECH-1', page: '/tech-1', category: 'content', impact: 3, effort: 2, confidence: 'high', evidence: 'ev TECH-1',
    });
  });
});

describe('buildActionPlan', () => {
  it('merges the pass tasks that the synthesis did not drop', () => {
    const passTasks = [task('TECH-1', { impact: 1 }), task('CONT-1-1', { impact: 5 }), task('LOCAL-1')];
    const plan = buildActionPlan(passTasks, { drop_task_ids: ['LOCAL-1'] });
    expect(plan.map((t) => t.title)).toEqual(['Task CONT-1-1', 'Task TECH-1']);
    expect(plan.map((t) => t.id)).toEqual(['T1', 'T2']);
    expect(plan[0].source_ids).toEqual(['CONT-1-1']);
  });

  it('records every pass id merged into one task', () => {
    const a = task('CONT-1-1', { title: 'Rewrite the title', page: '/' });
    const b = task('LOCAL-1', { title: 'Rewrite the title!', page: '/', impact: 5 });
    const plan = buildActionPlan([[a], [b]], {});
    expect(plan).toHaveLength(1);
    expect([...plan[0].source_ids].sort()).toEqual(['CONT-1-1', 'LOCAL-1']);
  });

  it('keeps everything when synthesis output is missing', () => {
    expect(buildActionPlan([task('A'), task('B')], null)).toHaveLength(2);
  });

  const measured = (id, o = {}) => task(id, { evidence: ['4,760 impressions, position 9.6 (Search Console, 2026-08-17 to 2026-11-14)'], ...o });

  it('caps unmeasured content tasks at impact 2 so a measured big fix ranks first', () => {
    const cosmetic = task('CONT-1-1', { title: 'Rewrite Alpine title', impact: 3, effort: 1 });
    const big = measured('CONT-1-2', { title: 'Restore the cost guide', impact: 5, effort: 3 });
    const plan = buildActionPlan([cosmetic, big], {});
    expect(plan.map((t) => t.title)).toEqual(['Restore the cost guide', 'Rewrite Alpine title']);
    expect(plan[1].impact).toBe(2);
  });

  it('folds follow-up tasks into their parent with nested ids', () => {
    const parent = measured('CONT-1-1', { title: 'Restore the cost guide', page: '/cost', impact: 5 });
    const a = task('CONT-1-2', { title: 'Add a 400 sq ft example', page: '/cost' });
    const b = task('CONT-1-3', { title: 'Add a price table', page: '/cost' });
    const other = task('TECH-1', { title: 'Other', page: '/x', impact: 1 });
    const plan = buildActionPlan([parent, a, b, other], { follow_ups: [{ parent_id: 'CONT-1-1', task_ids: ['CONT-1-2', 'CONT-1-3', 'CONT-1-1', 'NOPE'] }] });
    expect(plan.map((t) => t.title)).toEqual(['Restore the cost guide', 'Other']);
    expect(plan[0].follow_ups.map((t) => [t.id, t.title])).toEqual([['T1.1', 'Add a 400 sq ft example'], ['T1.2', 'Add a price table']]);
  });

  it('groups the same fix across pages into one task with one item per page', () => {
    const lists = ['/a', '/b', '/c'].map((p, i) => task(`CONT-1-${i + 1}`, { title: `Remove the keyword list on ${p}`, page: p, impact: 2, effort: 1, change: `Delete "kw ${p}"\nsecond line` }));
    const lone = measured('TECH-1', { title: 'Fix the redirect', page: '/z', impact: 4, effort: 1, category: 'technical' });
    const plan = buildActionPlan([...lists, lone], {
      groups: [{ title: 'Remove visible keyword lists', why: 'Reads as stuffing.', task_ids: ['CONT-1-1', 'CONT-1-2', 'CONT-1-3'] }],
    });
    expect(plan).toHaveLength(2);
    const g = plan.find((t) => t.group);
    expect(g).toMatchObject({ title: 'Remove visible keyword lists', why: 'Reads as stuffing.', page: 'multiple pages', pages: ['/a', '/b', '/c'], category: 'content', impact: 2, effort: 1 });
    expect(g.items.map((t) => t.page)).toEqual(['/a', '/b', '/c']);
    expect(g.items[0].id).toBe(`${g.id}.1`);
    expect(g.change).toBe('Apply this on each page:\n/a: Delete "kw /a"\n/b: Delete "kw /b"\n/c: Delete "kw /c"');
    expect([...g.source_ids].sort()).toEqual(['CONT-1-1', 'CONT-1-2', 'CONT-1-3']);
  });

  it('a top move naming a folded follow-up resolves to its parent', () => {
    const plan = buildActionPlan([measured('P', { impact: 5 }), task('C')], { follow_ups: [{ parent_id: 'P', task_ids: ['C'] }] });
    const moves = resolveTopMoves(plan, { top_moves: [{ task_id: 'C', headline: 'h' }] });
    expect(moves[0]).toMatchObject({ headline: 'h', task: { id: 'T1' } });
  });

  it('a group title states the real page count', () => {
    const ts = ['/a', '/b'].map((p, i) => task(`C${i}`, { page: p }));
    const plan = buildActionPlan(ts, { groups: [{ title: 'Remove the visible keyword lists from 7 pages', why: 'w', task_ids: ['C0', 'C1'] }] });
    expect(plan[0].title).toBe('Remove the visible keyword lists from 2 pages');
    expect(fixPageCount('Add a local FAQ section to 6 location pages', 4)).toBe('Add a local FAQ section to 4 location pages');
    expect(fixPageCount('Rewrite titles on 9 homepage and service pages', 3)).toBe('Rewrite titles on 3 homepage and service pages');
    expect(fixPageCount('Remove keyword lists', 3)).toBe('Remove keyword lists');
  });

  it('ignores a group with fewer than two usable tasks and never uses a task twice', () => {
    const ts = [task('A', { page: '/a' }), task('B', { page: '/b' }), task('C', { page: '/c' })];
    const plan = buildActionPlan(ts, {
      follow_ups: [{ parent_id: 'A', task_ids: ['B'] }],
      groups: [{ title: 'G1', why: 'w', task_ids: ['B', 'C'] }, { title: 'G2', why: 'w', task_ids: ['ZZ', 'C'] }],
    });
    expect(plan.map((t) => t.title).sort()).toEqual(['Task A', 'Task C']);
    expect(plan.find((t) => t.title === 'Task A').follow_ups).toHaveLength(1);
  });
});

describe('resolveTopMoves', () => {
  const plan = buildActionPlan([task('A', { impact: 5 }), task('B', { impact: 4 }), task('C', { impact: 3 }), task('D', { impact: 2 })], {});

  it('maps pass task ids to merged plan tasks with the headline', () => {
    const moves = resolveTopMoves(plan, { top_moves: [{ task_id: 'C', headline: 'h1' }, { task_id: 'A', headline: 'h2' }, { task_id: 'D', headline: 'h3' }] });
    expect(moves.map((mv) => [mv.headline, mv.task.source_ids[0]])).toEqual([['h1', 'C'], ['h2', 'A'], ['h3', 'D']]);
  });

  it('falls back to the plan order for missing or dropped ids and caps at 3', () => {
    const moves = resolveTopMoves(plan, { top_moves: [{ task_id: 'ZZZ', headline: 'x' }, { task_id: 'C', headline: 'hc' }, { task_id: 'C', headline: 'dup' }] });
    expect(moves.map((mv) => mv.task.source_ids[0])).toEqual(['C', 'A', 'B']);
    expect(moves[0].headline).toBe('hc');
    expect(moves[1].headline).toBe(plan[0].title);
    expect(resolveTopMoves(plan, { top_moves: ['A', 'B', 'C', 'D'].map((id) => ({ task_id: id, headline: id })) })).toHaveLength(3);
    expect(resolveTopMoves(plan, null).map((mv) => mv.task.id)).toEqual(['T1', 'T2', 'T3']);
    expect(resolveTopMoves([], { top_moves: [{ task_id: 'A', headline: 'a' }] })).toEqual([]);
  });

  it('can also resolve a merged plan id', () => {
    expect(resolveTopMoves(plan, { top_moves: [{ task_id: 'T4', headline: 'h' }] })[0].task.id).toBe('T4');
  });
});

describe('resolveContentChunk', () => {
  const chunk = { chunk: 1, of: 1, pages: [{ url: 'https://x.com/' }, { url: 'https://x.com/turf/' }] };
  const ctask = (over = {}) => ({
    id: 'x', title: 'Rewrite the turf title', category: 'content', page: '/turf', evidence: ['Current title: "Turf"'],
    change: 'Rewrite the title around "turf las vegas". Exact text is in the page fixes.', why: 'Low CTR at position 6.',
    impact: 4, effort: 1, confidence: 'high', fix_ids: ['F2'], ...over,
  });
  const pages = [
    { page: 'https://x.com/', fixes: [{ id: 'F1', change: 'Keep the current title "Home | X".', targets_queries: [] }] },
    {
      page: '/turf/',
      fixes: [
        { id: 'F2', change: 'Replace the title with: "Turf Installation in Las Vegas, NV | X"', targets_queries: ['turf las vegas'] },
        { id: 'F3', change: 'Keep the existing FAQ section.', targets_queries: [] },
        { id: 'F4', change: 'Add the H2 "Turf Rebates in Las Vegas" covering the SNWA rebate.', targets_queries: [] },
      ],
    },
  ];

  it('attaches the exact text of the fixes a task names', () => {
    const r = resolveContentChunk(chunk, { findings: [], tasks: [ctask()], pages });
    expect(r.ok).toBe(true);
    expect(r.tasks[0].change).toBe('Rewrite the title around "turf las vegas".\nReplace the title with: "Turf Installation in Las Vegas, NV | X"');
    expect(r.tasks[0]).not.toHaveProperty('fix_ids');
    expect(r.tasks[0].page).toBe('/turf');
    expect(r.pages.map((p) => p.page)).toEqual(['/', '/turf']);
  });

  it('unknown fix ids fall back to every fix on the page except "keep" fixes', () => {
    const r = resolveContentChunk(chunk, { tasks: [ctask({ fix_ids: ['F99'] })], pages });
    const lines = r.tasks[0].change.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain('"Turf Installation in Las Vegas, NV | X"');
    expect(lines[2]).toContain('Turf Rebates in Las Vegas');
    expect(r.tasks[0].change).not.toMatch(/Keep the existing/);
  });

  it('a task pointing only at a keep fix gets the page fixes instead', () => {
    const r = resolveContentChunk(chunk, { tasks: [ctask({ fix_ids: ['F3'] })], pages });
    expect(r.tasks[0].change).not.toMatch(/Keep/);
    expect(r.tasks[0].change).toMatch(/Turf Rebates/);
  });

  it('drops a task whose change ends up empty and marks the chunk incomplete', () => {
    const empty = ctask({ page: '/', change: 'Exact text is in the page fixes.', fix_ids: [] });
    const r = resolveContentChunk(chunk, { tasks: [empty, ctask({ why: '' })], pages });
    expect(r.tasks).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it('a reply that leaves an input page without fixes is incomplete', () => {
    const r = resolveContentChunk(chunk, { findings: [], tasks: [], pages: [pages[0]] });
    expect(r.ok).toBe(false);
    expect(r.uncovered).toEqual(['/turf']);
    const none = resolveContentChunk(chunk, { findings: [], tasks: [ctask({ change: '', why: '' })], pages: [] });
    expect(none.ok).toBe(false);
    expect(none.uncovered).toEqual(['/', '/turf']);
  });
});

describe('page keys and sitemap counts', () => {
  it('the action plan uses path pages and merges "/a/" with a full URL', () => {
    const a = task('CONT-1-1', { title: 'Rewrite the title', page: 'https://x.com/a/' });
    const b = task('LOCAL-1', { title: 'Rewrite the title', page: '/a' });
    const plan = buildActionPlan([[a], [b]], {});
    expect(plan).toHaveLength(1);
    expect(plan[0].page).toBe('/a');
  });

  it('a compressed sitemap makes the count unknown, never 0', () => {
    const c = { ...crawl(2), sitemap_url_count: null, sitemaps: [{ url: 'https://x.com/sitemap.xml.gz', count: null }] };
    const tech = buildPassInput('technical', { crawl: c, data: emptyData });
    expect(tech.sitemap.ours.url_count).toBe('unknown');
    expect(tech.sitemap.ours.note).toContain('count unknown (compressed sitemaps not read)');
  });

  it('a sitemap read cut short is stated', () => {
    const tech = buildPassInput('technical', { crawl: { ...crawl(1), sitemap_partial: true }, data: emptyData });
    expect(tech.sitemap.ours.note).toMatch(/stopped early/);
  });
});
