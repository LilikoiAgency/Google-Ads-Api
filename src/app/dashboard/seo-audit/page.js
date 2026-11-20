"use client";
export const dynamic = 'force-dynamic';

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import { SEOAuditIcon } from "../components/DashboardIcons";
import ResultsView from "./ResultsView";
import ProgressSteps from "./v2/ProgressSteps";
import { useAuditJob, friendlyError } from "./v2/useAuditJob";
import AdvancedOptions, { EMPTY_ADVANCED, toRequestOptions, fromAuditOptions, bareHost } from "./v2/AdvancedOptions";
import { sameBrief } from "../../../lib/seoAuditV2/briefs";
import "../../globals.css";

// ─── Main Page ───────────────────────────────────────────────────────────────

const STEPS = { CONFIGURE: 0, PROGRESS: 1, RESULTS: 2 };

// History items that are v2 jobs still open (not saved as a finished audit yet).
const isOpenJob = (a) => Boolean(a.status) && a.status !== "done";
const JOB_BADGE = {
  queued:  { label: "Running", bg: "rgba(59,130,246,0.2)", color: "#93c5fd" },
  running: { label: "Running", bg: "rgba(59,130,246,0.2)", color: "#93c5fd" },
  failed:  { label: "Failed",  bg: "rgba(239,68,68,0.2)",  color: "#fca5a5" },
};

export default function SEOAuditPage() {
  const router = useRouter();
  const { status: authStatus } = useSession();

  // Form state
  const [domain, setDomain] = useState("");
  const [auditType, setAuditType] = useState("full");
  const [advanced, setAdvanced] = useState(EMPTY_ADVANCED);

  // Flow state
  const [step, setStep] = useState(STEPS.CONFIGURE);
  const [error, setError] = useState(null);
  const [starting, setStarting] = useState(false);

  // Data
  const [crawlData, setCrawlData] = useState(null);
  const [auditResult, setAuditResult] = useState(null);
  const [jobId, setJobId] = useState(null);

  // Corrections on the saved audit shown in the results, and "Update the plan".
  const [auditId, setAuditId] = useState(null);
  const [corrections, setCorrections] = useState([]);
  const [canReplan, setCanReplan] = useState(false);
  const [replanning, setReplanning] = useState(false);
  const [replanError, setReplanError] = useState(null);
  const shownAuditRef = useRef(null); // drops a late reply for an audit no longer shown

  // History
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingAuditId, setLoadingAuditId] = useState(null);

  // v2 job: advances while the progress view is open.
  const job = useAuditJob(step === STEPS.PROGRESS ? jobId : null);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard/seo-audit");
    }
  }, [authStatus, router]);

  function refreshHistory() {
    return fetch("/api/seo-audit/history")
      .then((res) => res.json())
      .then((data) => setHistory(data.audits || []))
      .catch(() => {});
  }

  // ── Fetch audit history on mount ───────────────────────────────────────
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    refreshHistory().finally(() => setHistoryLoading(false));
  }, [authStatus]);

  // ── Job finished: show its results ─────────────────────────────────────
  const finishedAuditId = job.progress?.auditId;
  useEffect(() => {
    if (step !== STEPS.PROGRESS || !job.result) return;
    setCrawlData(null);
    setAuditResult(job.result);
    // A just-finished job is saved with no corrections and its job data intact.
    setReview({ id: finishedAuditId || null, corrections: [], canReplan: Boolean(finishedAuditId) });
    setStep(STEPS.RESULTS);
    refreshHistory();
  }, [step, job.result, finishedAuditId]);

  function setReview({ id = null, corrections: list = [], canReplan: can = false } = {}) {
    setAuditId(id);
    shownAuditRef.current = id;
    setCorrections(list);
    setCanReplan(can);
    setReplanning(false);
    setReplanError(null);
  }

  // Add or undo a correction; both return the audit's updated corrections.
  async function saveCorrection(id, url, init, fallback) {
    let res;
    try {
      res = await fetch(url, init);
    } catch {
      throw new Error("Couldn't reach the server. Check your connection and try again.");
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(res.status === 401 ? "Your session has expired. Sign in again and retry." : body.error || fallback);
    if (shownAuditRef.current === id) setCorrections(Array.isArray(body.corrections) ? body.corrections : []);
  }

  function handleCorrect(correction) {
    return saveCorrection(auditId, `/api/seo-audit/v2/audits/${auditId}/corrections`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(correction),
    }, "Couldn't save the correction. Try again.");
  }

  function handleUndo(correctionId) {
    return saveCorrection(auditId, `/api/seo-audit/v2/audits/${auditId}/corrections/${correctionId}`, { method: "DELETE" }, "Couldn't undo. Try again.");
  }

  async function handleReplan() {
    const id = auditId;
    if (replanning || !id) return;
    setReplanning(true);
    setReplanError(null);
    let error = null;
    let result = null;
    try {
      const res = await fetch(`/api/seo-audit/v2/audits/${id}/replan`, { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.result) result = body.result;
      else if (res.status === 401) error = "Your session has expired. Sign in again and retry.";
      else if (res.status === 429) error = "The monthly usage limit is reached. Contact an admin.";
      else if (res.status === 404) error = "This audit no longer exists.";
      else error = body.error || "Updating the plan failed. Try again.";
    } catch {
      error = "Couldn't reach the server. Check your connection and try again.";
    }
    if (shownAuditRef.current !== id) return; // another audit is open now
    if (result) setAuditResult(result.version ? result : { ...result, version: 2 });
    setReplanError(error);
    setReplanning(false);
  }

  // ── Start (or reuse) a v2 audit job ────────────────────────────────────
  async function handleRunAudit(forceRerun = false) {
    const target = (domain || auditResult?.domain || "").trim();
    if (!target || starting) return;
    setError(null);
    setStarting(true);
    try {
      // The company brief is saved on its own; the job loads it when it starts.
      if (advanced.brief && advanced.briefDomain === bareHost(target) && !sameBrief(advanced.brief, advanced.briefLoaded)) {
        let saved;
        try {
          saved = await fetch("/api/seo-audit/v2/brief", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ domain: bareHost(target), brief: advanced.brief }),
          });
        } catch {
          throw new Error("Couldn't save the company brief. Check your connection and try again.");
        }
        if (!saved.ok) {
          const b = await saved.json().catch(() => ({}));
          throw new Error(b.error || "Couldn't save the company brief.");
        }
        setAdvanced((cur) => ({ ...cur, briefLoaded: cur.brief }));
      }
      let res;
      try {
        res = await fetch("/api/seo-audit/v2/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ domain: target, auditType, forceRerun, options: toRequestOptions(advanced) }),
        });
      } catch {
        throw new Error("Couldn't reach the server. Check your connection and try again.");
      }
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(friendlyError(res.status, body));
      setAuditResult(null);
      setReview();
      setCrawlData(null);
      setJobId(body.jobId);
      setStep(STEPS.PROGRESS);
      refreshHistory();
    } catch (err) {
      setError(err.message);
      setStep(STEPS.CONFIGURE);
    } finally {
      setStarting(false);
    }
  }

  function handleReset() {
    setStep(STEPS.CONFIGURE);
    setCrawlData(null);
    setAuditResult(null);
    setReview();
    setJobId(null);
    setError(null);
    setDomain("");
    setAdvanced(EMPTY_ADVANCED);
  }

  // Results -> the audit list (history), with a fresh form.
  function handleBackToAudits() {
    handleReset();
    refreshHistory();
    window.scrollTo({ top: 0 });
  }

  function handleBackFromProgress() {
    setStep(STEPS.CONFIGURE);
    setJobId(null);
    refreshHistory();
  }

  // ── Load a past audit (or resume an open job) from history ─────────────
  async function handleLoadAudit(item) {
    setError(null);
    if (isOpenJob(item)) {
      setDomain(item.domain || "");
      setAuditType(item.auditType || "full");
      setAdvanced(EMPTY_ADVANCED);
      setJobId(item.jobId || item._id);
      setStep(STEPS.PROGRESS);
      return;
    }
    const auditId = item._id;
    setLoadingAuditId(auditId);
    try {
      const res = await fetch(`/api/seo-audit/history?id=${auditId}`);
      if (!res.ok) throw new Error("Couldn't load that audit. Try again.");
      const doc = await res.json();
      setCrawlData(doc.crawlData || null);
      const result = doc.auditResult;
      setAuditResult(doc.version === 2 && result && !result.version ? { ...result, version: 2 } : result);
      setReview({ id: doc._id || auditId, corrections: Array.isArray(doc.corrections) ? doc.corrections : [], canReplan: Boolean(doc.canReplan) });
      setDomain(doc.domain || "");
      setAuditType(doc.auditType || "full");
      // "Run again" repeats the same page selection.
      setAdvanced(fromAuditOptions(result?.audit_options));
      setStep(STEPS.RESULTS);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingAuditId(null);
    }
  }

  // ── Delete a past audit ────────────────────────────────────────────────
  async function handleDeleteAudit(auditId) {
    try {
      const res = await fetch(`/api/seo-audit/history?id=${auditId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setHistory((prev) => prev.filter((a) => a._id !== auditId));
    } catch (err) {
      setError(err.message);
    }
  }

  // ── Loading / auth ─────────────────────────────────────────────────────────
  if (authStatus === "loading") {
    return <DashboardLoader label="Loading..." />;
  }

  const resultActions = (
    <div style={{ display: "flex", gap: 10 }}>
      <button
        onClick={() => handleRunAudit(true)}
        disabled={starting}
        style={{ padding: "8px 14px", borderRadius: 8, background: "var(--panel-2)", border: "1px solid var(--line)", color: "var(--ink)", fontSize: 13, fontWeight: 600, cursor: "pointer", opacity: starting ? 0.6 : 1, fontFamily: "inherit" }}
      >
        {starting ? "Starting..." : "Re-run Audit"}
      </button>
      <button
        onClick={handleReset}
        style={{ padding: "8px 14px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink)", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}
      >
        New Audit
      </button>
    </div>
  );

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader
        icon={<SEOAuditIcon />}
        title="SEO / GEO / AEO Audit"
        subtitle="Site audit with a prioritized action plan"
      />

      <div className={step === STEPS.RESULTS ? "mx-auto w-full max-w-[1600px] px-6 py-8" : "mx-auto max-w-5xl px-6 py-10"}>
        {/* ── Step 0: Configure ──────────────────────────────────────────── */}
        {step === STEPS.CONFIGURE && (
          <div style={{ maxWidth: 640, margin: "0 auto" }}>

            {/* Hero card */}
            <div style={{
              background: "linear-gradient(135deg, #0f3460 0%, #1a1a4e 50%, #2d1b69 100%)",
              borderRadius: 20,
              padding: "40px 36px 36px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
              position: "relative",
              overflow: "hidden",
              marginBottom: 24,
            }}>
              {/* Decorative background elements */}
              <div style={{ position: "absolute", top: -30, right: -30, width: 140, height: 140, borderRadius: "50%", background: "rgba(255,255,255,0.03)" }} />
              <div style={{ position: "absolute", bottom: -20, left: -20, width: 100, height: 100, borderRadius: "50%", background: "rgba(255,255,255,0.02)" }} />

              {/* Icon + title row */}
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 8, position: "relative" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.1)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="11" cy="11" r="7" stroke="#5eead4" strokeWidth="2"/>
                    <line x1="16" y1="16" x2="21" y2="21" stroke="#5eead4" strokeWidth="2.5" strokeLinecap="round"/>
                    <rect x="8" y="12" width="2" height="4" rx="0.5" fill="#fbbf24" opacity="0.9"/>
                    <rect x="10.5" y="10" width="2" height="6" rx="0.5" fill="#5eead4" opacity="0.9"/>
                    <rect x="13" y="8" width="2" height="8" rx="0.5" fill="#a78bfa" opacity="0.9"/>
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: 24, fontWeight: 800, color: "#fff", lineHeight: 1.2 }}>SEO Audit</h2>
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>SEO + GEO + AEO analysis with a ranked action plan</p>
                </div>
              </div>

              {/* Score pills row */}
              <div style={{ display: "flex", gap: 8, marginBottom: 28, marginTop: 16, position: "relative" }}>
                {[
                  { label: "SEO", color: "#0d9488", desc: "Search Engine Optimization" },
                  { label: "GEO", color: "#6366f1", desc: "Generative Engine Optimization" },
                  { label: "AEO", color: "#f59e0b", desc: "Answer Engine Optimization" },
                ].map((s) => (
                  <div key={s.label} style={{
                    padding: "6px 14px",
                    borderRadius: 20,
                    background: `${s.color}20`,
                    border: `1px solid ${s.color}40`,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}>
                    <div style={{ width: 7, height: 7, borderRadius: "50%", background: s.color }} />
                    <span style={{ fontSize: 12, fontWeight: 700, color: s.color, letterSpacing: "0.5px" }}>{s.label}</span>
                  </div>
                ))}
              </div>

              {error && (
                <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", borderRadius: 12, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#fca5a5" }}>
                  {error}
                </div>
              )}

              {/* Domain input — large and prominent */}
              <div style={{ position: "relative", marginBottom: 16 }}>
                <div style={{
                  position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
                  display: "flex", alignItems: "center", gap: 6, pointerEvents: "none",
                }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  <span style={{ fontSize: 14, color: "rgba(255,255,255,0.35)", fontWeight: 500 }}>https://</span>
                </div>
                <input
                  type="text"
                  placeholder="bigbullyturf.com"
                  value={domain}
                  onChange={(e) => setDomain(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && domain.trim() && handleRunAudit()}
                  style={{
                    width: "100%",
                    padding: "16px 16px 16px 108px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,0.15)",
                    background: "rgba(255,255,255,0.07)",
                    fontSize: 16,
                    fontWeight: 600,
                    color: "#fff",
                    outline: "none",
                    boxSizing: "border-box",
                    transition: "border-color 0.2s, background 0.2s",
                  }}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.35)"; e.target.style.background = "rgba(255,255,255,0.1)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.15)"; e.target.style.background = "rgba(255,255,255,0.07)"; }}
                />
              </div>

              {/* Audit type toggle */}
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {[
                  { value: "full", label: "Full Audit", desc: "Up to 50 pages", icon: "50" },
                  { value: "quick", label: "Quick Audit", desc: "Up to 5 pages", icon: "5" },
                ].map((opt) => {
                  const active = auditType === opt.value;
                  return (
                    <button
                      key={opt.value}
                      onClick={() => setAuditType(opt.value)}
                      style={{
                        flex: 1,
                        padding: "14px 16px",
                        borderRadius: 12,
                        border: active ? "1.5px solid rgba(255,255,255,0.3)" : "1px solid rgba(255,255,255,0.1)",
                        background: active ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.04)",
                        cursor: "pointer",
                        textAlign: "left",
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        transition: "all 0.15s",
                      }}
                    >
                      <div style={{
                        width: 36, height: 36, borderRadius: 10,
                        background: active ? "rgba(13,148,136,0.25)" : "rgba(255,255,255,0.06)",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        fontSize: 13, fontWeight: 800, color: active ? "#5eead4" : "rgba(255,255,255,0.3)",
                        flexShrink: 0,
                      }}>{opt.icon}</div>
                      <div>
                        <p style={{ fontSize: 14, fontWeight: 700, color: active ? "#fff" : "rgba(255,255,255,0.5)" }}>{opt.label}</p>
                        <p style={{ fontSize: 11, color: active ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)", marginTop: 1 }}>{opt.desc}</p>
                      </div>
                    </button>
                  );
                })}
              </div>

              <AdvancedOptions value={advanced} onChange={setAdvanced} auditType={auditType} domain={domain} />

              {/* Submit button */}
              <button
                onClick={() => handleRunAudit()}
                disabled={!domain.trim() || starting}
                style={{
                  width: "100%",
                  padding: "14px",
                  borderRadius: 12,
                  background: domain.trim()
                    ? "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)"
                    : "rgba(255,255,255,0.08)",
                  color: domain.trim() ? "#fff" : "rgba(255,255,255,0.25)",
                  fontSize: 15,
                  fontWeight: 700,
                  border: "none",
                  cursor: domain.trim() ? "pointer" : "not-allowed",
                  transition: "all 0.2s",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  letterSpacing: "0.3px",
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                  <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                {starting ? "Starting..." : "Run Audit"}
              </button>
            </div>

            {/* ── Past Audits ──────────────────────────────────────────── */}
            {!historyLoading && history.length > 0 && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeLinecap="round">
                    <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
                  </svg>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: "rgba(255,255,255,0.7)", letterSpacing: "0.5px", textTransform: "uppercase" }}>Past Audits</h3>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {history.map((a) => {
                    const isToday = a.createdAt && new Date(a.createdAt).toDateString() === new Date().toDateString();
                    const combined = (a.scores?.seo || 0) + (a.scores?.geo || 0) + (a.scores?.aeo || 0);
                    const open = isOpenJob(a);
                    const badge = open ? JOB_BADGE[a.status] || JOB_BADGE.running : null;
                    return (
                      <div
                        key={a._id}
                        style={{
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.08)",
                          borderRadius: 14,
                          padding: "16px 20px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          transition: "background 0.15s, border-color 0.15s",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.08)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; }}
                        onClick={() => handleLoadAudit(a)}
                      >
                        {/* Score circle */}
                        <div style={{
                          width: 44, height: 44, borderRadius: "50%",
                          border: `2px solid ${open ? "rgba(255,255,255,0.2)" : combined >= 20 ? "#0d9488" : combined >= 12 ? "#f59e0b" : "#ef4444"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, marginRight: 16,
                        }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: open ? "rgba(255,255,255,0.4)" : "#fff" }}>{open ? "…" : combined}</span>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a.domain}
                            </p>
                            {badge && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: badge.bg, color: badge.color, padding: "2px 8px", borderRadius: 10 }}>{badge.label}</span>
                            )}
                            {isToday && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(13,148,136,0.2)", color: "#5eead4", padding: "2px 8px", borderRadius: 10 }}>Today</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "center" }}>
                            {open ? (
                              <span style={{ color: "rgba(255,255,255,0.5)" }}>
                                {a.status === "failed" ? "Stopped on a step. Open to retry." : "Not finished. Open to continue."}
                              </span>
                            ) : (
                              <>
                                <span style={{ color: "#5eead4" }}>SEO {a.scores?.seo ?? "—"}</span>
                                <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
                                <span style={{ color: "#a78bfa" }}>GEO {a.scores?.geo ?? "—"}</span>
                                <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
                                <span style={{ color: "#fbbf24" }}>AEO {a.scores?.aeo ?? "—"}</span>
                              </>
                            )}
                            <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>
                              {a.auditType === "quick" ? "Quick" : "Full"}{a.optionsSummary && <span title={a.optionsSummary}> &middot; Custom pages</span>}{!open && <> &middot; {a.pagesCrawled}p</>} &middot; {new Date(a.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 6, marginLeft: 12, flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLoadAudit(a); }}
                            disabled={loadingAuditId === a._id}
                            style={{
                              padding: "7px 16px",
                              borderRadius: 8,
                              background: "rgba(255,255,255,0.1)",
                              color: "#fff",
                              fontSize: 12,
                              fontWeight: 600,
                              border: "1px solid rgba(255,255,255,0.15)",
                              cursor: "pointer",
                              opacity: loadingAuditId === a._id ? 0.5 : 1,
                              transition: "background 0.15s",
                            }}
                          >
                            {loadingAuditId === a._id ? "Loading..." : open ? "Resume" : "View"}
                          </button>
                          {!open && <button
                            onClick={(e) => { e.stopPropagation(); handleDeleteAudit(a._id); }}
                            style={{
                              padding: "7px 10px",
                              borderRadius: 8,
                              background: "transparent",
                              color: "rgba(239,68,68,0.7)",
                              fontSize: 12,
                              fontWeight: 600,
                              border: "1px solid rgba(239,68,68,0.2)",
                              cursor: "pointer",
                              transition: "all 0.15s",
                            }}
                          >
                            Delete
                          </button>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {historyLoading && (
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 16, textAlign: "center" }}>Loading past audits...</p>
            )}
          </div>
        )}

        {/* ── Step 1: v2 job progress ────────────────────────────────────── */}
        {step === STEPS.PROGRESS && (
          <ProgressSteps
            key={jobId}
            progress={job.progress?.jobId === jobId ? job.progress : { domain, auditType, steps: [], dataGaps: [] }}
            error={job.error}
            onRetry={job.retry}
            onBack={handleBackFromProgress}
          />
        )}

        {/* ── Step 2: Results (v2 or v1 view, by version) ────────────────── */}
        {step === STEPS.RESULTS && auditResult && (
          <ResultsView
            audit={auditResult}
            crawlData={crawlData}
            domain={domain}
            actions={resultActions}
            onBack={handleBackToAudits}
            review={auditId ? { auditId, corrections, canReplan, onCorrect: handleCorrect, onUndo: handleUndo, onReplan: handleReplan, replanning, replanError } : undefined}
          />
        )}
      </div>
    </div>
  );
}
