import { describe, it, expect } from 'vitest';
import {
  TASK_JSON_SCHEMA, priorityScore, mergeTasks, isGenericTask, tasksToCsv, pathKey, mergeKey, isEmptyTask,
  isMeasured, effectiveImpact, flattenTasks,
} from '@/lib/seoAuditV2/tasks';

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
    expect(priorityScore(t({ impact: 5, effort: 1, confidence: 'high' }))).toBe(12.5);
    expect(priorityScore(t({ impact: 5, effort: 2, confidence: 'medium' }))).toBeCloseTo(5.833, 2);
    expect(priorityScore(t({ impact: 4, effort: 2, confidence: 'low' }))).toBeCloseTo(2.133, 2);
  });
  it('a big fix outranks a cosmetic quick one (impact counts more than effort)', () => {
    expect(priorityScore(t({ impact: 5, effort: 3 }))).toBeGreaterThan(priorityScore(t({ impact: 3, effort: 1 })));
    expect(priorityScore(t({ impact: 5, effort: 1 }))).toBeGreaterThan(priorityScore(t({ impact: 5, effort: 3 })));
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

describe('isMeasured / effectiveImpact', () => {
  it('counts search, analytics, inspection and speed numbers as measured evidence', () => {
    expect(isMeasured(t({ evidence: ['"turf x" 5 clicks, 3964 impressions, position 8.9 (Search Console, 2026-08-17 to 2026-11-14)'] }))).toBe(true);
    expect(isMeasured(t({ evidence: ['coverage "URL is unknown to Google" (URL Inspection)'] }))).toBe(true);
    expect(isMeasured(t({ evidence: ['Mobile performance 41 (PageSpeed)'] }))).toBe(true);
    expect(isMeasured(t({ evidence: ['Current title: "Alpine Artificial Grass"'] }))).toBe(false);
  });
  it('caps unmeasured content and answer tasks at impact 2, leaves others alone', () => {
    expect(effectiveImpact(t({ category: 'content', impact: 4, evidence: ['Current title: "x"'] }))).toBe(2);
    expect(effectiveImpact(t({ category: 'aeo', impact: 3, evidence: ['no FAQ'] }))).toBe(2);
    expect(effectiveImpact(t({ category: 'content', impact: 1, evidence: ['x'] }))).toBe(1);
    expect(effectiveImpact(t({ category: 'content', impact: 5, evidence: ['4,760 impressions (Search Console)'] }))).toBe(5);
    expect(effectiveImpact(t({ category: 'local', impact: 3, evidence: ['wrong phone number'] }))).toBe(3);
  });
});

describe('flattenTasks', () => {
  it('lists each task followed by its group items and follow-ups', () => {
    const plan = [
      t({ id: 'T1', items: [t({ id: 'T1.1' }), t({ id: 'T1.2' })] }),
      t({ id: 'T2', follow_ups: [t({ id: 'T2.1' })] }),
      t({ id: 'T3' }),
    ];
    expect(flattenTasks(plan).map((x) => [x.id, x.parent_id || null])).toEqual([
      ['T1', null], ['T1.1', 'T1'], ['T1.2', 'T1'], ['T2', null], ['T2.1', 'T2'], ['T3', null],
    ]);
  });
});

describe('tasksToCsv', () => {
  it('has the expected header and joins evidence', () => {
    const csv = tasksToCsv([t({ evidence: ['a', 'b'] })]);
    const [head, row] = csv.split('\n');
    expect(head).toBe('ID,Priority,Task,Page,Category,Impact,Effort,Confidence,Change,Why,Evidence,Part of');
    expect(row).toContain('a | b');
  });
  it('puts the task id first and the rank (1 = first, in received order) in Priority', () => {
    const rows = tasksToCsv([t({ id: 'T3', title: 'one' }), t({ id: 'T7', title: 'two' })]).split('\n');
    expect(rows[1].startsWith('T3,1,one,')).toBe(true);
    expect(rows[2].startsWith('T7,2,two,')).toBe(true);
  });
  it('adds a row per group item and follow-up, ranked with its parent', () => {
    const rows = tasksToCsv([
      t({ id: 'T1', title: 'group', page: 'multiple pages', items: [t({ id: 'T1.1', title: 'a' })] }),
      t({ id: 'T2', title: 'two' }),
    ]).split('\n');
    expect(rows[1].startsWith('T1,1,group,multiple pages,')).toBe(true);
    expect(rows[2].startsWith('T1.1,1,a,/a,')).toBe(true);
    expect(rows[2].endsWith(',T1')).toBe(true);
    expect(rows[3].startsWith('T2,2,two,')).toBe(true);
  });
  it('escapes quotes, commas and newlines per RFC 4180', () => {
    const csv = tasksToCsv([t({ title: 'Say "hi", ok', change: 'line1\nline2' })]);
    expect(csv).toContain('"Say ""hi"", ok"');
    expect(csv).toContain('"line1\nline2"');
  });
});

describe('CSV safety and content', () => {
  it('prefixes an apostrophe to cells that would run as a spreadsheet formula', () => {
    const csv = tasksToCsv([t({ title: '=HYPERLINK("http://evil")', change: '+1', why: '-2', evidence: ['@SUM(A1)'] })]);
    const row = csv.split('\n')[1];
    expect(row).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(row).toContain(",'+1,'-2,");
    expect(row).toContain("'@SUM(A1)");
    expect(tasksToCsv([t({ title: '\tx' })]).split('\n')[1]).toContain("'\tx");
  });

  it('carries the exact fix text and the reason', () => {
    const change = 'Rewrite the title.\nReplace the title with: "Turf Installation in Las Vegas, NV | Big Bully Turf"';
    const csv = tasksToCsv([t({ change, why: 'Low CTR.' })]);
    expect(csv).toContain('Turf Installation in Las Vegas, NV | Big Bully Turf');
    expect(csv).toContain('Low CTR.');
  });
});

describe('page keys', () => {
  it('normalizes URLs and paths to one key and keeps site-wide', () => {
    expect(pathKey('https://acme.com/a/?x=1')).toBe('/a');
    expect(pathKey('/a/')).toBe('/a');
    expect(pathKey('a')).toBe('/a');
    expect(pathKey('https://acme.com')).toBe('/');
    expect(pathKey('site-wide')).toBe('site-wide');
    expect(mergeKey(t({ page: 'https://acme.com/a/' }))).toBe(mergeKey(t({ page: '/a' })));
  });

  it('flags tasks with no change or no reason', () => {
    expect(isEmptyTask(t({ change: ' ' }))).toBe(true);
    expect(isEmptyTask(t({ why: '' }))).toBe(true);
    expect(isEmptyTask(t({ why: 'w' }))).toBe(false);
  });
});
