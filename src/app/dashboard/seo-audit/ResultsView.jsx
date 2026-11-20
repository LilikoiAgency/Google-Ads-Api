"use client";
// Picks the results view by audit version: v2 audits get the action-plan view,
// everything older keeps the v1 view.

import V1Results from "./V1Results";
import V2Results from "./v2/V2Results";

export function isV2Audit(audit) {
  return Number(audit?.version) === 2;
}

// onBack: return to the audit list (shown as "All audits").
// review: corrections and "Update the plan" for a saved v2 audit (see V2Results).
export default function ResultsView({ audit, crawlData, domain, actions, onBack, review }) {
  if (!audit) return null;
  if (isV2Audit(audit)) return <V2Results result={audit} domain={domain} actions={actions} onBack={onBack} review={review} />;
  const back = onBack ? (
    <button
      type="button"
      onClick={onBack}
      style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#ddd", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
    >
      ← All audits
    </button>
  ) : null;
  return <V1Results audit={audit} crawlData={crawlData} domain={domain} actions={<div style={{ display: "flex", gap: 10 }}>{back}{actions}</div>} />;
}
