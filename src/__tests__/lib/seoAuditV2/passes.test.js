import { describe, it, expect } from 'vitest';
import {
  PASSES, PASS_SYSTEM, SYNTH_SYSTEM, buildPassInput, buildSharedContext, passSchema, synthSchema,
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

  it('content chunks 20 pages into 3 chunks of at most 8', () => {
    const chunks = buildPassInput('content', { crawl: crawl(20), data: fullData });
    expect(Array.isArray(chunks)).toBe(true);
    expect(chunks).toHaveLength(3);
    expect(chunks.map((c) => c.pages.length)).toEqual([8, 8, 4]);
    for (const c of chunks) expect(c.pages.length).toBeLessThanOrEqual(8);
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
    expect(JSON.stringify(local.pages[0]).length).toBeLessThan(6000);
  });

  it('throws on an unknown pass', () => {
    expect(() => buildPassInput('nope', { crawl: crawl(1), data: emptyData })).toThrow();
  });
});

describe('prompts', () => {
  it('every PASS_SYSTEM mentions evidence, data gaps and bans generic tasks', () => {
    for (const key of PASSES) {
      const s = PASS_SYSTEM[key];
      expect(s).toMatch(/evidence/i);
      expect(s).toMatch(/data gaps/i);
      expect(s).toMatch(/generic/i);
    }
    expect(SYNTH_SYSTEM).toMatch(/evidence/i);
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
    expect(passSchema('content').properties.pages.items.properties.fixes.items.required).toEqual(['change', 'targets_queries']);
    expect(passSchema('conversion').properties).toHaveProperty('key_events_configured');
    expect(passSchema('technical').properties).not.toHaveProperty('pages');
  });

  it('synth schema matches the spec output', () => {
    checkSchema(synthSchema);
    expect(Object.keys(synthSchema.properties).sort()).toEqual(['action_plan', 'client_summary', 'data_gaps', 'scores', 'top_moves']);
    expect(Object.keys(synthSchema.properties.scores.properties).sort()).toEqual(['aeo', 'geo', 'seo']);
    expect(synthSchema.properties.scores.properties.seo.properties.score.enum).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
