/**
 * seoCrawler.js
 *
 * Lightweight site crawler using cheerio (no headless browser needed).
 * Runs on Vercel serverless — no binary dependencies.
 *
 * Extracts: title tags, meta descriptions, JSON-LD schema, headings,
 * images, OG tags, canonical, robots, links, word count, content snippet.
 */

import * as cheerio from "cheerio";

const USER_AGENT = "LilikoiSEOAudit/1.0 (+https://lilikoiagency.com)";
const FETCH_TIMEOUT_MS = 15_000;
const DELAY_BETWEEN_PAGES_MS = 300;
const MAX_PAGES_FULL = 50;
const MAX_PAGES_QUICK = 5;

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeUrl(href, baseUrl) {
  try {
    const u = new URL(href, baseUrl);
    u.hash = "";          // strip #fragments — they're the same page
    u.search = "";        // strip query strings — avoid duplicate crawls
    return u.href;
  } catch {
    return null;
  }
}

function getDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ── Fetch a single URL with timeout ──────────────────────────────────────────

async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const started = Date.now();

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    const status = res.status;
    const finalUrl = res.url || url; // actual URL after redirects
    const html = await res.text();
    clearTimeout(timer);
    return { html, status, finalUrl, error: null, responseMs: Date.now() - started };
  } catch (err) {
    clearTimeout(timer);
    return { html: null, status: 0, finalUrl: url, error: err.message, responseMs: null };
  }
}

// Body text only for 2xx responses; anything else (404 page, network error) is null.
async function fetchOkText(url) {
  const { html, status, error } = await fetchHtml(url);
  if (error || !html || status < 200 || status >= 300) return null;
  return html;
}

// ── Sitemaps ─────────────────────────────────────────────────────────────────

const MAX_CHILD_SITEMAPS = 50;
const MAX_SITEMAP_URLS = 5_000;
const MAX_SITEMAP_DEPTH = 3;

/**
 * Parse sitemap XML. Pure.
 * @returns {{ type: 'index'|'urlset'|'unknown', locs: string[] }}
 */
export function parseSitemapXml(xml) {
  if (!xml || typeof xml !== "string") return { type: "unknown", locs: [] };
  let $;
  try {
    $ = cheerio.load(xml, { xmlMode: true });
  } catch {
    return { type: "unknown", locs: [] };
  }
  const readLocs = (selector) =>
    $(selector)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

  if ($("sitemapindex").length || $("sitemap > loc").length) {
    return { type: "index", locs: readLocs("sitemap > loc") };
  }
  if ($("urlset").length || $("url > loc").length) {
    return { type: "urlset", locs: readLocs("url > loc") };
  }
  return { type: "unknown", locs: [] };
}

/**
 * Collect page URLs from every sitemap a site exposes.
 * Order of discovery: robots.txt `Sitemap:` lines, then /sitemap_index.xml,
 * then /sitemap.xml. Reads every child of an index, recursing into nested
 * indexes up to depth 3. Caps: 50 child sitemaps, 5,000 URLs.
 * `.xml.gz` children are not fetched; they are listed with count null.
 *
 * @param {string} domain
 * @param {(url: string) => Promise<string|null>} fetchText
 */
export async function collectSitemapUrls(domain, fetchText) {
  const baseUrl = `https://${domain}`;
  const siteDomain = getDomain(baseUrl);

  const candidates = []; // [{ roots: string[], source }]
  const robotsTxt = await fetchText(`${baseUrl}/robots.txt`);
  if (robotsTxt) {
    const roots = [];
    for (const m of robotsTxt.matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)) {
      try {
        const u = new URL(m[1], baseUrl).href;
        if (!roots.includes(u)) roots.push(u);
      } catch { /* skip malformed */ }
    }
    if (roots.length) candidates.push({ roots, source: "robots" });
  }
  candidates.push({ roots: [`${baseUrl}/sitemap_index.xml`], source: "sitemap_index.xml" });
  candidates.push({ roots: [`${baseUrl}/sitemap.xml`], source: "sitemap.xml" });

  for (const { roots, source } of candidates) {
    const urls = new Set();
    const sitemaps = [];
    const visited = new Set();
    let childCount = 0;
    let foundAny = false;

    const addUrls = (locs) => {
      let count = 0;
      for (const loc of locs) {
        if (urls.size >= MAX_SITEMAP_URLS) break;
        if (getDomain(loc) !== siteDomain) continue;
        count++;
        urls.add(loc);
      }
      return count;
    };

    const walk = async (url, depth, isRoot) => {
      if (visited.has(url) || urls.size >= MAX_SITEMAP_URLS) return;
      if (!isRoot) {
        if (childCount >= MAX_CHILD_SITEMAPS) return;
        childCount++;
      }
      visited.add(url);

      if (/\.gz(\?|#|$)/i.test(url)) {
        sitemaps.push({ url, count: null });
        foundAny = true;
        return;
      }

      const parsed = parseSitemapXml(await fetchText(url));
      if (parsed.type === "unknown") return;
      foundAny = true;

      if (parsed.type === "urlset") {
        sitemaps.push({ url, count: addUrls(parsed.locs) });
        return;
      }
      if (depth >= MAX_SITEMAP_DEPTH) return;
      for (const child of parsed.locs) {
        if (childCount >= MAX_CHILD_SITEMAPS || urls.size >= MAX_SITEMAP_URLS) break;
        await walk(child, depth + 1, false);
      }
    };

    for (const root of roots) await walk(root, 1, true);

    if (foundAny) return { urls: [...urls], sitemaps, source };
  }

  return { urls: [], sitemaps: [], source: null };
}

// ── Images ───────────────────────────────────────────────────────────────────

/** Summarize a page's images. Pure. */
export function summarizeImages(images) {
  const list = Array.isArray(images) ? images : [];
  const missing = list.filter((img) => !(img?.alt || "").trim());
  return {
    count: list.length,
    missing_alt: missing.length,
    examples_missing_alt: missing.slice(0, 5).map((img) => img?.src || ""),
  };
}

// ── Parse a single page HTML ─────────────────────────────────────────────────

export function parsePage(html, url) {
  const $ = cheerio.load(html);
  const domain = getDomain(url);

  // Title
  const titleTag = $("title").first().text().trim();

  // Meta description
  const metaDescription =
    $('meta[name="description"]').attr("content")?.trim() || "";

  // Canonical
  const canonicalUrl = $('link[rel="canonical"]').attr("href") || "";

  // Robots meta
  const robotsMeta = $('meta[name="robots"]').attr("content") || "";

  // Viewport
  const hasViewportMeta = !!$('meta[name="viewport"]').length;

  // HTTPS
  const hasHttps = url.startsWith("https://");

  // Headings
  const h1Tags = $("h1")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h2Tags = $("h2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  const h3Tags = $("h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  // Images
  const images = $("img")
    .map((_, el) => ({
      src: $(el).attr("src") || "",
      alt: $(el).attr("alt") || "",
      has_alt: !!($(el).attr("alt") || "").trim(),
    }))
    .get();

  // JSON-LD Schema markup
  const schemaMarkup = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html();
    try {
      schemaMarkup.push({
        type: "application/ld+json",
        raw_json: JSON.parse(raw),
      });
    } catch {
      schemaMarkup.push({
        type: "application/ld+json",
        parse_error: true,
        raw_text: raw?.substring(0, 500),
      });
    }
  });

  // Open Graph
  const openGraph = {
    og_title: $('meta[property="og:title"]').attr("content") || "",
    og_description: $('meta[property="og:description"]').attr("content") || "",
    og_image: $('meta[property="og:image"]').attr("content") || "",
  };

  // Body text for word count + content snippet. Read from a copy with
  // non-content elements removed, so code and CSS don't count as page text.
  const $body = $("body").clone();
  $body.find("script, style, noscript, svg, template, iframe").remove();
  const bodyText = $body.text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;
  const contentText = bodyText.substring(0, 8000);
  const contentSnippet = contentText.substring(0, 2000); // kept for the v1 audit

  // Links
  const allLinks = $("a[href]")
    .map((_, el) => $(el).attr("href"))
    .get();
  let internalLinksCount = 0;
  let externalLinksCount = 0;
  for (const href of allLinks) {
    const resolved = normalizeUrl(href, url);
    if (!resolved) continue;
    if (getDomain(resolved) === domain) {
      internalLinksCount++;
    } else {
      externalLinksCount++;
    }
  }

  return {
    url,
    title_tag: titleTag,
    meta_description: metaDescription,
    canonical_url: canonicalUrl,
    robots_meta: robotsMeta,
    has_viewport_meta: hasViewportMeta,
    has_https: hasHttps,
    h1_tags: h1Tags,
    h2_tags: h2Tags,
    h3_tags: h3Tags,
    images: summarizeImages(images),
    schema_markup: schemaMarkup,
    open_graph: openGraph,
    word_count: wordCount,
    internal_links_count: internalLinksCount,
    external_links_count: externalLinksCount,
    content_text: contentText,
    content_snippet: contentSnippet,
  };
}

// ── Discover pages from sitemap or homepage nav ──────────────────────────────

async function discoverPages(domain) {
  const baseUrl = `https://${domain}`;
  const navUrls = new Set();      // from header/nav — these are the "main" pages
  const sitemapUrls = new Set();   // fallback pool
  navUrls.add(baseUrl + "/");

  // ── Step 1: Fetch homepage and extract nav/header links ────────────────
  // These are the pages the site owner considers primary — use them first.
  const { html: homepageHtml } = await fetchHtml(baseUrl);
  if (homepageHtml) {
    const $ = cheerio.load(homepageHtml);

    // Primary: <nav> and <header> links
    $("nav a[href], header a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const resolved = normalizeUrl(href, baseUrl);
      if (resolved && getDomain(resolved) === domain) {
        navUrls.add(resolved);
      }
    });

    // Also grab prominent footer links (about, contact, etc.)
    $("footer a[href]").each((_, el) => {
      const href = $(el).attr("href");
      const resolved = normalizeUrl(href, baseUrl);
      if (resolved && getDomain(resolved) === domain) {
        // Only add footer links that look like main pages (short paths)
        try {
          const path = new URL(resolved).pathname;
          const depth = path.replace(/\/$/, "").split("/").filter(Boolean).length;
          if (depth <= 2) navUrls.add(resolved);
        } catch { /* skip */ }
      }
    });
  }

  // ── Step 2: Sitemap pages fill the gaps after nav ──────────────────────
  // Reads every child sitemap (robots.txt, sitemap_index.xml, sitemap.xml).
  const sitemap = await collectSitemapUrls(domain, fetchOkText);
  for (const loc of sitemap.urls) {
    const resolved = normalizeUrl(loc, baseUrl);
    if (resolved) sitemapUrls.add(resolved);
  }

  // ── Combine: nav links first (primary), then sitemap fills gaps ────────
  // Nav links are ordered as they appear in the site's navigation — intentional.
  const combined = [...navUrls];
  for (const url of sitemapUrls) {
    if (!navUrls.has(url)) combined.push(url);
  }

  return {
    urls: combined,
    navUrlCount: navUrls.size,
    sitemapAccessible: sitemap.source !== null,
    sitemapUrlCount: sitemap.urls.length,
    sitemaps: sitemap.sitemaps,
    sitemapSource: sitemap.source,
  };
}

// ── Extract site-wide data ───────────────────────────────────────────────────

async function extractSiteWide(domain, homepageData, discovery) {
  const baseUrl = `https://${domain}`;

  // Robots.txt
  const robotsTxt = await fetchOkText(`${baseUrl}/robots.txt`);

  // Parse nav/footer/social from homepage crawl data
  const $ = homepageData?._$ || null;
  let navigationLinks = [];
  let footerLinks = [];
  let socialLinks = [];
  let contactInfo = { phone: "", email: "", addresses: [] };

  if ($) {
    // Navigation
    navigationLinks = $("nav a[href]")
      .map((_, el) => ({
        text: $(el).text().trim(),
        url: $(el).attr("href"),
      }))
      .get()
      .filter((l) => l.text)
      .slice(0, 20);

    // Footer
    footerLinks = $("footer a[href]")
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean)
      .slice(0, 20);

    // Social links
    const socialPatterns = [
      { platform: "facebook", pattern: /facebook\.com/i },
      { platform: "instagram", pattern: /instagram\.com/i },
      { platform: "twitter", pattern: /twitter\.com|x\.com/i },
      { platform: "linkedin", pattern: /linkedin\.com/i },
      { platform: "youtube", pattern: /youtube\.com/i },
      { platform: "tiktok", pattern: /tiktok\.com/i },
    ];
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      for (const s of socialPatterns) {
        if (s.pattern.test(href)) {
          socialLinks.push({ platform: s.platform, url: href });
          break;
        }
      }
    });
    // Dedupe by platform
    const seen = new Set();
    socialLinks = socialLinks.filter((l) => {
      if (seen.has(l.platform)) return false;
      seen.add(l.platform);
      return true;
    });

    // Contact info — look for tel: and mailto: links
    $('a[href^="tel:"]').each((_, el) => {
      if (!contactInfo.phone) {
        contactInfo.phone = $(el).attr("href").replace("tel:", "").trim();
      }
    });
    $('a[href^="mailto:"]').each((_, el) => {
      if (!contactInfo.email) {
        contactInfo.email = $(el).attr("href").replace("mailto:", "").trim();
      }
    });
  }

  return {
    robots_txt_accessible: !!robotsTxt,
    robots_txt_content: robotsTxt?.substring(0, 1000) || "",
    // Sitemap facts come from discovery, which reads every child sitemap.
    sitemap_accessible: discovery.sitemapAccessible,
    sitemap_url_count: discovery.sitemapUrlCount,
    sitemap_source: discovery.sitemapSource,
    ssl_valid: true, // We always fetch via HTTPS
    navigation_links: navigationLinks,
    footer_links: footerLinks,
    social_links: socialLinks,
    contact_info: contactInfo,
  };
}

// ── Prioritize which pages to crawl ──────────────────────────────────────────

export function prioritizePages(urls, domain, maxPages) {
  const baseUrl = `https://${domain}`;
  const priorityPatterns = [
    { pattern: /^\/?$/, type: "homepage" },
    { pattern: /about|our-story|team/i, type: "about" },
    { pattern: /services?|what-we-do/i, type: "services" },
    { pattern: /contact|get-in-touch/i, type: "contact" },
    { pattern: /blog|news|articles/i, type: "blog" },
    { pattern: /faq|frequently-asked/i, type: "faq" },
    { pattern: /reviews?|testimonials/i, type: "reviews" },
    { pattern: /locations?|areas?-served/i, type: "locations" },
    { pattern: /products?|shop|store/i, type: "products" },
    { pattern: /pricing|cost|quote/i, type: "pricing" },
  ];

  const prioritized = [];
  const typeClaimed = new Set();
  const remaining = [];

  for (const url of urls) {
    const path = url.replace(baseUrl, "").replace(/\/$/, "");
    let matched = false;
    for (const { pattern, type } of priorityPatterns) {
      if (pattern.test(path)) {
        // Only take ONE page per priority type to ensure variety
        if (!typeClaimed.has(type)) {
          typeClaimed.add(type);
          prioritized.push({ url, page_type: type });
        } else {
          remaining.push({ url, page_type: type });
        }
        matched = true;
        break;
      }
    }
    if (!matched) {
      remaining.push({ url, page_type: "other" });
    }
  }

  // Combine prioritized first, then remaining, capped at maxPages
  return [...prioritized, ...remaining].slice(0, maxPages);
}

// ── Main crawl function ──────────────────────────────────────────────────────

function isHomepageUrl(url) {
  try {
    return new URL(url).pathname.replace(/\/+$/, "") === "";
  } catch {
    return false;
  }
}

/**
 * @param {string} domain
 * @param {'full'|'quick'} auditType
 * @param {string[]|null} customUrls  explicit page list (overrides discovery)
 * @param {{ seedUrls?: string[] }} options  seedUrls (e.g. top Search Console
 *   pages) are crawled first, deduped; nav/sitemap priority fills up to the cap.
 */
export async function crawlSite(domain, auditType = "full", customUrls = null, { seedUrls } = {}) {
  const maxPages = auditType === "quick" ? MAX_PAGES_QUICK : MAX_PAGES_FULL;
  const baseUrl = `https://${domain}`;

  // Discover pages
  const discovery = await discoverPages(domain);

  // Determine which pages to crawl
  let pagesToCrawl;
  if (customUrls && customUrls.length > 0) {
    pagesToCrawl = customUrls.slice(0, maxPages).map((url) => ({
      url,
      page_type: "custom",
    }));
  } else {
    const seeds = [];
    const seen = new Set();
    for (const raw of Array.isArray(seedUrls) ? seedUrls : []) {
      const url = normalizeUrl(raw, baseUrl);
      if (!url || seen.has(url) || getDomain(url) !== getDomain(baseUrl)) continue;
      seen.add(url);
      seeds.push({ url, page_type: isHomepageUrl(url) ? "homepage" : "search_console" });
      if (seeds.length >= maxPages) break;
    }
    const rest = prioritizePages(
      discovery.urls.filter((u) => !seen.has(u)),
      domain,
      maxPages - seeds.length
    );
    pagesToCrawl = [...seeds, ...rest];
    if (discovery.urls.length > maxPages) {
      console.warn(
        `[seoCrawler] Discovered ${discovery.urls.length} pages for ${domain} — truncated to ${maxPages}`
      );
    }
  }

  // Crawl each page
  const pagesCrawled = [];
  const crawlErrors = [];
  const crawledFinalUrls = new Set(); // dedupe after redirects
  let homepageCheerio = null;

  for (let i = 0; i < pagesToCrawl.length; i++) {
    const { url, page_type } = pagesToCrawl[i];

    if (i > 0) await sleep(DELAY_BETWEEN_PAGES_MS);

    const { html, status, finalUrl, error, responseMs } = await fetchHtml(url);

    if (error || !html) {
      crawlErrors.push({ url, error: error || "Empty response", status });
      continue;
    }

    // Use the final URL after redirects — skip if we already crawled it
    const resolvedUrl = normalizeUrl(finalUrl, `https://${domain}`) || finalUrl;
    if (crawledFinalUrls.has(resolvedUrl)) continue;
    crawledFinalUrls.add(resolvedUrl);

    try {
      const parsed = parsePage(html, resolvedUrl);
      parsed.http_status = status; // v1 name
      parsed.status_code = status;
      parsed.final_url = finalUrl;
      parsed.response_ms = responseMs;
      parsed.page_type = page_type;
      pagesCrawled.push(parsed);

      // Keep homepage cheerio instance for site-wide extraction
      if (page_type === "homepage" || (i === 0 && !homepageCheerio)) {
        homepageCheerio = { _$: cheerio.load(html) };
      }
    } catch (err) {
      crawlErrors.push({ url: resolvedUrl, error: err.message, status });
    }
  }

  // Extract site-wide data
  const siteWide = await extractSiteWide(domain, homepageCheerio, discovery);

  return {
    domain,
    audit_type: auditType,
    audit_date: new Date().toISOString().split("T")[0],
    pages_crawled: pagesCrawled,
    site_wide: siteWide,
    crawl_errors: crawlErrors,
    discovered_pages: discovery.urls.slice(0, 50),
    sitemap_accessible: discovery.sitemapAccessible,
    sitemap_url_count: discovery.sitemapUrlCount,
    sitemaps: discovery.sitemaps,
    sitemap_source: discovery.sitemapSource,
  };
}
