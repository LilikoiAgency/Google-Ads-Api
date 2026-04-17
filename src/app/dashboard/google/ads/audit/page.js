"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useMemo, useEffect, Suspense } from "react";
import { runAudit, fmtCurrency, fmtPct, fmtCvr } from "../../../../../lib/googleAdsAudit";

const TABS = ["Overview", "Campaigns", "Keywords", "Search Terms", "Bidding", "Assets", "Action Plan"];

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
    <div style={{ flex: 1, background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}` }}>
      <p style={{ fontSize: 10, color: C.textSec, margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color: color || C.textPri, margin: 0 }}>{value}</p>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec, margin: "0 0 12px" }}>{title}</p>
      {children}
    </div>
  );
}

function Row({ label, value, warn }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
      <span style={{ fontSize: 13, color: C.textSec }}>{label}</span>
      <span style={{ fontSize: 13, fontWeight: 600, color: warn ? C.accent : C.textPri }}>{value}</span>
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
      <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>Fetching deep audit data — keywords, bidding, assets…</p>
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
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
          <KPI label="Total Spend"    value={fmtCurrency(summary.totalCost)} />
          <KPI label="Conversions"    value={summary.totalConversions.toFixed(1)} />
          <KPI label="Blended CPA"    value={summary.blendedCPA ? fmtCurrency(summary.blendedCPA) : "—"} />
          <KPI label="L/R Ratio"      value={summary.lrRatio != null ? summary.lrRatio.toFixed(2) : (auditLoading ? "…" : "—")} color={lrColor} />
        </div>
      </Section>

      {structure && (
        <Section title="Account Structure">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            <KPI label="Campaigns"  value={structure.campaignCount} />
            <KPI label="Ad Groups"  value={structure.adGroupCount} />
            <KPI label="Keywords"   value={structure.keywordCount} />
          </div>
          {structure.avgKeywordsPerAdGroup > 0 && (
            <p style={{ fontSize: 12, color: C.textSec, margin: "10px 0 0" }}>
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
          <div style={{ background: C.card, borderRadius: 10, padding: "16px 20px", border: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 10 }}>
              <span style={{ fontSize: 32, fontWeight: 800, color: summary.optimizationScore >= 0.8 ? C.teal : summary.optimizationScore >= 0.6 ? C.amber : C.accent }}>
                {Math.round(summary.optimizationScore * 100)}%
              </span>
              <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {Object.entries(byCat).map(([key, count]) => {
            const colors = { SCALE: C.teal, OPTIMIZE: C.amber, FIX_QS: C.accent, PAUSE: "#9ca3af", REVIEW: C.amber };
            return (
              <div key={key} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 20px", textAlign: "center" }}>
                <p style={{ fontSize: 24, fontWeight: 800, color: colors[key] || C.textPri, margin: 0 }}>{count}</p>
                <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{key.replace(/_/g, " ")}</p>
              </div>
            );
          })}
        </div>
      </Section>

      {adStrength && (
        <Section title="RSA Ad Strength">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 12 }}>
            {["EXCELLENT","GOOD","AVERAGE","POOR"].map((s) => {
              const colors = { EXCELLENT: C.teal, GOOD: "#60d394", AVERAGE: C.amber, POOR: C.accent };
              return (
                <div key={s} style={{ background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, textAlign: "center" }}>
                  <p style={{ fontSize: 22, fontWeight: 800, color: colors[s], margin: 0 }}>{adStrength.distribution[s]}</p>
                  <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>{s}</p>
                </div>
              );
            })}
          </div>
          {adStrength.underHeadlined.length > 0 && (
            <p style={{ fontSize: 12, color: C.amber, margin: "0 0 6px" }}>⚠ {adStrength.underHeadlined.length} RSA{adStrength.underHeadlined.length > 1 ? "s have" : " has"} fewer than 10 headlines</p>
          )}
          {adStrength.pinnedCount > 0 && (
            <p style={{ fontSize: 12, color: C.amber, margin: 0 }}>⚠ {adStrength.pinnedCount} RSA(s) have pinned headlines — reduces optimization</p>
          )}
        </Section>
      )}

      {recommendations.length > 0 && (
        <Section title={`Google Recommendations (${recommendations.length})`}>
          {recommendations.slice(0, 5).map((r, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: C.amber, flexShrink: 0 }} />
              <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
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
          <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, marginBottom: 8, overflow: "hidden" }}>
            <button
              onClick={() => setExpanded(isOpen ? null : i)}
              style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "14px 16px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}
            >
              <Pill verdict={c.verdict} />
              <span style={{ flex: 1, fontSize: 14, fontWeight: 700, color: C.textPri }}>{c.campaignName}</span>
              <span style={{ fontSize: 13, color: C.textSec }}>{fmtCurrency(c.cost)}</span>
              <span style={{ fontSize: 13, color: C.teal, marginLeft: 12 }}>{(c.conversions || 0).toFixed(1)} conv</span>
              <span style={{ fontSize: 12, color: C.textSec, marginLeft: 8 }}>{isOpen ? "▲" : "▼"}</span>
            </button>
            {isOpen && (
              <div style={{ padding: "0 16px 14px", borderTop: `1px solid ${C.border}` }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8, marginTop: 12 }}>
                  <div><p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>CPA</p><p style={{ fontSize: 14, fontWeight: 700, color: C.textPri, margin: 0 }}>{c.cpa ? fmtCurrency(c.cpa) : "—"}</p></div>
                  <div><p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>Lost IS (Budget)</p><p style={{ fontSize: 14, fontWeight: 700, color: c.searchBudgetLostImpressionShare > 0.2 ? C.accent : C.textPri, margin: 0 }}>{fmtPct(c.searchBudgetLostImpressionShare)}</p></div>
                  <div><p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>Lost IS (Rank)</p><p style={{ fontSize: 14, fontWeight: 700, color: c.searchRankLostImpressionShare > 0.2 ? C.accent : C.textPri, margin: 0 }}>{fmtPct(c.searchRankLostImpressionShare)}</p></div>
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
  if (!keywordAnalysis) return <p style={{ color: C.textSec, fontSize: 13 }}>No keyword data available.</p>;

  const { qs1to3, qs4to6, qs7to10, totalWithQS, weightedAvgQS, matchTypeSpend, bottom10, componentBreakdown } = keywordAnalysis;
  const total = qs1to3.length + qs4to6.length + qs7to10.length;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}
      <Section title="Quality Score Distribution">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 12 }}>
          <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: C.accent, margin: 0 }}>{qs1to3.length}</p>
            <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>QS 1–3 (Poor)</p>
          </div>
          <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: C.amber, margin: 0 }}>{qs4to6.length}</p>
            <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>QS 4–6 (Average)</p>
          </div>
          <div style={{ background: C.card, borderRadius: 10, padding: "14px 16px", border: `1px solid ${C.border}`, textAlign: "center" }}>
            <p style={{ fontSize: 28, fontWeight: 800, color: C.teal, margin: 0 }}>{qs7to10.length}</p>
            <p style={{ fontSize: 11, color: C.textSec, margin: 0 }}>QS 7–10 (Good)</p>
          </div>
        </div>
        {weightedAvgQS != null && (
          <p style={{ fontSize: 13, color: C.textSec }}>
            Weighted avg QS: <strong style={{ color: weightedAvgQS >= 7 ? C.teal : weightedAvgQS >= 5 ? C.amber : C.accent }}>{weightedAvgQS}</strong> across {totalWithQS} keywords
          </p>
        )}
      </Section>

      <Section title="Match Type Spend">
        {["BROAD","PHRASE","EXACT"].map((mt) => {
          const pct = matchTypeSpend[mt] || 0;
          const color = mt === "BROAD" && pct > 0.6 ? C.accent : mt === "EXACT" ? C.teal : C.amber;
          return (
            <div key={mt} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ fontSize: 12, color: C.textSec }}>{mt}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color }}>{Math.round(pct * 100)}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,0.08)" }}>
                <div style={{ height: "100%", width: `${Math.round(pct * 100)}%`, borderRadius: 3, background: color }} />
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
              <div key={key} style={{ background: C.card, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.border}`, marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: C.textPri, margin: "0 0 8px" }}>{label}</p>
                <div style={{ display: "flex", gap: 12 }}>
                  {[["BELOW_AVERAGE", C.accent],["AVERAGE", C.amber],["ABOVE_AVERAGE", C.teal]].map(([rating, color]) => (
                    <div key={rating} style={{ flex: 1, textAlign: "center" }}>
                      <p style={{ fontSize: 18, fontWeight: 800, color, margin: 0 }}>{b[rating] || 0}</p>
                      <p style={{ fontSize: 9, color: C.textSec, margin: 0 }}>{rating.replace(/_/g, " ")}</p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </Section>
      )}

      {bottom10.length > 0 && (
        <Section title="Bottom Keywords by Quality Score">
          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "hidden" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 80px 64px 80px", padding: "8px 14px", borderBottom: `1px solid ${C.border}` }}>
              {["Keyword","Match","QS","Spend"].map((h) => <span key={h} style={{ fontSize: 10, color: C.textSec, fontWeight: 700 }}>{h}</span>)}
            </div>
            {bottom10.map((k, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 80px 64px 80px", padding: "9px 14px", borderBottom: i < bottom10.length - 1 ? `1px solid ${C.border}` : "none", alignItems: "center" }}>
                <p style={{ fontSize: 12, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={k.text}>{k.text}</p>
                <span style={{ fontSize: 11, color: C.textSec }}>{k.matchType}</span>
                <span style={{ fontSize: 13, fontWeight: 800, color: k.qualityScore <= 3 ? C.accent : k.qualityScore <= 6 ? C.amber : C.teal }}>{k.qualityScore}</span>
                <span style={{ fontSize: 11, color: C.textSec }}>{fmtCurrency(k.cost)}</span>
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
        <div style={{ background: C.card, borderRadius: 10, padding: "12px 16px", border: `1px solid ${C.border}`, marginBottom: 12 }}>
          <p style={{ fontSize: 13, color: C.textSec, margin: 0 }}>
            <strong style={{ color: wasteRatio > 0.1 ? C.accent : C.amber }}>{fmtPct(wasteRatio)}</strong> of search term spend
            ({fmtCurrency(totalWastedCost)}) went to zero-conversion queries
          </p>
        </div>
        {wasted.length === 0
          ? <p style={{ fontSize: 13, color: C.teal }}>No significant wasted spend detected.</p>
          : wasted.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.accent }}>{fmtCurrency(t.cost)}</span>
            </div>
          ))
        }
      </Section>

      <Section title="Converting Search Terms">
        {winners.length === 0
          ? <p style={{ fontSize: 13, color: C.textSec }}>No converting search terms found.</p>
          : winners.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.teal }}>{t.conversions.toFixed(1)} conv · {fmtCurrency(t.cost)}</span>
            </div>
          ))
        }
      </Section>

      {uncoveredWinners?.length > 0 && (
        <Section title="Not Covered by Exact Match">
          <div style={{ background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.2)", borderRadius: 10, padding: "12px 14px", marginBottom: 12 }}>
            <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
              These converting queries have no exact match keyword. Add them to capture intent more precisely and lower wasted spend.
            </p>
          </div>
          {uncoveredWinners.map((t, i) => (
            <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ fontSize: 13, color: C.textPri }}>{t.term}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: C.amber }}>{t.conversions.toFixed(1)} conv</span>
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
  if (!biddingAudits.length) return <p style={{ color: C.textSec, fontSize: 13 }}>No bidding data available.</p>;

  return (
    <>
      {auditLoading && <AuditLoadingBanner />}
      <Section title={`${biddingAudits.length} Campaign Bidding Configs`}>
        {biddingAudits.map((b, i) => (
          <div key={i} style={{ background: C.card, border: `1px solid ${b.status === "warn" ? "rgba(233,69,96,0.3)" : b.status === "info" ? "rgba(245,166,35,0.3)" : C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0 }}>{b.campaignName}</p>
              <span style={{ fontSize: 11, fontWeight: 700, color: b.status === "warn" ? C.accent : b.status === "info" ? C.amber : C.teal, background: b.status === "warn" ? "rgba(233,69,96,0.1)" : b.status === "info" ? "rgba(245,166,35,0.1)" : "rgba(78,204,163,0.1)", padding: "2px 8px", borderRadius: 6 }}>
                {b.status === "warn" ? "⚠ Review" : b.status === "info" ? "ℹ Info" : "✓ OK"}
              </span>
            </div>
            <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: b.recommendation ? 8 : 0 }}>
              <span style={{ fontSize: 11, color: C.textSec }}>{b.biddingStrategyType?.replace(/_/g, " ")}</span>
              {b.budget > 0 && <span style={{ fontSize: 11, color: C.textSec }}>Budget: {fmtCurrency(b.budget)}/day</span>}
              {b.targetCpa && <span style={{ fontSize: 11, color: C.textSec }}>Target CPA: {fmtCurrency(b.targetCpa)}</span>}
              {b.actualCpa && <span style={{ fontSize: 11, color: C.textSec }}>Actual CPA: {fmtCurrency(b.actualCpa)}</span>}
            </div>
            {b.recommendation && (
              <p style={{ fontSize: 12, color: C.textSec, margin: 0, lineHeight: 1.5 }}>{b.recommendation}</p>
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
          <div style={{ background: C.card, borderRadius: 10, border: `1px solid ${C.border}`, overflow: "auto" }}>
            <div style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "80px").join(" ")} 80px`, padding: "8px 14px", borderBottom: `1px solid ${C.border}`, minWidth: 560 }}>
              <span style={{ fontSize: 10, color: C.textSec, fontWeight: 700 }}>Campaign</span>
              {ASSET_TYPES.map((t) => <span key={t} style={{ fontSize: 9, color: C.textSec, textAlign: "center" }}>{ASSET_LABELS[t]}</span>)}
              <span style={{ fontSize: 10, color: C.textSec, textAlign: "center" }}>Score</span>
            </div>
            {assetAnalysis.map((a, i) => (
              <div key={i} style={{ display: "grid", gridTemplateColumns: `1fr ${ASSET_TYPES.map(() => "80px").join(" ")} 80px`, padding: "10px 14px", borderBottom: `1px solid ${C.border}`, gap: 4, alignItems: "center", minWidth: 560 }}>
                <p style={{ fontSize: 12, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={a.campaignName}>{a.campaignName}</p>
                {ASSET_TYPES.map((type) => (
                  <span key={type} style={{ fontSize: 14, textAlign: "center" }}>{a.presentTypes.includes(type) ? "✅" : "❌"}</span>
                ))}
                <span style={{ fontSize: 12, fontWeight: 700, textAlign: "center", color: a.coverageScore >= 0.8 ? C.teal : a.coverageScore >= 0.6 ? C.amber : C.accent }}>
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
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "14px 16px", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0 }}>{p.campaignName}</p>
                <span style={{ fontSize: 11, color: p.hasBrandExclusion ? C.teal : C.accent, fontWeight: 700 }}>
                  {p.hasBrandExclusion ? "✓ Brand excluded" : "⚠ No brand exclusion"}
                </span>
              </div>
              <p style={{ fontSize: 12, color: C.textSec, margin: "0 0 8px" }}>
                {p.assetGroupCount} asset group{p.assetGroupCount !== 1 ? "s" : ""} · {fmtCurrency(p.cost)} spend · {(p.conversions || 0).toFixed(1)} conv
              </p>
              {p.flags.map((flag, fi) => (
                <p key={fi} style={{ fontSize: 12, color: C.accent, margin: "2px 0" }}>⚠ {flag}</p>
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
        <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 20 }}>Partial results shown — deep audit loading…</p>
      </>
    );
    return <p style={{ fontSize: 13, color: C.textSec, textAlign: "center", marginTop: 40 }}>No issues detected — account looks healthy.</p>;
  }

  return (
    <div>
      {auditLoading && <AuditLoadingBanner />}
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
        <p style={{ fontSize: 12, color: C.textSec, margin: 0 }}>
          Sorted by <strong style={{ color: "#fff" }}>ICE score</strong> (Impact × Confidence × Ease). Do red items today.
        </p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(480px,1fr))", gap: 12 }}>
        {actions.map((a, i) => {
          const priority = a.ice >= 500 ? { color: C.accent, label: "DO TODAY" } : a.ice >= 200 ? { color: C.amber, label: "THIS WEEK" } : { color: C.teal, label: "THIS MONTH" };
          return (
            <div key={i} style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: "16px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 10, fontWeight: 800, color: priority.color, background: `${priority.color}18`, border: `1px solid ${priority.color}40`, borderRadius: 4, padding: "2px 7px" }}>{priority.label}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: C.textSec, background: "rgba(255,255,255,0.06)", borderRadius: 4, padding: "2px 7px" }}>{a.category}</span>
                <span style={{ fontSize: 10, color: C.textSec, marginLeft: "auto" }}>ICE {a.ice}</span>
              </div>
              <p style={{ fontSize: 13, fontWeight: 600, color: C.textPri, margin: "0 0 8px", lineHeight: 1.4 }}>{a.issue}</p>
              <p style={{ fontSize: 12, color: C.textSec, margin: "0 0 10px", lineHeight: 1.5 }}>{a.fix}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.25)", margin: 0 }}>📍 {a.path}</p>
            </div>
          );
        })}
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

  const [accountData, setAccountData] = useState(null);
  const [auditData,   setAuditData]   = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [tab, setTab] = useState(0);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("auditAccountData");
      if (stored) setAccountData(JSON.parse(stored));
    } catch {}
  }, []);

  useEffect(() => {
    if (!customerId) return;
    setAuditLoading(true);
    fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then((json) => { if (json?.data) setAuditData(json.data); })
      .catch((err) => console.warn("[AuditPage]", err))
      .finally(() => setAuditLoading(false));
  }, [customerId]);

  const selectedCampaign = useMemo(() => {
    if (!campaignId || !accountData) return null;
    return (accountData.campaigns || []).find((c) => String(c.campaignId) === String(campaignId)) || null;
  }, [accountData, campaignId]);

  const accountName = accountData?.customer?.customer_client?.descriptive_name || "Account";

  const audit = useMemo(
    () => (accountData ? runAudit(accountData, auditData, campaignId) : null),
    [accountData, auditData, campaignId]
  );

  if (!accountData) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: "50%", border: `3px solid rgba(255,255,255,0.1)`, borderTopColor: C.accent, animation: "spin 0.8s linear infinite" }} />
        <p style={{ color: C.textSec, fontSize: 14, margin: 0 }}>Loading audit…</p>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.textPri }}>
      {/* ── Top bar ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "16px 32px", display: "flex", alignItems: "center", gap: 16, flexShrink: 0 }}>
        <button
          onClick={() => router.back()}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, color: C.textSec, cursor: "pointer" }}
        >
          ← Back
        </button>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 2px" }}>
            {selectedCampaign ? "CAMPAIGN AUDIT" : "ACCOUNT AUDIT"}
          </p>
          <h1 style={{ fontSize: 18, fontWeight: 800, color: C.textPri, margin: 0 }}>
            {selectedCampaign ? selectedCampaign.campaignName : accountName}
          </h1>
        </div>
        {audit && (
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {audit.summary.criticalCount > 0 && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: C.accent, margin: 0 }}>{audit.summary.criticalCount}</p>
                <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>Critical</p>
              </div>
            )}
            {audit.summary.warningCount > 0 && (
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 20, fontWeight: 800, color: C.amber, margin: 0 }}>{audit.summary.warningCount}</p>
                <p style={{ fontSize: 10, color: C.textSec, margin: 0 }}>Warnings</p>
              </div>
            )}
            {auditLoading && <span style={{ fontSize: 11, color: C.amber }}>● loading deep data…</span>}
          </div>
        )}
      </div>

      {/* ── Tab bar ── */}
      <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 32px", display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            style={{
              flexShrink: 0, padding: "12px 16px", fontSize: 13, fontWeight: 600,
              background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap",
              color: tab === i ? C.textPri : C.textSec,
              borderBottom: `2px solid ${tab === i ? C.accent : "transparent"}`,
              transition: "all 0.15s",
            }}
          >
            {t}
            {auditLoading && (i === 2 || i === 4 || i === 5) && (
              <span style={{ marginLeft: 5, fontSize: 9, color: C.amber }}>●</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {audit ? (
        <div style={{ padding: "32px", maxWidth: 1100, margin: "0 auto" }}>
          {tab === 0 && <OverviewTab audit={audit} auditLoading={auditLoading} />}
          {tab === 1 && <CampaignsTab campaigns={audit.campaigns} />}
          {tab === 2 && <KeywordsTab keywordAnalysis={audit.keywords} auditLoading={auditLoading} />}
          {tab === 3 && <SearchTermsTab searchTerms={audit.searchTerms} />}
          {tab === 4 && <BiddingTab biddingAudits={audit.bidding} auditLoading={auditLoading} />}
          {tab === 5 && <AssetsTab assetAnalysis={audit.assets} auditLoading={auditLoading} pmaxData={audit.pmaxData} />}
          {tab === 6 && <ActionPlanTab actions={audit.actionPlan} auditLoading={auditLoading} />}
        </div>
      ) : (
        <LoadingSpinner message="Running audit…" />
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
