"use client";
import { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { runAudit, fmtCurrency, fmtPct, fmtCvr } from "../../../../../lib/googleAdsAudit";

const TABS = ["Overview", "Campaigns", "Keywords", "Search Terms", "Bidding", "Assets", "Action Plan"];

const C = {
  bg:      "#0f0f17",
  card:    "#1a1a2e",
  border:  "rgba(255,255,255,0.08)",
  accent:  "#e94560",
  teal:    "#4ecca3",
  amber:   "#f5a623",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.5)",
};

function Pill({ verdict }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 10px", borderRadius: 20, fontSize: 10, fontWeight: 800,
      letterSpacing: "0.5px", textTransform: "uppercase",
      background: verdict.bg, color: verdict.color,
      border: `1px solid ${verdict.color}40`,
    }}>
      {verdict.label}
    </span>
  );
}

function KPI({ label, value, color }) {
  return (
    <div style={{ flex: 1, background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 10, color: C.textSec, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ fontSize: 18, fontWeight: 800, color: color || C.textPri, margin: 0 }}>{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec, margin: "0 0 12px" }}>{title}</p>
      {children}
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div>
      <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{label}</p>
      <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0 }}>{value}</p>
    </div>
  );
}

function Row({ label, value, warn }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 12, color: C.textSec }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: warn ? C.accent : C.textPri }}>{value}</span>
    </div>
  );
}

function LoadingSpinner({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 0", gap: 12 }}>
      <div style={{
        width: 28, height: 28, borderRadius: "50%",
        border: `3px solid ${C.border}`,
        borderTopColor: C.accent,
        animation: "spin 0.8s linear infinite",
      }} />
      <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>{message || "Loading…"}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AuditLoadingBanner() {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)",
      borderRadius: 10, padding: "10px 14px", marginBottom: 16,
    }}>
      <div style={{
        width: 14, height: 14, borderRadius: "50%", flexShrink: 0,
        border: `2px solid rgba(233,69,96,0.4)`,
        borderTopColor: C.accent,
        animation: "spin 0.8s linear infinite",
      }} />
      <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
        Fetching deep audit data — keywords, bidding, assets…
      </p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────
function OverviewTab({ audit, auditLoading }) {
  const { summary, actionPlan, recommendations, campaigns, structure } = audit;
  const byCat = {};
  campaigns.forEach((c) => {
    const k = c.verdict.key;
    byCat[k] = (byCat[k] || 0) + 1;
  });

  const lrColor = summary.lrRatio == null
    ? C.textPri
    : summary.lrRatio < 1.5 ? C.amber
    : summary.lrRatio <= 2.0 ? C.teal
    : C.accent;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}

      <Section title="Account Health">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <KPI label="Total Spend"   value={fmtCurrency(summary.totalCost)} />
          <KPI label="Conversions"   value={summary.totalConversions.toFixed(1)} />
          <KPI label="Blended CPA"   value={summary.blendedCPA ? fmtCurrency(summary.blendedCPA) : "—"} />
          <KPI
            label="L/R Ratio"
            value={summary.lrRatio != null ? summary.lrRatio.toFixed(2) : (auditLoading ? "…" : "—")}
            color={lrColor}
          />
        </div>
      </Section>

      {structure && (
        <Section title="Account Structure">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 }}>
            <KPI label="Campaigns"  value={structure.campaignCount} />
            <KPI label="Ad Groups"  value={structure.adGroupCount} />
            <KPI label="Keywords"   value={structure.keywordCount} />
          </div>
          {structure.avgKeywordsPerAdGroup > 0 && (
            <p style={{ fontSize: 11, color: C.textSec, margin: "8px 0 0" }}>
              Avg {structure.avgKeywordsPerAdGroup} keywords per ad group
              {structure.bloatedAdGroups.length > 0 && (
                <span style={{ color: C.accent }}> · {structure.bloatedAdGroups.length} bloated ({">"}20 kws)</span>
              )}
            </p>
          )}
        </Section>
      )}

      {summary.optimizationScore != null && (
        <Section title="Google Optimization Score">
          <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: summary.optimizationScore >= 0.8 ? C.teal : summary.optimizationScore >= 0.6 ? C.amber : C.accent }}>
                {Math.round(summary.optimizationScore * 100)}%
              </span>
              <p style={{ fontSize: 13, color: C.textSec, margin: 0, lineHeight: 1.4 }}>
                {summary.optimizationScore >= 0.8 ? "Well optimized" : summary.optimizationScore >= 0.6 ? "Room to improve" : "Needs attention"}
              </p>
            </div>
            <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(summary.optimizationScore * 100)}%`, borderRadius: 3, background: summary.optimizationScore >= 0.8 ? C.teal : summary.optimizationScore >= 0.6 ? C.amber : C.accent }} />
            </div>
          </div>
        </Section>
      )}

      <Section title="Campaign Breakdown">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {Object.entries(byCat).map(([key, count]) => {
            const colors = { SCALE: C.teal, OPTIMIZE: C.amber, FIX_QS: C.accent, PAUSE: "#9ca3af", REVIEW: C.amber };
            return (
              <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 14px", textAlign: "center" }}>
                <p style={{ fontSize: 18, fontWeight: 800, color: colors[key] || C.textPri, margin: 0 }}>{count}</p>
                <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{key}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {audit.adStrength && (
        <Section title="RSA Health">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
            {['EXCELLENT', 'GOOD', 'AVERAGE', 'POOR'].map((s) => (
              <div key={s} style={{ background: C.card, borderRadius: 8, padding: "8px", textAlign: "center", border: `1px solid ${C.border}` }}>
                <p style={{ fontSize: 16, fontWeight: 800, color: s === 'EXCELLENT' ? C.teal : s === 'GOOD' ? '#60a5fa' : s === 'AVERAGE' ? C.amber : C.accent, margin: 0 }}>
                  {audit.adStrength.distribution[s] || 0}
                </p>
                <p style={{ fontSize: 9, color: C.textSec, margin: 0 }}>{s}</p>
              </div>
            ))}
          </div>
          {audit.adStrength.underHeadlined?.length > 0 && (
            <p style={{ fontSize: 11, color: C.amber, margin: "6px 0 0" }}>⚠ {audit.adStrength.underHeadlined.length} RSA(s) have fewer than 10 headlines</p>
          )}
          {audit.adStrength.pinnedCount > 0 && (
            <p style={{ fontSize: 11, color: C.amber, margin: "4px 0 0" }}>⚠ {audit.adStrength.pinnedCount} RSA(s) have pinned headlines (hurts optimization)</p>
          )}
        </Section>
      )}

      {actionPlan.length > 0 && (
        <Section title={`Top Issues (${actionPlan.length} total)`}>
          {actionPlan.slice(0, 3).map((a, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: a.ice >= 500 ? C.accent : C.amber, background: a.ice >= 500 ? "rgba(233,69,96,0.12)" : "rgba(245,166,35,0.12)", borderRadius: 4, padding: "2px 6px", flexShrink: 0, marginTop: 1 }}>{a.category}</span>
                <p style={{ fontSize: 12, color: C.textPri, margin: 0, lineHeight: 1.5 }}>{a.issue}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section title={`Google Recommendations (${recommendations.length})`}>
          {recommendations.slice(0, 5).map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />
              <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
                {String(r.type ?? "").replace(/_/g, " ")}
                {r.campaignName && <span style={{ color: "rgba(255,255,255,0.3)" }}> · {r.campaignName}</span>}
              </p>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// ── Tab: Campaigns ────────────────────────────────────────────────────────────
function CampaignsTab({ campaigns }) {
  const [expanded, setExpanded] = useState(null);
  const sorted = [...campaigns].sort((a, b) => (b.cost || 0) - (a.cost || 0));

  return (
    <div>
      {sorted.map((c, i) => (
        <div key={c.campaignId} style={{ marginBottom: 8, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <button
            onClick={() => setExpanded(expanded === i ? null : i)}
            style={{ width: "100%", background: C.card, border: "none", cursor: "pointer", padding: "12px 14px", textAlign: "left", display: "flex", flexDirection: "column", gap: 8 }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0, flex: 1, textAlign: "left" }}>{c.campaignName}</p>
              <Pill verdict={c.verdict} />
            </div>
            <div style={{ display: "flex", gap: 16 }}>
              <Stat label="Spend"  value={fmtCurrency(c.cost)} />
              <Stat label="Conv"   value={(c.conversions || 0).toFixed(1)} />
              <Stat label="CPA"    value={c.cpa ? fmtCurrency(c.cpa) : "—"} />
              <Stat label="CVR"    value={fmtCvr(c.clicks, c.conversions)} />
              {c.searchImpressionShare != null && <Stat label="IS%" value={fmtPct(c.searchImpressionShare)} />}
            </div>
          </button>

          {expanded === i && (
            <div style={{ background: "#0f0f17", padding: "12px 14px", borderTop: `1px solid ${C.border}` }}>
              {c.searchBudgetLostImpressionShare != null && (
                <Row label="IS Lost (Budget)" value={fmtPct(c.searchBudgetLostImpressionShare)} warn={c.searchBudgetLostImpressionShare > 0.25} />
              )}
              {c.searchRankLostImpressionShare != null && (
                <Row label="IS Lost (Rank)" value={fmtPct(c.searchRankLostImpressionShare)} warn={c.searchRankLostImpressionShare > 0.25} />
              )}
              <Row label="Clicks"   value={(c.clicks || 0).toLocaleString()} />
              <Row label="Channel"  value={c.channelType || "—"} />
              {c.optimizationScore != null && (
                <Row label="Opt. Score" value={`${Math.round(c.optimizationScore * 100)}%`} />
              )}
              <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, background: `${c.verdict.color}18`, border: `1px solid ${c.verdict.color}40` }}>
                <p style={{ fontSize: 11, fontWeight: 700, color: c.verdict.color, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>What to do</p>
                <p style={{ fontSize: 12, color: C.textSec, margin: 0, lineHeight: 1.5 }}>
                  {c.verdict.key === "SCALE"    && "This campaign is profitable and budget-constrained. Increase daily budget to capture more available demand."}
                  {c.verdict.key === "FIX_QS"   && "Ad Rank is too low. Do NOT add budget — you'll waste money. Fix QS by tightening ad group themes, improving ad relevance, and raising bids on high-quality keywords."}
                  {c.verdict.key === "PAUSE"    && "Zero conversions with real spend. Pause and investigate: check conversion tracking, review search terms for intent mismatch, consider reallocating budget."}
                  {c.verdict.key === "OPTIMIZE" && "Decent performance but impression share gap exists. Test ad copy variations, refine match types, and review search terms for waste."}
                  {c.verdict.key === "REVIEW"   && "New or low-spend campaign. Allow more time to accumulate data before making major changes."}
                </p>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tab: Keywords ─────────────────────────────────────────────────────────────
function KeywordsTab({ keywordAnalysis, auditLoading }) {
  const [expandedKw, setExpandedKw] = useState(null);

  if (auditLoading && !keywordAnalysis) {
    return <LoadingSpinner message="Fetching keyword data…" />;
  }

  if (!keywordAnalysis) {
    return <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No keyword data available.</p>;
  }

  const { qs1to3, qs4to6, qs7to10, totalWithQS, weightedAvgQS, matchTypeSpend, bottom10, componentBreakdown } = keywordAnalysis;
  const qsTotal = qs1to3.length + qs4to6.length + qs7to10.length;

  const QsBar = ({ count, total, color, label }) => {
    const pct = total > 0 ? (count / total) * 100 : 0;
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span style={{ fontSize: 11, color: C.textSec, width: 44, flexShrink: 0 }}>{label}</span>
        <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, borderRadius: 5, background: color, transition: "width 0.3s" }} />
        </div>
        <span style={{ fontSize: 11, color: C.textPri, fontWeight: 600, width: 60, textAlign: "right", flexShrink: 0 }}>
          {count} ({Math.round(pct)}%)
        </span>
      </div>
    );
  };

  const componentLabels = { expectedCtr: "Expected CTR", adRelevance: "Ad Relevance", lpExperience: "Landing Page Exp." };

  return (
    <>
      <Section title="Quality Score Distribution">
        <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, marginBottom: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ fontSize: 11, color: C.textSec }}>Weighted avg QS:</span>
            <span style={{
              fontSize: 15, fontWeight: 800,
              color: weightedAvgQS == null ? C.textSec : weightedAvgQS >= 7 ? C.teal : weightedAvgQS >= 5 ? C.amber : C.accent,
            }}>
              {weightedAvgQS != null ? weightedAvgQS.toFixed(1) : "—"}
            </span>
            <span style={{ fontSize: 10, color: C.textSec, marginLeft: "auto" }}>{totalWithQS} keywords with QS data</span>
          </div>
          <QsBar count={qs7to10.length} total={qsTotal} color={C.teal}  label="7–10" />
          <QsBar count={qs4to6.length}  total={qsTotal} color={C.amber} label="4–6" />
          <QsBar count={qs1to3.length}  total={qsTotal} color={C.accent} label="1–3" />
        </div>
      </Section>

      <Section title="Match Type Spend">
        <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
          {[
            { key: "EXACT",  color: C.teal,  label: "Exact Match" },
            { key: "PHRASE", color: C.amber, label: "Phrase Match" },
            { key: "BROAD",  color: C.accent, label: "Broad Match" },
          ].map(({ key, color, label }) => {
            const pct = matchTypeSpend[key] * 100;
            return (
              <div key={key} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 11, color: C.textSec, width: 86, flexShrink: 0 }}>{label}</span>
                <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.08)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, borderRadius: 5, background: color }} />
                </div>
                <span style={{ fontSize: 11, fontWeight: 600, color: C.textPri, width: 36, textAlign: "right", flexShrink: 0 }}>
                  {Math.round(pct)}%
                </span>
              </div>
            );
          })}
          {matchTypeSpend.BROAD > 0.6 && (
            <p style={{ fontSize: 11, color: C.accent, margin: "8px 0 0", lineHeight: 1.4 }}>
              High broad match spend ({Math.round(matchTypeSpend.BROAD * 100)}%) — Google controls targeting. Consider shifting to phrase/exact.
            </p>
          )}
        </div>
      </Section>

      {componentBreakdown && (
        <Section title="QS Component Breakdown">
          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 10, color: C.textSec }}>Component</span>
              {["Below", "Average", "Above"].map((h) => (
                <span key={h} style={{ fontSize: 10, color: C.textSec, textAlign: "center" }}>{h}</span>
              ))}
            </div>
            {Object.entries(componentBreakdown).map(([comp, counts]) => (
              <div key={comp} style={{ display: "grid", gridTemplateColumns: "1fr 80px 80px 80px", padding: "9px 14px", borderBottom: `1px solid ${C.border}` }}>
                <span style={{ fontSize: 12, color: C.textPri }}>{componentLabels[comp] || comp}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.accent, textAlign: "center" }}>{counts.BELOW_AVERAGE}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.amber, textAlign: "center" }}>{counts.AVERAGE}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: C.teal, textAlign: "center" }}>{counts.ABOVE_AVERAGE}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {bottom10.length > 0 && (
        <Section title="Bottom Keywords by Quality Score">
          {bottom10.map((k, i) => (
            <div key={i} style={{ borderRadius: 8, border: `1px solid ${C.border}`, marginBottom: 6, overflow: "hidden" }}>
              <button
                onClick={() => setExpandedKw(expandedKw === i ? null : i)}
                style={{ width: "100%", background: C.card, border: "none", cursor: "pointer", padding: "10px 12px", textAlign: "left", display: "flex", alignItems: "center", gap: 10 }}
              >
                <span style={{
                  fontSize: 13, fontWeight: 800, flexShrink: 0, width: 22, textAlign: "center",
                  color: k.qualityScore <= 3 ? C.accent : k.qualityScore <= 6 ? C.amber : C.teal,
                }}>{k.qualityScore}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 600, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{k.text}</p>
                  <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{k.adGroupName}</p>
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: C.textPri, margin: 0 }}>{fmtCurrency(k.cost)}</p>
                  <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{(k.conversions || 0).toFixed(1)} conv</p>
                </div>
              </button>
              {expandedKw === i && (
                <div style={{ background: "#0f0f17", padding: "10px 12px", borderTop: `1px solid ${C.border}` }}>
                  <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 6px" }}>
                    Match: <strong style={{ color: C.textPri }}>{k.matchType}</strong> · Campaign: <strong style={{ color: C.textPri }}>{k.campaignName}</strong>
                  </p>
                  {k.expectedCtr && <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 2px" }}>Expected CTR: <strong style={{ color: C.textPri }}>{k.expectedCtr.replace(/_/g, " ")}</strong></p>}
                  {k.adRelevance && <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 2px" }}>Ad Relevance: <strong style={{ color: C.textPri }}>{k.adRelevance.replace(/_/g, " ")}</strong></p>}
                  {k.lpExperience && <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 8px" }}>Landing Page: <strong style={{ color: C.textPri }}>{k.lpExperience.replace(/_/g, " ")}</strong></p>}
                  <div style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 6, padding: "8px 10px" }}>
                    <p style={{ fontSize: 11, fontWeight: 700, color: C.accent, margin: "0 0 3px", textTransform: "uppercase", letterSpacing: "0.4px" }}>Fix this keyword</p>
                    <p style={{ fontSize: 11, color: C.textSec, margin: 0, lineHeight: 1.5 }}>
                      Tighten the ad group theme so all keywords share the same intent. Rewrite ad headlines to include this exact keyword. Ensure landing page content directly answers the search query.
                    </p>
                  </div>
                </div>
              )}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// ── Tab: Search Terms ─────────────────────────────────────────────────────────
function SearchTermsTab({ searchTerms }) {
  const { wasted, winners, totalWastedCost, wasteRatio, uncoveredWinners } = searchTerms;

  return (
    <>
      {wasted.length > 0 && (
        <Section title={`Wasted Spend — ${fmtPct(wasteRatio)} of budget (${fmtCurrency(totalWastedCost)})`}>
          <div style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
              These search terms got clicks but <strong style={{ color: "#fff" }}>zero conversions</strong>. Add them as negative keywords immediately.
            </p>
          </div>
          {wasted.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: C.textPri, margin: 0 }}>{t.term}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>{t.campaignName} · {t.clicks} clicks</p>
              </div>
              <span style={{ fontSize: 12, fontWeight: 700, color: C.accent, flexShrink: 0 }}>{fmtCurrency(t.cost)}</span>
            </div>
          ))}
        </Section>
      )}

      {winners.length > 0 && (
        <Section title="Converting Terms — add as exact match">
          <div style={{ background: "rgba(78,204,163,0.08)", border: "1px solid rgba(78,204,163,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
              These search terms are driving conversions. Pin them with <strong style={{ color: "#fff" }}>exact match keywords</strong> to protect performance.
            </p>
          </div>
          {winners.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: C.textPri, margin: 0 }}>{t.term}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>{t.campaignName} · {t.clicks} clicks</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.teal, margin: 0 }}>{t.conversions.toFixed(1)} conv</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>{fmtCurrency(t.cost)}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {uncoveredWinners?.length > 0 && (
        <Section title="Not Covered by Exact Match">
          <div style={{ background: "rgba(245,166,35,0.08)", border: "1px solid rgba(245,166,35,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
              These converting terms have <strong style={{ color: "#fff" }}>no exact match keyword</strong>. Add them to lock in your top performers.
            </p>
          </div>
          {uncoveredWinners.slice(0, 8).map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 600, color: C.textPri, margin: 0 }}>{t.term}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>{t.campaignName}</p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.amber, margin: 0 }}>{t.conversions.toFixed(1)} conv</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>→ Add as [exact]</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {wasted.length === 0 && winners.length === 0 && (
        <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No search term data available for this date range.</p>
      )}
    </>
  );
}

// ── Tab: Bidding ──────────────────────────────────────────────────────────────
function BiddingTab({ biddingAudits, auditLoading }) {
  if (auditLoading && (!biddingAudits || biddingAudits.length === 0)) {
    return <LoadingSpinner message="Fetching bidding data…" />;
  }

  if (!biddingAudits || biddingAudits.length === 0) {
    return <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No bidding data available.</p>;
  }

  const statusColor = { ok: C.teal, warn: C.accent, info: C.amber };
  const statusIcon  = { ok: "✅", warn: "🔴", info: "🟡" };

  return (
    <div>
      {biddingAudits.map((b, i) => (
        <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px", marginBottom: 10 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8, marginBottom: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0, flex: 1, lineHeight: 1.3 }}>{b.campaignName}</p>
            <span style={{ fontSize: 13, flexShrink: 0 }}>{statusIcon[b.status]}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginBottom: 8 }}>
            <Stat label="Strategy" value={b.biddingStrategyType?.replace(/_/g, " ") || "—"} />
            <Stat label="Budget/day" value={b.budget ? fmtCurrency(b.budget) : "—"} />
            <Stat label="Target CPA" value={b.targetCpa ? fmtCurrency(b.targetCpa) : "—"} />
            <Stat label="Actual CPA" value={b.actualCpa ? fmtCurrency(b.actualCpa) : "—"} />
            <Stat label="Conversions" value={(b.conversions || 0).toFixed(1)} />
          </div>
          {b.recommendation && (
            <div style={{ background: `${statusColor[b.status] || C.amber}14`, border: `1px solid ${statusColor[b.status] || C.amber}40`, borderRadius: 8, padding: "8px 10px" }}>
              <p style={{ fontSize: 11, color: C.textSec, margin: 0, lineHeight: 1.5 }}>{b.recommendation}</p>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Tab: Assets ───────────────────────────────────────────────────────────────
function AssetsTab({ assetAnalysis, auditLoading, pmaxData }) {
  if (auditLoading && (!assetAnalysis || assetAnalysis.length === 0)) {
    return <LoadingSpinner message="Fetching asset data…" />;
  }

  if (!assetAnalysis || assetAnalysis.length === 0) {
    return <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No asset data available.</p>;
  }

  const ASSET_TYPES = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "IMAGE"];
  const ASSET_LABELS = {
    SITELINK: "Sitelink",
    CALLOUT: "Callout",
    STRUCTURED_SNIPPET: "Snippet",
    CALL: "Call",
    IMAGE: "Image",
  };

  const summaries = ASSET_TYPES.map((type) => ({
    type,
    label: ASSET_LABELS[type],
    missing: assetAnalysis.filter((a) => a.missingTypes.includes(type)).length,
  })).filter((s) => s.missing > 0);

  return (
    <>
      {summaries.length > 0 && (
        <Section title="Coverage Gaps">
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
            {summaries.map(({ type, label, missing }) => (
              <div key={type} style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 8, padding: "6px 12px" }}>
                <span style={{ fontSize: 11, color: C.textSec }}>{label}: </span>
                <span style={{ fontSize: 11, fontWeight: 700, color: C.accent }}>{missing} campaign{missing > 1 ? "s" : ""} missing</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Campaign Asset Coverage">
        <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "56px").join(" ")} 64px`, padding: "8px 14px", borderBottom: `1px solid ${C.border}`, gap: 4 }}>
            <span style={{ fontSize: 10, color: C.textSec }}>Campaign</span>
            {ASSET_TYPES.map((t) => (
              <span key={t} style={{ fontSize: 9, color: C.textSec, textAlign: "center", letterSpacing: "0.3px" }}>{ASSET_LABELS[t]}</span>
            ))}
            <span style={{ fontSize: 10, color: C.textSec, textAlign: "center" }}>Score</span>
          </div>

          {assetAnalysis.map((a, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "56px").join(" ")} 64px`, padding: "9px 14px", borderBottom: `1px solid ${C.border}`, gap: 4, alignItems: "center" }}>
              <p style={{ fontSize: 11, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.campaignName}>{a.campaignName}</p>
              {ASSET_TYPES.map((type) => (
                <span key={type} style={{ fontSize: 14, textAlign: "center" }}>
                  {a.presentTypes.includes(type) ? "✅" : "❌"}
                </span>
              ))}
              <span style={{ fontSize: 11, fontWeight: 700, textAlign: "center", color: a.coverageScore >= 0.8 ? C.teal : a.coverageScore >= 0.6 ? C.amber : C.accent }}>
                {Math.round(a.coverageScore * 100)}%
              </span>
            </div>
          ))}
        </div>
      </Section>

      {pmaxData && pmaxData.length > 0 && (
        <Section title={`Performance Max (${pmaxData.length} campaign${pmaxData.length > 1 ? 's' : ''})`}>
          {pmaxData.map((p, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 14px", marginBottom: 8 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0 }}>{p.campaignName}</p>
                <span style={{ fontSize: 10, color: p.hasBrandExclusion ? C.teal : C.accent, fontWeight: 700 }}>
                  {p.hasBrandExclusion ? "✓ Brand excluded" : "⚠ No brand exclusion"}
                </span>
              </div>
              <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 8px" }}>
                {p.assetGroupCount} asset group{p.assetGroupCount !== 1 ? 's' : ''} · {fmtCurrency(p.cost)} spend · {(p.conversions || 0).toFixed(1)} conv
              </p>
              {p.flags.map((flag, fi) => (
                <p key={fi} style={{ fontSize: 11, color: C.accent, margin: "2px 0" }}>⚠ {flag}</p>
              ))}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// ── Tab: Action Plan ──────────────────────────────────────────────────────────
function ActionPlanTab({ actions, auditLoading }) {
  if (!actions.length) {
    if (auditLoading) {
      return (
        <>
          <AuditLoadingBanner />
          <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 20 }}>Partial results shown — deep audit loading…</p>
        </>
      );
    }
    return <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No issues detected — account looks healthy.</p>;
  }

  return (
    <div>
      {auditLoading && <AuditLoadingBanner />}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "10px 14px", marginBottom: 16 }}>
        <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>Sorted by <strong style={{ color: "#fff" }}>ICE score</strong> (Impact × Confidence × Ease). Do red items today.</p>
      </div>
      {actions.map((a, i) => {
        const priority = a.ice >= 500 ? { color: C.accent, label: "DO TODAY" } : a.ice >= 200 ? { color: C.amber, label: "THIS WEEK" } : { color: C.teal, label: "THIS MONTH" };
        return (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 10, fontWeight: 800, color: priority.color, background: `${priority.color}18`, border: `1px solid ${priority.color}40`, borderRadius: 4, padding: "2px 7px" }}>{priority.label}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: C.textSec, background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "2px 7px" }}>{a.category}</span>
              <span style={{ fontSize: 10, color: C.textSec, marginLeft: "auto" }}>ICE {a.ice}</span>
            </div>
            <p style={{ fontSize: 13, fontWeight: 600, color: C.textPri, margin: "0 0 6px", lineHeight: 1.4 }}>{a.issue}</p>
            <p style={{ fontSize: 12, color: C.textSec, margin: "0 0 8px", lineHeight: 1.5 }}>{a.fix}</p>
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", margin: 0 }}>📍 {a.path}</p>
          </div>
        );
      })}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function AuditPanel({ accountData, accountName, customerId, selectedCampaign, onClose }) {
  const [tab, setTab] = useState(0);
  const [visible, setVisible] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);

  const campaignId = selectedCampaign?.campaignId ?? null;

  const audit = useMemo(
    () => runAudit(accountData, auditData, campaignId),
    [accountData, auditData, campaignId]
  );

  useEffect(() => {
    setMounted(true);
    const t = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(t);
  }, []);

  useEffect(() => {
    if (!customerId) return;
    setAuditLoading(true);
    fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Audit API error ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (json?.data) setAuditData(json.data);
      })
      .catch((err) => {
        console.warn("[AuditPanel] Deep audit fetch failed:", err.message);
      })
      .finally(() => setAuditLoading(false));
  }, [customerId]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 220);
  };

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(3px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      />

      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
        width: 560, maxWidth: "100vw",
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        transform: visible ? "translateX(0)" : "translateX(100%)",
        transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "20px 24px 0", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
            <div>
              <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 4px" }}>
                {selectedCampaign ? "CAMPAIGN AUDIT" : "ACCOUNT AUDIT"}
              </p>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: C.textPri, margin: "0 0 2px" }}>
                {selectedCampaign ? selectedCampaign.campaignName : accountName}
              </h2>
              <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>
                {audit.summary.criticalCount > 0
                  ? `${audit.summary.criticalCount} critical issue${audit.summary.criticalCount > 1 ? "s" : ""} found`
                  : "No critical issues found"}
                {auditLoading && <span style={{ color: C.amber }}> · deep audit loading…</span>}
              </p>
            </div>
            <button onClick={handleClose} style={{ background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: "rgba(255,255,255,0.6)", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>✕</button>
          </div>

          {/* Tabs — horizontally scrollable */}
          <div style={{ display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}>
            {TABS.map((t, i) => (
              <button
                key={t}
                onClick={() => setTab(i)}
                style={{
                  flexShrink: 0,
                  padding: "8px 12px",
                  fontSize: 12, fontWeight: 600,
                  background: "none", border: "none", cursor: "pointer",
                  whiteSpace: "nowrap",
                  color: tab === i ? C.textPri : C.textSec,
                  borderBottom: `2px solid ${tab === i ? C.accent : "transparent"}`,
                  transition: "all 0.15s",
                }}
              >
                {t}
                {auditLoading && (i === 2 || i === 4 || i === 5) && (
                  <span style={{ marginLeft: 4, fontSize: 9, color: C.amber }}>●</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable content */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {tab === 0 && <OverviewTab audit={audit} auditLoading={auditLoading} />}
          {tab === 1 && <CampaignsTab campaigns={audit.campaigns} />}
          {tab === 2 && <KeywordsTab keywordAnalysis={audit.keywords} auditLoading={auditLoading} />}
          {tab === 3 && <SearchTermsTab searchTerms={audit.searchTerms} />}
          {tab === 4 && <BiddingTab biddingAudits={audit.bidding} auditLoading={auditLoading} />}
          {tab === 5 && <AssetsTab assetAnalysis={audit.assets} auditLoading={auditLoading} pmaxData={audit.pmaxData} />}
          {tab === 6 && <ActionPlanTab actions={audit.actionPlan} auditLoading={auditLoading} />}
        </div>
      </div>
    </>,
    document.body
  );
}
