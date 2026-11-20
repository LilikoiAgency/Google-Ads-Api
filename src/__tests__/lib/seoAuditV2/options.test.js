import { describe, it, expect } from 'vitest';
import { parseAuditOptions, matchesSkip, filterSkipped, pageLimit, hasOptions, describeOptions, MAX_LOCATIONS, MAX_TARGETS, MAX_TARGET_KEYWORDS, hasTargets } from '../../../lib/seoAuditV2/options';

describe('parseAuditOptions', () => {
  it('returns null options when nothing is set', () => {
    expect(parseAuditOptions(undefined, 'site.com')).toEqual({ options: null });
    expect(parseAuditOptions({ pages: [], skip: [], onlyListed: false }, 'site.com')).toEqual({ options: null });
  });

  it('normalises paths and full URLs on the domain (www or not), dedupes and keeps order', () => {
    const { options } = parseAuditOptions({
      pages: ['/pet-turf', 'https://www.site.com/las-vegas/', 'site.com/pet-turf', '  ', 'http://site.com/a?x=1#top'],
    }, 'site.com');
    expect(options.pages).toEqual([
      'https://site.com/pet-turf',
      'https://site.com/las-vegas',
      'https://site.com/a?x=1',
    ]);
    expect(options.onlyListed).toBe(false);
  });

  it('rejects off-domain pages and lists them', () => {
    const { error } = parseAuditOptions({ pages: ['/ok', 'https://other.com/x'] }, 'site.com');
    expect(error).toMatch(/other\.com\/x/);
  });

  it('caps listed pages at 50 and skip patterns at 20', () => {
    const many = Array.from({ length: 51 }, (_, i) => `/p${i}`);
    expect(parseAuditOptions({ pages: many }, 'site.com').error).toMatch(/50/);
    const skips = Array.from({ length: 21 }, (_, i) => `/s${i}/*`);
    expect(parseAuditOptions({ skip: skips }, 'site.com').error).toMatch(/20/);
  });

  it('cleans skip patterns: adds a leading slash, drops blanks', () => {
    const { options } = parseAuditOptions({ skip: ['blog/*', ' ', '/tag/*'] }, 'site.com');
    expect(options.skip).toEqual(['/blog/*', '/tag/*']);
  });

  it('accepts a page count from 1 to 50 only', () => {
    expect(parseAuditOptions({ pageCount: 10 }, 'site.com').options.pageCount).toBe(10);
    expect(parseAuditOptions({ pageCount: 0 }, 'site.com').error).toBeTruthy();
    expect(parseAuditOptions({ pageCount: 51 }, 'site.com').error).toBeTruthy();
  });

  it('onlyListed needs at least one page', () => {
    expect(parseAuditOptions({ onlyListed: true }, 'site.com').error).toMatch(/page/i);
  });
});

describe('parseAuditOptions data source picks', () => {
  it('keeps a chosen Search Console property and GA4 property', () => {
    const { options } = parseAuditOptions({ gscSite: 'sc-domain:sempersolaris.com', ga4Property: { id: 'properties/123', name: 'Semper Solaris', account: 'Semper' } }, 'sempersolaris.com');
    expect(options).toMatchObject({ gscSite: 'sc-domain:sempersolaris.com', ga4Property: { id: 'properties/123', name: 'Semper Solaris', account: 'Semper' } });
    expect(hasOptions(options)).toBe(true);
    expect(parseAuditOptions({ gscSite: 'https://www.acme.com/' }, 'acme.com').options.gscSite).toBe('https://www.acme.com/');
  });
  it('rejects malformed picks', () => {
    expect(parseAuditOptions({ gscSite: 'not a site' }, 'acme.com').error).toMatch(/Search Console/);
    expect(parseAuditOptions({ ga4Property: { id: '123' } }, 'acme.com').error).toMatch(/Google Analytics/);
  });
  it('leaves the keys out when nothing is picked', () => {
    expect(parseAuditOptions({ pageCount: 10, gscSite: '' }, 'acme.com').options).toEqual({ pages: [], onlyListed: false, skip: [], pageCount: 10 });
  });
});

describe('matchesSkip / filterSkipped', () => {
  it('matches path patterns with * wildcards, ignoring a trailing slash', () => {
    expect(matchesSkip('https://site.com/blog/post-1', ['/blog/*'])).toBe(true);
    expect(matchesSkip('https://site.com/blog', ['/blog/*'])).toBe(true);
    expect(matchesSkip('https://site.com/blogger', ['/blog/*'])).toBe(false);
    expect(matchesSkip('https://site.com/tag/x/', ['/tag/*'])).toBe(true);
    expect(matchesSkip('https://site.com/about', ['/about'])).toBe(true);
    expect(matchesSkip('https://site.com/about-us', ['/about'])).toBe(false);
    expect(matchesSkip('https://site.com/a/b/print', ['*/print'])).toBe(true);
  });

  it('filterSkipped keeps everything without patterns', () => {
    const urls = ['https://site.com/blog/a', 'https://site.com/x'];
    expect(filterSkipped(urls, [])).toEqual(urls);
    expect(filterSkipped(urls, ['/blog/*'])).toEqual(['https://site.com/x']);
  });
});

describe('pageLimit / hasOptions', () => {
  it('uses the type default, the chosen count, or the listed count when only listed', () => {
    expect(pageLimit('quick', null)).toBe(5);
    expect(pageLimit('full', null)).toBe(50);
    expect(pageLimit('quick', { pageCount: 15 })).toBe(15);
    expect(pageLimit('full', { onlyListed: true, pages: ['a', 'b'], pageCount: 40 })).toBe(2);
  });

  it('hasOptions is false for null', () => {
    expect(hasOptions(null)).toBe(false);
    expect(hasOptions({ pages: ['x'] })).toBe(true);
  });
});

describe('location picks', () => {
  const place = (i) => ({ source: 'places', id: `ChIJ${String(i).padStart(10, '0')}`, name: `Shop ${i}` });

  it('locations parsed and capped at 10', () => {
    const raw = [...Array.from({ length: 12 }, (_, i) => place(i)), place(0)];
    raw.push({ source: 'gbp', id: 'locations/123', name: `  ${'x'.repeat(300)}  ` });
    const { options } = parseAuditOptions({ locations: raw }, 'site.com');
    expect(options.locations).toHaveLength(MAX_LOCATIONS);
    expect(options.locations[0]).toEqual(place(0));
    const gbp = parseAuditOptions({ locations: [{ source: 'gbp', id: 'locations/123', name: `  ${'x'.repeat(300)}  ` }] }, 'site.com').options.locations[0];
    expect(gbp.name).toHaveLength(200);
    const dupes = parseAuditOptions({ locations: [place(1), place(1)] }, 'site.com').options.locations;
    expect(dupes).toHaveLength(1);
  });

  it('rejects malformed location id', () => {
    const err = { error: 'Pick locations from the list.' };
    expect(parseAuditOptions({ locations: [{ source: 'places', id: 'short', name: 'x' }] }, 'site.com')).toEqual(err);
    expect(parseAuditOptions({ locations: [{ source: 'gbp', id: 'accounts/1', name: 'x' }] }, 'site.com')).toEqual(err);
    expect(parseAuditOptions({ locations: [{ source: 'yelp', id: 'abcdefghijk', name: 'x' }] }, 'site.com')).toEqual(err);
    expect(parseAuditOptions({ locations: ['nope'] }, 'site.com')).toEqual(err);
  });

  it('locations alone is an option', () => {
    const { options } = parseAuditOptions({ locations: [place(1)] }, 'site.com');
    expect(options).toMatchObject({ pages: [], skip: [], locations: [place(1)] });
    expect(hasOptions(options)).toBe(true);
    expect(describeOptions(options)).toBe('1 location');
    expect(describeOptions({ ...options, locations: [place(1), place(2)] })).toBe('2 locations');
  });

  it('an explicit empty locations list is kept as an option (the user unticked every location)', () => {
    const { options } = parseAuditOptions({ locations: [] }, 'site.com');
    expect(options).toEqual({ pages: [], onlyListed: false, skip: [], pageCount: null, locations: [] });
    expect(hasOptions(options)).toBe(true);
    expect(describeOptions(options)).toBe('no locations');
    expect(parseAuditOptions({}, 'site.com')).toEqual({ options: null });
  });
});

describe('target keywords', () => {
  it('parses pages and keywords, lowercases and dedupes keywords, and adds each page as a priority page', () => {
    const { options } = parseAuditOptions({
      pages: '/about',
      targets: [
        { page: '/panel-upgrade/', keywords: 'Panel Upgrade Tampa\npanel  upgrade tampa, electrician tampa' },
        { page: 'https://www.site.com/ev', keywords: [] },
        { page: '', keywords: '' },
      ],
    }, 'site.com');
    expect(options.targets).toEqual([
      { url: 'https://site.com/panel-upgrade', keywords: ['panel upgrade tampa', 'electrician tampa'] },
      { url: 'https://site.com/ev', keywords: [] },
    ]);
    expect(options.pages).toEqual(['https://site.com/about', 'https://site.com/panel-upgrade', 'https://site.com/ev']);
    expect(hasTargets(options)).toBe(true);
    expect(describeOptions(options)).toBe('target keywords for 2 pages · 1 priority page');
  });

  it('targets alone are an option and merge rows for the same page', () => {
    const { options } = parseAuditOptions({ targets: [{ page: '/a', keywords: 'x' }, { page: '/a/', keywords: 'y' }] }, 'site.com');
    expect(options.targets).toEqual([{ url: 'https://site.com/a', keywords: ['x', 'y'] }]);
    expect(describeOptions(options)).toBe('target keywords for 1 page');
    expect(hasTargets(parseAuditOptions({ pages: '/a' }, 'site.com').options)).toBe(false);
    expect(hasTargets(null)).toBe(false);
  });

  it('rejects keywords without a page, off-site pages and too many pages or keywords', () => {
    expect(parseAuditOptions({ targets: [{ page: '', keywords: 'x' }] }, 'site.com').error).toMatch(/Add the page/);
    expect(parseAuditOptions({ targets: [{ page: 'https://other.com/a', keywords: 'x' }] }, 'site.com').error).toMatch(/isn't on site.com/);
    const many = Array.from({ length: MAX_TARGETS + 1 }, (_, i) => ({ page: `/p${i}`, keywords: 'x' }));
    expect(parseAuditOptions({ targets: many }, 'site.com').error).toMatch(/at most 5 pages/);
    const kws = Array.from({ length: MAX_TARGET_KEYWORDS + 1 }, (_, i) => `k${i}`).join('\n');
    expect(parseAuditOptions({ targets: [{ page: '/a', keywords: kws }] }, 'site.com').error).toMatch(/at most 10 keywords/);
    expect(parseAuditOptions({ targets: [{ page: '/a', keywords: 'x'.repeat(81) }] }, 'site.com').error).toMatch(/under 80/);
  });
});

describe('targets-only options', () => {
  it('count as options and are described', () => {
    const o = { pages: [], skip: [], targets: [{ page: '/a', keywords: [] }] };
    expect(hasOptions(o)).toBe(true);
    expect(describeOptions(o)).toBe('target keywords for 1 page');
  });
});
