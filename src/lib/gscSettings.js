// Per-site Search Console settings: brand terms, chart annotations and an
// optional GA4 property override. Mongo tokensApi.gscSiteSettings, one doc per site.

import { cleanBrandTerms } from './gscReport';

const COLLECTION = 'gscSiteSettings';
const MAX_ANNOTATIONS = 200;

export const SITE_RE = /^(sc-domain:[a-z0-9.-]+|https?:\/\/[^\s]+)$/i;

export function isValidSite(site) {
  return typeof site === 'string' && site.length <= 300 && SITE_RE.test(site);
}

export function emptySettings(siteUrl) {
  return { siteUrl, brandTerms: [], annotations: [], ga4Property: null };
}

export function cleanAnnotations(list) {
  const out = [];
  for (const a of list || []) {
    const date = String(a?.date || '');
    const label = String(a?.label || '').trim().slice(0, 120);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !label) continue;
    const id = String(a?.id || `${date}-${Math.random().toString(36).slice(2, 8)}`).slice(0, 40);
    out.push({ id, date, label });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date)).slice(-MAX_ANNOTATIONS);
}

// Mongo is loaded lazily so the pure helpers above import without a database.
async function col() {
  const { default: dbConnect } = await import('./mongoose');
  const client = await dbConnect();
  return client.db('tokensApi').collection(COLLECTION);
}

export async function getSiteSettings(siteUrl) {
  const doc = await (await col()).findOne({ siteUrl });
  if (!doc) return emptySettings(siteUrl);
  return {
    siteUrl,
    brandTerms: doc.brandTerms || [],
    annotations: doc.annotations || [],
    ga4Property: doc.ga4Property || null,
  };
}

// Only the fields present in `patch` change.
export async function saveSiteSettings(siteUrl, patch, email) {
  const set = { siteUrl, updatedAt: new Date(), updatedBy: email || null };
  if ('brandTerms' in patch) set.brandTerms = cleanBrandTerms(patch.brandTerms);
  if ('annotations' in patch) set.annotations = cleanAnnotations(patch.annotations);
  if ('ga4Property' in patch) {
    set.ga4Property = /^properties\/\d+$/.test(patch.ga4Property || '') ? patch.ga4Property : null;
  }
  await (await col()).updateOne({ siteUrl }, { $set: set }, { upsert: true });
  return getSiteSettings(siteUrl);
}
