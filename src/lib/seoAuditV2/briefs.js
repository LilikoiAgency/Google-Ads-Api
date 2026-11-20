// The agency's company brief for a website: facts the homepage does not show
// (what is actually sold, where, and what must never be recommended). It is
// added to the shared context of the audit passes as an authoritative block.

export const BRIEF_HEADING = '## Company brief (from the agency: treat as fact; it overrides what the homepage suggests)';

const MAX_SERVICES = 1000;
const MAX_AREAS = 300;
const MAX_NOTES = 1000;
const MAX_EXCLUDE = 30;
const MIN_EXCLUDE_LEN = 4;
const MAX_EXCLUDE_LEN = 80;

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const items = (v) => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\n,]/) : [])
  .map((s) => String(s).trim()).filter(Boolean);

/**
 * Validates a raw brief from the request. Returns { brief } (null when every
 * field is empty) or { error }. Keys always come back in the order services,
 * exclude, areas, notes so briefs can be compared by exact match.
 */
export function parseBrief(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const services = text(src.services);
  const areas = text(src.areas);
  const notes = text(src.notes);
  if (services.length > MAX_SERVICES) return { error: `Services must be ${MAX_SERVICES} characters or fewer.` };
  if (areas.length > MAX_AREAS) return { error: `Service areas must be ${MAX_AREAS} characters or fewer.` };
  if (notes.length > MAX_NOTES) return { error: `Notes must be ${MAX_NOTES} characters or fewer.` };

  const seen = new Set();
  const exclude = [];
  for (const phrase of items(src.exclude)) {
    if (phrase.length < MIN_EXCLUDE_LEN) return { error: 'Use at least 4 characters for each service not to recommend.' };
    if (phrase.length > MAX_EXCLUDE_LEN) return { error: `Each service not to recommend must be ${MAX_EXCLUDE_LEN} characters or fewer.` };
    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    exclude.push(phrase);
  }
  if (exclude.length > MAX_EXCLUDE) return { error: `List at most ${MAX_EXCLUDE} services not to recommend.` };

  if (!services && !areas && !notes && !exclude.length) return { brief: null };
  return { brief: { services, exclude, areas, notes } };
}

const isEmpty = (b) => !b || (!b.services && !b.areas && !b.notes && !(b.exclude || []).length);

export function briefBlock(brief) {
  if (isEmpty(brief)) return '';
  const lines = [BRIEF_HEADING];
  if (brief.services) lines.push(`Services: ${brief.services}`);
  if (brief.areas) lines.push(`Service areas: ${brief.areas}`);
  if (brief.exclude?.length) lines.push(`Do not recommend: ${brief.exclude.join('; ')}`);
  if (brief.notes) lines.push(`Notes: ${brief.notes}`);
  return lines.join('\n');
}

export function withBrief(sharedContext, brief) {
  const base = String(sharedContext || '');
  const at = base.indexOf(BRIEF_HEADING);
  const stripped = at === -1 ? base : base.slice(0, at);
  const block = briefBlock(brief);
  return block ? `${stripped.replace(/\s+$/, '')}\n\n${block}` : stripped;
}

export function sameBrief(a, b) {
  const x = isEmpty(a) ? null : a;
  const y = isEmpty(b) ? null : b;
  if (!x || !y) return x === y;
  const xe = x.exclude || [];
  const ye = y.exclude || [];
  return (x.services || '') === (y.services || '')
    && (x.areas || '') === (y.areas || '')
    && (x.notes || '') === (y.notes || '')
    && xe.length === ye.length
    && xe.every((v, i) => v === ye[i]);
}
