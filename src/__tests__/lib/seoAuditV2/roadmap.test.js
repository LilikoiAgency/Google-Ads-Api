import { describe, it, expect } from 'vitest';
import { buildRoadmap, basePhase, workload, phaseByTaskId, PHASE_BUDGET } from '@/lib/seoAuditV2/roadmap';

let n = 0;
const t = (o = {}) => ({ id: `T${++n}`, title: 'x', category: 'content', page: '/a', impact: 3, effort: 3, confidence: 'high', ...o });
const days = (roadmap) => roadmap.map((p) => p.tasks.map((x) => x.id));

describe('basePhase', () => {
  it('puts technical blockers and quick wins first, big bets second, the rest last', () => {
    expect(basePhase(t({ category: 'technical', impact: 4, effort: 5 }))).toBe(30);
    expect(basePhase(t({ impact: 3, effort: 2 }))).toBe(30);
    expect(basePhase(t({ impact: 5, effort: 4 }))).toBe(60);
    expect(basePhase(t({ impact: 3, effort: 3 }))).toBe(60);
    expect(basePhase(t({ impact: 3, effort: 4 }))).toBe(90);
    expect(basePhase(t({ impact: 2, effort: 1 }))).toBe(90);
  });
});

describe('workload', () => {
  it('counts extra pages of a grouped fix and follow-ups', () => {
    expect(workload(t({ effort: 2 }))).toBe(2);
    expect(workload(t({ effort: 2, items: [t(), t(), t(), t(), t()] }))).toBe(4);
    expect(workload(t({ effort: 2, follow_ups: [t({ effort: 3 })] }))).toBe(4);
  });
});

describe('buildRoadmap', () => {
  it('always returns the three phases in order, empty plan included', () => {
    const r = buildRoadmap([]);
    expect(r.map((p) => p.label)).toEqual(['Days 1–30', 'Days 31–60', 'Days 61–90']);
    expect(r.every((p) => p.tasks.length === 0 && p.workload === 0)).toBe(true);
    expect(buildRoadmap(undefined)).toHaveLength(3);
  });

  it('pulls the top work into Days 1-30 when nothing there qualifies, so month one is never empty', () => {
    const plan = [t({ impact: 5, effort: 5 }), t({ impact: 5, effort: 5 }), t({ impact: 2, effort: 4 })];
    const r = buildRoadmap(plan);
    // Pulls in priority order until the phase is half full (budget 16): 5, then 10.
    expect(r[0].tasks.map((x) => x.id)).toEqual([plan[0].id, plan[1].id]);
    // Days 31-60 was left empty, so it takes the next task the same way.
    expect(r[1].tasks.map((x) => x.id)).toEqual([plan[2].id]);
    expect(r[2].tasks).toEqual([]);
  });

  it('moves lower-priority work on when a phase is over budget, keeping plan order', () => {
    const quick = Array.from({ length: 10 }, () => t({ impact: 4, effort: 2 })); // 30-day candidates, 2 points each
    const r = buildRoadmap(quick);
    expect(r[0].workload).toBeLessThanOrEqual(PHASE_BUDGET[30]);
    expect(r[0].tasks.map((x) => x.id)).toEqual(quick.slice(0, 8).map((x) => x.id));
    expect(r[1].tasks.map((x) => x.id)).toEqual(quick.slice(8).map((x) => x.id));
  });

  it('keeps every technical blocker in Days 1-30 even past the budget', () => {
    const blockers = Array.from({ length: 5 }, () => t({ category: 'technical', impact: 5, effort: 5 }));
    const quick = t({ impact: 4, effort: 1 });
    const r = buildRoadmap([...blockers, quick]);
    expect(r[0].tasks.map((x) => x.id)).toEqual(blockers.map((x) => x.id));
    expect(r[1].tasks.map((x) => x.id)).toEqual([quick.id]);
  });

  it('places every task exactly once and counts categories', () => {
    const plan = [
      t({ category: 'technical', impact: 5, effort: 3 }), t({ impact: 4, effort: 4 }), t({ category: 'local', impact: 3, effort: 1 }),
      t({ impact: 2, effort: 5 }), t({ category: 'reputation', impact: 4, effort: 5 }),
    ];
    const r = buildRoadmap(plan);
    expect(days(r).flat().sort()).toEqual(plan.map((x) => x.id).sort());
    const cats = r.flatMap((p) => p.categories).reduce((s, c) => s + c.count, 0);
    expect(cats).toBe(plan.length);
  });
});

describe('phaseByTaskId', () => {
  it('labels group items and follow-ups with their parent phase', () => {
    const plan = [t({ id: 'T1', impact: 4, effort: 1, items: [t({ id: 'T1.1' })], follow_ups: [t({ id: 'T1.2' })] })];
    const m = phaseByTaskId(plan);
    expect(m.get('T1')).toBe('Days 1–30');
    expect(m.get('T1.1')).toBe('Days 1–30');
    expect(m.get('T1.2')).toBe('Days 1–30');
  });
});
