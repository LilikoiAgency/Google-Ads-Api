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
const MAX_PAGES_FULL = 25;
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

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": USER_AGENT },
      redirect: "follow",
    });
    clearTimeout(timer);
    const status = res.status;
    const finalUrl = res.url || url; // actual URL after redirects
    const html = await res.text();
    return { html, status, finalUrl, error: null };
  } catch (err) {
    clearTimeout(timer);
    return { html: null, status: 0, finalUrl: url, error: err.message };
  }
}

// ── Parse a single page HTML ─────────────────────────────────────────────────

function parsePage(html, url) {
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
    .get()
    .slice(0, 50); // cap to avoid bloat

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

  // Body text for word count + content snippet
  const bodyText = $("body").text().replace(/\s+/g, " ").trim();
  const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;
  const contentSnippet = bodyText.substring(0, 2000);

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
    images,
    schema_markup: schemaMarkup,
    open_graph: openGraph,
    word_count: wordCount,
    internal_links_count: internalLinksCount,
    external_links_count: externalLinksCount,
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

  // ── Step 2: Sitemap as fallback — only if nav gave us too few pages ────
  let sitemapUrlCount = 0;
  let sitemapAccessible = false;

  const sitemapUrl = `${baseUrl}/sitemap.xml`;
  const { html: sitemapXml } = await fetchHtml(sitemapUrl);

  if (sitemapXml) {
    sitemapAccessible = true;
    const $ = cheerio.load(sitemapXml, { xmlMode: true });

    // Handle sitemap index (nested sitemaps)
    const sitemapLocs = $("sitemap > loc")
      .map((_, el) => $(el).text().trim())
      .get();

    if (sitemapLocs.length > 0) {
      const { html: childXml } = await fetchHtml(sitemapLocs[0]);
      if (childXml) {
        const $child = cheerio.load(childXml, { xmlMode: true });
        $child("url > loc").each((_, el) => {
          const loc = $child(el).text().trim();
          if (loc && getDomain(loc) === domain) {
            sitemapUrls.add(loc);
            sitemapUrlCount++;
          }
        });
      }
    } else {
      $("url > loc").each((_, el) => {
        const loc = $(el).text().trim();
        if (loc && getDomain(loc) === domain) {
          sitemapUrls.add(loc);
          sitemapUrlCount++;
        }
      });
    }
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
    sitemapAccessible,
    sitemapUrlCount,
  };
}

// ── Extract site-wide data ───────────────────────────────────────────────────

async function extractSiteWide(domain, homepageData) {
  const baseUrl = `https://${domain}`;

  // Robots.txt
  const { html: robotsTxt } = await fetchHtml(`${baseUrl}/robots.txt`);

  // Sitemap info (already partially known from discovery)
  const { html: sitemapXml } = await fetchHtml(`${baseUrl}/sitemap.xml`);
  let sitemapUrlCount = 0;
  if (sitemapXml) {
    const $ = cheerio.load(sitemapXml, { xmlMode: true });
    sitemapUrlCount = $("url > loc").length || $("sitemap > loc").length;
  }

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
    sitemap_accessible: !!sitemapXml,
    sitemap_url_count: sitemapUrlCount,
    ssl_valid: true, // We always fetch via HTTPS
    navigation_links: navigationLinks,
    footer_links: footerLinks,
    social_links: socialLinks,
    contact_info: contactInfo,
  };
}

// ── Prioritize which pages to crawl ──────────────────────────────────────────

function prioritizePages(urls, domain, maxPages) {
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

export async function crawlSite(domain, auditType = "full", customUrls = null) {
  const maxPages = auditType === "quick" ? MAX_PAGES_QUICK : MAX_PAGES_FULL;

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
    pagesToCrawl = prioritizePages(discovery.urls, domain, maxPages);
  }

  // Crawl each page
  const pagesCrawled = [];
  const crawlErrors = [];
  const crawledFinalUrls = new Set(); // dedupe after redirects
  let homepageCheerio = null;

  for (let i = 0; i < pagesToCrawl.length; i++) {
    const { url, page_type } = pagesToCrawl[i];

    if (i > 0) await sleep(DELAY_BETWEEN_PAGES_MS);

    const { html, status, finalUrl, error } = await fetchHtml(url);

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
      parsed.http_status = status;
      parsed.page_type = page_type;
      pagesCrawled.push(parsed);

      // Keep homepage cheerio instance for site-wide extraction
      if (page_type === "homepage" || i === 0) {
        homepageCheerio = { _$: cheerio.load(html) };
      }
    } catch (err) {
      crawlErrors.push({ url: resolvedUrl, error: err.message, status });
    }
  }

  // Extract site-wide data
  const siteWide = await extractSiteWide(domain, homepageCheerio);

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
  };
}
