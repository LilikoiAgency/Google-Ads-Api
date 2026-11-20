// 30/60/90-day plan for SEO Audit v2, built in code from the action plan's
// impact and effort ratings (no extra analysis call), so it also works on
// audits run before it existed. Pure: the browser UI and the report use it.

export const PHASES = [
  { days: 30, label: 'Days 1–30', title: 'Fix what holds the site back and take the quick wins' },
  { days: 60, label: 'Days 31–60', title: 'The bigger improvements' },
  { days: 90, label: 'Days 61–90', title: 'Longer projects and follow-through' },
];

// Effort points a phase can hold before lower-priority work moves to the next
// one (efforts are 1-5; Days 61-90 takes the rest).
export const PHASE_BUDGET = { 30: 16, 60: 20 };

// A grouped fix is one task per page and a follow-up adds work to its parent.
export function workload(task) {
  const extraPages = task.items?.length ? Math.ceil((task.items.length - 1) / 2) : 0;
  const followUps = (task.follow_ups || []).reduce((sum, f) => sum + Math.ceil((f.effort || 1) / 2), 0);
  return (task.effort || 1) + extraPages + followUps;
}

// Problems that limit everything else (indexing, crawling, broken pages) go first.
export const isBlocker = (t) => t.category === 'technical' && t.impact >= 4;
// Wider than the "Quick win" tag (impact 4+): easy work with real impact also fits month one.
const isEasyWin = (t) => t.effort <= 2 && t.impact >= 3;

// Where a task belongs before phase budgets are applied.
export function basePhase(t) {
  if (isBlocker(t) || isEasyWin(t)) return 30;
  if (t.impact >= 4 || (t.impact === 3 && t.effort <= 3)) return 60;
  return 90;
}

// plan: the action plan (top-level tasks, highest priority first).
// -> [{ days, label, title, tasks, workload, categories: [{ category, count }] }]
// for the three phases (a phase may have no tasks). A phase under half its
// budget first takes the highest-priority later work that fits, so the plan
// never starts with an empty month. Blockers always stay in Days 1-30; other
// work over a phase's budget moves to the next phase, lowest priority first,
// keeping the plan's order inside each phase.
export function buildRoadmap(plan) {
  const tasks = (plan || []).filter(Boolean);
  const phaseOf = new Map(tasks.map((t) => [t, basePhase(t)]));
  const load = (days) => tasks.filter((t) => phaseOf.get(t) === days).reduce((sum, t) => sum + workload(t), 0);
  for (const days of [30, 60]) {
    for (const t of tasks) {
      if (load(days) >= PHASE_BUDGET[days] / 2) break;
      if (phaseOf.get(t) > days && load(days) + workload(t) <= PHASE_BUDGET[days]) phaseOf.set(t, days);
    }
  }
  for (const days of [30, 60]) {
    const inPhase = tasks.filter((t) => phaseOf.get(t) === days);
    const fixed = days === 30 ? inPhase.filter(isBlocker) : [];
    let used = fixed.reduce((sum, t) => sum + workload(t), 0);
    for (const t of inPhase) {
      if (fixed.includes(t)) continue;
      const w = workload(t);
      // The first task always fits, so an empty phase never pushes everything on.
      if (used + w <= PHASE_BUDGET[days] || used === 0) used += w;
      else phaseOf.set(t, days === 30 ? 60 : 90);
    }
  }
  return PHASES.map((p) => {
    const list = tasks.filter((t) => phaseOf.get(t) === p.days);
    const counts = new Map();
    for (const t of list) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    return {
      ...p,
      tasks: list,
      workload: list.reduce((sum, t) => sum + workload(t), 0),
      categories: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([category, count]) => ({ category, count })),
    };
  });
}

// Task id -> phase label ("Days 1–30"), nested tasks under their parent's phase.
export function phaseByTaskId(plan) {
  const out = new Map();
  for (const phase of buildRoadmap(plan)) {
    for (const t of phase.tasks) {
      out.set(t.id, phase.label);
      for (const c of [...(t.items || []), ...(t.follow_ups || [])]) out.set(c.id, phase.label);
    }
  }
  return out;
}
