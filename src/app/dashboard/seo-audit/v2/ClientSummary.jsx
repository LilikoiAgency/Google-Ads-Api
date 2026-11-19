"use client";
// Top of the v2 results: the plain-language summary for the client, the three top moves,
// and the scores row.

import { ScoreCard, CombinedScoreCard, CARD, CARD_LABEL, getScoreStatus } from "../ui";
import { pagePath } from "./ActionPlan";

export default function ClientSummary({ result }) {
  if (!result) return null;
  const scores = result.scores || {};
  const keys = ["seo", "geo", "aeo"];
  const hasScores = keys.some((k) => typeof scores[k]?.score === "number");
  const combined = keys.reduce((sum, k) => sum + (Number(scores[k]?.score) || 0), 0);
  const moves = result.top_moves || [];

  return (
    <div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 16 }}>
        {result.client_summary && (
          <div style={{ ...CARD, flex: "1 1 340px", borderTop: "4px solid #0d9488" }}>
            <p style={{ ...CARD_LABEL, marginBottom: 8 }}>Summary for the client</p>
            <p style={{ fontSize: 14, color: "#333", lineHeight: 1.7, whiteSpace: "pre-line" }}>{result.client_summary}</p>
          </div>
        )}
        {moves.length > 0 && (
          <div style={{ ...CARD, flex: "1 1 300px" }}>
            <p style={{ ...CARD_LABEL, marginBottom: 12 }}>Top {moves.length} moves</p>
            <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
              {moves.map((m, i) => (
                <li key={m.task?.id || i} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
                  <span style={{ width: 24, height: 24, borderRadius: "50%", background: "#0f3460", color: "#fff", fontSize: 12, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                    {i + 1}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", lineHeight: 1.45 }}>{m.headline}</p>
                    {m.task && (
                      <p style={{ fontSize: 12, color: "#888", marginTop: 2, wordBreak: "break-all" }}>
                        {m.task.id} &middot; {m.task.group ? `${m.task.items?.length || 0} pages` : pagePath(m.task.page)}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>

      {hasScores && (
        <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
          {keys.map((k) => (
            <ScoreCard
              key={k}
              label={k.toUpperCase()}
              score={scores[k]?.score}
              status={getScoreStatus(scores[k]?.score)}
              takeaway={scores[k]?.reason}
            />
          ))}
          <CombinedScoreCard score={combined} max={30} />
        </div>
      )}
    </div>
  );
}
