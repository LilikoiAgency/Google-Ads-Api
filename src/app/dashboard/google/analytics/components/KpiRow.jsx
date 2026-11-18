"use client";
import { fmtInt, fmtRate, DeltaText } from "./format";

const KPIS = [
  { key: "users", label: "Users", fmt: fmtInt },
  { key: "sessions", label: "Sessions", fmt: fmtInt },
  { key: "newUsers", label: "New users", fmt: fmtInt },
  { key: "engagementRate", label: "Engagement rate", fmt: fmtRate, pts: true },
  { key: "keyEvents", label: "Key events", fmt: fmtInt },
];

// Headline totals for the selected view. `compareLabel` null = no comparison.
// `showKeyEvents` false = the property records no key events: show "—".
export default function KpiRow({ totals, deltas = {}, compareLabel, showKeyEvents = true, loading = false }) {
  return (
    <div className="ga4-kpis">
      {KPIS.map((k) => {
        const dash = k.key === "keyEvents" && !showKeyEvents;
        return (
          <div key={k.key} className="ga4-card ga4-kpi" data-testid={`kpi-${k.key}`}>
            <p className="ga4-kpi-label">{k.label}</p>
            {loading || !totals ? (
              <div className="ga4-skel" style={{ height: 30, width: "70%", marginTop: 6 }} />
            ) : (
              <>
                <p className="ga4-kpi-value">{dash ? "—" : k.fmt(totals[k.key])}</p>
                {compareLabel && !dash && (
                  <p className="ga4-kpi-delta">
                    <DeltaText d={deltas[k.key]} pts={k.pts} />
                    <span className="ga4-kpi-vs">vs {compareLabel}</span>
                  </p>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
