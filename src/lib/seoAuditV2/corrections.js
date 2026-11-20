// Pure helpers for the "not offered / not relevant" corrections applied to a
// finished audit. No server imports: used from server code and React alike.

import { fixPageCount } from './tasks';

export const MIN_PHRASE = 4;
const MAX_PHRASE = 80;

export function isUsablePhrase(s) {
  const n = String(s ?? '').trim().length;
  return n >= MIN_PHRASE && n <= MAX_PHRASE;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const norm = (s) => String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const firstLine = (s) => String(s ?? '').split(/\r?\n/).map((l) => l.trim()).find(Boolean) || '';

// Whole-word match; a trailing s/es on the phrase or on the text is ignored.
function phraseRegex(phrase) {
  const p = norm(phrase);
  const stems = new Set([p]);
  if (p.endsWith('es')) stems.add(p.slice(0, -2));
  if (p.endsWith('s')) stems.add(p.slice(0, -1));
  const alts = [...stems].filter(Boolean).map(escapeRe).join('|');
  // A leading (?:^|[^a-z0-9]) instead of a lookbehind, which older Safari can't parse.
  return new RegExp(`(?:^|[^a-z0-9])(?:${alts})(?:es|s)?(?![a-z0-9])`);
}

export function matchesExclusion(task, phrases) {
  const text = [norm(task?.title), norm(firstLine(task?.change))].filter(Boolean);
  if (!text.length) return false;
  return (phrases || []).some((ph) => {
    if (!isUsablePhrase(ph)) return false;
    const re = phraseRegex(ph);
    return text.some((t) => re.test(t));
  });
}

const LEADING = /^(?:rank for|add|create|build|write|expand|improve|optimi[sz]e|target|publish)\s+/i;
const TRAILING = /\s+(?:landing page|page|section|content)$/i;

export function guessService(title) {
  let s = String(title ?? '').trim();
  s = s.replace(LEADING, '').replace(/^(?:a|an|the)\s+/i, '');
  s = s.replace(TRAILING, '').replace(TRAILING, '');
  return s.trim().toLowerCase().slice(0, MAX_PHRASE).trim();
}

const maxOf = (items, key) => {
  const nums = items.map((t) => t[key]).filter(Number.isFinite);
  return nums.length ? Math.max(...nums) : undefined;
};

// A group with some items hidden: title, pages, impact, effort and source ids
// from the items that remain.
function regroup(task, kept) {
  const out = {
    ...task,
    title: fixPageCount(task.title, kept.length),
    items: kept,
    pages: [...new Set(kept.map((t) => t.page))],
    source_ids: [...new Set(kept.flatMap((t) => t.source_ids || []))],
  };
  for (const key of ['impact', 'effort']) {
    const n = maxOf(kept, key);
    if (n !== undefined) out[key] = n;
  }
  return out;
}

export function applyCorrections(result, corrections) {
  if (!result || !Array.isArray(corrections) || !corrections.length) return result;

  const bySource = new Map();
  for (const c of corrections) {
    for (const id of c.source_ids || []) if (!bySource.has(id)) bySource.set(id, c);
  }
  const services = corrections.filter((c) => c.kind === 'not_offered' && c.service);

  const hidden = [];
  const hiddenIds = new Set();

  const correctionFor = (task) => {
    for (const id of task.source_ids || []) if (bySource.has(id)) return bySource.get(id);
    return services.find((c) => matchesExclusion(task, [c.service])) || null;
  };
  const hide = (task, correction) => {
    hidden.push({ task, correction });
    if (task.id) hiddenIds.add(task.id);
  };
  const hideTree = (task, correction) => {
    hide(task, correction);
    for (const f of task.follow_ups || []) hide(f, correction);
  };

  const plan = [];
  for (const task of result.action_plan || []) {
    if (task.group && Array.isArray(task.items)) {
      // A group whose own title names a service not offered goes as a whole.
      const whole = services.find((c) => matchesExclusion({ title: task.title }, [c.service]));
      if (whole) {
        hideTree(task, whole);
        for (const item of task.items) if (item.id) hiddenIds.add(item.id);
        continue;
      }
      const kept = [];
      let lastCorrection = null;
      for (const item of task.items) {
        const c = correctionFor(item);
        if (c) {
          hideTree(item, c);
          lastCorrection = c;
        } else kept.push(item);
      }
      if (kept.length === task.items.length) {
        plan.push(task);
      } else if (kept.length < 1) {
        hiddenIds.add(task.id);
        for (const f of task.follow_ups || []) hide(f, lastCorrection);
      } else {
        plan.push(regroup(task, kept));
      }
      continue;
    }
    const c = correctionFor(task);
    if (c) hideTree(task, c);
    else plan.push(task);
  }

  const byId = new Map(plan.map((t) => [t.id, t]));
  const out = { ...result, action_plan: plan };
  if (Array.isArray(result.top_moves)) {
    out.top_moves = result.top_moves
      .filter((m) => m?.task && !hiddenIds.has(m.task.id))
      .map((m) => (byId.has(m.task.id) ? { ...m, task: byId.get(m.task.id) } : m));
  }
  if (result.targets?.pages) {
    // Suggested keywords about a service not offered go too; the agency's own stay.
    const offOffer = (k) => k?.given !== true && services.some((c) => matchesExclusion({ title: k?.keyword }, [c.service]));
    out.targets = {
      ...result.targets,
      pages: result.targets.pages.map((p) => ({
        ...p,
        task_ids: (p.task_ids || []).filter((id) => !hiddenIds.has(id)),
        ...(Array.isArray(p.keywords) ? { keywords: p.keywords.filter((k) => !offOffer(k)) } : {}),
      })),
    };
  }
  return { result: out, hidden };
}
