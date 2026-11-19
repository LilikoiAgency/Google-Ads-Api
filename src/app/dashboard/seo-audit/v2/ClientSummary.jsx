"use client";
// Report pieces for the top of a v2 audit: the summary split into a headline and
// the rest (for the cover), the three 0–10 scales, and the three top moves.

import s from "./audit.module.css";
import { pagePath } from "./ActionPlan";

export const SCORES = [
  { key: "seo", name: "Search visibility", abbr: "SEO" },
  { key: "geo", name: "AI search readiness", abbr: "GEO" },
  { key: "aeo", name: "Answer readiness", abbr: "AEO" },
];

// The first sentence leads as the headline; the rest follows as body text.
export function splitSummary(text) {
  const t = String(text || "").trim();
  const m = t.match(/^(.+?[.!?])\s+(?=[A-Z0-9"'“‘(])/s);
  if (!m || m[1].length < 40) return { headline: t, rest: "" };
  return { headline: m[1], rest: t.slice(m[0].length).trim() };
}

export function ScoreScales({ scores }) {
  const shown = SCORES.filter((x) => Number.isFinite(scores?.[x.key]?.score));
  if (!shown.length) return null;
  return (
    <div className={s.scores}>
      {shown.map(({ key, name, abbr }) => {
        const { score, reason } = scores[key];
        return (
          <div key={key}>
            <div className={s.scoreHead}>
              <span className={s.scoreNum}>{score}</span>
              <span className={s.scoreOf}>out of 10</span>
            </div>
            <p className={s.scoreName}>{name} <abbr>({abbr})</abbr></p>
            <div className={s.scale} role="img" aria-label={`${name}: ${score} out of 10`}>
              {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < score ? s.on : undefined} />)}
            </div>
            {reason && <p className={s.scoreWhy} title={reason}>{reason}</p>}
          </div>
        );
      })}
    </div>
  );
}

export function TopMoves({ moves }) {
  if (!moves?.length) return null;
  return (
    <section className={s.section}>
      <h3 className={s.sectionHead}>The moves that matter most</h3>
      <ol className={s.moves}>
        {moves.map((m, i) => (
          <li key={m.task?.id || i} className={s.move}>
            <span className={s.moveNum} aria-hidden>{i + 1}</span>
            <p className={s.moveText}>{m.headline}</p>
            {m.task && (
              <p className={s.movePage} title={m.task.page}>
                {m.task.id}, {m.task.group ? `${m.task.items?.length || 0} pages` : pagePath(m.task.page)}
              </p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

// Kept for callers that want the whole block in one piece.
export default function ClientSummary({ result }) {
  if (!result) return null;
  return (
    <div>
      {result.client_summary && <p className={s.summaryRest}>{result.client_summary}</p>}
      <ScoreScales scores={result.scores} />
      <TopMoves moves={result.top_moves} />
    </div>
  );
}
