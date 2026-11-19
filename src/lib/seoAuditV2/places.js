// Google Places API (New) client and Google Maps link resolver.
// Key is read at call time from PLACES_API_KEY and never logged.

const BASE = 'https://places.googleapis.com/v1';
const SUMMARY_MASK = 'places.id,places.displayName,places.formattedAddress,places.websiteUri,places.rating,places.userRatingCount,places.googleMapsUri';
const DETAIL_MASK = 'id,displayName,formattedAddress,websiteUri,rating,userRatingCount,googleMapsUri,addressComponents,reviews';
const MAX_RESULTS = 5;

export class PlacesError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'PlacesError';
    this.code = code;
  }
}

async function placesFetch(url, init, fieldMask) {
  const key = process.env.PLACES_API_KEY;
  if (!key) throw new PlacesError('not_connected', 'PLACES_API_KEY is not set');
  let res;
  try {
    res = await fetch(url, {
      ...init,
      cache: 'no-store',
      headers: { ...(init.headers || {}), 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': fieldMask },
    });
  } catch (e) {
    throw new PlacesError('error', `Places request failed: ${e.message}`);
  }
  if (res.status === 403) throw new PlacesError('permission', 'Places API access denied');
  if (!res.ok) throw new PlacesError('error', `Places API returned ${res.status}`);
  return res.json();
}

function toSummary(p) {
  return {
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    website: p.websiteUri || null,
    rating: p.rating ?? null,
    count: p.userRatingCount ?? null,
    mapsUrl: p.googleMapsUri || null,
  };
}

export async function searchPlaces(textQuery, { bias } = {}) {
  const body = { textQuery };
  if (bias) {
    body.locationBias = { circle: { center: { latitude: bias.lat, longitude: bias.lng }, radius: 5000 } };
  }
  const data = await placesFetch(
    `${BASE}/places:searchText`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    SUMMARY_MASK
  );
  return (data.places || []).map(toSummary);
}

export async function getPlace(id) {
  const p = await placesFetch(`${BASE}/places/${encodeURIComponent(id)}`, { method: 'GET' }, DETAIL_MASK);
  const comps = p.addressComponents || [];
  const city = comps.find((c) => (c.types || []).includes('locality'))?.longText || null;
  const region = comps.find((c) => (c.types || []).includes('administrative_area_level_1'))?.shortText || null;
  const reviews = (p.reviews || []).map((r) => ({
    stars: r.rating,
    date: String(r.publishTime || '').slice(0, 10),
    text: r.text?.text ?? r.originalText?.text ?? '',
  }));
  return { ...toSummary(p), city, region, reviews };
}

function isShortLink(u) {
  return /(^|\.)goo\.gl$/i.test(u.hostname);
}

function isMapsUrl(u) {
  return isShortLink(u) || (/(^|\.)google\.[a-z.]+$/i.test(u.hostname) && u.pathname.startsWith('/maps'));
}

async function followShortLink(url) {
  try {
    const res = await fetch(url, { redirect: 'manual' });
    return res.headers?.get?.('location') || null;
  } catch {
    return null;
  }
}

export async function resolveLocationInput(input) {
  const text = String(input || '').trim();
  if (!text) return [];

  let url = null;
  try {
    url = new URL(text);
  } catch {
    url = null;
  }

  if (url && isMapsUrl(url)) {
    if (isShortLink(url)) {
      const next = await followShortLink(text);
      if (!next) return (await searchPlaces(text)).slice(0, MAX_RESULTS);
      try {
        url = new URL(next, url);
      } catch {
        return (await searchPlaces(text)).slice(0, MAX_RESULTS);
      }
    }
    const placeId = url.searchParams.get('place_id') || url.searchParams.get('query_place_id');
    if (placeId) return [await getPlace(placeId)];
    const m = url.pathname.match(/\/maps\/place\/([^/@]+)\/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
    if (m) {
      const segment = m[1].replace(/\+/g, ' ');
      let name;
      try {
        name = decodeURIComponent(segment);
      } catch {
        name = segment;
      }
      return (await searchPlaces(name, { bias: { lat: Number(m[2]), lng: Number(m[3]) } })).slice(0, MAX_RESULTS);
    }
  }
  return (await searchPlaces(text)).slice(0, MAX_RESULTS);
}

function bareHost(value) {
  const s = String(value || '').trim().toLowerCase();
  if (!s) return '';
  let host;
  try {
    host = new URL(/^[a-z]+:\/\//.test(s) ? s : `https://${s}`).hostname;
  } catch {
    host = s.replace(/\/.*$/, '');
  }
  return host.replace(/^www\./, '');
}

export function matchesDomain(website, domain) {
  const a = bareHost(website);
  return !!a && a === bareHost(domain);
}
