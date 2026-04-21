"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useMemo, useEffect, Suspense } from "react";
import { runAudit, fmtCurrency, fmtPct, fmtCvr } from "../../../../../lib/googleAdsAudit";

const TABS = ["Overview", "Campaigns", "Keywords", "Search Terms", "Bidding", "Assets", "Action Plan", "AI Insight"];

const REC_TYPE_LABELS = {
  2: "Increase campaign budget",
  3: "Add keywords",
  4: "Improve ad copy",
  5: "Use broad match keywords",
  6: "Move unused budget",
  7: "Target outranking share",
  8: "Enable search partners",
  10: "Improve landing page experience",
  11: "Add negative keywords",
  14: "Upgrade to Target CPA",
  15: "Upgrade to Target ROAS",
  16: "Upgrade Smart Shopping to Performance Max",
  18: "Add responsive search ads",
  19: "Use optimized ad rotation",
  20: "Improve ad strength",
  21: "Improve responsive search ad assets",
  22: "Upgrade local campaigns to Performance Max",
  23: "Improve ad strength",
  24: "Set a target CPA",
  25: "Set a target ROAS",
  26: "Improve keyword themes",
  27: "Create conversion action",
  28: "Add callout assets",
  29: "Add sitelinks",
  30: "Add call assets",
  31: "Add location assets",
  32: "Add image assets",
  33: "Add seller ratings",
  34: "Add structured snippets",
  35: "Add dynamic image extensions",
  36: "Add price assets",
  37: "Add promotion assets",
  38: "Add app assets",
  39: "Add lead form assets",
  40: "Maximize clicks bid strategy",
  41: "Maximize conversions bid strategy",
  42: "Target impression share",
  43: "Add audience targeting",
  44: "Remove conflicting negative keywords",
  45: "Remove redundant keywords",
  46: "Adopt Performance Max",
  47: "Improve Performance Max ad strength",
  48: "Migrate to Performance Max with store goals",
  49: "Improve Performance Max asset group coverage",
  50: "Expand reach with Google Display Network",
  51: "Optimize Performance Max campaign",
  52: "Add new business locations",
  53: "Improve Google tag coverage",
  54: "Fix conversion tracking",
  55: "Add age targeting exclusions",
};

function formatRecType(type) {
  if (typeof type === "number" && REC_TYPE_LABELS[type]) return REC_TYPE_LABELS[type];
  if (typeof type === "string" && type.length > 0) return type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  return `Recommendation type ${type}`;
}

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

// ── Shared UI atoms ───────────────────────────────────────────────────────────

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
    <div style={{ flex: 1, background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: color || C.textPri, margin: 0 }}>{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec, margin: "0 0 14px" }}>{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, warn }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "9px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 14, color: C.textSec }}>{label}</span>
      <span style={{ fontSize: 14, fontWeight: 600, color: warn ? C.accent : C.textPri }}>{value}</span>
    </div>
  );
}

function LoadingSpinner({ message }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 12 }}>
      <div style={{ width: 32, height: 32, borderRadius: "50%", border: `3px solid ${C.border}`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>{message || "Loading…"}</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function AuditLoadingBanner() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 10, padding: "10px 14px", marginBottom: 20 }}>
      <div style={{ width: 14, height: 14, borderRadius: "50%", flexShrink: 0, border: `2px solid rgba(233,69,96,0.4)`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontSize: 15, color: C.textSec, margin: 0 }}>Fetching deep audit data — keywords, bidding, assets…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

// ── Tab: Overview ─────────────────────────────────────────────────────────────

function OverviewTab({ audit, auditLoading }) {
  const { summary, actionPlan, recommendations, campaigns, structure, adStrength } = audit;
  const byCat = {};
  campaigns.forEach((c) => { byCat[c.verdict.key] = (byCat[c.verdict.key] || 0) + 1; });

  const lrColor = summary.lrRatio == null ? C.textPri
    : summary.lrRatio < 1.5 ? C.amber
    : summary.lrRatio <= 2.0 ? C.teal
    : C.accent;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}

      <Section title="Account Health">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12 }}>
          <KPI label="Total Spend"    value={fmtCurrency(summary.totalCost)} />
          <KPI label="Conversions"    value={summary.totalConversions.toFixed(1)} />
          <KPI label="Blended CPA"    value={summary.blendedCPA ? fmtCurrency(summary.blendedCPA) : "—"} />
          <KPI label="L/R Ratio"      value={summary.lrRatio != null ? summary.lrRatio.toFixed(2) : (auditLoading ? "…" : "—")} color={lrColor} />
        </div>
      </Section>

      {structure && (
        <Section title="Account Structure">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
            <KPI label="Campaigns"  value={structure.campaignCount} />
            <KPI label="Ad Groups"  value={structure.adGroupCount} />
            <KPI label="Keywords"   value={structure.keywordCount} />
          </div>
          {structure.avgKeywordsPerAdGroup > 0 && (
            <p style={{ fontSize: 15, color: C.textSec, margin: "12px 0 0" }}>
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
          <div style={{ background: C.card, borderRadius: 12, padding: "20px 24px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 20, marginBottom: 12 }}>
              <span style={{ fontSize: 40, fontWeight: 800, color: summary.optimizationScore >= 0.8 ? C.teal : summary.optimizationScore >= 0.6 ? C.amber : C.accent }}>
                {Math.round(summary.optimizationScore * 100)}%
              </span>
              <p style={{ fontSize: 16, color: C.textSec, margin: 0 }}>
                {summary.optimizationScore >= 0.8 ? "Well optimized" : summary.optimizationScore >= 0.6 ? "Room to improve" : "Needs attention"}
              </p>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${Math.round(summary.optimizationScore * 100)}%`, borderRadius: 4, background: summary.optimizationScore >= 0.8 ? C.teal : summary.optimizationScore >= 0.6 ? C.amber : C.accent }} />
            </div>
          </div>
        </Section>
      )}

      <Section title="Campaign Breakdown">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {Object.entries(byCat).map(([key, count]) => {
            const colors = { SCALE: C.teal, OPTIMIZE: C.amber, FIX_QS: C.accent, PAUSE: "#9ca3af", REVIEW: C.amber };
            return (
              <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px 24px", textAlign: "center" }}>
                <p style={{ fontSize: 30, fontWeight: 800, color: colors[key] || C.textPri, margin: 0 }}>{count}</p>
                <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>{key.replace(/_/g, " ")}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {adStrength && (
        <Section title="RSA Ad Strength">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 14 }}>
            {["EXCELLENT","GOOD","AVERAGE","POOR"].map((s) => {
              const colors = { EXCELLENT: C.teal, GOOD: "#60d394", AVERAGE: C.amber, POOR: C.accent };
              return (
                <div key={s} style={{ background: C.card, borderRadius: 12, padding: "16px 18px", border: `1px solid ${C.border}`, textAlign: "center" }}>
                  <p style={{ fontSize: 28, fontWeight: 800, color: colors[s], margin: 0 }}>{adStrength.distribution[s]}</p>
                  <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>{s}</p>
                </div>
              );
            })}
          </div>
          {adStrength.underHeadlined.length > 0 && (
            <p style={{ fontSize: 15, color: C.amber, margin: "0 0 8px" }}>⚠ {adStrength.underHeadlined.length} RSA{adStrength.underHeadlined.length > 1 ? "s have" : " has"} fewer than 10 headlines</p>
          )}
          {adStrength.pinnedCount > 0 && (
            <p style={{ fontSize: 15, color: C.amber, margin: 0 }}>⚠ {adStrength.pinnedCount} RSA(s) have pinned headlines — reduces optimization</p>
          )}
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section title={`Google Recommendations (${recommendations.length})`}>
          {recommendations.slice(0, 5).map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />
              <p style={{ fontSize: 16, color: C.textSec, margin: 0 }}>
                {formatRecType(r.type)}
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
  return (
    <Section title={`${campaigns.length} Campaign${campaigns.length !== 1 ? "s" : ""}`}>
      {campaigns.map((c, i) => {
        const isOpen = expanded === i;
        return (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 10, overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(isOpen ? null : i)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "16px 20px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            >
              <Pill verdict={c.verdict} />
              <span style={{ flex: 1, fontSize: 16, fontWeight: 700, color: C.textPri }}>{c.campaignName}</span>
              <span style={{ fontSize: 15, color: C.textSec }}>{fmtCurrency(c.cost)}</span>
              <span style={{ fontSize: 15, color: C.teal, marginLeft: 14 }}>{(c.conversions || 0).toFixed(1)} conv</span>
              <span style={{ fontSize: 14, color: C.textSec, marginLeft: 10 }}>{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div style={{ padding: "0 20px 18px", borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginTop: 14 }}>
                  <div><p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>CPA</p><p style={{ fontSize: 18, fontWeight: 700, color: C.textPri, margin: 0 }}>{c.cpa ? fmtCurrency(c.cpa) : "—"}</p></div>
                  <div><p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>Lost IS (Budget)</p><p style={{ fontSize: 18, fontWeight: 700, color: c.searchBudgetLostImpressionShare > 0.2 ? C.accent : C.textPri, margin: 0 }}>{fmtPct(c.searchBudgetLostImpressionShare)}</p></div>
                  <div><p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>Lost IS (Rank)</p><p style={{ fontSize: 18, fontWeight: 700, color: c.searchRankLostImpressionShare > 0.2 ? C.accent : C.textPri, margin: 0 }}>{fmtPct(c.searchRankLostImpressionShare)}</p></div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </Section>
  );
}

// ── Tab: Keywords ─────────────────────────────────────────────────────────────

function KeywordsTab({ keywordAnalysis, auditLoading }) {
  if (auditLoading && !keywordAnalysis) return <LoadingSpinner message="Fetching keyword quality data…" />;
  if (!keywordAnalysis) return <p style={{ color: C.textSec, fontSize: 16 }}>No keyword data available.</p>;

  const { qs1to3, qs4to6, qs7to10, totalWithQS, weightedAvgQS, matchTypeSpend, bottom10, topByConversions, componentBreakdown } = keywordAnalysis;
  const total = qs1to3.length + qs4to6.length + qs7to10.length;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}
      <Section title="Quality Score Distribution">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 14 }}>
          <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 35, fontWeight: 800, color: C.accent, margin: 0 }}>{qs1to3.length}</p>
            <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>QS 1–3 (Poor)</p>
          </div>
          <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 35, fontWeight: 800, color: C.amber, margin: 0 }}>{qs4to6.length}</p>
            <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>QS 4–6 (Average)</p>
          </div>
          <div style={{ background: C.card, borderRadius: 12, padding: "18px 20px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 35, fontWeight: 800, color: C.teal, margin: 0 }}>{qs7to10.length}</p>
            <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>QS 7–10 (Good)</p>
          </div>
        </div>
        {weightedAvgQS != null && (
          <p style={{ fontSize: 16, color: C.textSec }}>
            Weighted avg QS: <strong style={{ color: weightedAvgQS >= 7 ? C.teal : weightedAvgQS >= 5 ? C.amber : C.accent }}>{weightedAvgQS}</strong> across {totalWithQS} keywords
          </p>
        )}
      </Section>

      <Section title="Match Type Spend">
        {["BROAD","PHRASE","EXACT"].map((mt) => {
          const pct = matchTypeSpend[mt] || 0;
          const color = mt === "BROAD" && pct > 0.6 ? C.accent : mt === "EXACT" ? C.teal : C.amber;
          return (
            <div key={mt} style={{ marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 15, color: C.textSec }}>{mt}</span>
                <span style={{ fontSize: 15, fontWeight: 700, color }}>{Math.round(pct * 100)}%</span>
              </div>
              <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,0.08)" }}>
                <div style={{ height: "100%", width: `${Math.round(pct * 100)}%`, borderRadius: 4, background: color }} />
              </div>
            </div>
          );
        })}
      </Section>

      {componentBreakdown && (
        <Section title="QS Component Breakdown">
          {[["expectedCtr","Expected CTR"],["adRelevance","Ad Relevance"],["lpExperience","Landing Page"]].map(([key, label]) => {
            const b = componentBreakdown[key] || {};
            return (
              <div key={key} style={{ background: C.card, borderRadius: 12, padding: "16px 18px", border: `1px solid ${C.border}`, marginBottom: 10 }}>
                <p style={{ fontSize: 15, fontWeight: 700, color: C.textPri, margin: "0 0 10px" }}>{label}</p>
                <div style={{ display: "flex", gap: 14 }}>
                  {[["BELOW_AVERAGE", C.accent],["AVERAGE", C.amber],["ABOVE_AVERAGE", C.teal]].map(([rating, color]) => (
                    <div key={rating} style={{ flex: 1, textAlign: "center" }}>
                      <p style={{ fontSize: 22, fontWeight: 800, color, margin: 0 }}>{b[rating] || 0}</p>
                      <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>{rating.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {topByConversions?.length > 0 && (
        <Section title="Top Keywords by Conversions">
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 90px 90px", padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              {["Keyword","Match","QS","Conv","CPA"].map((h) => <span key={h} style={{ fontSize: 13, color: C.textSec, fontWeight: 700 }}>{h}</span>)}
            </div>
            {topByConversions.map((k, i) => {
              const cpa = k.conversions > 0 ? k.cost / k.conversions : null;
              return (
                <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 60px 90px 90px", padding: "12px 16px", borderBottom: i < topByConversions.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                  <p style={{ fontSize: 15, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.text}>{k.text}</p>
                  <span style={{ fontSize: 14, color: C.textSec }}>{k.matchType}</span>
                  <span style={{ fontSize: 16, fontWeight: 800, color: k.qualityScore == null ? C.textSec : k.qualityScore <= 3 ? C.accent : k.qualityScore <= 6 ? C.amber : C.teal }}>
                    {k.qualityScore ?? "—"}
                  </span>
                  <span style={{ fontSize: 15, fontWeight: 700, color: C.teal }}>{k.conversions.toFixed(1)}</span>
                  <span style={{ fontSize: 14, color: C.textSec }}>{cpa != null ? fmtCurrency(cpa) : "—"}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {bottom10.length > 0 && (
        <Section title="Bottom Keywords by Quality Score">
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 90px", padding: "10px 16px", borderBottom: `1px solid ${C.border}` }}>
              {["Keyword","Match","QS","Spend"].map((h) => <span key={h} style={{ fontSize: 13, color: C.textSec, fontWeight: 700 }}>{h}</span>)}
            </div>
            {bottom10.map((k, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 90px", padding: "12px 16px", borderBottom: i < bottom10.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                <p style={{ fontSize: 15, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.text}>{k.text}</p>
                <span style={{ fontSize: 14, color: C.textSec }}>{k.matchType}</span>
                <span style={{ fontSize: 16, fontWeight: 800, color: k.qualityScore <= 3 ? C.accent : k.qualityScore <= 6 ? C.amber : C.teal }}>{k.qualityScore}</span>
                <span style={{ fontSize: 14, color: C.textSec }}>{fmtCurrency(k.cost)}</span>
              </div>
            ))}
          </div>
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
      <Section title="Wasted Spend (Zero Conversions)">
        <div style={{ background: C.card, borderRadius: 12, padding: "16px 20px", border: `1px solid ${C.border}`, marginBottom: 14 }}>
          <p style={{ fontSize: 16, color: C.textSec, margin: 0 }}>
            <strong style={{ color: wasteRatio > 0.1 ? C.accent : C.amber }}>{fmtPct(wasteRatio)}</strong> of search term spend
            ({fmtCurrency(totalWastedCost)}) went to zero-conversion queries
          </p>
        </div>
        {wasted.length === 0
          ? <p style={{ fontSize: 16, color: C.teal }}>No significant wasted spend detected.</p>
          : wasted.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.accent }}>{fmtCurrency(t.cost)}</span>
            </div>
          ))
        }
      </Section>

      <Section title="Converting Search Terms">
        {winners.length === 0
          ? <p style={{ fontSize: 16, color: C.textSec }}>No converting search terms found.</p>
          : winners.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.teal }}>{t.conversions.toFixed(1)} conv · {fmtCurrency(t.cost)}</span>
            </div>
          ))
        }
      </Section>

      {uncoveredWinners?.length > 0 && (
        <Section title="Not Covered by Exact Match">
          <div style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 12, padding: "16px 18px", marginBottom: 14 }}>
            <p style={{ fontSize: 15, color: C.textSec, margin: 0 }}>
              These converting queries have no exact match keyword. Add them to capture intent more precisely and lower wasted spend.
            </p>
          </div>
          {uncoveredWinners.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 16, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 16, fontWeight: 700, color: C.amber }}>{t.conversions.toFixed(1)} conv</span>
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

// ── Tab: Bidding ──────────────────────────────────────────────────────────────

function BiddingTab({ biddingAudits, auditLoading }) {
  if (auditLoading && !biddingAudits.length) return <LoadingSpinner message="Fetching bidding configuration…" />;
  if (!biddingAudits.length) return <p style={{ color: C.textSec, fontSize: 16 }}>No bidding data available.</p>;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}
      <Section title={`${biddingAudits.length} Campaign Bidding Configs`}>
        {biddingAudits.map((b, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${b.status === "warn" ? "rgba(233,69,96,0.3)" : b.status === "info" ? "rgba(245,166,35,0.3)" : C.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 16, fontWeight: 700, color: C.textPri, margin: 0 }}>{b.campaignName}</p>
              <span style={{ fontSize: 14, fontWeight: 700, color: b.status === "warn" ? C.accent : b.status === "info" ? C.amber : C.teal, background: b.status === "warn" ? "rgba(233,69,96,0.1)" : b.status === "info" ? "rgba(245,166,35,0.1)" : "rgba(78,204,163,0.1)", padding: "3px 10px", borderRadius: 6 }}>
                {b.status === "warn" ? "⚠ Review" : b.status === "info" ? "ℹ Info" : "✓ OK"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginBottom: b.recommendation ? 10 : 0 }}>
              <span style={{ fontSize: 14, color: C.textSec }}>{b.biddingStrategyType?.replace(/_/g, " ")}</span>
              {b.budget > 0 && <span style={{ fontSize: 14, color: C.textSec }}>Budget: {fmtCurrency(b.budget)}/day</span>}
              {b.targetCpa && <span style={{ fontSize: 14, color: C.textSec }}>Target CPA: {fmtCurrency(b.targetCpa)}</span>}
              {b.actualCpa && <span style={{ fontSize: 14, color: C.textSec }}>Actual CPA: {fmtCurrency(b.actualCpa)}</span>}
            </div>
            {b.recommendation && (
              <p style={{ fontSize: 15, color: C.textSec, margin: 0, lineHeight: 1.6 }}>{b.recommendation}</p>
            )}
          </div>
        ))}
      </Section>
    </>
  );
}

// ── Tab: Assets ───────────────────────────────────────────────────────────────

const ASSET_TYPES  = ["SITELINK","CALLOUT","STRUCTURED_SNIPPET","CALL","MARKETING_IMAGE"];
const ASSET_LABELS = { SITELINK: "Sitelinks", CALLOUT: "Callouts", STRUCTURED_SNIPPET: "Snippets", CALL: "Call", MARKETING_IMAGE: "Image" };

function AssetsTab({ assetAnalysis, auditLoading, pmaxData }) {
  if (auditLoading && !assetAnalysis.length) return <LoadingSpinner message="Fetching asset coverage…" />;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}
      {assetAnalysis.length > 0 && (
        <Section title="Extension Coverage by Campaign">
          <div style={{ background: C.card, borderRadius: 12, border: `1px solid ${C.border}`, overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "90px").join(" ")} 90px`, padding: "10px 16px", borderBottom: `1px solid ${C.border}`, minWidth: 580 }}>
              <span style={{ fontSize: 13, color: C.textSec, fontWeight: 700 }}>Campaign</span>
              {ASSET_TYPES.map((t) => <span key={t} style={{ fontSize: 12, color: C.textSec, textAlign: "center" }}>{ASSET_LABELS[t]}</span>)}
              <span style={{ fontSize: 13, color: C.textSec, textAlign: "center" }}>Score</span>
            </div>
            {assetAnalysis.map((a, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "90px").join(" ")} 90px`, padding: "13px 16px", borderBottom: `1px solid ${C.border}`, gap: 4, alignItems: "center", minWidth: 580 }}>
                <p style={{ fontSize: 15, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.campaignName}>{a.campaignName}</p>
                {ASSET_TYPES.map((type) => (
                  <span key={type} style={{ fontSize: 16, textAlign: "center" }}>{a.presentTypes.includes(type) ? "✅" : "❌"}</span>
                ))}
                <span style={{ fontSize: 15, fontWeight: 700, textAlign: "center", color: a.coverageScore >= 0.8 ? C.teal : a.coverageScore >= 0.6 ? C.amber : C.accent }}>
                  {Math.round(a.coverageScore * 100)}%
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {pmaxData && pmaxData.length > 0 && (
        <Section title={`Performance Max (${pmaxData.length} campaign${pmaxData.length > 1 ? "s" : ""})`}>
          {pmaxData.map((p, i) => (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px", marginBottom: 12 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                <p style={{ fontSize: 16, fontWeight: 700, color: C.textPri, margin: 0 }}>{p.campaignName}</p>
                <span style={{ fontSize: 14, color: p.hasBrandExclusion ? C.teal : C.accent, fontWeight: 700 }}>
                  {p.hasBrandExclusion ? "✓ Brand excluded" : "⚠ No brand exclusion"}
                </span>
              </div>
              <p style={{ fontSize: 15, color: C.textSec, margin: "0 0 10px" }}>
                {p.assetGroupCount} asset group{p.assetGroupCount !== 1 ? "s" : ""} · {fmtCurrency(p.cost)} spend · {(p.conversions || 0).toFixed(1)} conv
              </p>
              {p.flags.map((flag, fi) => (
                <p key={fi} style={{ fontSize: 15, color: C.accent, margin: "3px 0" }}>⚠ {flag}</p>
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
    if (auditLoading) return (
      <>
        <AuditLoadingBanner />
        <p style={{ fontSize: 16, color: C.textSec, textAlign: "center", marginTop: 20 }}>Partial results shown — deep audit loading…</p>
      </>
    );
    return <p style={{ fontSize: 16, color: C.textSec, textAlign: "center", marginTop: 40 }}>No issues detected — account looks healthy.</p>;
  }

  return (
    <div>
      {auditLoading && <AuditLoadingBanner />}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "14px 20px", marginBottom: 24 }}>
        <p style={{ fontSize: 15, color: C.textSec, margin: 0 }}>
          Sorted by <strong style={{ color: "#fff" }}>ICE score</strong> (Impact × Confidence × Ease). Do red items today.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(480px,1fr))", gap: 14 }}>
        {actions.map((a, i) => {
          const priority = a.ice >= 500 ? { color: C.accent, label: "DO TODAY" } : a.ice >= 200 ? { color: C.amber, label: "THIS WEEK" } : { color: C.teal, label: "THIS MONTH" };
          return (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: priority.color, background: `${priority.color}18`, border: `1px solid ${priority.color}40`, borderRadius: 4, padding: "3px 9px" }}>{priority.label}</span>
                <span style={{ fontSize: 13, fontWeight: 700, color: C.textSec, background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "3px 9px" }}>{a.category}</span>
                <span style={{ fontSize: 13, color: C.textSec, marginLeft: "auto" }}>ICE {a.ice}</span>
              </div>
              <p style={{ fontSize: 16, fontWeight: 600, color: C.textPri, margin: "0 0 10px", lineHeight: 1.5 }}>{a.issue}</p>
              <p style={{ fontSize: 15, color: C.textSec, margin: "0 0 12px", lineHeight: 1.6 }}>{a.fix}</p>
              {a.examples?.length > 0 && (
                <ul style={{ margin: "0 0 12px", paddingLeft: 16, listStyle: "none" }}>
                  {a.examples.map((ex, ei) => (
                    <li key={ei} style={{ fontSize: 14, color: "rgba(255,255,255,0.5)", padding: "3px 0", display: "flex", gap: 8, alignItems: "baseline" }}>
                      <span style={{ color: C.accent, flexShrink: 0 }}>▸</span>
                      <span style={{ fontFamily: "monospace" }}>{ex}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.3)", margin: 0 }}>📍 {a.path}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── AI Insight helpers ────────────────────────────────────────────────────────

function buildAuditPayload(audit, accountName, customerId, dateRange) {
  const { summary, campaigns, keywords, searchTerms, bidding, assets, pmaxData, structure, adStrength } = audit;
  const toDollars = (micros) => (micros == null ? null : Math.round((micros || 0) / 1_000_000));
  return {
    accountName,
    customerId,
    dateRange,
    currency: 'USD',
    unitsNote: 'All cost, CPA, and budget values are in whole US dollars.',
    summary: {
      totalCost: toDollars(summary.totalCost),
      totalConversions: summary.totalConversions,
      blendedCPA: toDollars(summary.blendedCPA),
      lrRatio: summary.lrRatio,
      optimizationScore: summary.optimizationScore,
    },
    structure,
    campaigns: campaigns.map((c) => ({
      campaignName: c.campaignName,
      verdict: c.verdict?.key,
      cost: toDollars(c.cost),
      conversions: c.conversions,
      cpa: toDollars(c.cpa),
      biddingStrategyType: c.biddingStrategyType,
      searchBudgetLostImpressionShare: c.searchBudgetLostImpressionShare,
      searchRankLostImpressionShare: c.searchRankLostImpressionShare,
    })),
    keywords: keywords ? {
      weightedAvgQS: keywords.weightedAvgQS,
      totalWithQS: keywords.totalWithQS,
      qs1to3Count: keywords.qs1to3.length,
      qs4to6Count: keywords.qs4to6.length,
      qs7to10Count: keywords.qs7to10.length,
      matchTypeSpend: keywords.matchTypeSpend,
      bottom10: keywords.bottom10?.slice(0, 10).map((k) => ({ text: k.text, matchType: k.matchType, qualityScore: k.qualityScore, cost: toDollars(k.cost) })),
      topByConversions: keywords.topByConversions?.slice(0, 10).map((k) => ({ text: k.text, matchType: k.matchType, qualityScore: k.qualityScore, conversions: k.conversions, cost: toDollars(k.cost) })),
      componentBreakdown: keywords.componentBreakdown,
    } : null,
    searchTerms: searchTerms ? {
      wasteRatio: searchTerms.wasteRatio,
      totalWastedCost: toDollars(searchTerms.totalWastedCost),
      topWasted: searchTerms.wasted?.slice(0, 10).map((t) => ({ term: t.term, cost: toDollars(t.cost) })),
      topConverting: searchTerms.winners?.slice(0, 10).map((t) => ({ term: t.term, conversions: t.conversions, cost: toDollars(t.cost) })),
    } : null,
    bidding: bidding?.slice(0, 15).map((b) => ({
      campaignName: b.campaignName,
      biddingStrategyType: b.biddingStrategyType,
      targetCpa: toDollars(b.targetCpa),
      actualCpa: toDollars(b.actualCpa),
      budget: toDollars(b.budget),
      status: b.status,
    })),
    adStrength: adStrength ? {
      distribution: adStrength.distribution,
      underHeadlinedCount: adStrength.underHeadlined?.length,
      pinnedCount: adStrength.pinnedCount,
    } : null,
    assets: assets?.slice(0, 15).map((a) => ({
      campaignName: a.campaignName,
      presentTypes: a.presentTypes,
      coverageScore: a.coverageScore,
    })),
    pmaxData: pmaxData?.map((p) => ({
      campaignName: p.campaignName,
      hasBrandExclusion: p.hasBrandExclusion,
      assetGroupCount: p.assetGroupCount,
      cost: toDollars(p.cost),
      conversions: p.conversions,
      flags: p.flags,
    })),
  };
}

function ClientSummaryCard({ summary }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ background: C.card, border: "1px solid rgba(78,204,163,0.25)", borderRadius: 12, padding: "24px" }}>
      <p style={{ fontSize: 18, color: C.textPri, margin: "0 0 16px", lineHeight: 1.8 }}>{summary}</p>
      <button
        onClick={() => { navigator.clipboard.writeText(summary).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }); }}
        style={{ fontSize: 14, fontWeight: 700, color: copied ? C.teal : C.textSec, background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 6, padding: "7px 16px", cursor: "pointer" }}
      >
        {copied ? "✓ Copied!" : "Copy"}
      </button>
    </div>
  );
}

// ── Tab: AI Insight ───────────────────────────────────────────────────────────

function AIInsightTab({ aiInsight, aiLoading, aiError, onRunAnalysis, auditReady }) {
  if (aiLoading) return <LoadingSpinner message="Claude is analyzing your account — this takes 15–30 seconds…" />;

  if (!aiInsight) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 20px", gap: 24, maxWidth: 600, margin: "0 auto", textAlign: "center" }}>
        <div style={{ fontSize: 50 }}>🤖</div>
        <div>
          <p style={{ fontSize: 20, fontWeight: 700, color: C.textPri, margin: "0 0 12px" }}>AI-Powered Account Audit</p>
          <p style={{ fontSize: 16, color: C.textSec, margin: 0, lineHeight: 1.7 }}>
            Claude will score this account across 9 pillars (Quality Score, Match Types, Search Terms, Bidding, Ad Strength, Assets, Structure, Budget Efficiency, PMax), assign an overall grade, surface campaign-level insights, and return prioritized recommendations specific to your data.
          </p>
        </div>
        {aiError && (
          <div style={{ background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.3)", borderRadius: 8, padding: "14px 18px", fontSize: 15, color: C.accent }}>
            Error: {aiError}
          </div>
        )}
        <button
          onClick={onRunAnalysis}
          disabled={!auditReady}
          style={{
            background: auditReady ? C.accent : "rgba(255,255,255,0.1)",
            color: auditReady ? "#fff" : C.textSec,
            border: "none", borderRadius: 10, padding: "14px 32px",
            fontSize: 17, fontWeight: 700, cursor: auditReady ? "pointer" : "not-allowed",
          }}
        >
          {auditReady ? "Run AI Analysis" : "Waiting for audit data…"}
        </button>
      </div>
    );
  }

  const { executive_summary, account_grade, pillar_scores, top_3_priorities, biggest_strength, campaign_insights, recommendations, client_summary } = aiInsight;
  const gradeColor = { A: C.teal, B: "#60d394", C: C.amber, D: "#f97316", F: C.accent }[account_grade] || C.textPri;

  const PILLAR_LABELS = {
    quality_score: "Quality Score", match_types: "Match Types", search_terms: "Search Terms",
    bidding: "Bidding", ad_strength: "Ad Strength", assets: "Assets",
    account_structure: "Account Structure", budget_efficiency: "Budget Efficiency", performance_max: "PMax",
  };

  return (
    <>
      {/* Grade + executive summary */}
      <div style={{ display: "flex", gap: 20, marginBottom: 32, alignItems: "stretch", flexWrap: "wrap" }}>
        <div style={{ background: C.card, border: `2px solid ${gradeColor}60`, borderRadius: 16, padding: "28px 40px", textAlign: "center", flexShrink: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
          <p style={{ fontSize: 80, fontWeight: 900, color: gradeColor, margin: 0, lineHeight: 1 }}>{account_grade}</p>
          <p style={{ fontSize: 13, color: C.textSec, margin: "8px 0 0", textTransform: "uppercase", letterSpacing: "1.5px" }}>Account Grade</p>
        </div>
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 16, padding: "24px", flex: 1, minWidth: 280 }}>
          <p style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec, margin: "0 0 12px" }}>Executive Summary</p>
          <p style={{ fontSize: 17, color: C.textPri, margin: 0, lineHeight: 1.8 }}>{executive_summary}</p>
        </div>
      </div>

      {/* 9-Pillar scores */}
      <Section title="9-Pillar Scores">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 12 }}>
          {Object.entries(pillar_scores || {}).map(([key, p]) => {
            if (!p) return null;
            const score = p.score;
            const color = score == null ? C.textSec : score >= 8 ? C.teal : score >= 6 ? "#60d394" : score >= 4 ? C.amber : C.accent;
            return (
              <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                  <span style={{ fontSize: 14, color: C.textSec, fontWeight: 600 }}>{PILLAR_LABELS[key] || key}</span>
                  <span style={{ fontSize: 28, fontWeight: 900, color }}>{score ?? "—"}</span>
                </div>
                {score != null && (
                  <div style={{ height: 5, borderRadius: 3, background: "rgba(255,255,255,0.08)", marginBottom: 10 }}>
                    <div style={{ height: "100%", width: `${(score / 10) * 100}%`, borderRadius: 3, background: color }} />
                  </div>
                )}
                <p style={{ fontSize: 14, color: C.textSec, margin: 0, lineHeight: 1.5 }}>{p.key_takeaway}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {/* Top 3 priorities */}
      {top_3_priorities?.length > 0 && (
        <Section title="Top 3 Priorities">
          {top_3_priorities.map((priority, i) => (
            <div key={i} style={{ display: "flex", gap: 18, padding: "18px 0", borderBottom: `1px solid ${C.border}`, alignItems: "flex-start" }}>
              <span style={{ fontSize: 28, fontWeight: 900, color: i === 0 ? C.accent : i === 1 ? C.amber : C.teal, flexShrink: 0, lineHeight: 1.2 }}>{i + 1}</span>
              <p style={{ fontSize: 16, color: C.textPri, margin: 0, lineHeight: 1.7 }}>{priority}</p>
            </div>
          ))}
        </Section>
      )}

      {/* Campaign insights */}
      {campaign_insights?.length > 0 && (
        <Section title={`Campaign Insights (${campaign_insights.length})`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(420px, 1fr))", gap: 12 }}>
            {campaign_insights.map((c, i) => {
              const vColors = { SCALE: C.teal, PAUSE: "#9ca3af", OPTIMIZE: C.amber, FIX_QS: C.accent, REVIEW: C.amber };
              const vc = vColors[c.verdict] || C.textPri;
              return (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: vc, background: `${vc}18`, border: `1px solid ${vc}40`, borderRadius: 4, padding: "3px 9px", textTransform: "uppercase" }}>{c.verdict}</span>
                    <p style={{ fontSize: 16, fontWeight: 700, color: C.textPri, margin: 0 }}>{c.campaign_name}</p>
                  </div>
                  <p style={{ fontSize: 15, color: C.textSec, margin: "0 0 10px", lineHeight: 1.6 }}>{c.ai_assessment}</p>
                  <p style={{ fontSize: 14, color: C.teal, margin: 0 }}>→ {c.recommended_action}</p>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Recommendations */}
      {recommendations?.length > 0 && (
        <Section title={`${recommendations.length} Recommendations`}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(440px, 1fr))", gap: 14 }}>
            {recommendations.map((r, i) => {
              const prColors = { critical: C.accent, high: "#f97316", medium: C.amber, quick_win: C.teal };
              const rc = prColors[r.priority] || C.textPri;
              return (
                <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: "18px 20px" }}>
                  <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, fontWeight: 800, color: rc, background: `${rc}18`, border: `1px solid ${rc}40`, borderRadius: 4, padding: "3px 9px", textTransform: "uppercase" }}>{r.priority}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: C.textSec, background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "3px 9px" }}>{r.category}</span>
                  </div>
                  <p style={{ fontSize: 16, fontWeight: 600, color: C.textPri, margin: "0 0 8px", lineHeight: 1.5 }}>{r.issue}</p>
                  <p style={{ fontSize: 15, color: C.textSec, margin: "0 0 10px", lineHeight: 1.6 }}>{r.action}</p>
                  <p style={{ fontSize: 14, color: C.teal, margin: r.examples?.length ? "0 0 10px" : 0, lineHeight: 1.5 }}>Expected: {r.expected_impact}</p>
                  {r.examples?.length > 0 && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {r.examples.map((ex, ei) => (
                        <span key={ei} style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "3px 8px", fontFamily: "monospace" }}>{ex}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Biggest strength */}
      {biggest_strength && (
        <Section title="Biggest Strength">
          <div style={{ background: "rgba(78,204,163,0.08)", border: "1px solid rgba(78,204,163,0.2)", borderRadius: 12, padding: "18px 20px" }}>
            <p style={{ fontSize: 16, color: C.teal, margin: 0, lineHeight: 1.6 }}>✓ {biggest_strength}</p>
          </div>
        </Section>
      )}

      {/* Client summary */}
      {client_summary && (
        <Section title="Summary for Business Owner">
          <ClientSummaryCard summary={client_summary} />
        </Section>
      )}
    </>
  );
}

// ── Run Audit Modal ───────────────────────────────────────────────────────────

const DATE_OPTIONS = [
  { value: "LAST_7_DAYS",  label: "Last 7 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "LAST_60_DAYS", label: "Last 60 days" },
  { value: "LAST_90_DAYS", label: "Last 90 days" },
  { value: "THIS_MONTH",   label: "This month" },
  { value: "LAST_MONTH",   label: "Last month" },
  { value: "THIS_YEAR",    label: "This year" },
  { value: "CUSTOM",       label: "Custom range" },
];

function RunAuditModal({ accountName, initialRange = "LAST_30_DAYS", usage, onConfirm, onCancel }) {
  const [range,      setRange]      = useState(initialRange);
  const [start,      setStart]      = useState("");
  const [end,        setEnd]        = useState("");
  const [includeAi,  setIncludeAi]  = useState(false);
  const canConfirm   = range !== "CUSTOM" || (start && end && start <= end);
  const aiLimitReached = usage?.remaining === 0;

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}>
      <div style={{ background: C.card, border: `1px solid rgba(255,255,255,0.12)`, borderRadius: 16, padding: 28, width: 440, maxWidth: "92vw", boxShadow: "0 24px 64px rgba(0,0,0,0.6)", maxHeight: "90vh", overflowY: "auto" }}>
        <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 4px" }}>Run Audit</p>
        <h2 style={{ fontSize: 17, fontWeight: 800, color: "#fff", margin: "0 0 22px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{accountName}</h2>

        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: C.textSec, margin: "0 0 10px" }}>Choose timeframe</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 18 }}>
          {DATE_OPTIONS.map((opt) => {
            const active = range === opt.value;
            return (
              <button key={opt.value} onClick={() => setRange(opt.value)} style={{ display: "flex", alignItems: "center", gap: 10, background: active ? "rgba(233,69,96,0.1)" : "rgba(255,255,255,0.04)", border: `1px solid ${active ? "rgba(233,69,96,0.4)" : C.border}`, borderRadius: 8, padding: "9px 14px", cursor: "pointer", textAlign: "left" }}>
                <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${active ? C.accent : "rgba(255,255,255,0.25)"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  {active && <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.accent }} />}
                </span>
                <span style={{ fontSize: 13, fontWeight: 600, color: active ? "#fff" : C.textSec }}>{opt.label}</span>
              </button>
            );
          })}
        </div>

        {range === "CUSTOM" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 18 }}>
            {[["Start date", start, setStart], ["End date", end, setEnd]].map(([label, val, setter]) => (
              <div key={label}>
                <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 4px" }}>{label}</p>
                <input type="date" value={val} onChange={(e) => setter(e.target.value)}
                  style={{ width: "100%", background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 10px", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box" }} />
              </div>
            ))}
          </div>
        )}

        {/* AI Analysis toggle */}
        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 16, marginBottom: 20 }}>
          <button
            onClick={() => !aiLimitReached && setIncludeAi(!includeAi)}
            style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, background: includeAi && !aiLimitReached ? "rgba(233,69,96,0.08)" : "rgba(255,255,255,0.03)", border: `1px solid ${includeAi && !aiLimitReached ? "rgba(233,69,96,0.3)" : C.border}`, borderRadius: 10, padding: "12px 16px", cursor: aiLimitReached ? "not-allowed" : "pointer", textAlign: "left" }}>
            <div>
              <p style={{ fontSize: 14, fontWeight: 700, color: aiLimitReached ? C.textSec : "#fff", margin: 0 }}>
                🤖 Include AI Analysis
              </p>
              <p style={{ fontSize: 12, color: C.textSec, margin: "3px 0 0" }}>
                {aiLimitReached
                  ? "Daily limit reached — resets at midnight"
                  : usage
                  ? `${usage.remaining} of ${usage.limit} AI runs remaining today`
                  : "Auto-runs Claude after data loads"}
              </p>
            </div>
            <div style={{ width: 40, height: 22, borderRadius: 11, background: includeAi && !aiLimitReached ? C.accent : "rgba(255,255,255,0.15)", transition: "background 0.2s", flexShrink: 0, position: "relative" }}>
              <div style={{ width: 18, height: 18, borderRadius: "50%", background: "#fff", position: "absolute", top: 2, left: includeAi && !aiLimitReached ? 20 : 2, transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.3)" }} />
            </div>
          </button>
        </div>

        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onCancel} style={{ padding: "9px 20px", background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, fontSize: 14, color: C.textSec, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onConfirm(range, range === "CUSTOM" ? start : null, range === "CUSTOM" ? end : null, includeAi && !aiLimitReached)} disabled={!canConfirm}
            style={{ padding: "9px 24px", background: canConfirm ? C.accent : "rgba(255,255,255,0.1)", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 700, color: canConfirm ? "#fff" : C.textSec, cursor: canConfirm ? "pointer" : "not-allowed" }}>
            {includeAi && !aiLimitReached ? "Run Audit + AI" : "Run Audit"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Accounts Sidebar ──────────────────────────────────────────────────────────

function AccountsSidebar({ accounts, currentCustomerId, onSelect }) {
  const [hoveredId, setHoveredId] = useState(null);
  const GRADE_COLOR = { A: C.teal, B: "#60d394", C: C.amber, D: "#f97316", F: C.accent };

  return (
    <div style={{ width: 200, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec }}>Accounts</span>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {accounts.length === 0 ? (
          <p style={{ fontSize: 12, color: C.textSec, padding: "20px 14px", textAlign: "center", lineHeight: 1.6 }}>No accounts audited yet</p>
        ) : accounts.map((acc) => {
          const id = String(acc.customerId);
          const isActive = id === String(currentCustomerId);
          const gc = GRADE_COLOR[acc.lastGrade];
          return (
            <button key={id} onClick={() => onSelect(acc)}
              onMouseEnter={() => setHoveredId(id)} onMouseLeave={() => setHoveredId(null)}
              style={{ width: "100%", textAlign: "left", display: "block", padding: "12px 14px", border: "none", borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`, background: isActive ? "rgba(233,69,96,0.07)" : hoveredId === id ? "rgba(255,255,255,0.03)" : "transparent", cursor: "pointer", transition: "background 0.1s" }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#fff" : "rgba(255,255,255,0.8)", margin: "0 0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={acc.accountName}>{acc.accountName}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {acc.lastGrade && <span style={{ fontSize: 12, fontWeight: 800, color: gc }}>{acc.lastGrade}</span>}
                <span style={{ fontSize: 11, color: C.textSec }}>
                  {acc.lastSavedAt ? new Date(acc.lastSavedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No audits"}
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Audit History Sidebar ─────────────────────────────────────────────────────

function AuditHistorySidebar({ entries, activeId, usage, onSelect, onDelete, onRunAudit, auditLoading }) {
  const [hoveredId, setHoveredId] = useState(null);

  return (
    <div style={{ width: 240, borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column", flexShrink: 0, overflow: "hidden" }}>
      {/* Run Audit button */}
      <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
        <button onClick={onRunAudit} disabled={auditLoading}
          style={{ width: "100%", background: auditLoading ? "rgba(233,69,96,0.3)" : C.accent, border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, color: "#fff", cursor: auditLoading ? "not-allowed" : "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
          {auditLoading ? (
            <><span style={{ width: 12, height: 12, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite", display: "inline-block" }} /> Running…</>
          ) : "▶ Run Audit"}
        </button>
      </div>

      {/* History header */}
      <div style={{ padding: "10px 14px 8px", borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
        <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec }}>Audit History</span>
        {entries.length > 0 && <span style={{ fontSize: 11, background: "rgba(255,255,255,0.08)", borderRadius: 10, padding: "2px 7px", color: C.textSec }}>{entries.length}</span>}
      </div>

      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 ? (
          <p style={{ fontSize: 13, color: C.textSec, padding: "20px 14px", lineHeight: 1.7, textAlign: "center" }}>
            No saved audits yet.<br />Run an audit to get started.
          </p>
        ) : entries.map((entry) => {
          const id = String(entry._id);
          const isActive = id === activeId;
          const isHovered = id === hoveredId;
          const grade = entry.summary?.accountGrade;
          const gradeColor = { A: C.teal, B: "#60d394", C: C.amber, D: "#f97316", F: C.accent }[grade];
          const date = new Date(entry.savedAt);
          const isToday = new Date().toDateString() === date.toDateString();
          const dateStr = isToday
            ? `Today ${date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
          const rangeLabel = entry.dateLabel || (entry.dateRange || "").replace(/_/g, " ").toLowerCase();

          return (
            <div key={id} onClick={() => onSelect(entry)}
              onMouseEnter={() => setHoveredId(id)} onMouseLeave={() => setHoveredId(null)}
              style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`, cursor: "pointer", background: isActive ? "rgba(233,69,96,0.07)" : isHovered ? "rgba(255,255,255,0.03)" : "transparent", transition: "background 0.1s" }}>
              <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#fff" : "rgba(255,255,255,0.85)", margin: 0 }}>{dateStr}</p>
                  <p style={{ fontSize: 11, color: C.textSec, margin: "3px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={rangeLabel}>{rangeLabel}</p>
                  <p style={{ fontSize: 11, color: C.textSec, margin: "2px 0 0" }}>{fmtCurrency(entry.summary?.totalCost || 0)}</p>
                  {entry.email && (
                    <p style={{ fontSize: 10, color: C.textSec, opacity: 0.7, margin: "2px 0 0" }}>by {entry.email.split("@")[0]}</p>
                  )}
                </div>
                {grade ? (
                  <span style={{ fontSize: 14, fontWeight: 900, width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: `${gradeColor}18`, color: gradeColor, flexShrink: 0, marginLeft: 6 }}>{grade}</span>
                ) : (
                  <span style={{ fontSize: 11, width: 26, height: 26, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)", color: C.textSec, flexShrink: 0, marginLeft: 6 }}>—</span>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                {grade
                  ? <span style={{ fontSize: 10, fontWeight: 700, color: C.accent, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 4, padding: "2px 6px" }}>✦ AI</span>
                  : <span style={{ fontSize: 10, fontWeight: 700, color: C.textSec, background: "rgba(255,255,255,0.04)", border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px" }}>Data only</span>
                }
                {isHovered && (
                  <button onClick={(e) => { e.stopPropagation(); onDelete(id); }}
                    style={{ background: "none", border: "none", color: C.textSec, fontSize: 14, cursor: "pointer", padding: "0 2px", lineHeight: 1 }}>✕</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ padding: "10px 14px", borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        {usage ? (
          <p style={{ fontSize: 12, margin: 0, color: usage.remaining === 0 ? C.accent : usage.remaining <= 2 ? C.amber : C.textSec }}>
            {usage.remaining === 0 ? "No AI runs left today" : `${usage.remaining} / ${usage.limit} AI runs left`}
          </p>
        ) : <p style={{ fontSize: 12, margin: 0, color: C.textSec }}>—</p>}
      </div>
    </div>
  );
}

// ── Main audit page ───────────────────────────────────────────────────────────

function AuditPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const customerId = searchParams.get("customerId");
  const campaignId = searchParams.get("campaignId") || null;
  const urlDateRange  = searchParams.get("dateRange")  || "LAST_30_DAYS";
  const urlStartDate  = searchParams.get("startDate")  || null;
  const urlEndDate    = searchParams.get("endDate")    || null;

  const [accountData,     setAccountData]     = useState(null);
  const [auditData,       setAuditData]       = useState(null);
  const [auditLoading,    setAuditLoading]    = useState(false);
  const [dateRange,       setDateRange]       = useState(urlDateRange);
  const [customDates,     setCustomDates]     = useState({ startDate: urlStartDate || "", endDate: urlEndDate || "" });
  const [dateWindow,      setDateWindow]      = useState(urlDateRange === "CUSTOM" && urlStartDate && urlEndDate ? { startDate: urlStartDate, endDate: urlEndDate } : null);
  const [tab,             setTab]             = useState(0);
  const [aiInsight,       setAiInsight]       = useState(null);
  const [aiLoading,       setAiLoading]       = useState(false);
  const [aiError,         setAiError]         = useState(null);
  const [history,         setHistory]         = useState([]);
  const [historyUsage,    setHistoryUsage]    = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyVersion,  setHistoryVersion]  = useState(0);
  const [accounts,        setAccounts]        = useState([]);
  const [showRunModal,    setShowRunModal]    = useState(false);
  const [pendingAutoSave, setPendingAutoSave] = useState(false);
  const [pendingAi,       setPendingAi]       = useState(false);
  const [saving,          setSaving]          = useState(false);

  // Load account data from sessionStorage
  useEffect(() => {
    if (!customerId) return;
    try {
      const keyed = sessionStorage.getItem(`auditAccountData:${customerId}`);
      const generic = sessionStorage.getItem("auditAccountData");
      const raw = keyed || generic;
      if (raw) setAccountData(JSON.parse(raw));
    } catch {}
  }, [customerId]);

  async function doFetch(cid, dr, start, end) {
    setAuditData(null);
    setAuditLoading(true);
    setAiInsight(null);
    setAiError(null);
    setActiveHistoryId(null);
    const params = new URLSearchParams({ customerId: cid, dateRange: dr });
    if (dr === "CUSTOM" && start && end) {
      params.set("startDate", start);
      params.set("endDate", end);
    }
    try {
      const r = await fetch(`/api/googleads/audit?${params.toString()}`);
      if (!r.ok) throw new Error(r.status);
      const json = await r.json();
      if (json?.data) {
        setAuditData(json.data);
        if (json.data.dateWindow) setDateWindow(json.data.dateWindow);
      }
    } catch (err) {
      console.warn("[AuditPage]", err);
    } finally {
      setAuditLoading(false);
    }
  }

  // Fetch audit history for this account
  useEffect(() => {
    if (!customerId) return;
    fetch(`/api/googleads/audit/history?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((json) => {
        if (json?.data) setHistory(json.data);
        if (json?.usage) setHistoryUsage(json.usage);
      })
      .catch((err) => console.warn("[AuditHistory]", err));
  }, [customerId, historyVersion]);

  // Fetch accounts list from audit history
  useEffect(() => {
    fetch("/api/googleads/audit/accounts")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((json) => { if (json?.data) setAccounts(json.data); })
      .catch(() => {});
  }, [historyVersion]);

  // Auto-save (and optionally auto-run AI) after audit data loads
  useEffect(() => {
    if (pendingAutoSave && !auditLoading && audit && auditData) {
      setPendingAutoSave(false);
      const shouldRunAi = pendingAi;
      if (shouldRunAi) {
        setPendingAi(false);
        setTab(7);
        runAiAnalysis();
      } else {
        saveAudit(null);
      }
    }
  }, [pendingAutoSave, auditLoading]);

  const selectedCampaign = useMemo(() => {
    if (!campaignId || !accountData) return null;
    return (accountData.campaigns || []).find((c) => String(c.campaignId) === String(campaignId)) || null;
  }, [accountData, campaignId]);

  const accountName = accountData?.customer?.customer_client?.descriptive_name || "Account";

  function buildDateLabel(dr, dw) {
    if (dw?.startDate && dw?.endDate) {
      const fmt = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${fmt(dw.startDate)} – ${fmt(dw.endDate)}`;
    }
    const labels = { LAST_7_DAYS: "Last 7 days", LAST_30_DAYS: "Last 30 days", LAST_60_DAYS: "Last 60 days", LAST_90_DAYS: "Last 90 days", THIS_MONTH: "This month", LAST_MONTH: "Last month", THIS_YEAR: "This year" };
    return labels[dr] || dr;
  }

  function handleRunAudit(newRange, newStart, newEnd, includeAi) {
    setDateRange(newRange);
    setCustomDates({ startDate: newStart || "", endDate: newEnd || "" });
    setDateWindow(newRange === "CUSTOM" && newStart && newEnd ? { startDate: newStart, endDate: newEnd } : null);
    setShowRunModal(false);
    setPendingAutoSave(true);
    setPendingAi(!!includeAi);
    doFetch(customerId, newRange, newStart, newEnd);
  }

  async function runAiAnalysis() {
    if (!audit || !customerId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = buildAuditPayload(audit, accountName, customerId, dateRange);
      const res = await fetch("/api/claude/google-ads-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json?.data) {
        setAiInsight(json.data);
        if (json.usage) setHistoryUsage(json.usage);
        await saveAudit(json.data);
      } else if (json?.limitReached) {
        setAiError(json.error);
        if (json.usage) setHistoryUsage(json.usage);
        await saveAudit(null);
      } else {
        throw new Error("No data in response");
      }
    } catch (err) {
      console.error("[AIInsight]", err);
      setAiError(err.message);
      saveAudit(null).catch(() => {});
    } finally {
      setAiLoading(false);
    }
  }

  async function saveAudit(ai) {
    if (!audit || !customerId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/googleads/audit/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          accountName,
          dateRange,
          dateWindow: dateWindow || null,
          dateLabel: buildDateLabel(dateRange, dateWindow),
          auditId: activeHistoryId || null,
          summary: {
            totalCost: audit.summary.totalCost,
            blendedCPA: audit.summary.blendedCPA,
            lrRatio: audit.summary.lrRatio,
            totalConversions: audit.summary.totalConversions,
            accountGrade: ai?.account_grade ?? aiInsight?.account_grade ?? null,
          },
          aiInsight: ai ?? aiInsight ?? null,
        }),
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.id) setActiveHistoryId(String(json.id));
      }
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      console.error("[saveAudit]", err);
    } finally {
      setSaving(false);
    }
  }

  async function loadHistoryEntry(entry) {
    const id = String(entry._id);
    setActiveHistoryId(id);
    if (!entry.summary?.accountGrade) return;
    try {
      const res = await fetch(`/api/googleads/audit/history?id=${id}`);
      const json = await res.json();
      if (json?.data?.aiInsight) {
        setAiInsight(json.data.aiInsight);
        setTab(7);
      }
    } catch (err) {
      console.error("[loadHistoryEntry]", err);
    }
  }

  async function deleteHistoryEntry(id) {
    try {
      await fetch(`/api/googleads/audit/history?id=${id}`, { method: "DELETE" });
      if (id === activeHistoryId) setActiveHistoryId(null);
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      console.error("[deleteHistoryEntry]", err);
    }
  }

  function handleAccountSelect(acc) {
    const id = String(acc.customerId);
    if (id === String(customerId)) return;
    try {
      const stored = sessionStorage.getItem(`auditAccountData:${id}`);
      if (stored) sessionStorage.setItem("auditAccountData", stored);
    } catch {}
    router.push(`/dashboard/google/ads/audit?customerId=${id}`);
  }

  const audit = useMemo(
    () => (accountData ? runAudit(accountData, auditData, campaignId) : null),
    [accountData, auditData, campaignId]
  );

  if (!accountData) {
    return (
      <div style={{ height: "100vh", background: C.bg, display: "flex" }}>
        <AccountsSidebar accounts={accounts} currentCustomerId={customerId} onSelect={handleAccountSelect} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
          <p style={{ fontSize: 14, color: C.textSec, margin: 0 }}>No account data loaded for this account.</p>
          <button onClick={() => router.push("/dashboard/google/ads")}
            style={{ background: C.accent, border: "none", borderRadius: 8, padding: "9px 20px", fontSize: 13, fontWeight: 700, color: "#fff", cursor: "pointer" }}>
            Go to Google Ads →
          </button>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      </div>
    );
  }

  const dateLabel = buildDateLabel(dateRange, dateWindow);

  return (
    <div style={{ height: "100vh", background: C.bg, color: C.textPri, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* ── Top bar ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 28px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <button onClick={() => router.back()} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: C.textSec, cursor: "pointer" }}>
          ← Back
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 3px" }}>
            {selectedCampaign ? "CAMPAIGN AUDIT" : "ACCOUNT AUDIT"}
          </p>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {selectedCampaign ? selectedCampaign.campaignName : accountName}
          </h1>
        </div>
        {dateWindow && (
          <div style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: C.textSec, whiteSpace: "nowrap" }}>
            {dateLabel}
          </div>
        )}
        {audit && (
          <div style={{ display: "flex", gap: 22, alignItems: "center" }}>
            {audit.summary.criticalCount > 0 && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: C.accent, margin: 0 }}>{audit.summary.criticalCount}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>Critical</p>
              </div>
            )}
            {audit.summary.warningCount > 0 && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 22, fontWeight: 800, color: C.amber, margin: 0 }}>{audit.summary.warningCount}</p>
                <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>Warnings</p>
              </div>
            )}
            {(auditLoading || saving) && <span style={{ fontSize: 12, color: C.amber }}>{saving ? "● saving…" : "● loading…"}</span>}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <AccountsSidebar accounts={accounts} currentCustomerId={customerId} onSelect={handleAccountSelect} />
        <AuditHistorySidebar
          entries={history}
          activeId={activeHistoryId}
          usage={historyUsage}
          auditLoading={auditLoading}
          onSelect={loadHistoryEntry}
          onDelete={deleteHistoryEntry}
          onRunAudit={() => setShowRunModal(true)}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {/* Tab bar */}
          <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={{ flexShrink: 0, padding: "13px 16px", fontSize: 14, fontWeight: 600, background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", color: tab === i ? C.textPri : C.textSec, borderBottom: `2px solid ${tab === i ? C.accent : "transparent"}`, transition: "all 0.15s" }}>
                {t}
                {auditLoading && (i === 2 || i === 4 || i === 5) && <span style={{ marginLeft: 5, fontSize: 9, color: C.amber }}>●</span>}
                {aiLoading && i === 7 && <span style={{ marginLeft: 5, fontSize: 9, color: C.accent }}>●</span>}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div style={{ flex: 1, overflowY: "auto" }}>
            {audit ? (
              <div style={{ padding: "28px 32px", maxWidth: 1100, margin: "0 auto" }}>
                {tab === 0 && <OverviewTab audit={audit} auditLoading={auditLoading} />}
                {tab === 1 && <CampaignsTab campaigns={audit.campaigns} />}
                {tab === 2 && <KeywordsTab keywordAnalysis={audit.keywords} auditLoading={auditLoading} />}
                {tab === 3 && <SearchTermsTab searchTerms={audit.searchTerms} />}
                {tab === 4 && <BiddingTab biddingAudits={audit.bidding} auditLoading={auditLoading} />}
                {tab === 5 && <AssetsTab assetAnalysis={audit.assets} auditLoading={auditLoading} pmaxData={audit.pmaxData} />}
                {tab === 6 && <ActionPlanTab actions={audit.actionPlan} auditLoading={auditLoading} />}
                {tab === 7 && <AIInsightTab aiInsight={aiInsight} aiLoading={aiLoading} aiError={aiError} onRunAnalysis={runAiAnalysis} auditReady={!!audit && !auditLoading} />}
              </div>
            ) : auditLoading ? (
              <LoadingSpinner message="Running audit…" />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, padding: 60 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>📊</div>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.textPri, margin: 0 }}>No audit data yet</p>
                <p style={{ fontSize: 14, color: C.textSec, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
                  Click <strong style={{ color: "#fff" }}>▶ Run Audit</strong> in the sidebar to fetch live data for this account.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      {showRunModal && (
        <RunAuditModal
          accountName={selectedCampaign ? selectedCampaign.campaignName : accountName}
          initialRange={dateRange}
          usage={historyUsage}
          onConfirm={handleRunAudit}
          onCancel={() => setShowRunModal(false)}
        />
      )}
    </div>
  );
}

export default function AuditPage() {
  return (
    <Suspense fallback={
      <div style={{ minHeight: "100vh", background: "#0f0f17", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "rgba(255,255,255,0.4)", fontSize: 14 }}>Loading…</p>
      </div>
    }>
      <AuditPageInner />
    </Suspense>
  );
}
