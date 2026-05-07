"use client";
export const dynamic = 'force-dynamic';
import { Suspense, useState, useEffect, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// ─── constants ────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  pixelCapi:        "Pixel / CAPI Health",
  creative:         "Creative",
  accountStructure: "Account Structure",
  audience:         "Audience & Targeting",
};

const CATEGORY_INFO = {
  pixelCapi:        "Checks Meta Pixel installation, Conversions API (CAPI) setup, event deduplication (event_id matching), Event Match Quality (EMQ ≥8.0 for Purchase), all standard events (ViewContent/AddToCart/Purchase/Lead), Aggregated Event Measurement for iOS, domain verification, and server-side customer_information parameters.",
  creative:         "Evaluates creative format diversity (≥3 formats: image/video/carousel/collection), creatives per ad set (≥5), creative fatigue signals (CTR drop >20% over 14 days), video length compliance, UGC/testimonial presence, Dynamic Creative Optimization (DCO), ad copy length, refresh cadence, and Andromeda AI Similarity Score risk.",
  accountStructure: "Reviews CBO vs ABO intent, campaign consolidation (1-3 campaigns recommended), learning phase health (<30% Learning Limited), budget per ad set (≥5× target CPA), audience overlap between ad sets (<30%), naming conventions, Advantage+ Sales Campaigns for e-commerce, and Threads placement adoption.",
  audience:         "Assesses prospecting frequency (7-day <3.0), retargeting frequency (7-day <8.0), Custom Audience coverage (website visitors, customer lists, engagement), Lookalike Audience seeds tested (1%/3%/5%), Advantage+ Audience vs manual testing, purchaser exclusions from prospecting, and location targeting precision.",
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
  if (g === "B") return "#1877F2";
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
      <style>{`@keyframes metaPulse{0%,100%{opacity:1}50%{opacity:.35}}`}</style>
      <div style={{ height: 220, background: "#dbeafe", borderRadius: 20, animation: "metaPulse 1.5s ease-in-out infinite" }} />
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: 16 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0,1,2,3].map((i) => (
            <div key={i} style={{ height: 56, background: "#f1f5f9", borderRadius: 12, animation: "metaPulse 1.5s ease-in-out infinite", animationDelay: `${i*0.08}s` }} />
          ))}
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {[0,1,2].map((i) => (
            <div key={i} style={{ height: 72, background: "#f1f5f9", borderRadius: 12, animation: "metaPulse 1.5s ease-in-out infinite", animationDelay: `${i*0.1+0.3}s` }} />
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
      <div style={{ width: 180, fontSize: 13, color: "#374151", fontWeight: 600, flexShrink: 0 }}>
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
      style={{ cursor: "pointer", borderRadius: 10, padding: "10px 12px", marginBottom: 6, background: STATUS_BG[finding.status], border: `1px solid ${STATUS_COLOR[finding.status]}33` }}
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
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#1877F2", margin: "0 0 4px" }}>About this report</p>
            <h2 style={{ fontSize: 20, fontWeight: 900, color: "#111827", margin: 0 }}>50-Check Audit Framework</h2>
          </div>
          <button onClick={onClose} style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, color: "#6b7280", flexShrink: 0 }}>✕</button>
        </div>
        <p style={{ fontSize: 13, color: "#6b7280", lineHeight: 1.6, margin: "0 0 20px" }}>
          Claude evaluates your Meta Ads account against 50 structured checks across 4 weighted categories, then scores each category 0–100. The overall Health Score is a weighted average. Findings are marked PASS, WARNING, or FAIL based on Meta best practices including Andromeda AI engine considerations (Oct 2025).
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {Object.entries(CATEGORY_INFO).map(([key, desc]) => {
            const weight = { pixelCapi: 30, creative: 30, accountStructure: 20, audience: 20 }[key];
            return (
              <div key={key} style={{ borderRadius: 12, padding: "14px 16px", background: "#eff6ff", border: "1px solid #bfdbfe" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                  <span style={{ fontSize: 13, fontWeight: 800, color: "#111827" }}>{CATEGORY_LABELS[key]}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#1877F2", background: "rgba(24,119,242,0.1)", borderRadius: 6, padding: "2px 7px" }}>{weight}%</span>
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

function MetaDeepAnalysisPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const accountId = searchParams.get("accountId") || "";
  const accountName = searchParams.get("accountName") || "";

  const [status, setStatus] = useState("idle");
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [showInfo, setShowInfo] = useState(false);
  const abortRef = useRef(null);

  const cacheKey = `metaDeepAnalysis:${accountId}:${new Date().toISOString().slice(0, 10)}`;

  async function runAnalysis(skipCache = false) {
    if (!accountId) return;
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
      const auditRes = await fetch(`/api/meta/audit?accountId=${encodeURIComponent(accountId)}`, { signal: controller.signal });
      const auditJson = auditRes.ok ? await auditRes.json() : { data: {} };
      const auditData = auditJson.data || {};

      const deepRes = await fetch("/api/claude/meta-deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, auditData }),
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

  useEffect(() => {
    if (!accountId) return;
    runAnalysis();
    return () => abortRef.current?.abort();
  }, [accountId]);

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
              <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(24,119,242,0.12)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#1877F2" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
                </svg>
              </div>
              <div>
                <span style={{ fontSize: 15, fontWeight: 800, color: "#111827" }}>Deep Analysis</span>
                {accountName && <span style={{ fontSize: 12, color: "#9ca3af", marginLeft: 8 }}>{decodeURIComponent(accountName)}</span>}
              </div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {status === "done" && (
              <button
                onClick={handleRerun}
                style={{ fontSize: 12, fontWeight: 700, color: "#1877F2", background: "rgba(24,119,242,0.08)", border: "1px solid rgba(24,119,242,0.25)", borderRadius: 8, padding: "6px 14px", cursor: "pointer", transition: "background 0.15s" }}
                onMouseEnter={(e) => e.currentTarget.style.background = "rgba(24,119,242,0.15)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "rgba(24,119,242,0.08)"}
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
              style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: "#1877F2", border: "none", borderRadius: 10, padding: "10px 24px", cursor: "pointer" }}
            >
              Try again
            </button>
          </div>
        )}

        {!accountId && status === "idle" && (
          <div style={{ textAlign: "center", padding: "80px 0" }}>
            <p style={{ fontSize: 15, color: "#6b7280" }}>No account selected. Go back and select an account first.</p>
          </div>
        )}

        {status === "done" && result && (
          <>
            {/* Score hero */}
            <div style={{ background: "linear-gradient(135deg,#eff6ff 0%,#fff 60%)", border: "1px solid #bfdbfe", borderRadius: 24, padding: "36px 40px", marginBottom: 32, display: "flex", alignItems: "center", gap: 48 }}>
              <div style={{ textAlign: "center", flexShrink: 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 12, justifyContent: "center", marginBottom: 6 }}>
                  <span style={{ fontSize: 80, fontWeight: 900, color: scoreColor(result.healthScore), lineHeight: 1 }}>{result.healthScore}</span>
                  <span style={{ fontSize: 14, color: "#9ca3af", fontWeight: 600 }}>/100</span>
                </div>
                <div style={{ display: "inline-block", fontSize: 28, fontWeight: 900, color: gradeColor(result.grade), background: `${gradeColor(result.grade)}15`, borderRadius: 12, padding: "4px 20px" }}>
                  {result.grade}
                </div>
                <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "#9ca3af", margin: "10px 0 0" }}>Health Score</p>
              </div>

              <div style={{ width: 1, alignSelf: "stretch", background: "#bfdbfe", flexShrink: 0 }} />

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
                            <p style={{ fontSize: 12, color: "#1877F2", margin: 0, fontWeight: 600 }}>{w.impact}</p>
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
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#1877F2", background: "rgba(24,119,242,0.1)", borderRadius: 6, padding: "2px 7px" }}>Claude</span>
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

export default function MetaDeepAnalysisPageWrapper() {
  return <Suspense fallback={null}><MetaDeepAnalysisPage /></Suspense>;
}
