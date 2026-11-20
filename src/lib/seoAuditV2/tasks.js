// Pure task model for SEO Audit v2. No server imports: the browser UI uses tasksToCsv.

import { phaseByTaskId } from './roadmap';

const IMPACT_EFFORT = { type: 'integer', enum: [1, 2, 3, 4, 5] };

export const TASK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: ['technical', 'content', 'local', 'aeo', 'conversion', 'reputation'] },
    page: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' }, minItems: 1 },
    change: { type: 'string' },
    why: { type: 'string' },
    impact: IMPACT_EFFORT,
    effort: IMPACT_EFFORT,
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
  },
  required: ['id', 'title', 'category', 'page', 'evidence', 'change', 'why', 'impact', 'effort', 'confidence'],
  additionalProperties: false,
};

const CONFIDENCE_WEIGHT = { high: 1, medium: 0.7, low: 0.4 };

// Impact counts much more than effort: a big fix (impact 5, effort 3) outranks a
// cosmetic quick one (impact 3, effort 1).
export function priorityScore(task) {
  const w = CONFIDENCE_WEIGHT[task.confidence] ?? CONFIDENCE_WEIGHT.low;
  return (w * task.impact * task.impact) / ((task.effort || 1) + 1);
}

// Evidence backed by a measurement (Search Console, URL Inspection, GA4, PageSpeed, Keyword Planner).
const MEASURED = /search console|impressions?\b|\bclicks?\b|url inspection|google analytics|\bga4\b|pagespeed|key events?|\bsessions\b|keyword planner|monthly searches/i;
export const isMeasured = (task) => (task?.evidence || []).some((e) => MEASURED.test(String(e)));

// Content and answer-engine tasks with no measured evidence are capped at impact 2,
// so cosmetic rewrites don't outrank fixes with real search demand behind them.
export const UNMEASURED_IMPACT_CAP = 2;
export function effectiveImpact(task) {
  if ((task.category === 'content' || task.category === 'aeo') && !isMeasured(task)) {
    return Math.min(task.impact, UNMEASURED_IMPACT_CAP);
  }
  return task.impact;
}

// Plan tasks, each followed by its group items and follow-ups (with parent_id).
export function flattenTasks(tasks) {
  const out = [];
  for (const t of tasks || []) {
    out.push(t);
    for (const c of [...(t.items || []), ...(t.follow_ups || [])]) out.push({ ...c, parent_id: t.id });
  }
  return out;
}

function titleKey(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6)
    .join(' ');
}

// "https://acme.com/a/?x=1", "/a/" and "a" all key to "/a"; the home page keys
// to "/"; "site-wide" and an empty page stay as they are.
export function pathKey(page) {
  const s = String(page ?? '').trim();
  if (!s || s === 'site-wide') return s;
  let path;
  try {
    path = new URL(s, 'https://placeholder.invalid').pathname;
  } catch {
    path = s.split(/[?#]/)[0];
  }
  return path.length > 1 ? path.replace(/\/+$/, '') : '/';
}

// Tasks with the same key are merged into one by mergeTasks.
export function mergeKey(task) {
  return `${pathKey(task.page)}|${titleKey(task.title)}`;
}

export function mergeTasks(taskLists) {
  const byKey = new Map();
  for (const task of (taskLists || []).flat()) {
    if (!task) continue;
    const key = mergeKey(task);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, { ...task, evidence: [...new Set(task.evidence || [])] });
      continue;
    }
    const winner = priorityScore(task) > priorityScore(prev) ? task : prev;
    const evidence = [...new Set([...(winner.evidence || []), ...(prev === winner ? task.evidence : prev.evidence) || []])];
    byKey.set(key, { ...winner, evidence });
  }
  return [...byKey.values()]
    .sort((a, b) => priorityScore(b) - priorityScore(a))
    .map((task, i) => ({ ...task, id: `T${i + 1}` }));
}

const VAGUE_TITLE = /^(improve|optimi[sz]e|enhance|build) (content|seo|backlinks|quality)/i;

export function isGenericTask(task) {
  if (VAGUE_TITLE.test(String(task.title || '').trim())) return true;
  if (task.page === 'site-wide') {
    const change = String(task.change || '');
    const hasQuote = /"[^"]+"|'[^']+'|\u201c[^\u201d]+\u201d/.test(change);
    const hasPath = /(^|\s)\/[\w.-]/.test(change);
    return !hasQuote && !hasPath;
  }
  return false;
}

// A task with no change or no reason can't be acted on.
export function isEmptyTask(task) {
  return !String(task?.change ?? '').trim() || !String(task?.why ?? '').trim();
}

// A cell starting with = + - @ (or tab / CR) would run as a formula in a
// spreadsheet; a leading apostrophe keeps it plain text.
function csvCell(value) {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tasksToCsv(tasks, { phases = null } = {}) {
  // phases: id -> period label from the whole plan, so a filtered export keeps
  // each task in the same period as the screen.
  const phase = phases || phaseByTaskId(tasks);
  const header = ['ID', 'Priority', 'When', 'Task', 'Page', 'Category', 'Impact', 'Effort', 'Confidence', 'Change', 'Why', 'Evidence', 'Part of'];
  const row = (t, rank, parent = '') => [
    t.id, rank, phase.get(t.id) || '', t.title, t.page, t.category, t.impact, t.effort, t.confidence,
    t.change, t.why, (t.evidence || []).join(' | '), parent,
  ];
  const rows = (tasks || []).flatMap((t, i) => [
    row(t, i + 1),
    ...[...(t.items || []), ...(t.follow_ups || [])].map((c) => row(c, i + 1, t.id)),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
