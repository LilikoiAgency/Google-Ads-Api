"use client";
// Report pieces for the top of a v2 audit: the stat strip (three 0–10 scores and
// the plan size), the summary box (first sentence as the lead, then the rest and
// the reason behind each score), and the three top moves.

import s from "./audit.module.css";
import { pagePath, isQuickWin } from "./ActionPlan";

export const SCORES = [
  { key: "seo", name: "Search visibility", abbr: "SEO" },
  { key: "geo", name: "AI search readiness", abbr: "GEO" },
  { key: "aeo", name: "Answer readiness", abbr: "AEO" },
];

// The first sentence leads; the rest follows as body text.
export function splitSummary(text) {
  const t = String(text || "").trim();
  const m = t.match(/^(.+?[.!?])\s+(?=[A-Z0-9"'“‘(])/s);
  if (!m || m[1].length < 40) return { headline: t, rest: "" };
  return { headline: m[1], rest: t.slice(m[0].length).trim() };
}

const scored = (scores) => SCORES.filter((x) => Number.isFinite(scores?.[x.key]?.score));

export function StatStrip({ scores, tasks }) {
  const shown = scored(scores);
  const plan = tasks || [];
  if (!shown.length && !plan.length) return null;
  const quick = plan.filter(isQuickWin).length;
  return (
    <div className={s.stats}>
      {shown.map(({ key, name, abbr }) => {
        const score = scores[key].score;
        return (
          <div key={key} className={s.stat}>
            <p className={s.statLabel}><abbr>{abbr}</abbr> {name}</p>
            <p className={s.statValue}>{score}<small>/10</small></p>
            <div className={s.bar} role="img" aria-label={`${name}: ${score} out of 10`}>
              <i style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }} />
            </div>
          </div>
        );
      })}
      {plan.length > 0 && (
        <div className={s.stat}>
          <p className={s.statLabel}>Action plan</p>
          <p className={s.statValue}>{plan.length}<small> tasks</small></p>
          <p className={s.statNote}>{quick > 0 ? `${quick} quick win${quick === 1 ? "" : "s"}` : "Ranked by value"}</p>
        </div>
      )}
    </div>
  );
}

export function SummaryBox({ summary, scores }) {
  const { headline, rest } = splitSummary(summary);
  const reasons = scored(scores).filter((x) => scores[x.key].reason);
  if (!headline && !reasons.length) return null;
  return (
    <div className={s.summary}>
      {headline && <p className={s.headline}>{headline}</p>}
      {rest && <p className={s.summaryRest}>{rest}</p>}
      {reasons.length > 0 && (
        <details className={s.why}>
          <summary>Why these scores</summary>
          <ul className={s.scoreWhyList}>
            {reasons.map(({ key, abbr }) => <li key={key}><b>{abbr}:</b> {scores[key].reason}</li>)}
          </ul>
        </details>
      )}
    </div>
  );
}

export function TopMoves({ moves }) {
  if (!moves?.length) return null;
  return (
    <section className={s.section}>
      <h3 className={s.sectionHead}>Top {moves.length} moves</h3>
      <ol className={s.moves}>
        {moves.map((m, i) => (
          <li key={m.task?.id || i} className={s.move}>
            <span className={s.moveNum} aria-hidden>{i + 1}</span>
            <p className={s.moveText}>{m.headline}</p>
            {m.task && (
              <p className={s.movePage} title={m.task.page}>
                {m.task.id} · {m.task.group ? `${m.task.items?.length || 0} pages` : pagePath(m.task.page)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function ClientSummary({ result }) {
  if (!result) return null;
  return (
    <div>
      <StatStrip scores={result.scores} tasks={result.action_plan} />
      <SummaryBox summary={result.client_summary} scores={result.scores} />
      <TopMoves moves={result.top_moves} />
    </div>
  );
}
