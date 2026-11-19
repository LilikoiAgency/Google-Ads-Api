"use client";
// Picks the results view by audit version: v2 audits get the action-plan view,
// everything older keeps the v1 view.

import V1Results from "./V1Results";
import V2Results from "./v2/V2Results";

export function isV2Audit(audit) {
  return Number(audit?.version) === 2;
}

export default function ResultsView({ audit, crawlData, domain, actions }) {
  if (!audit) return null;
  if (isV2Audit(audit)) return <V2Results result={audit} domain={domain} actions={actions} />;
  return <V1Results audit={audit} crawlData={crawlData} domain={domain} actions={actions} />;
}
