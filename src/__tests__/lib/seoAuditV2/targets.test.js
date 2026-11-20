import { describe, it, expect } from 'vitest';
import { targetsInput, guardTargets, buildTargetsResult, normKeyword } from '@/lib/seoAuditV2/targets';
import { passSchema, buildPassInput, PASS_SYSTEM } from '@/lib/seoAuditV2/passes';

const crawl = {
  pages_crawled: [
    { url: 'https://x.com/panel', title_tag: 'Panels', meta_description: 'm', h1_tags: ['Panel work'], h2_tags: [], h3_tags: [], word_count: 300, content_text: 'a'.repeat(9000) },
    { url: 'https://x.com/services', title_tag: 'Services', h1_tags: ['All services'] },
  ],
};
const keywords = {
  geo: 'Tampa, Florida',
  targets: [{
    page: '/panel',
    url: 'https://x.com/panel',
    mode: 'given',
    given: [{ keyword: 'panel upgrade tampa', volume: 210, competition: 'low', search_console: [{ page: '/services', position: 12.5, clicks: 2, impressions: 80 }] }],
    page_queries: [{ query: 'electrical panel replacement', clicks: 3, impressions: 40, position: 8.1 }],
    ideas: [{ keyword: 'electrical panel upgrade', volume: 590, competition: 'medium', search_console: [] }],
  }],
};
const opts = [{ url: 'https://x.com/panel', keywords: ['panel upgrade tampa'] }];

describe('targetsInput', () => {
  it('is null without target pages', () => {
    expect(targetsInput(crawl, {}, [])).toBeNull();
    expect(buildPassInput('targets', { crawl, data: {} })).toBeNull();
  });

  it('carries the page content, keyword numbers, ideas and the other pages', () => {
    const inp = buildPassInput('targets', { crawl, data: { keywords }, targetOptions: opts });
    expect(inp.volumes_for).toBe('Tampa, Florida');
    const t = inp.targets[0];
    expect(t).toMatchObject({ page: '/panel', mode: 'given', crawled: true, title_tag: 'Panels' });
    expect(t.content_text).toHaveLength(8000);
    expect(t.target_keywords[0]).toEqual({ keyword: 'panel upgrade tampa', monthly_searches: 210, competition: 'low', search_console: keywords.targets[0].given[0].search_console });
    expect(t.keyword_ideas[0].monthly_searches).toBe(590);
    expect(inp.other_pages).toEqual([{ page: '/services', title_tag: 'Services', h1: 'All services' }]);
    expect(inp.note).toBeUndefined();
  });

  it('still works without Keyword Planner data, with a note and the given keywords', () => {
    const inp = targetsInput(crawl, { gscPages: [{ page: 'https://x.com/panel', queries: [{ query: 'q', clicks: 1, impressions: 2, position: 3 }] }] }, [{ url: 'https://x.com/missing', keywords: [] }, ...opts]);
    expect(inp.note).toMatch(/unavailable/);
    expect(inp.targets[0]).toMatchObject({ page: '/missing', mode: 'recommend', crawled: false, target_keywords: [], keyword_ideas: [] });
    expect(inp.targets[1].target_keywords[0]).toMatchObject({ keyword: 'panel upgrade tampa', monthly_searches: null });
    expect(inp.targets[1].page_queries[0].query).toBe('q');
  });
});

describe('targets schema and prompt', () => {
  it('asks for targets with roles and conflicts', () => {
    const s = passSchema('targets');
    expect(s.required).toEqual(['findings', 'tasks', 'targets']);
    expect(s.properties.targets.items.properties.keywords.items.properties.role.enum).toEqual(['primary', 'secondary', 'drop']);
    expect(PASS_SYSTEM.targets).toMatch(/never promise rankings/);
    expect(PASS_SYSTEM.targets).toMatch(/copied exactly/);
  });
});

describe('guardTargets', () => {
  const input = targetsInput(crawl, { keywords }, opts);

  it('keeps keywords from the input only, one primary, and lists every given keyword', () => {
    const out = guardTargets([{
      page: 'https://x.com/panel/',
      keywords: [
        { keyword: 'Electrical Panel Upgrade', role: 'primary', note: 'big' },
        { keyword: 'made up keyword', role: 'secondary', note: '' },
        { keyword: 'electrical panel replacement', role: 'primary', note: 'own query' },
        { keyword: 'electrical panel upgrade', role: 'secondary', note: 'dup' },
      ],
      conflicts: [],
    }], input);
    expect(out).toHaveLength(1);
    expect(out[0].page).toBe('/panel');
    expect(out[0].keywords).toEqual([
      { keyword: 'electrical panel upgrade', role: 'primary', note: 'big', given: false },
      { keyword: 'electrical panel replacement', role: 'secondary', note: 'own query', given: false },
      { keyword: 'panel upgrade tampa', role: 'secondary', note: '', given: true },
    ]);
  });

  it('only drops given keywords and keeps conflicts that name another known page', () => {
    const out = guardTargets([{
      page: '/panel',
      keywords: [{ keyword: 'panel upgrade tampa', role: 'drop', note: 'wrong page' }, { keyword: 'electrical panel upgrade', role: 'drop', note: '' }],
      conflicts: [
        { keyword: 'panel upgrade tampa', other_page: 'https://x.com/services', note: 'link it' },
        { keyword: 'x', other_page: '/nowhere', note: '' },
        { keyword: 'x', other_page: '/panel', note: '' },
      ],
    }], input);
    expect(out[0].keywords).toEqual([{ keyword: 'panel upgrade tampa', role: 'drop', note: 'wrong page', given: true }]);
    expect(out[0].conflicts).toEqual([{ keyword: 'panel upgrade tampa', other_page: '/services', note: 'link it' }]);
  });

  it('a missing reply still yields an entry per target page', () => {
    expect(guardTargets(null, input)[0].keywords).toEqual([{ keyword: 'panel upgrade tampa', role: 'secondary', note: '', given: true }]);
  });
});

describe('buildTargetsResult', () => {
  it('is undefined without target pages', () => {
    expect(buildTargetsResult({ targetOptions: [], keywordData: keywords, guarded: [], plan: [] })).toBeUndefined();
  });

  it('attaches numbers from the data, sorts primary first and links the page tasks', () => {
    const input = targetsInput(crawl, { keywords }, opts);
    const guarded = guardTargets([{ page: '/panel', keywords: [{ keyword: 'electrical panel upgrade', role: 'primary', note: 'n' }], conflicts: [] }], input);
    const plan = [
      { id: 'T1', page: '/panel' },
      { id: 'T2', page: 'multiple pages', pages: ['/panel', '/b'], items: [{ id: 'T2.1', page: '/panel' }, { id: 'T2.2', page: '/b' }] },
      { id: 'T3', page: '/other' },
    ];
    const r = buildTargetsResult({ targetOptions: opts, keywordData: keywords, guarded, plan });
    expect(r.volumes_for).toBe('Tampa, Florida');
    const p = r.pages[0];
    expect(p.mode).toBe('given');
    expect(p.task_ids).toEqual(['T1', 'T2', 'T2.1']);
    expect(p.keywords[0]).toMatchObject({ keyword: 'electrical panel upgrade', role: 'primary', volume: 590, position: null, ranking_page: null });
    expect(p.keywords[1]).toMatchObject({ keyword: 'panel upgrade tampa', volume: 210, position: 12.5, ranking_page: '/services', impressions: 80 });
  });

  it('falls back to the given keywords when the pass did not complete, and to the page queries for positions', () => {
    const r = buildTargetsResult({ targetOptions: [{ url: 'https://x.com/panel', keywords: ['Electrical  Panel Replacement'] }], keywordData: keywords, guarded: null, plan: [] });
    expect(r.pages[0].keywords).toEqual([expect.objectContaining({ keyword: 'electrical panel replacement', role: 'secondary', position: 8.1, ranking_page: '/panel', volume: null })]);
  });
});

describe('normKeyword', () => {
  it('lowercases and collapses spaces', () => {
    expect(normKeyword('  Panel   Upgrade ')).toBe('panel upgrade');
  });
});

describe('review fixes', () => {
  it("prefers the target page's own position over a sibling page's", () => {
    const kw = {
      geo: 'Tampa, Florida',
      targets: [{
        page: '/panel', url: 'https://x.com/panel', mode: 'given',
        given: [{ keyword: 'electrician tampa', volume: 500, competition: 'low', search_console: [{ page: '/', position: 3, clicks: 50, impressions: 900 }] }],
        page_queries: [{ query: 'electrician tampa', clicks: 1, impressions: 40, position: 18 }],
        ideas: [],
      }],
    };
    const r = buildTargetsResult({ targetOptions: [{ url: 'https://x.com/panel', keywords: ['electrician tampa'] }], keywordData: kw, guarded: null, plan: [] });
    expect(r.pages[0].keywords[0]).toMatchObject({ position: 18, ranking_page: '/panel', clicks: 1 });
  });

  it('Search Console only data (no volumes) still gives positions and tells the pass demand is unknown', () => {
    const kw = { geo: null, volumes: false, targets: [{ page: '/panel', url: 'https://x.com/panel', mode: 'given', given: [{ keyword: 'panel upgrade tampa', volume: null, competition: null, search_console: [{ page: '/panel', position: 8, clicks: 2, impressions: 60 }] }], page_queries: [], ideas: [] }] };
    expect(targetsInput(crawl, { keywords: kw }, opts).note).toMatch(/unavailable/);
    const r = buildTargetsResult({ targetOptions: opts, keywordData: kw, guarded: null, plan: [] });
    expect(r.volumes_for).toBeNull();
    expect(r.pages[0].keywords[0]).toMatchObject({ volume: null, position: 8, ranking_page: '/panel' });
  });
});
