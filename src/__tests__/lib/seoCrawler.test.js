import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  prioritizePages,
  parseSitemapXml,
  collectSitemapUrls,
  summarizeImages,
  parsePage,
  crawlSite,
} from '@/lib/seoCrawler.js';

describe('prioritizePages', () => {
  it('caps output at maxPages', () => {
    const urls = Array.from({ length: 100 }, (_, i) => `https://example.com/page-${i}`);
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBeLessThanOrEqual(50);
  });

  it('returns all URLs when count is under the cap', () => {
    const urls = ['https://example.com/', 'https://example.com/about'];
    const result = prioritizePages(urls, 'example.com', 50);
    expect(result.length).toBe(2);
  });
});

const urlset = (urls) =>
  `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls
    .map((u) => `<url><loc>${u}</loc></url>`)
    .join('')}</urlset>`;
const index = (locs) =>
  `<?xml version="1.0" encoding="UTF-8"?><sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${locs
    .map((u) => `<sitemap><loc>${u}</loc></sitemap>`)
    .join('')}</sitemapindex>`;
const pages = (prefix, n) => Array.from({ length: n }, (_, i) => `https://example.com/${prefix}-${i}`);

// fetchText stub backed by a url -> body map; anything missing is a 404 (null).
const stub = (map) => async (url) => (url in map ? map[url] : null);

describe('parseSitemapXml', () => {
  it('recognizes a sitemap index', () => {
    const r = parseSitemapXml(index(['https://example.com/a.xml', 'https://example.com/b.xml']));
    expect(r.type).toBe('index');
    expect(r.locs).toEqual(['https://example.com/a.xml', 'https://example.com/b.xml']);
  });

  it('recognizes a urlset', () => {
    const r = parseSitemapXml(urlset(['https://example.com/', 'https://example.com/about']));
    expect(r.type).toBe('urlset');
    expect(r.locs).toHaveLength(2);
  });

  it('returns unknown for non-sitemap content', () => {
    expect(parseSitemapXml('<html><body>Not found</body></html>').type).toBe('unknown');
    expect(parseSitemapXml(null)).toEqual({ type: 'unknown', locs: [] });
  });
});

describe('collectSitemapUrls', () => {
  it('reads every child of a sitemap index (BBT regression: must not report 3)', async () => {
    const fetchText = stub({
      'https://example.com/sitemap_index.xml': index([
        'https://example.com/page-sitemap.xml',
        'https://example.com/post-sitemap.xml',
        'https://example.com/product-sitemap.xml',
      ]),
      'https://example.com/page-sitemap.xml': urlset(pages('page', 3)),
      'https://example.com/post-sitemap.xml': urlset(pages('post', 40)),
      'https://example.com/product-sitemap.xml': urlset(pages('product', 12)),
    });
    const r = await collectSitemapUrls('example.com', fetchText);
    expect(r.urls).toHaveLength(55);
    expect(r.sitemaps).toHaveLength(3);
    expect(r.sitemaps.map((s) => s.count)).toEqual([3, 40, 12]);
    expect(r.source).toBe('sitemap_index.xml');
  });

  it('recurses into a nested index (depth 2)', async () => {
    const fetchText = stub({
      'https://example.com/sitemap.xml': index([
        'https://example.com/nested-index.xml',
        'https://example.com/top.xml',
      ]),
      'https://example.com/nested-index.xml': index(['https://example.com/deep.xml']),
      'https://example.com/deep.xml': urlset(pages('deep', 7)),
      'https://example.com/top.xml': urlset(pages('top', 2)),
    });
    const r = await collectSitemapUrls('example.com', fetchText);
    expect(r.urls).toHaveLength(9);
    expect(r.source).toBe('sitemap.xml');
    expect(r.sitemaps.find((s) => s.url === 'https://example.com/deep.xml').count).toBe(7);
  });

  it('uses a robots.txt Sitemap: line as the source', async () => {
    const fetchText = stub({
      'https://example.com/robots.txt': 'User-agent: *\nDisallow: /wp-admin/\nSitemap: https://example.com/custom-map.xml\n',
      'https://example.com/custom-map.xml': urlset(pages('r', 4)),
      'https://example.com/sitemap.xml': urlset(pages('wrong', 1)),
    });
    const r = await collectSitemapUrls('example.com', fetchText);
    expect(r.source).toBe('robots');
    expect(r.urls).toHaveLength(4);
    expect(r.sitemaps).toEqual([{ url: 'https://example.com/custom-map.xml', count: 4 }]);
  });

  it('stops at 50 child sitemaps', async () => {
    const children = Array.from({ length: 60 }, (_, i) => `https://example.com/s-${i}.xml`);
    const map = { 'https://example.com/sitemap_index.xml': index(children) };
    children.forEach((c, i) => { map[c] = urlset(pages(`c${i}`, 10)); });
    const r = await collectSitemapUrls('example.com', stub(map));
    expect(r.sitemaps).toHaveLength(50);
    expect(r.urls).toHaveLength(500);
  });

  it('stops at 5,000 URLs', async () => {
    const children = Array.from({ length: 10 }, (_, i) => `https://example.com/s-${i}.xml`);
    const map = { 'https://example.com/sitemap_index.xml': index(children) };
    children.forEach((c, i) => { map[c] = urlset(pages(`c${i}`, 1000)); });
    const r = await collectSitemapUrls('example.com', stub(map));
    expect(r.urls).toHaveLength(5000);
  });

  it('skips .xml.gz children but lists them with count null', async () => {
    const fetchText = stub({
      'https://example.com/sitemap_index.xml': index([
        'https://example.com/a.xml',
        'https://example.com/b.xml.gz',
      ]),
      'https://example.com/a.xml': urlset(pages('a', 2)),
    });
    const r = await collectSitemapUrls('example.com', fetchText);
    expect(r.urls).toHaveLength(2);
    expect(r.sitemaps).toContainEqual({ url: 'https://example.com/b.xml.gz', count: null });
  });

  it('returns empty with source null when no sitemap exists', async () => {
    const r = await collectSitemapUrls('example.com', stub({}));
    expect(r.urls).toEqual([]);
    expect(r.source).toBeNull();
  });
});

describe('summarizeImages', () => {
  it('summarizes 300 images with 120 missing alt', () => {
    const images = Array.from({ length: 300 }, (_, i) => ({
      src: `/img/${i}.jpg`,
      alt: i < 120 ? '' : `photo ${i}`,
      has_alt: i >= 120,
    }));
    const s = summarizeImages(images);
    expect(s.count).toBe(300);
    expect(s.missing_alt).toBe(120);
    expect(s.examples_missing_alt).toHaveLength(5);
    expect(s.examples_missing_alt[0]).toBe('/img/0.jpg');
  });
});

describe('parsePage', () => {
  it('page record caps text and summarizes images', () => {
    const body = 'word '.repeat(6000); // 30,000 characters
    const imgs = Array.from({ length: 200 }, (_, i) => `<img src="/i${i}.png"${i % 2 ? ' alt="x"' : ''}>`).join('');
    const html = `<html><head><title>T</title></head><body><p>${body}</p>${imgs}</body></html>`;
    const rec = parsePage(html, 'https://example.com/');
    expect(rec.content_text.length).toBeLessThanOrEqual(8000);
    expect(rec.content_text.length).toBeGreaterThan(2000);
    expect(rec.content_snippet).toBe(rec.content_text.substring(0, 2000));
    expect(Array.isArray(rec.images)).toBe(false);
    expect(rec.images).toMatchObject({ count: 200, missing_alt: 100 });
    expect(rec.images.examples_missing_alt.length).toBeLessThanOrEqual(5);
  });
});

describe('crawlSite', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('crawls seed URLs first, deduped, and reports sitemap totals', async () => {
    const html = (t) => `<html><head><title>${t}</title></head><body><nav><a href="/about">About</a></nav>${t}</body></html>`;
    const bodies = {
      'https://example.com': html('home'),
      'https://example.com/': html('home'),
      'https://example.com/about': html('about'),
      'https://example.com/top-page': html('top'),
      'https://example.com/sitemap_index.xml': index(['https://example.com/a.xml', 'https://example.com/b.xml']),
      'https://example.com/a.xml': urlset(pages('a', 3)),
      'https://example.com/b.xml': urlset(pages('b', 4)),
    };
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      const body = bodies[url];
      return { status: body ? 200 : 404, url, text: async () => body || 'not found' };
    }));

    const r = await crawlSite('example.com', 'quick', null, {
      seedUrls: ['https://example.com/top-page', 'https://example.com/top-page?x=1', '/top-page'],
    });
    expect(r.pages_crawled[0].url).toBe('https://example.com/top-page');
    expect(r.pages_crawled.filter((p) => p.url === 'https://example.com/top-page')).toHaveLength(1);
    expect(r.pages_crawled.length).toBeLessThanOrEqual(5);
    expect(r.sitemap_url_count).toBe(7);
    expect(r.sitemaps).toHaveLength(2);
    expect(r.sitemap_source).toBe('sitemap_index.xml');
    expect(r.site_wide.sitemap_url_count).toBe(7);
    const rec = r.pages_crawled[0];
    expect(rec.status_code).toBe(200);
    expect(rec.final_url).toBe('https://example.com/top-page');
    expect(typeof rec.response_ms).toBe('number');
  });
});
