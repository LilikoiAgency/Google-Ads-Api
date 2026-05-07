"use client";
export const dynamic = 'force-dynamic';
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  conversionTracking: "Conversion Tracking",
  wastedSpend:        "Wasted Spend",
  accountStructure:   "Account Structure",
  keywords:           "Keywords",
  ads:                "Ads",
  settings:           "Settings",
};

const CATEGORY_INFO = {
  conversionTracking: "Checks gtag/GA4 setup, Enhanced Conversions, Consent Mode v2, attribution model (data-driven preferred), conversion lag patterns, and primary vs. secondary action mapping.",
  wastedSpend:        "Audits search term irrelevance, negative keyword coverage (shared lists + campaign-level), broad match without Smart Bidding, brand/non-brand separation, and geographic spend waste.",
  accountStructure:   "Reviews campaign organisation logic, ad group theme tightness (≤20 keywords), RSA count per ad group, PMax asset group setup, brand exclusions, and SKAG detection.",
  keywords:           "Evaluates match type strategy, Quality Score distribution (target avg ≥7), keyword cannibalization across campaigns, and impression share gaps for top keywords.",
  ads:                "Checks RSA headline count (≥8), description count (≥3), ad strength rating, pin overuse, and extension coverage (sitelinks ≥4, callouts ≥4, structured snippets, images).",
  settings:           "Flags deprecated ECPC bidding, budget-limited campaigns, location targeting mode ('Presence or Interest' = fail), Search Partners review, and ad schedule alignment.",
};

const STATUS_ICON  = { PASS: "✓", WARNING: "⚠", FAIL: "✗" };
const STATUS_COLOR = { PASS: "#15803d", WARNING: "#b45309", FAIL: "#dc2626" };
const STATUS_BG    = { PASS: "#f0fdf4", WARNING: "#fffbeb", FAIL: "#fef2f2" };
const EFFORT_COLOR = { low: "#15803d", medium: "#b45309", high: "#dc2626" };

function scoreColor(s) {
  return s >= 75 ? "#15803d" : s >= 50 ? "#b45309" : "#dc2626";
}
function gradeColor(g) {
  if (g === "A") return "#15803d";
  if (g === "B") return "#1d4ed8";
  if (g === "C") return "#b45309";
  return "#dc2626";
}
function safeGet(k)    { try { return sessionStorage.getItem(k); }    catch { return null; } }
function safeSet(k, v) { try { sessionStorage.setItem(k, v); }        catch {} }
function safeRemove(k) { try { sessionStorage.removeItem(k); }        catch {} }

// ─── small components ──────────────────────────────────────────────────────────

function Skeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <style>{`@keyframes deepPulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
      <div style={{ height: 220, background: "#e8efff", borderRadius: 20, animation: "deepPulse 1.5s ease-in-out infinite" }} />
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0,1,2,3,4,5].map((i) => (
            <div key={i} style={{ height: 56, background: "#f1f5f9", borderRadius: 12, animation: "deepPulse 1.5s ease-in-out infinite", animationDelay: `${i*0.08}s` }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ height: 72, background: "#f1f5f9", borderRadius: 12, animation: "deepPulse 1.5s ease-in-out infinite", animationDelay: `${i*0.1+0.3}s` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function CategoryBar({ name, score, weight }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
      <div style={{ width: 160, fontSize: 13, color: "#374151", fontWeight: 600, flexShrink: 0 }}>
        {CATEGORY_LABELS[name]}
        <span style={{ fontSize: 11, color: "#9ca3af", marginLeft: 5 }}>{weight}%</span>
      </div>
      <div style={{ flex: 1, height: 10, background: "#e5e7eb", borderRadius: 5, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${score}%`, background: color, borderRadius: 5, transition: "width 0.6s ease" }} />
      </div>
      <div style={{ width: 36, fontSize: 14, fontWeight: 800, color, textAlign: "right", flexShrink: 0 }}>{score}</div>
    </div>
  );
}

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(finding.status !== "PASS");
  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      style={{ cursor: "pointer", borderRadius: 10, padding: "10px 12px", marginBottom: 6, background: STATUS_BG[finding.status], border: `1px solid ${STATUS_COLOR[finding.status]}33`, transition: "box-shadow 0.15s" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 14, fontWeight: 800, color: STATUS_COLOR[finding.status], flexShrink: 0 }}>{STATUS_ICON[finding.status]}</span>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#111827", flex: 1 }}>{finding.label}</span>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{expanded ? "▲" : "▼"}</span>
      </div>
      {expanded && finding.detail && (
        <p style={{ fontSize: 12, color: "#6b7280", margin: "8px 0 0 24px", lineHeight: 1.6 }}>{finding.detail}</p>
      )}
    </div>
  );
}

function CategorySection({ name, category }) {
  const findings = category.findings || [];
  const hasIssues = findings.some((f) => f.status !== "PASS");
  const [open, setOpen] = useState(hasIssues);
  if (findings.length === 0) return null;
  return (
    <div style={{ marginBottom: 18 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", background: "none", border: "none", borderBottom: "1px solid #f3f4f6", cursor: "pointer", padding: "8px 0", marginBottom: open ? 10 : 0 }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {CATEGORY_LABELS[name]}
          </span>
          <span style={{ fontSize: 11, fontWeight: 700, color: scoreColor(category.score) }}>{category.score}/100</span>
          <span style={{ fontSize: 11, color: "#9ca3af" }}>
            {findings.filter((f) => f.status === "FAIL").length > 0 && `${findings.filter((f) => f.status === "FAIL").length} fail`}
            {findings.filter((f) => f.status === "FAIL").length > 0 && findings.filter((f) => f.status === "WARNING").length > 0 && " · "}
            {findings.filter((f) => f.status === "WARNING").length > 0 && `${findings.filter((f) => f.status === "WARNING").length} warn`}
          </span>
        </div>
        <span style={{ fontSize: 11, color: "#9ca3af" }}>{open ? "▲" : "▼"}</span>
      </button>
      {open && findings.map((f) => <FindingRow key={f.label} finding={f} />)}
    </div>
  );
}

// ─── info modal ───────────────────────────────────────────────────────────────

function InfoModal({ onClose }) {
  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "#fff", borderRadius: 20, padding: 32, maxWidth: 560, width: "100%", maxHeight: "80vh", overflowY: "auto", boxShadow: "0 24px 80px rgba(0,0,0,0.2)" }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6366f1", margin: "0 0 4px" }}>About this report</p>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: "#111827", margin: 0 }}>80-Check Audit Framework</h2>
          </div>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, color: "#6b7280", flexShrink: 0 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, margin: "0 0 20px" }}>
          Claude evaluates your account against 80 structured checks across 6 weighted categories, then scores each category 0–100. The overall Health Score is a weighted average. Findings are marked PASS, WARNING, or FAIL based on established Google Ads best practices.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {Object.entries(CATEGORY_INFO).map(([key, desc]) => {
            const weight = { conversionTracking: 25, wastedSpend: 20, accountStructure: 15, keywords: 15, ads: 15, settings: 10 }[key];
            return (
              <div key={key} style={{ borderRadius: 12, padding: "14px 16px", background: "#f8faff", border: "1px solid #e0e7ff" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{CATEGORY_LABELS[key]}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.1)", borderRadius: 6, padding: "2px 7px" }}>{weight}%</span>
                </div>
                <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>{desc}</p>
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 20, padding: "14px 16px", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 12 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "#92400e", margin: "0 0 4px" }}>Grade thresholds</p>
          <p style={{ fontSize: 12, color: "#92400e", margin: 0 }}>A ≥90 · B ≥75 · C ≥60 · D ≥45 · F &lt;45</p>
        </div>
      </div>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

function DeepAnalysisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const customerId = searchParams.get("customerId") || "";

  const [campaigns, setCampaigns] = useState([]);
  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const abortRef = useRef(null);

  const cacheKey = `deepAnalysis:${customerId}:${new Date().toISOString().slice(0, 10)}`;

  // Load campaigns from sessionStorage
  useEffect(() => {
    if (!customerId) return;
    try {
      const raw = sessionStorage.getItem(`deepAnalysisCampaigns:${customerId}`);
      if (raw) setCampaigns(JSON.parse(raw));
    } catch {}
  }, [customerId]);

  async function runAnalysis(skipCache = false) {
    if (!customerId) return;
    if (!skipCache) {
      const cached = safeGet(cacheKey);
      if (cached) {
        try { setResult(JSON.parse(cached)); setStatus("done"); return; } catch {}
      }
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus("loading");
    setResult(null);
    setErrorMsg("");
    try {
      const auditRes = await fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal });
      const auditJson = auditRes.ok ? await auditRes.json() : { data: {} };
      const auditData = auditJson.data || {};

      const campaignsToSend = (() => {
        try {
          const raw = sessionStorage.getItem(`deepAnalysisCampaigns:${customerId}`);
          return raw ? JSON.parse(raw) : campaigns;
        } catch { return campaigns; }
      })();

      const deepRes = await fetch("/api/claude/google-deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, campaigns: campaignsToSend, auditData }),
        signal: controller.signal,
      });
      const deepJson = await deepRes.json();
      if (!deepRes.ok || deepJson.error) throw new Error(deepJson.error || `Error ${deepRes.status}`);
      safeSet(cacheKey, JSON.stringify(deepJson.data));
      setResult(deepJson.data);
      setStatus("done");
    } catch (err) {
      if (err.name === "AbortError") return;
      setErrorMsg(err.message || "Analysis failed");
      setStatus("error");
    }
  }

  function handleRerun() {
    safeRemove(cacheKey);
    runAnalysis(true);
  }

  // Auto-run on mount
  useEffect(() => {
    if (!customerId) return;
    runAnalysis();
    return () => abortRef.current?.abort();
  }, [customerId]);

  const accountName = (() => {
    try {
      const raw = sessionStorage.getItem(`auditAccountData:${customerId}`);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return d?.customer?.customer_client?.descriptive_name || null;
    } catch { return null; }
  })();

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc" }}>
      {/* Page header */}
      <div style={{ background: "#fff", borderBottom: "1px solid #e5e7eb", padding: "0 32px", position: "sticky", top: 0, zIndex: 10 }}>
        <div style={{ maxWidth: 1200, margin: "0 auto", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <button
              onClick={() => router.back()}
              style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 700, color: "#6b7280", background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
              Back
            </button>
            <div style={{ width: 1, height: 20, background: "#e5e7eb" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(99,102,241,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
                </svg>
              </div>
              <div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>Deep Analysis</span>
                {accountName && <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>{accountName}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {status === "done" && (
              <button
                onClick={handleRerun}
                style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.25)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", transition: "background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(99,102,241,0.15)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(99,102,241,0.08)"}
              >
                ↺ Re-run
              </button>
            )}
            <button
              onClick={() => setShowInfo(true)}
              title="About this analysis"
              style={{ width: 32, height: 32, borderRadius: "50%", background: "#f3f4f6", border: "1px solid #e5e7eb", cursor: "pointer", fontSize: 14, fontWeight: 800, color: "#6b7280", display: "flex", alignItems: "center", justifyContent: "center", transition: "background 0.15s" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "#e5e7eb"}
              onMouseLeave={(e) => e.currentTarget.style.background = "#f3f4f6"}
            >
              ℹ
            </button>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div style={{ maxWidth: 1200, margin: "0 auto", padding: "32px 32px 64px" }}>
        {status === "loading" && <Skeleton />}

        {status === "error" && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <div style={{ fontSize: 40, marginBottom: 16 }}>⚠</div>
            <p style={{ fontSize: 15, color: "#374151", fontWeight: 600, marginBottom: 8 }}>Analysis failed</p>
            <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 24 }}>{errorMsg}</p>
            <button
              onClick={handleRerun}
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "#6366f1", border: "none", borderRadius: 10, padding: "10px 24px", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        )}

        {!customerId && status === "idle" && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <p style={{ fontSize: 15, color: "#6b7280" }}>No account selected. Go back and select an account first.</p>
          </div>
        )}

        {status === "done" && result && (
          <>
            {/* Score hero */}
            <div style={{ background: "linear-gradient(135deg,#eef2ff 0%,#fff 60%)", border: "1px solid #c7d2fe", borderRadius: 24, padding: "36px 40px", marginBottom: 32, display: "flex", alignItems: "center", gap: 48 }}>
              {/* Score + grade */}
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, justifyContent: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 80, fontWeight: 900, color: scoreColor(result.healthScore), lineHeight: 1 }}>{result.healthScore}</span>
                  <span style={{ fontSize: 14, color: "#9ca3af", fontWeight: 600 }}>/100</span>
                </div>
                <div style={{ display: "inline-block", fontSize: 28, fontWeight: 900, color: gradeColor(result.grade), background: `${gradeColor(result.grade)}15`, borderRadius: 12, padding: "4px 20px", letterSpacing: "0.02em" }}>
                  {result.grade}
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#9ca3af", margin: "10px 0 0" }}>Health Score</p>
              </div>

              {/* Divider */}
              <div style={{ width: 1, alignSelf: "stretch", background: "#c7d2fe", flexShrink: 0 }} />

              {/* Summary + category bars */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, color: "#374151", lineHeight: 1.6, margin: "0 0 20px", fontStyle: "italic" }}>{result.summary}</p>
                {Object.entries(result.categories || {}).map(([key, cat]) => (
                  <CategoryBar key={key} name={key} score={cat.score} weight={cat.weight} />
                ))}
              </div>
            </div>

            {/* Two-column content */}
            <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 24, alignItems: "start" }}>
              {/* Left: Findings */}
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                  <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", margin: 0 }}>Findings</h2>
                  <span style={{ fontSize: 11, color: "#9ca3af" }}>
                    ({Object.values(result.categories || {}).reduce((acc, c) => acc + (c.findings || []).length, 0)} checks)
                  </span>
                </div>
                <div style={{ background: "#fff", borderRadius: 16, border: "1px solid #e5e7eb", padding: "20px 24px" }}>
                  {Object.entries(result.categories || {}).map(([key, cat]) => (
                    <CategorySection key={key} name={key} category={cat} />
                  ))}
                </div>
              </div>

              {/* Right: Quick Wins + AI Insights */}
              <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
                {(result.quickWins || []).length > 0 && (
                  <div>
                    <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", margin: "0 0 16px" }}>Quick Wins</h2>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {result.quickWins.map((w) => (
                        <div key={w.action} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "14px 16px", display: "flex", gap: 12 }}>
                          <div style={{ flexShrink: 0, marginTop: 2 }}>
                            <span style={{ fontSize: 10, fontWeight: 800, color: "#fff", background: EFFORT_COLOR[w.effort] || "#6b7280", borderRadius: 6, padding: "3px 8px", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{w.effort}</span>
                          </div>
                          <div>
                            <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>{w.action}</p>
                            <p style={{ fontSize: 12, color: "#6366f1", margin: 0, fontWeight: 600 }}>{w.impact}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {(result.aiInsights || []).length > 0 && (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
                      <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "#6b7280", margin: 0 }}>AI Insights</h2>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.1)", borderRadius: 6, padding: "2px 7px" }}>Claude</span>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                      {result.aiInsights.map((ins) => (
                        <div key={ins.title} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 14, padding: "14px 16px" }}>
                          <p style={{ fontSize: 13, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>{ins.title}</p>
                          <p style={{ fontSize: 12, color: "#6b7280", margin: 0, lineHeight: 1.6 }}>{ins.detail}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </div>
  );
}

export default function DeepAnalysisPageWrapper() {
  return <Suspense fallback={null}><DeepAnalysisPage /></Suspense>;
}
