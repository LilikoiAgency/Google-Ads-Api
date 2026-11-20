import { describe, it, expect } from 'vitest';
import { isUsablePhrase, matchesExclusion, guessService, applyCorrections } from '../../../lib/seoAuditV2/corrections';

const t = (id, title, source_ids = [], extra = {}) => ({ id, title, change: '', page: '/p', source_ids, ...extra });

describe('phrases', () => {
  it('usable length', () => {
    expect(isUsablePhrase('ac')).toBe(false);
    expect(isUsablePhrase('roof')).toBe(true);
    expect(isUsablePhrase('x'.repeat(81))).toBe(false);
  });
  it('matches whole words, plural-tolerant', () => {
    expect(matchesExclusion(t('T1', 'Add a roof repair page'), ['roof repairs'])).toBe(true);
    expect(matchesExclusion(t('T1', 'Add roofing services page'), ['roof repairs'])).toBe(false);
    expect(matchesExclusion(t('T1', 'Improve waterproofing'), ['roofing'])).toBe(false);
    expect(matchesExclusion(t('T1', 'Add an ac page'), ['ac'])).toBe(false);
    expect(matchesExclusion({ title: 'x', change: '\nBuild the roof repair page\nmore' }, ['roof repair'])).toBe(true);
  });
  it('guesses service', () => {
    expect(guessService('Add a roof repair landing page')).toBe('roof repair');
  });
});

describe('applyCorrections', () => {
  const group = {
    id: 'T2', group: true, title: 'g', source_ids: ['B-1', 'B-2'], pages: ['/a', '/b'],
    items: [t('T2.1', 'Item one', ['B-1'], { page: '/a' }), t('T2.2', 'Item two', ['B-2'], { page: '/b' })],
  };
  const base = () => ({
    action_plan: [
      t('T1', 'Add roof repair page', ['A-1'], { follow_ups: [t('T1.1', 'Extra section', ['A-9'])] }),
      group,
      t('T3', 'Keep me', ['C-1']),
    ],
    top_moves: [{ headline: 'h', task: t('T1', 'Add roof repair page', ['A-1']) }, { headline: 'k', task: t('T3', 'Keep me') }],
    targets: { pages: [{ page: '/p', task_ids: ['T1', 'T1.1', 'T2.1', 'T3'] }] },
  });
  const c = (o) => ({ id: 'c1', kind: 'not_relevant', source_ids: [], by: 'u', at: 'now', ...o });

  it('returns same object without corrections', () => {
    const r = base();
    expect(applyCorrections(r, [])).toBe(r);
    expect(applyCorrections(r)).toBe(r);
  });
  it('hides by source id with follow-ups, top move and targets', () => {
    const { result, hidden } = applyCorrections(base(), [c({ source_ids: ['A-1'] })]);
    expect(result.action_plan.map((x) => x.id)).toEqual(['T2', 'T3']);
    expect(hidden.map((h) => h.task.id)).toEqual(['T1', 'T1.1']);
    expect(result.top_moves.map((m) => m.task.id)).toEqual(['T3']);
    expect(result.targets.pages[0].task_ids).toEqual(['T2.1', 'T3']);
  });
  it('hides by service', () => {
    const { result, hidden } = applyCorrections(base(), [c({ kind: 'not_offered', service: 'roof repair' })]);
    expect(result.action_plan.map((x) => x.id)).toEqual(['T2', 'T3']);
    expect(hidden[0].correction.service).toBe('roof repair');
  });
  it('filters a single group item', () => {
    const { result, hidden } = applyCorrections(base(), [c({ source_ids: ['B-1'] })]);
    const g = result.action_plan.find((x) => x.id === 'T2');
    expect(g.items.map((i) => i.id)).toEqual(['T2.2']);
    expect(hidden.map((h) => h.task.id)).toEqual(['T2.1']);
  });
  it('removes an emptied group', () => {
    const { result, hidden } = applyCorrections(base(), [c({ source_ids: ['B-1', 'B-2'] })]);
    expect(result.action_plan.map((x) => x.id)).toEqual(['T1', 'T3']);
    expect(hidden).toHaveLength(2);
  });
});
