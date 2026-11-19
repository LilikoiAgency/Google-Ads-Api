"use client";
// Overview cards for a v2 audit: headline numbers, searches you almost win,
// scores with the main finding, the top moves, the plan by area, and the
// impact-vs-effort grid. Numbers come from seoAuditV2/overview so the app and
// the downloaded report always agree.

import s from "./audit.module.css";
import { pagePath } from "./ActionPlan";
import { kpiCards, planStats } from "@/lib/seoAuditV2/overview";

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

const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString("en-US") : "–");
const KPI_COLS = ["k1", "k1", "k2", "k3", "k4", "k5"];

export function KpiRow({ result }) {
  const cards = kpiCards(result);
  return (
    <div className={`${s.kpis} ${cards.length < 6 ? s[KPI_COLS[cards.length]] : ""}`}>
      {cards.map((c) => (
        <div key={c.key} className={s.card}>
          <p className={s.kl}>{c.label}</p>
          <p className={s.kv}>{c.value}{c.unit && <small>{c.unit}</small>}</p>
          {c.sub && <p className={`${s.kd} ${s[c.tone] || ""}`}>{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

// gscStatus: the audit's Search Console status, to explain an empty table correctly.
export function Opportunities({ search, gscStatus }) {
  const rows = search?.opportunities || [];
  const max = Math.max(1, ...rows.map((r) => r.impressions || 0));
  return (
    <div className={s.card}>
      <div className={s.ch}>
        <p className={s.ct}>Biggest opportunities: searches you almost win</p>
        <span className={s.cs}>Positions 4–20, Search Console</span>
      </div>
      {rows.length ? (
        <table className={s.opp}>
          <thead>
            <tr><th>Search</th><th className={s.r}>Impressions</th><th aria-hidden /><th className={s.r}>Clicks</th><th className={s.r}>Position</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.query}>
                <td className={s.q}>{r.query}</td>
                <td className={s.r}>{fmt(r.impressions)}</td>
                <td style={{ width: "28%" }}><div className={s.bar}><i style={{ width: `${Math.round(((r.impressions || 0) / max) * 100)}%` }} /></div></td>
                <td className={s.r}>{fmt(r.clicks)}</td>
                <td className={s.r}><span className={s.pos}>{r.position}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className={s.empty}>
          {gscStatus === "ok"
            ? "This audit was saved before search numbers were added here. Re-run it to see them."
            : "Search Console data wasn't available for this audit. Check the property under Advanced, then re-run."}
        </p>
      )}
    </div>
  );
}

export function ScoresCard({ scores, summary }) {
  const shown = SCORES.filter((x) => Number.isFinite(scores?.[x.key]?.score));
  const { headline, rest } = splitSummary(summary);
  const reasons = shown.filter((x) => scores[x.key].reason);
  return (
    <div className={s.card}>
      <div className={s.ch}><p className={s.ct}>Scores</p><span className={s.cs}>out of 10</span></div>
      {shown.map(({ key, name, abbr }) => {
        const score = scores[key].score;
        return (
          <div key={key} className={s.score} title={name}>
            <b>{abbr}</b>
            <div className={s.bar} role="img" aria-label={`${name}: ${score} out of 10`}>
              <i style={{ width: `${Math.max(0, Math.min(10, score)) * 10}%` }} />
            </div>
            <span>{score}</span>
          </div>
        );
      })}
      {headline && <p className={s.lead}>{headline}</p>}
      {(rest || reasons.length > 0) && (
        <details className={s.more}>
          <summary>Full summary and score reasons</summary>
          {rest && <p>{rest}</p>}
          {reasons.length > 0 && (
            <ul>{reasons.map(({ key, abbr }) => <li key={key}><b>{abbr}:</b> {scores[key].reason}</li>)}</ul>
          )}
        </details>
      )}
    </div>
  );
}

export function TopMoves({ moves }) {
  if (!moves?.length) return null;
  return (
    <div className={s.grid3}>
      {moves.map((m, i) => (
        <div key={m.task?.id || i} className={`${s.card} ${s.move}`}>
          <span className={s.mn} aria-hidden>{i + 1}</span>
          <div style={{ minWidth: 0 }}>
            <p className={s.mt}>{m.headline}</p>
            {m.task && (
              <p className={s.mp} title={m.task.page}>
                {m.task.id} · {m.task.group ? `${m.task.items?.length || 0} pages` : pagePath(m.task.page)}
              </p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlanBreakdown({ plan }) {
  const { areas, matrix, total } = planStats(plan);
  if (!total) return null;
  return (
    <div className={s.grid}>
      <div className={s.card}>
        <div className={s.ch}><p className={s.ct}>Action plan by area</p><span className={s.cs}>{total} tasks</span></div>
        {areas.map((a) => (
          <div key={a.key} className={s.hb}>
            <span>{a.label}</span>
            <div className={s.bar}><i style={{ width: `${Math.round((a.count / total) * 100)}%` }} /></div>
            <span className={s.r}>{a.count}</span>
          </div>
        ))}
      </div>
      <div className={s.card}>
        <div className={s.ch}><p className={s.ct}>Impact vs effort</p></div>
        <div className={s.matrix}>
          <div className={`${s.mq} ${s.hot}`}><b>{matrix.quick}</b><span>Quick wins: high impact, low effort</span></div>
          <div className={s.mq}><b>{matrix.big}</b><span>Big bets: high impact, more work</span></div>
          <div className={s.mq}><b>{matrix.fill}</b><span>Fill-ins: easy, smaller impact</span></div>
          <div className={s.mq}><b>{matrix.later}</b><span>Later: more work, smaller impact</span></div>
        </div>
      </div>
    </div>
  );
}

// The whole overview block in one piece.
export default function ClientSummary({ result }) {
  if (!result) return null;
  return (
    <div>
      <KpiRow result={result} />
      <div className={s.grid}>
        <Opportunities search={result.search} gscStatus={result.data_sources?.search_console?.status} />
        <ScoresCard scores={result.scores} summary={result.client_summary} />
      </div>
      <TopMoves moves={result.top_moves} />
      <PlanBreakdown plan={result.action_plan} />
    </div>
  );
}
