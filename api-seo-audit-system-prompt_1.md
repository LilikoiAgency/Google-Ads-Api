# SEO/GEO/AEO Audit System Prompt for Claude API

## How to Use This Document

This document contains everything you need to integrate an SEO audit "skill" into your web application via the Claude API. It has three parts:

1. **Data Schema** — What your backend should crawl and how to structure it before sending to Claude
2. **System Prompt** — The full prompt you paste into the `system` field of your API call
3. **API Integration Example** — Sample code showing how to wire it all together

---

## Part 1: Data Schema — What Your Backend Should Crawl

Your app should crawl the target site and send Claude a structured JSON payload. This is critical because:
- Your backend can capture raw HTML including `<script type="application/ld+json">` tags (which markdown extraction misses)
- You can include Google Search Console and Google Ads data alongside the crawl
- You control the quality and completeness of the data

### Crawl Data Structure

For each page crawled, extract and send:

```json
{
  "audit_request": {
    "domain": "bigbullyturf.com",
    "audit_type": "full",
    "audit_date": "2026-04-08",
    "pages_crawled": [
      {
        "url": "https://bigbullyturf.com/",
        "page_type": "homepage",
        "http_status": 200,
        "title_tag": "Get the lawn of your dreams today",
        "meta_description": "Big Bully Turf specializes in artificial grass installation...",
        "canonical_url": "https://bigbullyturf.com/",
        "robots_meta": "index, follow",
        "h1_tags": ["Get the lawn of your dreams today"],
        "h2_tags": ["Our Services", "How Our Technology Works", "The Big Bully Turf Story"],
        "h3_tags": ["Artificial Grass Installation", "Hardscape", "Putting Green", "Pet Turf"],
        "word_count": 850,
        "internal_links_count": 45,
        "external_links_count": 3,
        "images": [
          {
            "src": "https://bigbullyturf.com/wp-content/uploads/logo.webp",
            "alt": "Big Bully Turf logo featuring a cartoon bulldog...",
            "has_alt": true
          }
        ],
        "schema_markup": [
          {
            "type": "application/ld+json",
            "raw_json": {
              "@context": "https://schema.org",
              "@type": "LocalBusiness",
              "name": "Big Bully Turf",
              "telephone": "(888) 665-8873",
              "email": "hello@bigbullyturf.com",
              "sameAs": ["https://twitter.com/bigbullyturf", "..."],
              "description": "Big Bully Turf is a artificial grass company..."
            }
          }
        ],
        "open_graph": {
          "og_title": "Big Bully Turf - Artificial Grass Installation",
          "og_description": "...",
          "og_image": "https://bigbullyturf.com/..."
        },
        "has_viewport_meta": true,
        "has_https": true,
        "content_snippet": "First 500 words of visible body text..."
      }
    ],

    "site_wide": {
      "robots_txt_accessible": true,
      "robots_txt_content": "User-agent: *\nAllow: /\nSitemap: https://bigbullyturf.com/sitemap.xml",
      "sitemap_accessible": true,
      "sitemap_url_count": 87,
      "ssl_valid": true,
      "navigation_links": [
        {"text": "About Us", "url": "/about-us/"},
        {"text": "Services", "url": "/services/"},
        {"text": "Locations", "url": "/locations/"}
      ],
      "footer_links": ["..."],
      "social_links": [
        {"platform": "facebook", "url": "https://www.facebook.com/bigbullyturf"},
        {"platform": "instagram", "url": "https://instagram.com/bigbullyturf"}
      ],
      "contact_info": {
        "phone": "(888) 665-8873",
        "email": "hello@bigbullyturf.com",
        "addresses": [
          "350 Tenth Ave, Suite 820, San Diego, CA 92101",
          "921 American Pacific Drive, Suite 304, Henderson, NV 89014"
        ]
      },
      "license_numbers": ["CSLB #1109967", "ROC 356010"]
    },

    "google_search_console": {
      "period": "last_90_days",
      "total_clicks": 12450,
      "total_impressions": 345000,
      "average_ctr": 0.036,
      "average_position": 14.2,
      "top_queries": [
        {
          "query": "artificial grass installation san diego",
          "clicks": 320,
          "impressions": 4500,
          "ctr": 0.071,
          "position": 6.2
        },
        {
          "query": "big bully turf",
          "clicks": 890,
          "impressions": 2100,
          "ctr": 0.424,
          "position": 1.1
        }
      ],
      "top_pages": [
        {
          "page": "https://bigbullyturf.com/locations/san-diego/",
          "clicks": 450,
          "impressions": 8900,
          "ctr": 0.051,
          "position": 8.7
        }
      ],
      "coverage_issues": {
        "errors": 2,
        "warnings": 15,
        "excluded": 45
      }
    },

    "google_ads": {
      "period": "last_30_days",
      "account_currency": "USD",
      "total_spend": 15420.50,
      "total_conversions": 187,
      "total_conversion_value": 45600.00,
      "campaigns": [
        {
          "name": "San Diego - Artificial Grass",
          "status": "active",
          "spend": 4200.00,
          "impressions": 28000,
          "clicks": 1400,
          "conversions": 62,
          "conversion_value": 15200.00,
          "ctr": 0.05,
          "cpc": 3.00,
          "cpa": 67.74,
          "roas": 3.62
        }
      ],
      "top_keywords": [
        {
          "keyword": "artificial grass installation",
          "match_type": "phrase",
          "spend": 1200.00,
          "clicks": 380,
          "conversions": 22,
          "quality_score": 7,
          "cpa": 54.55
        }
      ]
    },

    "seo_tool_data": {
      "source": "ahrefs | semrush | both",
      "domain_metrics": {
        "domain_rating": 42,
        "domain_authority": 38,
        "organic_traffic_estimate": 8500,
        "organic_keywords_count": 2340,
        "referring_domains": 312,
        "backlinks_total": 4850,
        "traffic_value_estimate": 12400.00
      },
      "backlink_profile": {
        "referring_domains_trend": "growing | stable | declining",
        "new_referring_domains_30d": 18,
        "lost_referring_domains_30d": 5,
        "dofollow_percentage": 0.72,
        "top_referring_domains": [
          {
            "domain": "sandiegouniontribune.com",
            "domain_rating": 85,
            "backlinks_from": 3,
            "type": "editorial | directory | sponsor | guest_post"
          },
          {
            "domain": "yelp.com",
            "domain_rating": 93,
            "backlinks_from": 1,
            "type": "directory"
          }
        ],
        "anchor_text_distribution": [
          { "anchor": "big bully turf", "percentage": 0.28, "type": "branded" },
          { "anchor": "artificial grass san diego", "percentage": 0.08, "type": "keyword" },
          { "anchor": "https://bigbullyturf.com", "percentage": 0.22, "type": "url" },
          { "anchor": "click here", "percentage": 0.05, "type": "generic" }
        ],
        "toxic_or_spammy_links_flagged": 12
      },
      "organic_keywords": {
        "top_ranking_keywords": [
          {
            "keyword": "artificial grass installation san diego",
            "position": 6,
            "search_volume": 1200,
            "keyword_difficulty": 45,
            "traffic_estimate": 85,
            "url": "https://bigbullyturf.com/locations/san-diego/"
          },
          {
            "keyword": "pet turf las vegas",
            "position": 12,
            "search_volume": 480,
            "keyword_difficulty": 32,
            "traffic_estimate": 15,
            "url": "https://bigbullyturf.com/services/pet-turf/"
          }
        ],
        "keyword_gaps_vs_competitors": [
          {
            "keyword": "artificial grass cost per square foot",
            "search_volume": 5400,
            "difficulty": 38,
            "competitor_ranking": "competitor.com at position 4",
            "your_position": "not ranking"
          },
          {
            "keyword": "best artificial grass for dogs",
            "search_volume": 3200,
            "difficulty": 42,
            "competitor_ranking": "competitor.com at position 7",
            "your_position": "not ranking"
          }
        ],
        "position_distribution": {
          "positions_1_3": 15,
          "positions_4_10": 68,
          "positions_11_20": 210,
          "positions_21_50": 890,
          "positions_51_100": 1157
        }
      },
      "competitors": [
        {
          "domain": "syntheticgrasswarehouse.com",
          "domain_rating": 55,
          "organic_traffic": 22000,
          "organic_keywords": 5400,
          "common_keywords": 340,
          "keyword_gap_count": 1200
        },
        {
          "domain": "installitdirect.com",
          "domain_rating": 48,
          "organic_traffic": 15000,
          "organic_keywords": 3800,
          "common_keywords": 220,
          "keyword_gap_count": 850
        }
      ],
      "site_audit_issues": {
        "errors": [
          { "issue": "4xx errors", "count": 3, "urls": ["https://bigbullyturf.com/old-page/"] },
          { "issue": "Missing meta descriptions", "count": 8 },
          { "issue": "Duplicate title tags", "count": 2 }
        ],
        "warnings": [
          { "issue": "Title tag too long (>60 chars)", "count": 5 },
          { "issue": "Images without alt text", "count": 12 },
          { "issue": "Orphan pages (no internal links)", "count": 3 },
          { "issue": "Slow pages (>3s load)", "count": 7 }
        ],
        "notices": [
          { "issue": "Pages with low word count (<300)", "count": 14 },
          { "issue": "Non-HTTPS internal links", "count": 0 }
        ]
      },
      "content_gap_analysis": [
        {
          "topic_cluster": "artificial grass cost/pricing",
          "total_search_volume": 18000,
          "competitor_coverage": "3 of 4 competitors have dedicated pricing pages",
          "your_coverage": "No dedicated pricing page",
          "opportunity": "high"
        },
        {
          "topic_cluster": "artificial grass maintenance",
          "total_search_volume": 9500,
          "competitor_coverage": "2 of 4 competitors have maintenance guides",
          "your_coverage": "Brief mention on service page only",
          "opportunity": "medium"
        }
      ]
    }
  }
}
```

### What to Crawl (Priority Order)

For a **full audit**, crawl these pages:

1. Homepage
2. About / Team / Our Story
3. Each main service page
4. Product pages
5. Blog index + 2-3 recent posts
6. Contact page
7. Reviews / Testimonials
8. Locations hub + 1-2 city pages
9. FAQ page (if exists)
10. Any other high-traffic pages from GSC data

For a **quick audit**, crawl just the homepage + 3-4 top pages.

### Extraction Tips for Your Backend

Use a headless browser (Puppeteer/Playwright) rather than simple HTTP requests so you get:
- JavaScript-rendered content
- Schema markup from dynamically injected `<script>` tags
- Fully rendered DOM for accurate word counts and heading extraction

Example extraction snippet (Node.js + Puppeteer):

```javascript
const puppeteer = require('puppeteer');

async function crawlPage(url) {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'networkidle2' });

  const data = await page.evaluate(() => {
    // Title
    const title = document.querySelector('title')?.textContent || '';

    // Meta description
    const metaDesc = document.querySelector('meta[name="description"]')?.content || '';

    // Schema markup - THIS IS THE KEY PART
    const schemas = [];
    document.querySelectorAll('script[type="application/ld+json"]').forEach(el => {
      try {
        schemas.push({
          type: 'application/ld+json',
          raw_json: JSON.parse(el.textContent)
        });
      } catch (e) {
        schemas.push({ type: 'application/ld+json', parse_error: true, raw_text: el.textContent });
      }
    });

    // Headings
    const h1s = [...document.querySelectorAll('h1')].map(el => el.textContent.trim());
    const h2s = [...document.querySelectorAll('h2')].map(el => el.textContent.trim());
    const h3s = [...document.querySelectorAll('h3')].map(el => el.textContent.trim());

    // Images
    const images = [...document.querySelectorAll('img')].map(el => ({
      src: el.src,
      alt: el.alt,
      has_alt: !!el.alt && el.alt.trim() !== ''
    }));

    // Open Graph
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || '';
    const ogDesc = document.querySelector('meta[property="og:description"]')?.content || '';
    const ogImage = document.querySelector('meta[property="og:image"]')?.content || '';

    // Canonical
    const canonical = document.querySelector('link[rel="canonical"]')?.href || '';

    // Robots
    const robotsMeta = document.querySelector('meta[name="robots"]')?.content || '';

    // Viewport
    const hasViewport = !!document.querySelector('meta[name="viewport"]');

    // Word count (visible text)
    const bodyText = document.body?.innerText || '';
    const wordCount = bodyText.split(/\s+/).filter(w => w.length > 0).length;

    // Links
    const allLinks = [...document.querySelectorAll('a[href]')];
    const domain = window.location.hostname;
    const internalLinks = allLinks.filter(a => {
      try { return new URL(a.href).hostname === domain; } catch { return false; }
    }).length;
    const externalLinks = allLinks.length - internalLinks;

    // Content snippet
    const contentSnippet = bodyText.substring(0, 2000);

    return {
      title, metaDesc, canonical, robotsMeta, hasViewport,
      h1s, h2s, h3s, images, schemas, wordCount,
      internalLinks, externalLinks, contentSnippet,
      openGraph: { og_title: ogTitle, og_description: ogDesc, og_image: ogImage }
    };
  });

  await browser.close();
  return { url, http_status: 200, ...data };
}
```

---

## Part 2: The System Prompt

Copy this entire block into the `system` parameter of your Claude API call.

```
You are an expert digital marketing analyst specializing in SEO, GEO (Generative Engine Optimization), and AEO (Answer Engine Optimization). You also analyze Google Ads, Google Search Console, and third-party SEO tool data (Ahrefs, SEMrush) for a complete picture of organic and paid performance.

You will receive a JSON payload containing some or all of:
- Crawl data from a website (pages, meta tags, schema markup, headings, content)
- Google Search Console data (queries, clicks, impressions, positions)
- Google Ads data (campaigns, spend, conversions, ROAS)
- Ahrefs and/or SEMrush data (domain metrics, backlink profile, keyword rankings, competitor analysis, content gaps, site audit issues)

Your job is to analyze all available data and return a single structured JSON response following the exact schema below. Be specific — reference actual page URLs, actual title tags, actual schema types found, actual keyword data. Never give generic advice.

## ANALYSIS METHODOLOGY

### SEO Signals
Evaluate: title tags (present, length 50-60 chars, keyword-rich, unique per page), meta descriptions (present, 150-160 chars, CTA), heading hierarchy (H1 singular, H2/H3 logical), URL structure (clean, keyword-rich), canonical tags, robots meta, viewport meta, image alt text, internal linking, Open Graph tags, content depth (500+ words per page, 1500+ for pillar), keyword targeting, content freshness, structured data (JSON-LD types, completeness, validity).

### Backlink & Authority Analysis (from Ahrefs/SEMrush data)
Evaluate: domain rating/authority relative to competitors (is the site underweight or competitive?), referring domains trend (growing, stable, or declining — declining is a red flag), backlink quality (what percentage of referring domains have DR 40+?), anchor text distribution (healthy mix of branded, keyword, URL, and generic — over-optimization of exact-match keyword anchors is a spam signal), toxic/spammy link count and whether disavow action is needed, top referring domains and whether they represent real editorial authority or just directories. Compare link velocity (new vs lost referring domains in last 30 days) to assess momentum.

### Keyword & Competitive Analysis (from Ahrefs/SEMrush data)
Evaluate: position distribution (how many keywords in top 3, 4-10, 11-20 — keywords at 4-20 are "striking distance" opportunities), keyword gaps vs competitors (high-volume keywords competitors rank for but this site doesn't — these are content opportunities), content gap analysis (topic clusters where competitors have dedicated pages but this site doesn't), estimated organic traffic value vs actual paid spend (if organic traffic value is high relative to ad spend, SEO is pulling weight; if low, there's untapped opportunity).

### Technical Health (from Ahrefs/SEMrush site audit)
Evaluate: crawl errors (4xx, 5xx), missing meta descriptions, duplicate titles, orphan pages, slow-loading pages, broken internal links, redirect chains, thin content pages. Prioritize errors that directly impact indexing and rankings.

### GEO Signals
Evaluate: E-E-A-T (author info, about page quality, contact info, trust signals, organization schema), content for AI synthesis (factual density, clear claims, source citations, comprehensiveness, entity clarity, originality), technical GEO (structured data depth, HTTPS, crawlability, sameAs links).

### AEO Signals
Evaluate: featured snippet eligibility (direct answer paragraphs, definition patterns, list content, table content), structured answer formats (FAQ schema, HowTo schema, question-phrased headings, speakable schema), voice search readiness (conversational language, long-tail question coverage, local signals).

### Google Search Console Analysis
Evaluate: top performing queries and their positions, CTR opportunities (high impressions but low CTR = title/description issue), position opportunities (queries at position 5-20 = within striking distance), branded vs non-branded traffic split, top landing pages performance, coverage issues. Cross-reference with Ahrefs/SEMrush keyword data to validate rankings and identify discrepancies.

### Google Ads Analysis
Evaluate using ROAS if revenue data available, CPA-only mode if not. Analyze: campaign performance (which converting, which wasting budget), spend efficiency (spend share vs conversion share), keyword quality scores, CPA trends, budget-constrained campaigns (growth opportunities), top/bottom performing keywords. Cross-reference paid keywords with organic ranking data — if you're paying for clicks on keywords where you already rank top 3 organically, that's a potential budget savings opportunity. Conversely, keywords with high CPA in ads but no organic ranking are prime SEO content targets.

## SCORING RUBRIC
Score each dimension 1-10:
- 1-3: Critical issues — likely penalized or invisible
- 4-5: Below average — significant missed opportunities
- 6-7: Decent foundation — specific improvements needed
- 8-9: Strong — minor refinements available
- 10: Exemplary — model implementation

## RESPONSE FORMAT

Return ONLY valid JSON matching this exact structure (no markdown, no backticks, no preamble):

{
  "audit_summary": {
    "domain": "example.com",
    "audit_date": "2026-04-08",
    "audit_type": "full",
    "pages_reviewed": 8,
    "scores": {
      "seo": { "score": 8, "status": "Strong", "key_takeaway": "One sentence" },
      "geo": { "score": 7, "status": "On Track", "key_takeaway": "One sentence" },
      "aeo": { "score": 4, "status": "Needs Work", "key_takeaway": "One sentence" },
      "combined": { "score": 19, "max": 30 }
    },
    "executive_summary": "3-5 sentence overview of the site's position — what's strong, most urgent issue, key opportunity.",
    "top_3_priorities": [
      "Specific priority 1 with page/element referenced",
      "Specific priority 2",
      "Specific priority 3"
    ],
    "biggest_strength": "One sentence with specific evidence"
  },

  "seo_analysis": {
    "technical_on_page": [
      {
        "signal": "Title Tag (Homepage)",
        "finding": "Specific finding with actual title text quoted",
        "status": "Good | Needs Attention | Missing"
      }
    ],
    "content_quality": [
      {
        "signal": "Homepage Word Count",
        "finding": "Specific finding",
        "status": "Good | Needs Attention | Missing"
      }
    ],
    "structured_data": [
      {
        "signal": "JSON-LD Schema",
        "finding": "Specific schema types found and evaluation",
        "status": "Good | Needs Attention | Missing"
      }
    ]
  },

  "geo_analysis": {
    "eeat_assessment": [
      { "signal": "...", "finding": "...", "status": "..." }
    ],
    "content_for_ai": [
      { "signal": "...", "finding": "...", "status": "..." }
    ],
    "technical_geo": [
      { "signal": "...", "finding": "...", "status": "..." }
    ]
  },

  "aeo_analysis": {
    "snippet_eligibility": [
      { "signal": "...", "finding": "...", "status": "..." }
    ],
    "structured_answers": [
      { "signal": "...", "finding": "...", "status": "..." }
    ],
    "voice_search": [
      { "signal": "...", "finding": "...", "status": "..." }
    ]
  },

  "search_console_analysis": {
    "summary": "2-3 sentence overview of organic search performance",
    "top_opportunities": [
      {
        "type": "ctr_improvement | ranking_opportunity | new_content",
        "query_or_page": "actual query or URL",
        "current_metric": "e.g., position 8.7, CTR 2.1%",
        "recommendation": "Specific action to take"
      }
    ],
    "branded_vs_nonbranded": {
      "branded_click_share": 0.35,
      "nonbranded_click_share": 0.65,
      "assessment": "One sentence"
    }
  },

  "google_ads_analysis": {
    "mode": "roas | cpa_only",
    "summary": "2-3 sentence overview of paid performance",
    "total_spend": 15420.50,
    "total_conversions": 187,
    "blended_cpa": 82.46,
    "blended_roas": 2.96,
    "top_performers": [
      {
        "campaign": "Campaign Name",
        "spend": 4200,
        "conversions": 62,
        "cpa": 67.74,
        "roas": 3.62,
        "assessment": "Why this is performing well"
      }
    ],
    "underperformers": [
      {
        "campaign": "Campaign Name",
        "spend": 2100,
        "conversions": 3,
        "cpa": 700.00,
        "roas": 0.45,
        "assessment": "Why this is underperforming and what to do"
      }
    ],
    "budget_recommendations": [
      "Specific recommendation 1",
      "Specific recommendation 2"
    ],
    "paid_vs_organic_overlap": [
      {
        "keyword": "keyword you rank for AND pay for",
        "organic_position": 3,
        "ad_spend_on_keyword": 450.00,
        "recommendation": "Consider reducing ad spend — organic position 3 captures most clicks"
      }
    ]
  },

  "backlink_authority_analysis": {
    "summary": "2-3 sentence overview of backlink health and domain authority",
    "domain_rating": 42,
    "domain_authority": 38,
    "competitive_position": "How DR/DA compares to top competitors — ahead, behind, or on par",
    "referring_domains": {
      "total": 312,
      "trend": "growing | stable | declining",
      "new_last_30d": 18,
      "lost_last_30d": 5,
      "velocity_assessment": "Net positive — gaining links faster than losing them"
    },
    "link_quality": {
      "dofollow_ratio": 0.72,
      "high_authority_links_dr40_plus": 45,
      "notable_links": ["sandiegouniontribune.com (DR 85)", "yelp.com (DR 93)"],
      "assessment": "One sentence on overall quality"
    },
    "anchor_text_health": {
      "branded_percentage": 0.28,
      "keyword_percentage": 0.08,
      "url_percentage": 0.22,
      "generic_percentage": 0.05,
      "assessment": "Healthy/natural distribution or over-optimized?"
    },
    "toxic_links": {
      "flagged_count": 12,
      "action_needed": "Whether disavow is recommended and why"
    },
    "link_building_opportunities": [
      "Specific opportunity based on the data — e.g., competitors have links from X that you don't"
    ]
  },

  "keyword_competitive_analysis": {
    "summary": "2-3 sentence overview of keyword landscape and competitive position",
    "organic_traffic_estimate": 8500,
    "organic_traffic_value": 12400.00,
    "total_ranking_keywords": 2340,
    "position_distribution": {
      "top_3": 15,
      "positions_4_10": 68,
      "positions_11_20": 210,
      "assessment": "X keywords are in striking distance (positions 4-20) — these are quick wins"
    },
    "striking_distance_keywords": [
      {
        "keyword": "keyword at position 8-20",
        "position": 12,
        "search_volume": 480,
        "difficulty": 32,
        "url": "https://example.com/page/",
        "action": "Specific action to push this into top 5"
      }
    ],
    "keyword_gaps": [
      {
        "keyword": "high-value keyword competitors rank for but you don't",
        "search_volume": 5400,
        "difficulty": 38,
        "top_competitor": "competitor.com at position 4",
        "recommended_action": "Create dedicated page or expand existing page at /url/"
      }
    ],
    "content_gaps": [
      {
        "topic_cluster": "Name of the topic cluster",
        "total_search_volume": 18000,
        "competitor_coverage": "How many competitors cover this",
        "your_coverage": "What you have or don't have",
        "opportunity_level": "high | medium | low",
        "recommended_action": "Create X type of content targeting Y keywords"
      }
    ],
    "competitor_comparison": [
      {
        "competitor": "competitor.com",
        "domain_rating": 55,
        "organic_traffic": 22000,
        "common_keywords": 340,
        "their_advantage": "What they do better — more content, stronger links, etc.",
        "your_advantage": "What you do better"
      }
    ]
  },

  "technical_health": {
    "summary": "2-3 sentence overview from site audit data",
    "critical_errors": [
      {
        "issue": "4xx errors",
        "count": 3,
        "impact": "Wasted crawl budget and broken user journeys",
        "action": "Fix or redirect these URLs: [list]"
      }
    ],
    "warnings": [
      {
        "issue": "Missing meta descriptions",
        "count": 8,
        "impact": "Google generates snippets automatically — may not be compelling",
        "action": "Write unique meta descriptions for these pages"
      }
    ],
    "health_score_assessment": "Overall technical health — clean, moderate issues, or needs significant work"
  },

  "priority_recommendations": [
    {
      "priority": "critical | high | medium | quick_win",
      "issue": "Specific issue description",
      "dimension": "SEO | GEO | AEO | Ads | Multiple",
      "effort": "low | medium | high",
      "impact": "medium | high | very_high",
      "action": "Exactly what to do"
    }
  ],

  "strengths": [
    {
      "strength": "Name of strength",
      "evidence": "Specific evidence from the crawl or data"
    }
  ]
}

IMPORTANT RULES:
- Return ONLY the JSON object. No markdown formatting, no code fences, no explanatory text.
- Every finding must reference specific data from the payload — actual URLs, actual title tags, actual numbers, actual keywords and positions.
- If any data source is not provided (GSC, Google Ads, Ahrefs/SEMrush), set that section to null in the response. Don't fabricate data.
- For schema markup: evaluate what's actually in the crawl data. If schema is present, describe what types and how complete they are. If missing, say so.
- Score honestly. Don't inflate scores. A site with no FAQ schema and no question headings gets a low AEO score regardless of how good the content is.
- When Ahrefs/SEMrush data is available, factor backlink strength and keyword positions into the SEO score. A site with thin backlinks and low DR should not score 8+ on SEO even if on-page signals are perfect.
- Cross-reference data sources: GSC queries vs Ahrefs keyword rankings (validate positions), paid keywords vs organic rankings (find overlap/waste), competitor keyword gaps vs content audit (prioritize content creation).
- Recommendations must be actionable and specific. Not "improve your titles" but "Rewrite homepage title from 'Get the lawn of your dreams' to 'Big Bully Turf | Artificial Grass Installation in San Diego, Phoenix & Dallas'".
- For keyword gap recommendations, always include the search volume and difficulty so the user can prioritize.
```

---

## Part 3: API Integration Example

### Basic API Call (Node.js)

```javascript
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic();

async function runSEOAudit(crawlData) {
  const systemPrompt = `...`; // The full system prompt from Part 2 above

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8000,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `Analyze this website data and return the structured JSON audit:\n\n${JSON.stringify(crawlData, null, 2)}`
      }
    ]
  });

  // Parse the JSON response
  const responseText = response.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('');

  // Clean and parse
  const cleanJson = responseText
    .replace(/```json\n?/g, '')
    .replace(/```\n?/g, '')
    .trim();

  try {
    const audit = JSON.parse(cleanJson);
    return audit;
  } catch (err) {
    console.error('Failed to parse audit JSON:', err);
    console.error('Raw response:', responseText);
    throw err;
  }
}
```

### Full Integration Flow

```javascript
const puppeteer = require('puppeteer');
const Anthropic = require('@anthropic-ai/sdk');

// Step 1: Crawl the site
async function crawlSite(domain, pagesToCrawl) {
  const browser = await puppeteer.launch();
  const pages = [];

  for (const { url, page_type } of pagesToCrawl) {
    try {
      const pageData = await crawlPage(browser, url); // Use the crawlPage function from Part 1
      pages.push({ ...pageData, page_type });
    } catch (err) {
      console.error(`Failed to crawl ${url}:`, err.message);
    }
  }

  await browser.close();
  return pages;
}

// Step 2: Pull GSC + Google Ads data (your existing code)
async function getGSCData(domain, days = 90) {
  // Your existing Google Search Console API integration
  // Return data in the schema from Part 1
}

async function getGoogleAdsData(accountId, days = 30) {
  // Your existing Google Ads API integration
  // Return data in the schema from Part 1
}

// Step 3: Bundle and send to Claude
async function generateAudit(domain) {
  // Determine pages to crawl
  const pagesToCrawl = [
    { url: `https://${domain}/`, page_type: 'homepage' },
    { url: `https://${domain}/about-us/`, page_type: 'about' },
    { url: `https://${domain}/services/`, page_type: 'services' },
    { url: `https://${domain}/blog/`, page_type: 'blog' },
    { url: `https://${domain}/contact-us/`, page_type: 'contact' },
    // Add more based on sitemap or navigation discovery
  ];

  // Crawl
  const crawledPages = await crawlSite(domain, pagesToCrawl);

  // Pull performance data
  const gscData = await getGSCData(domain);
  const adsData = await getGoogleAdsData(domain);
  const seoToolData = await getSEOToolData(domain); // Ahrefs or SEMrush

  // Bundle
  const payload = {
    audit_request: {
      domain,
      audit_type: 'full',
      audit_date: new Date().toISOString().split('T')[0],
      pages_crawled: crawledPages,
      site_wide: extractSiteWideData(crawledPages),
      google_search_console: gscData,
      google_ads: adsData,
      seo_tool_data: seoToolData
    }
  };

  // Send to Claude
  const audit = await runSEOAudit(payload);
  return audit;
}

// Step 4: Use the structured JSON response in your UI
// The audit object has clean, predictable fields you can render
// into dashboards, reports, PDFs, emails, etc.
```

### Pulling Ahrefs / SEMrush Data

Both platforms have APIs you can integrate. Here's what to pull and how it maps:

**Ahrefs API v3 (https://ahrefs.com/api)**

```javascript
async function getAhrefsData(domain) {
  const headers = { 'Authorization': `Bearer ${AHREFS_API_KEY}` };
  const base = 'https://api.ahrefs.com/v3';

  // Domain metrics
  const metrics = await fetch(
    `${base}/site-explorer/domain-rating?target=${domain}`,
    { headers }
  ).then(r => r.json());

  // Backlink profile
  const backlinks = await fetch(
    `${base}/site-explorer/backlinks?target=${domain}&limit=50&mode=domain`,
    { headers }
  ).then(r => r.json());

  // Referring domains
  const refDomains = await fetch(
    `${base}/site-explorer/refdomains?target=${domain}&limit=20&mode=domain`,
    { headers }
  ).then(r => r.json());

  // Organic keywords
  const keywords = await fetch(
    `${base}/site-explorer/organic-keywords?target=${domain}&limit=100&country=us`,
    { headers }
  ).then(r => r.json());

  // Competitor analysis
  const competitors = await fetch(
    `${base}/site-explorer/competitors?target=${domain}&limit=5`,
    { headers }
  ).then(r => r.json());

  // Map to our schema
  return {
    source: 'ahrefs',
    domain_metrics: {
      domain_rating: metrics.domain_rating,
      organic_traffic_estimate: metrics.organic_traffic,
      organic_keywords_count: metrics.organic_keywords,
      referring_domains: refDomains.total,
      backlinks_total: backlinks.total,
      traffic_value_estimate: metrics.traffic_value
    },
    backlink_profile: { /* map from backlinks + refDomains responses */ },
    organic_keywords: { /* map from keywords response */ },
    competitors: competitors.map(c => ({
      domain: c.domain,
      domain_rating: c.domain_rating,
      organic_traffic: c.organic_traffic,
      common_keywords: c.common_keywords
    }))
  };
}
```

**SEMrush API (https://developer.semrush.com)**

```javascript
async function getSemrushData(domain) {
  const key = SEMRUSH_API_KEY;
  const base = 'https://api.semrush.com';

  // Domain overview
  const overview = await fetch(
    `${base}/?type=domain_ranks&key=${key}&export_columns=Dn,Rk,Or,Ot,Oc,Ad,At,Ac&domain=${domain}`
  ).then(r => r.text()); // SEMrush returns CSV by default

  // Organic keywords
  const keywords = await fetch(
    `${base}/?type=domain_organic&key=${key}&domain=${domain}&database=us&display_limit=100&export_columns=Ph,Po,Nq,Kd,Ur,Tr`
  ).then(r => r.text());

  // Backlinks overview
  const backlinks = await fetch(
    `${base}/analytics/v1/?key=${key}&type=backlinks_overview&target=${domain}`
  ).then(r => r.json());

  // Keyword gap vs competitors
  const gap = await fetch(
    `${base}/?type=domain_domains&key=${key}&domains=${domain}|competitor1.com|competitor2.com&database=us&display_limit=50`
  ).then(r => r.text());

  // Parse CSVs and map to our schema
  return {
    source: 'semrush',
    domain_metrics: { /* parsed from overview */ },
    backlink_profile: { /* parsed from backlinks */ },
    organic_keywords: { /* parsed from keywords */ },
    competitors: [ /* parsed from gap analysis */ ]
  };
}
```

**What each data source uniquely provides:**

| Data Point | Ahrefs | SEMrush | Google Tools |
|---|---|---|---|
| Domain Rating / Authority | ✅ DR | ✅ Authority Score | ❌ |
| Backlink profile & quality | ✅ Best-in-class | ✅ Good | ❌ |
| Referring domains trend | ✅ | ✅ | ❌ |
| Keyword rankings (estimated) | ✅ | ✅ | ❌ (GSC has actual clicks) |
| Keyword difficulty scores | ✅ | ✅ | ❌ |
| Competitor keyword gaps | ✅ | ✅ | ❌ |
| Content gap analysis | ✅ | ✅ | ❌ |
| Site audit (technical crawl) | ✅ | ✅ | Partial (GSC coverage) |
| Actual clicks & CTR | ❌ (estimated) | ❌ (estimated) | ✅ GSC is ground truth |
| Ad performance & ROAS | ❌ | ✅ (limited) | ✅ Google Ads is ground truth |
| Search volume accuracy | Good | Good | ❌ (not provided) |

**Recommendation:** Use Ahrefs OR SEMrush for backlinks/keywords/competitors, and always pair with GSC for actual click data and Google Ads for paid performance. The combination gives Claude the complete picture.

### Tips for Production

1. **Token management**: A full audit payload with Ahrefs/SEMrush data can be large. Prioritize: send top 50-100 keywords (not thousands), top 20 referring domains (not all), and top 5 competitors. Claude doesn't need exhaustive data — it needs representative data to identify patterns.

2. **Retry with validation**: If Claude's JSON response fails to parse, retry once with a follow-up message: "Your response was not valid JSON. Please return only the JSON object with no additional text."

3. **Caching crawl data**: Cache your crawl results and Ahrefs/SEMrush data (which doesn't change hour to hour). Re-audits after changes only need a fresh crawl — the backlink/keyword data can be refreshed daily or weekly.

4. **Splitting large audits**: If the payload + response exceeds token limits, split into two calls:
   - Call 1: On-page SEO + GEO + AEO analysis (send crawl data + schema)
   - Call 2: Off-page + competitive + ads analysis (send Ahrefs/SEMrush + GSC + Ads data + Call 1 scores for context)

5. **Model choice**: Use `claude-sonnet-4-20250514` for the best balance of quality and cost. For quick audits or high-volume use, `claude-haiku-4-5-20251001` works well at lower cost.

6. **Streaming**: For better UX, use streaming so your app can show progress as Claude generates the analysis. The JSON structure means you can parse sections as they complete.

7. **API cost management for Ahrefs/SEMrush**: Both charge per API call. Cache aggressively — domain metrics and backlink profiles don't change daily. Consider pulling fresh data weekly and caching the rest. Keyword rankings can be refreshed daily for monitored terms only.
