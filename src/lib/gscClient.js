import { google } from 'googleapis';
import dbConnect from './mongoose';
import { getCredentials } from './dbFunctions';
import { buildSearchRequests, normalizeSearchReport } from './gscReport';
import { compareRange as computeCompareRange } from './ga4Dates';

function getCallbackUrl() {
    const base = process.env.NEXTAUTH_URL || 'http://localhost:3000';
    return `${base}/api/gsc-callback`;
}

export async function createOAuth2Client() {
    const credentials = await getCredentials();
    return new google.auth.OAuth2(
        credentials.client_id,
        credentials.client_secret,
        getCallbackUrl()
    );
}

export async function getGscAuthUrl() {
    const oauth2Client = await createOAuth2Client();
    return oauth2Client.generateAuthUrl({
        access_type: 'offline',
        prompt: 'consent',
        scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
}

export async function getGscToken() {
    const client = await dbConnect();
    const db = client.db('tokensApi');
    return db.collection('GscTokens').findOne({});
}

export async function saveGscToken(tokens) {
    const client = await dbConnect();
    const db = client.db('tokensApi');
    await db.collection('GscTokens').replaceOne(
        {},
        {
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            scope: tokens.scope,
            created_at: new Date(),
        },
        { upsert: true }
    );
}

export async function createAuthedGscClient() {
    const tokenDoc = await getGscToken();
    if (!tokenDoc?.refresh_token) return null;

    const oauth2Client = await createOAuth2Client();
    oauth2Client.setCredentials({ refresh_token: tokenDoc.refresh_token });
    return oauth2Client;
}

// ── Organic search report (Search Console API v1) ───────────────────────────


// Runs async fns with at most `limit` in flight.
async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function getSearchConsole() {
  const auth = await createAuthedGscClient();
  if (!auth) return null;
  return google.searchconsole({ version: 'v1', auth });
}

function sitemapRow(s) {
  const contents = (s.contents || []).map((c) => ({ type: c.type, submitted: Number(c.submitted) || 0 }));
  return {
    path: s.path,
    type: s.type || null,
    lastSubmitted: s.lastSubmitted || null,
    lastDownloaded: s.lastDownloaded || null,
    isPending: !!s.isPending,
    isIndex: !!s.isSitemapsIndex,
    errors: Number(s.errors) || 0,
    warnings: Number(s.warnings) || 0,
    submitted: contents.reduce((n, c) => n + c.submitted, 0),
    contents,
  };
}

export async function fetchSearchReport(sc, { site, startDate, endDate, compare, type, brandTerms }) {
  const range = { startDate, endDate };
  const cmp = computeCompareRange(range, compare);
  const requests = buildSearchRequests({ startDate, endDate, compareRange: cmp, type, brandTerms });
  const responses = await pool(requests, 6, (r) =>
    sc.searchanalytics.query({ siteUrl: site, requestBody: r.body }).then((res) => res.data));
  const results = Object.fromEntries(requests.map((r, i) => [r.key, responses[i]]));
  let sitemaps = null;
  try {
    const res = await sc.sitemaps.list({ siteUrl: site });
    sitemaps = (res.data.sitemap || []).map(sitemapRow);
  } catch (err) {
    console.warn('[gsc] sitemaps list failed', err?.message || err);
  }
  return normalizeSearchReport(results, { site, range, compareRange: cmp, type, brandTerms, sitemaps });
}

// URL Inspection API: one call per URL, a few at a time.
export async function inspectUrls(sc, site, urls) {
  return pool(urls, 3, async (url) => {
    try {
      const res = await sc.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: site } });
      const r = res.data.inspectionResult || {};
      const idx = r.indexStatusResult || {};
      return {
        url,
        verdict: idx.verdict || 'VERDICT_UNSPECIFIED',
        coverage: idx.coverageState || null,
        indexingState: idx.indexingState || null,
        robotsTxt: idx.robotsTxtState || null,
        pageFetch: idx.pageFetchState || null,
        lastCrawl: idx.lastCrawlTime || null,
        googleCanonical: idx.googleCanonical || null,
        userCanonical: idx.userCanonical || null,
        richResults: r.richResultsResult?.verdict || null,
        link: r.inspectionResultLink || null,
        checkedAt: new Date().toISOString(),
      };
    } catch (err) {
      return { url, error: err?.message || 'Inspection failed', checkedAt: new Date().toISOString() };
    }
  });
}
