"use client";
import { fmtInt, fmtCtr, fmtPos, DeltaText, PosChange } from "./format";
import { change } from "@/lib/gscInsights";

const KPIS = [
  { key: "clicks", label: "Clicks", fmt: fmtInt },
  { key: "impressions", label: "Impressions", fmt: fmtInt },
  { key: "ctr", label: "CTR", fmt: fmtCtr, pts: true },
  { key: "position", label: "Avg. position", fmt: fmtPos, pos: true },
];

// Headline totals. Totals come from Search Console's own (unfiltered) totals,
// so they include anonymized queries the query table can't show.
export default function SearchKpis({ totals, prev, compareLabel, hasPosition = true, loading = false }) {
  const kpis = hasPosition ? KPIS : KPIS.filter((k) => k.key !== "position");
  return (
    <div className="ga4-kpis gsc-kpis" style={{ gridTemplateColumns: `repeat(${kpis.length}, minmax(0, 1fr))` }}>
      {kpis.map((k) => (
        <div key={k.key} className="ga4-card ga4-kpi" data-testid={`kpi-${k.key}`}>
          <p className="ga4-kpi-label">{k.label}</p>
          {loading || !totals ? (
            <div className="ga4-skel" style={{ height: 30, width: "70%", marginTop: 6 }} />
          ) : (
            <>
              <p className="ga4-kpi-value">{k.fmt(totals[k.key])}</p>
              {compareLabel && prev && (
                <p className="ga4-kpi-delta">
                  {k.pos ? <PosChange cur={totals.position} prev={prev.position} />
                    : k.pts ? <DeltaText d={prev.impressions > 0 ? totals.ctr - prev.ctr : null} pts />
                      : <DeltaText d={change(totals[k.key], prev[k.key])} />}
                  <span className="ga4-kpi-vs">vs {compareLabel}</span>
                </p>
              )}
            </>
          )}
        </div>
      ))}
    </div>
  );
}
