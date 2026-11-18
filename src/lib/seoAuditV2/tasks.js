// Pure task model for SEO Audit v2. No server imports: the browser UI uses tasksToCsv.

const IMPACT_EFFORT = { type: 'integer', enum: [1, 2, 3, 4, 5] };

export const TASK_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    title: { type: 'string' },
    category: { type: 'string', enum: ['technical', 'content', 'local', 'aeo', 'conversion'] },
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

export function priorityScore(task) {
  const w = CONFIDENCE_WEIGHT[task.confidence] ?? CONFIDENCE_WEIGHT.low;
  return (task.impact * w) / (task.effort || 1);
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

export function mergeTasks(taskLists) {
  const byKey = new Map();
  for (const task of (taskLists || []).flat()) {
    if (!task) continue;
    const key = `${task.page}|${titleKey(task.title)}`;
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

function csvCell(value) {
  const s = String(value ?? '');
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function tasksToCsv(tasks) {
  const header = ['Priority', 'Task', 'Page', 'Category', 'Impact', 'Effort', 'Confidence', 'Change', 'Evidence'];
  const rows = (tasks || []).map((t, i) => [
    i + 1, t.title, t.page, t.category, t.impact, t.effort, t.confidence,
    t.change, (t.evidence || []).join(' | '),
  ]);
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\n');
}
