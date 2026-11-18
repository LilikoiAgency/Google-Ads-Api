import { describe, it, expect } from 'vitest';
import { TASK_JSON_SCHEMA, priorityScore, mergeTasks, isGenericTask, tasksToCsv } from '@/lib/seoAuditV2/tasks';

const t = (o = {}) => ({
  id: 'x', title: 'Rewrite title tag', category: 'content', page: '/a',
  evidence: ['e1'], change: "New title: 'Foo'", why: 'w',
  impact: 3, effort: 3, confidence: 'high', ...o,
});

describe('TASK_JSON_SCHEMA', () => {
  it('matches the task shape and uses only supported keywords', () => {
    expect(TASK_JSON_SCHEMA.additionalProperties).toBe(false);
    expect(TASK_JSON_SCHEMA.required.sort()).toEqual(Object.keys(TASK_JSON_SCHEMA.properties).sort());
    expect(TASK_JSON_SCHEMA.properties.category.enum).toEqual(['technical', 'content', 'local', 'aeo', 'conversion']);
    expect(TASK_JSON_SCHEMA.properties.impact).toEqual({ type: 'integer', enum: [1, 2, 3, 4, 5] });
    expect(TASK_JSON_SCHEMA.properties.effort).toEqual({ type: 'integer', enum: [1, 2, 3, 4, 5] });
    expect(TASK_JSON_SCHEMA.properties.confidence.enum).toEqual(['high', 'medium', 'low']);
    expect(TASK_JSON_SCHEMA.properties.evidence.minItems).toBe(1);
    expect(TASK_JSON_SCHEMA.properties.id.type).toBe('string');
    expect(JSON.stringify(TASK_JSON_SCHEMA)).not.toMatch(/minimum|maximum|pattern|format/);
  });
});

describe('priorityScore', () => {
  it('computes impact * confidence weight / effort', () => {
    expect(priorityScore(t({ impact: 5, effort: 1, confidence: 'high' }))).toBe(5);
    expect(priorityScore(t({ impact: 5, effort: 2, confidence: 'medium' }))).toBeCloseTo(1.75);
    expect(priorityScore(t({ impact: 4, effort: 2, confidence: 'low' }))).toBeCloseTo(0.8);
  });
});

describe('mergeTasks', () => {
  it('merges near-identical titles on the same page, keeps higher score, unions evidence', () => {
    const a = t({ title: 'Rewrite the title tag for solar repair!', evidence: ['e1', 'e2'], impact: 2 });
    const b = t({ title: 'rewrite the title tag for solar repair page now', evidence: ['e2', 'e3'], impact: 5 });
    const out = mergeTasks([[a], [b]]);
    expect(out).toHaveLength(1);
    expect(out[0].impact).toBe(5);
    expect(out[0].evidence).toEqual(['e2', 'e3', 'e1']);
    expect(out[0].id).toBe('T1');
  });
  it('does not merge different pages', () => {
    expect(mergeTasks([[t({ page: '/a' })], [t({ page: '/b' })]])).toHaveLength(2);
  });
  it('sorts by score descending and renumbers ids', () => {
    const out = mergeTasks([[t({ title: 'low one', impact: 1 }), t({ title: 'high one', impact: 5 })]]);
    expect(out.map((x) => x.id)).toEqual(['T1', 'T2']);
    expect(out[0].title).toBe('high one');
  });
});

describe('isGenericTask', () => {
  it('flags site-wide tasks without quoted text or path', () => {
    expect(isGenericTask(t({ page: 'site-wide', change: 'Make titles better across the site' }))).toBe(true);
  });
  it('keeps site-wide tasks with quoted text or a path', () => {
    expect(isGenericTask(t({ page: 'site-wide', change: "Add 'Organization' schema" }))).toBe(false);
    expect(isGenericTask(t({ page: 'site-wide', change: 'Add Disallow for /cart/ in robots.txt' }))).toBe(false);
  });
  it('flags vague titles', () => {
    expect(isGenericTask(t({ title: 'Improve content quality' }))).toBe(true);
    expect(isGenericTask(t({ title: 'Optimize SEO on homepage' }))).toBe(true);
    expect(isGenericTask(t({ title: 'Build backlinks' }))).toBe(true);
  });
  it('keeps specific page tasks', () => {
    expect(isGenericTask(t())).toBe(false);
  });
});

describe('tasksToCsv', () => {
  it('has the expected header and joins evidence', () => {
    const csv = tasksToCsv([t({ evidence: ['a', 'b'] })]);
    const [head, row] = csv.split('\n');
    expect(head).toBe('Priority,Task,Page,Category,Impact,Effort,Confidence,Change,Evidence');
    expect(row).toContain('a | b');
  });
  it('uses rank (1 = first) in the Priority column', () => {
    const rows = tasksToCsv([t({ title: 'one' }), t({ title: 'two' })]).split('\n');
    expect(rows[1].startsWith('1,one,')).toBe(true);
    expect(rows[2].startsWith('2,two,')).toBe(true);
  });
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    const csv = tasksToCsv([t({ title: 'Say "hi", ok', change: 'line1\nline2' })]);
    expect(csv).toContain('"Say ""hi"", ok"');
    expect(csv).toContain('"line1\nline2"');
  });
});
