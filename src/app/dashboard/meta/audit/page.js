"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import { runAudit, fmtCurrency, fmtPct } from "../../../../lib/metaAudit";
import MetaAdsPanel from "../components/MetaAdsPanel";

const TABS = ["Overview", "Campaigns", "Creative", "Audience", "Placements", "Bidding", "Performance", "Action Plan", "AI Insight"];

const C = {
  bg:      "#0f0f17",
  card:    "#1a1a2e",
  border:  "rgba(255,255,255,0.08)",
  accent:  "#1877F2",
  pink:    "#e94560",
  teal:    "#4ecca3",
  amber:   "#f5a623",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.5)",
  textMut: "rgba(255,255,255,0.3)",
};

const RANGE_MAP = { LAST_7_DAYS: "7d", LAST_30_DAYS: "28d", LAST_90_DAYS: "3m" };

const RANGE_LABELS = {
  LAST_7_DAYS:  "Last 7 days",
  LAST_30_DAYS: "Last 30 days",
  LAST_90_DAYS: "Last 90 days",
};

function fmtDateWindow(w) {
  if (!w?.since || !w?.until) return null;
  const opts = { month: "short", day: "numeric" };
  const s = new Date(w.since + "T12:00:00");
  const u = new Date(w.until + "T12:00:00");
  return s.toLocaleDateString("en-US", opts) + " – " + u.toLocaleDateString("en-US", opts) + ", " + u.getFullYear();
}

export default function MetaAuditPage() {
  return (
    <Suspense fallback={<div style={{ padding: 40, color: C.textSec }}>Loading&hellip;</div>}>
      <MetaAuditPageInner />
    </Suspense>
  );
}

function MetaAuditPageInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const initialAccountId = sp.get("accountId") || "";

  const [accountId,      setAccountId]      = useState(initialAccountId);
  const [accountName,    setAccountName]    = useState("");
  const [audit,          setAudit]          = useState(null);
  const [auditLoading,   setAuditLoading]   = useState(false);
  const [auditError,     setAuditError]     = useState(null);
  const [dateRange,      setDateRange]      = useState("LAST_30_DAYS");
  const [dateWindow,     setDateWindow]     = useState(null);
  const [tab,            setTab]            = useState(0);
  const [aiInsight,      setAiInsight]      = useState(null);
  const [aiLoading,      setAiLoading]      = useState(false);
  const [aiError,        setAiError]        = useState(null);
  const [history,        setHistory]        = useState([]);
  const [, setHistoryUsage]                 = useState(null);
  const [activeHistoryId, setActiveHistoryId] = useState(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [accounts,       setAccounts]       = useState([]);
  const [showRunModal,   setShowRunModal]   = useState(false);
  const [pendingAutoSave, setPendingAutoSave] = useState(false);
  const [pendingAi,      setPendingAi]      = useState(false);
  const [, setSaving]                       = useState(false);
  const [adsPanelAdSet,  setAdsPanelAdSet]  = useState(null);
  const [pendingDeleteId, setPendingDeleteId] = useState(null);

  useEffect(() => {
    fetch("/api/meta/audit/accounts")
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => { if (j?.data) setAccounts(j.data); })
      .catch(() => {});
  }, [historyVersion]);

  // Sync accountName when arriving from URL (?accountId=...) or when the accounts list loads.
  useEffect(() => {
    if (!accountId || accountName) return;
    const match = accounts.find((a) => String(a.accountId) === String(accountId));
    if (match) setAccountName(match.accountName);
  }, [accounts, accountId, accountName]);

  // Fallback: if the account has no prior audits (so it's not in the audited-accounts list),
  // look up the name in the full Meta accounts list (lightweight — same endpoint the Meta
  // dashboard already uses for its picker).
  useEffect(() => {
    if (!accountId || accountName) return;
    const controller = new AbortController();
    fetch(`/api/meta-accounts`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : null)
      .then((j) => {
        const list = j?.data || j || [];
        const match = list.find((a) => String(a.accountId || a.id) === String(accountId));
        if (match?.name) setAccountName(match.name);
      })
      .catch(() => {});
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    fetch(`/api/meta/audit/history?accountId=${encodeURIComponent(accountId)}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((j) => {
        if (j?.data) setHistory(j.data);
        if (j?.usage) setHistoryUsage(j.usage);
      })
      .catch((err) => console.warn("[MetaAuditHistory]", err));
  }, [accountId, historyVersion]);

  async function doFetch(acctId, apiRange, start, end) {
    setAudit(null);
    setAuditLoading(true);
    setAuditError(null);
    setAiInsight(null);
    setAiError(null);
    const params = new URLSearchParams({ accountId: acctId, range: apiRange });
    if (apiRange === "custom" && start && end) {
      params.set("startDate", start);
      params.set("endDate", end);
    }
    try {
      const r = await fetch(`/api/meta/audit?${params.toString()}`);
      const j = await r.json();
      if (!r.ok) {
        const detail = [j?.error, j?.code && `code ${j.code}`, j?.subcode && `subcode ${j.subcode}`].filter(Boolean).join(" · ");
        throw new Error(detail || `HTTP ${r.status}`);
      }
      if (j?.data) {
        setAccountName(j.data.account?.name || "");
        setAudit(runAudit(j.data));
        if (j.data.dateRange) setDateWindow(j.data.dateRange);
      }
    } catch (err) {
      console.warn("[MetaAuditPage]", err);
      setAuditError(err.message || "Audit fetch failed");
    } finally {
      setAuditLoading(false);
    }
  }

  async function loadHistoryEntry(entry) {
    console.log("[loadHistoryEntry] clicked entry:", {
      id: String(entry._id),
      accountId: entry.accountId,
      dateRange: entry.dateRange,
      hasSummary: !!entry.summary,
      savedAt: entry.savedAt,
    });
    setActiveHistoryId(String(entry._id));
    setAudit(null);
    setAuditLoading(true);
    setAuditError(null);
    setAiInsight(null);
    setAiError(null);
    try {
      const res = await fetch(`/api/meta/audit/history?id=${String(entry._id)}`);
      const j = await res.json();
      console.log("[loadHistoryEntry] response:", {
        ok: res.ok,
        status: res.status,
        hasData: !!j?.data,
        hasAuditData: !!j?.data?.auditData,
        auditDataKeys: j?.data?.auditData ? Object.keys(j.data.auditData) : null,
        campaignCount: j?.data?.auditData?.campaigns?.length,
        adSetCount: j?.data?.auditData?.adSets?.length,
        hasAI: !!j?.data?.aiInsight,
        errorMsg: j?.error,
      });
      if (j?.data) {
        if (j.data.accountName) setAccountName(j.data.accountName);
        if (j.data.dateRange) setDateRange(j.data.dateRange);
        if (j.data.dateWindow) setDateWindow(j.data.dateWindow);
        if (j.data.aiInsight) {
          setAiInsight(j.data.aiInsight);
        }

        if (j.data.auditData) {
          console.log("[loadHistoryEntry] hydrating from stored auditData");
          setAudit(j.data.auditData);
        } else {
          // Legacy entry (saved before we started persisting full audit data).
          // Re-fetch live from Meta using the saved date range so every tab populates.
          const savedRange = j.data.dateRange || "LAST_30_DAYS";
          const apiRange = RANGE_MAP[savedRange] || "28d";
          const targetAccountId = j.data.accountId || accountId;
          console.log(`[loadHistoryEntry] legacy entry — refetching live for account=${targetAccountId} range=${apiRange}`);
          if (targetAccountId) {
            await doFetch(targetAccountId, apiRange,
              j.data.dateWindow?.since || undefined,
              j.data.dateWindow?.until || undefined,
            );
            return; // doFetch manages auditLoading itself
          }
        }
      }
    } catch (err) {
      console.error("[loadHistoryEntry] fetch/parse error:", err);
    } finally {
      setAuditLoading(false);
    }
  }

  async function deleteAudit(id) {
    try {
      const res = await fetch(`/api/meta/audit/history?id=${id}`, { method: "DELETE" });
      if (res.ok) {
        setHistory((h) => h.filter((e) => String(e._id) !== id));
        if (activeHistoryId === id) {
          setActiveHistoryId(null);
          setAudit(null);
          setAuditError(null);
        }
      }
    } catch (err) {
      console.error("[deleteAudit]", err);
    } finally {
      setPendingDeleteId(null);
    }
  }

  async function saveAudit(ai) {
    if (!audit || !accountId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/meta/audit/save", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId, accountName, dateRange,
          dateWindow, dateLabel: dateRange,
          auditId: activeHistoryId || null,
          summary: {
            totalSpend: audit.summary.totalSpend,
            totalConversions: audit.summary.totalConversions,
            blendedCPA: audit.summary.blendedCPA,
            accountGrade: ai?.account_grade ?? aiInsight?.account_grade ?? audit.summary.accountGrade,
            criticalCount: audit.summary.criticalCount,
            warningCount: audit.summary.warningCount,
          },
          // Full audit payload so past entries can re-hydrate every tab when clicked.
          auditData: audit,
          aiInsight: ai ?? aiInsight ?? null,
        }),
      });
      if (res.ok) {
        const j = await res.json().catch(() => null);
        if (j?.id) setActiveHistoryId(String(j.id));
      }
      setHistoryVersion((v) => v + 1);
    } catch (err) { console.error("[saveMetaAudit]", err); } finally { setSaving(false); }
  }

  async function runAiAnalysis() {
    if (!audit || !accountId) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const payload = buildAuditPayload(audit, accountName, accountId, dateRange);
      const res = await fetch("/api/claude/meta-audit", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const j = await res.json();
      if (j?.data) {
        setAiInsight(j.data);
        if (j.usage) setHistoryUsage(j.usage);
        await saveAudit(j.data);
      } else if (j?.limitReached) {
        setAiError(j.error);
        if (j.usage) setHistoryUsage(j.usage);
        await saveAudit(null);
      } else {
        throw new Error("No data in response");
      }
    } catch (err) {
      console.error("[MetaAIInsight]", err);
      setAiError(err.message);
      saveAudit(null).catch(() => {});
    } finally { setAiLoading(false); }
  }

  useEffect(() => {
    if (pendingAutoSave && !auditLoading && audit) {
      setPendingAutoSave(false);
      if (pendingAi) {
        setPendingAi(false);
        setTab(8);
        runAiAnalysis();
      } else {
        saveAudit(null);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAutoSave, auditLoading]);

  return (
    <div className="audit-root" style={{ background: C.bg, color: C.textPri }}>
      <div className="audit-topbar" style={{ borderBottom: `1px solid ${C.border}` }}>
        <button onClick={() => router.back()} style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(255,255,255,0.07)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "7px 14px", fontSize: 13, fontWeight: 600, color: C.textSec, cursor: "pointer" }}>&#8592; Back</button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 3px" }}>META ADS AUDIT</p>
          <h1 style={{ fontSize: 20, fontWeight: 800, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {accountName || "Pick an account"}
          </h1>
        </div>
      </div>
      <div className="audit-three-pane">
        <div className="audit-sidebar" style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 16px 12px", borderBottom: `1px solid ${C.border}` }}>
            <span style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.textSec }}>Accounts</span>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {accounts.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textSec, padding: "20px 14px", textAlign: "center", lineHeight: 1.6 }}>No accounts audited yet</p>
            ) : accounts.map((acc) => {
              const isActive = acc.accountId === accountId;
              return (
                <button key={acc.accountId} onClick={() => { setAccountId(acc.accountId); setAccountName(acc.accountName); }}
                  style={{ width: "100%", textAlign: "left", display: "block", padding: "12px 14px", border: "none", borderBottom: `1px solid ${C.border}`, borderLeft: `2px solid ${isActive ? C.accent : "transparent"}`, background: isActive ? "rgba(24,119,242,0.08)" : "transparent", cursor: "pointer" }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: isActive ? "#fff" : "rgba(255,255,255,0.8)", margin: "0 0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={acc.accountName}>{acc.accountName}</p>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {acc.lastGrade && <span style={{ fontSize: 12, fontWeight: 800, color: C.teal }}>{acc.lastGrade}</span>}
                    <span style={{ fontSize: 11, color: C.textSec }}>{acc.lastSavedAt ? new Date(acc.lastSavedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No audits"}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="audit-history" style={{ borderRight: `1px solid ${C.border}`, display: "flex", flexDirection: "column" }}>
          <div style={{ padding: "14px 14px 12px", borderBottom: `1px solid ${C.border}` }}>
            <button onClick={() => setShowRunModal(true)} disabled={auditLoading || !accountId}
              style={{ width: "100%", background: auditLoading ? "rgba(24,119,242,0.3)" : C.accent, border: "none", borderRadius: 8, padding: "11px 0", fontSize: 14, fontWeight: 700, color: "#fff", cursor: auditLoading ? "not-allowed" : "pointer" }}>
              {auditLoading ? "Running\u2026" : "\u25b6 Run Audit"}
            </button>
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {history.length === 0 ? (
              <p style={{ fontSize: 12, color: C.textSec, padding: "20px 14px", textAlign: "center" }}>No audits yet for this account.</p>
            ) : history.map((entry) => {
              const eid = String(entry._id);
              const isPendingDelete = pendingDeleteId === eid;
              const dateStr = fmtDateWindow(entry.dateWindow);
              const rangeLabel = RANGE_LABELS[entry.dateLabel || entry.dateRange] || entry.dateLabel || entry.dateRange;
              return (
                <div key={eid}
                  onClick={() => { setPendingDeleteId(null); loadHistoryEntry(entry); }}
                  style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: eid === activeHistoryId ? "rgba(24,119,242,0.08)" : "transparent" }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 6 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontSize: 12, fontWeight: 700, color: "#fff", margin: 0 }}>
                        {new Date(entry.savedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                      </p>
                      <p style={{ fontSize: 11, color: C.textSec, margin: "3px 0 0" }}>{rangeLabel}</p>
                      {dateStr && <p style={{ fontSize: 10, color: C.textMut, margin: "2px 0 0" }}>{dateStr}</p>}
                      <div style={{ display: "flex", gap: 5, marginTop: 5, alignItems: "center", flexWrap: "wrap" }}>
                        {entry.summary?.accountGrade && (
                          <span style={{ fontSize: 11, fontWeight: 800, color: C.teal }}>Grade {entry.summary.accountGrade}</span>
                        )}
                        {entry.hasAI === true && (
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "2px 6px", borderRadius: 4, color: C.accent, border: `1px solid ${C.accent}55`, background: `${C.accent}18` }}>AI</span>
                        )}
                        {entry.hasAI === false && (
                          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "2px 6px", borderRadius: 4, color: C.textMut, border: "1px solid rgba(255,255,255,0.1)" }}>Data</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); isPendingDelete ? deleteAudit(eid) : setPendingDeleteId(eid); }}
                      title="Delete audit"
                      style={{ flexShrink: 0, background: isPendingDelete ? "rgba(233,69,96,0.15)" : "transparent", border: isPendingDelete ? "1px solid rgba(233,69,96,0.4)" : "1px solid transparent", borderRadius: 5, padding: "3px 7px", fontSize: isPendingDelete ? 10 : 12, fontWeight: 700, color: isPendingDelete ? C.pink : C.textMut, cursor: "pointer", whiteSpace: "nowrap", marginTop: 1 }}>
                      {isPendingDelete ? "Delete?" : "\ud83d\uddd1"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="audit-content">
          <div style={{ borderBottom: `1px solid ${C.border}`, padding: "0 24px", display: "flex", overflowX: "auto", scrollbarWidth: "none", WebkitOverflowScrolling: "touch", flexShrink: 0 }}>
            {TABS.map((t, i) => (
              <button key={t} onClick={() => setTab(i)} style={{ flexShrink: 0, padding: "13px 16px", fontSize: 14, fontWeight: 600, background: "none", border: "none", cursor: "pointer", whiteSpace: "nowrap", color: tab === i ? C.textPri : C.textSec, borderBottom: `2px solid ${tab === i ? C.accent : "transparent"}` }}>
                {t}
              </button>
            ))}
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {audit ? (
              <div className="audit-tab-content">
                {tab === 0 && <OverviewTab audit={audit} />}
                {tab === 1 && <CampaignsTab campaigns={audit.campaigns} />}
                {tab === 2 && <CreativeTab audit={audit} onOpenAdSet={(as) => setAdsPanelAdSet(as)} />}
                {tab === 3 && <AudienceTab audit={audit} />}
                {tab === 4 && <PlacementsTab audit={audit} />}
                {tab === 5 && <BiddingTab audit={audit} />}
                {tab === 6 && <PerformanceTab audit={audit} />}
                {tab === 7 && <ActionPlanTab actions={audit.actionPlan} />}
                {tab === 8 && <AIInsightTab aiInsight={aiInsight} aiLoading={aiLoading} aiError={aiError} onRunAnalysis={runAiAnalysis} auditReady={!!audit && !auditLoading} />}
              </div>
            ) : auditLoading ? (
              <div style={{ padding: 60, textAlign: "center", color: C.textSec }}>{activeHistoryId ? "Loading audit…" : "Running audit…"}</div>
            ) : auditError ? (
              <div style={{ padding: 40 }}>
                <div style={{ background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.35)", borderRadius: 10, padding: 18, color: C.pink, fontSize: 13, lineHeight: 1.6 }}>
                  <strong style={{ display: "block", marginBottom: 6 }}>Meta API error</strong>
                  <span style={{ color: "rgba(255,255,255,0.8)" }}>{auditError}</span>
                </div>
                <p style={{ fontSize: 12, color: C.textSec, marginTop: 12 }}>Check the dev server terminal for the full <code>[meta/audit]</code> log.</p>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 14, padding: 60 }}>
                <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(24,119,242,0.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 26 }}>&#128216;</div>
                <p style={{ fontSize: 18, fontWeight: 700, color: C.textPri, margin: 0 }}>No audit data yet</p>
                <p style={{ fontSize: 14, color: C.textSec, margin: 0, textAlign: "center", maxWidth: 320, lineHeight: 1.6 }}>
                  {accountId ? "Click \u25b6 Run Audit in the sidebar" : "Pick an account from the left rail, then run an audit"}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <MetaAdsPanel
        open={!!adsPanelAdSet}
        onClose={() => setAdsPanelAdSet(null)}
        adSet={adsPanelAdSet}
        campaignName={adsPanelAdSet?.campaign_name || null}
        range="28d"
      />

      {showRunModal && (
        <RunAuditModal
          onClose={() => setShowRunModal(false)}
          onRun={(range, start, end, includeAi) => {
            setShowRunModal(false);
            setDateRange(range);
            setActiveHistoryId(null);
            setPendingAutoSave(true);
            setPendingAi(!!includeAi);
            const apiRange = RANGE_MAP[range] || "28d";
            doFetch(accountId, apiRange, start, end);
          }}
        />
      )}
    </div>
  );
}

function buildAuditPayload(audit, accountName, accountId, dateRange) {
  const { summary, pillars, campaigns, actionPlan } = audit;
  const dollars = (n) => (n == null ? null : Math.round(n));
  return {
    accountName, accountId, dateRange,
    currency: "USD",
    unitsNote: "All cost, CPA, and budget values are in whole US dollars.",
    summary: {
      totalSpend: dollars(summary.totalSpend),
      totalConversions: summary.totalConversions,
      blendedCPA: dollars(summary.blendedCPA),
      accountGrade: summary.accountGrade,
      avgScore: summary.avgScore,
      campaignCount: summary.campaignCount,
      adSetCount: summary.adSetCount,
    },
    pillars: {
      account_structure: { score: pillars.structure.score, ...pillars.structure },
      ad_fatigue: { score: pillars.fatigue.score, fatiguedSpendPct: pillars.fatigue.fatiguedSpendPct, fatiguedSpend: dollars(pillars.fatigue.fatiguedSpend) },
      creative_diversity: { score: pillars.creative.score, avg: pillars.creative.avgCreativesPerAdSet, singlePct: pillars.creative.singleCreativePct },
      audience_targeting: { score: pillars.audience.score, broadPct: pillars.audience.broadPct, lookalikeCount: pillars.audience.lookalikeCount },
      placements: { score: pillars.placements.score, advantagePct: pillars.placements.advantagePct },
      bidding_budget: { score: pillars.bidding.score, learningPct: pillars.bidding.learningPct, strategies: pillars.bidding.bidStrategies },
      conversion_tracking: { score: pillars.tracking.score, hasPixel: pillars.tracking.hasPixel, recentlyFired: pillars.tracking.recentlyFired },
      performance: { score: pillars.performance.score, zeroConvPct: pillars.performance.zeroConvPct, blendedCPA: dollars(pillars.performance.blendedCPA) },
    },
    campaigns: campaigns.slice(0, 30).map((c) => ({
      campaignName: c.name,
      objective: c.objective,
      verdict: c.verdict?.key,
      spend: dollars(c.spend),
      conversions: c.conversions,
      frequency: c.frequency,
      ctr: c.ctr,
      cpa: c.cost_per_conversion ? dollars(c.cost_per_conversion) : null,
      roas: c.roas,
    })),
    actionPlan,
  };
}

function OverviewTab({ audit }) {
  const { summary, pillars } = audit;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 20 }}>
        <KPI label="Total Spend"   value={fmtCurrency(summary.totalSpend)} />
        <KPI label="Conversions"   value={summary.totalConversions?.toFixed(0) || "\u2014"} />
        <KPI label="Blended CPA"   value={summary.blendedCPA ? fmtCurrency(summary.blendedCPA) : "\u2014"} />
        <KPI label="Grade"         value={summary.accountGrade} accent={gradeColor(summary.accountGrade)} />
      </div>
      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "20px 0 12px" }}>Pillar Scores</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 }}>
        <PillarTile label="Structure"     score={pillars.structure.score} />
        <PillarTile label="Ad Fatigue"    score={pillars.fatigue.score} />
        <PillarTile label="Creative"      score={pillars.creative.score} />
        <PillarTile label="Audience"      score={pillars.audience.score} />
        <PillarTile label="Placements"    score={pillars.placements.score} />
        <PillarTile label="Bidding"       score={pillars.bidding.score} />
        <PillarTile label="Tracking"      score={pillars.tracking.score} />
        <PillarTile label="Performance"   score={pillars.performance.score} />
      </div>
    </div>
  );
}

function KPI({ label, value, accent }) {
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.5)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 800, color: accent || "#fff", margin: "6px 0 0" }}>{value}</p>
    </div>
  );
}

function PillarTile({ label, score }) {
  const color = score >= 8 ? "#4ecca3" : score >= 6 ? "#f5a623" : score >= 4 ? "#f97316" : "#e94560";
  return (
    <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: "10px 12px" }}>
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", margin: 0 }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color, margin: "4px 0 0" }}>{score}<span style={{ fontSize: 12, color: "rgba(255,255,255,0.3)" }}>/10</span></p>
    </div>
  );
}

function gradeColor(g) {
  return { A: "#4ecca3", B: "#60d394", C: "#f5a623", D: "#f97316", F: "#e94560" }[g] || "#ffffff";
}

function CampaignsTab({ campaigns }) {
  const sorted = [...campaigns].sort((a, b) => (b.spend || 0) - (a.spend || 0));
  return (
    <div>
      <div style={{ background: "#1a1a2e", borderRadius: 10, border: "1px solid rgba(255,255,255,0.08)", overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 100px 100px 90px 90px 90px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.08)", minWidth: 720 }}>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)" }}>Campaign</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Spend</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Conv</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>CPA</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "right" }}>Freq</span>
          <span style={{ fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.5)", textAlign: "center" }}>Verdict</span>
        </div>
        {sorted.map((c) => (
          <div key={c.id} style={{ display: "grid", gridTemplateColumns: "2fr 100px 100px 90px 90px 90px", padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", minWidth: 720, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={c.name}>{c.name}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{fmtCurrency(c.spend)}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{(c.conversions || 0).toFixed(0)}</span>
            <span style={{ fontSize: 13, color: "#fff", textAlign: "right" }}>{c.cost_per_conversion ? fmtCurrency(c.cost_per_conversion) : "\u2014"}</span>
            <span style={{ fontSize: 13, color: (c.frequency || 0) > 4 ? "#dd6b20" : "#fff", textAlign: "right" }}>{(c.frequency || 0).toFixed(2)}</span>
            <span style={{ fontSize: 11, fontWeight: 800, textAlign: "center", color: c.verdict?.color }}>{c.verdict?.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function CreativeTab({ audit, onOpenAdSet }) {
  const { creative } = audit.pillars;
  const thin = audit.adSets.filter((as) => {
    const adCount = audit.ads.filter((ad) => ad.ad_set_id === as.id).length;
    return adCount <= 1 && (as.spend || 0) > 50;
  });
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Avg creatives / ad set" value={creative.avgCreativesPerAdSet.toFixed(1)} />
        <KPI label="Single-creative ad sets" value={creative.singleCreativeAdSetCount} />
        <KPI label="Single-creative %" value={fmtPct(creative.singleCreativePct)} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Thin-creative ad sets (click to open)</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "auto" }}>
        {thin.length === 0 ? (
          <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>No thin-creative ad sets (good!).</p>
        ) : thin.map((as) => (
          <div key={as.id} onClick={() => onOpenAdSet(as)} style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", cursor: "pointer", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <p style={{ fontSize: 13, color: "#fff", margin: 0 }}>{as.name}</p>
              <p style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", margin: "2px 0 0" }}>{as.campaign_name}</p>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "rgba(255,255,255,0.5)" }}>{fmtCurrency(as.spend)}</span>
              <span style={{ fontSize: 16, color: "rgba(255,255,255,0.3)" }}>&rsaquo;</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AudienceTab({ audit }) {
  const { audience } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Broad targeting %" value={fmtPct(audience.broadPct)} />
        <KPI label="Broad spend" value={fmtCurrency(audience.broadSpend)} />
        <KPI label="Narrow spend" value={fmtCurrency(audience.narrowSpend)} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12 }}>
        <KPI label="Lookalike ad sets" value={audience.lookalikeCount} />
        <KPI label="Advantage+ Audience on" value={audience.expansionCount} />
      </div>
    </div>
  );
}

function PlacementsTab({ audit }) {
  const { placements } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Advantage+ Placements %" value={fmtPct(placements.advantagePct)} />
        <KPI label="Ad sets using Advantage+" value={placements.advantagePlacementCount} />
      </div>
      <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, margin: 0 }}>
        Advantage+ Placements lets Meta distribute spend across Facebook Feed, Instagram Feed, Reels, Stories, Audience Network, and Messenger for maximum efficiency. Manual placement-limiting usually raises CPA.
      </p>
    </div>
  );
}

function BiddingTab({ audit }) {
  const { bidding } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Learning-phase ad sets" value={bidding.learningCount} />
        <KPI label="Learning %" value={fmtPct(bidding.learningPct)} />
        <KPI label="Smart-bid fit" value={bidding.smartBidFit ? "Yes" : "No"} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Bid strategy distribution</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14 }}>
        {Object.entries(bidding.bidStrategies).map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>{k}</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>{v}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PerformanceTab({ audit }) {
  const { performance } = audit.pillars;
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <KPI label="Total spend" value={fmtCurrency(performance.totalSpend)} />
        <KPI label="Blended CPA" value={performance.blendedCPA ? fmtCurrency(performance.blendedCPA) : "\u2014"} />
        <KPI label="Zero-conv spend %" value={fmtPct(performance.zeroConvPct)} accent={performance.zeroConvPct > 0.2 ? "#e94560" : undefined} />
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "14px 0 10px" }}>Zero-conversion high-spend ad sets</h3>
      <div style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, overflow: "auto" }}>
        {performance.zeroConvHighSpend.length === 0 ? (
          <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>None &mdash; all high-spend ad sets are converting.</p>
        ) : performance.zeroConvHighSpend.map((as) => (
          <div key={as.id} style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", justifyContent: "space-between" }}>
            <span style={{ fontSize: 13, color: "#fff" }}>{as.name}</span>
            <span style={{ fontSize: 13, color: "#e94560", fontWeight: 700 }}>{fmtCurrency(as.spend)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ActionPlanTab({ actions }) {
  const priorityColor = { critical: "#e94560", high: "#dd6b20", medium: "#f5a623", quick_win: "#4ecca3" };
  return (
    <div>
      {actions.length === 0 ? (
        <p style={{ padding: 20, color: "rgba(255,255,255,0.5)", textAlign: "center", fontSize: 13 }}>No issues flagged. Account is in good shape.</p>
      ) : actions.map((a, i) => (
        <div key={i} style={{ background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 10, padding: 14, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", padding: "2px 8px", borderRadius: 4, color: priorityColor[a.priority] || "#fff", border: `1px solid ${priorityColor[a.priority] || "#fff"}55` }}>{a.priority}</span>
            <span style={{ fontSize: 11, color: "rgba(255,255,255,0.5)" }}>{a.category}</span>
          </div>
          <p style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "4px 0 6px" }}>{a.issue}</p>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.7)", margin: 0 }}>&rarr; {a.action}</p>
        </div>
      ))}
    </div>
  );
}

function AIInsightTab({ aiInsight, aiLoading, aiError, onRunAnalysis, auditReady }) {
  if (aiLoading) return <div style={{ padding: 60, textAlign: "center", color: "rgba(255,255,255,0.6)" }}>Claude is analyzing your account&hellip; this takes 20-30 seconds.</div>;
  if (!aiInsight) {
    return (
      <div style={{ padding: 60, textAlign: "center" }}>
        {aiError && <p style={{ color: "#e94560", marginBottom: 14 }}>{aiError}</p>}
        <button onClick={onRunAnalysis} disabled={!auditReady}
          style={{ background: auditReady ? "#1877F2" : "rgba(255,255,255,0.1)", color: "#fff", padding: "10px 20px", fontSize: 14, fontWeight: 700, borderRadius: 8, border: "none", cursor: auditReady ? "pointer" : "not-allowed" }}>
          &#10022; Run AI Analysis
        </button>
        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginTop: 10 }}>Uses Claude to generate scored pillars + recommendations.</p>
      </div>
    );
  }
  return (
    <div>
      <div style={{ background: "rgba(24,119,242,0.1)", border: "1px solid rgba(24,119,242,0.3)", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", color: "#1877F2", margin: "0 0 8px" }}>Executive Summary</p>
        <p style={{ fontSize: 14, color: "#fff", lineHeight: 1.7, margin: 0 }}>{aiInsight.executive_summary}</p>
      </div>
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "20px 0 10px" }}>Top 3 priorities</h3>
      {(aiInsight.top_3_priorities || []).map((p, i) => (
        <div key={i} style={{ padding: "10px 14px", background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, marginBottom: 8, fontSize: 13, color: "#fff" }}>{i + 1}. {p}</div>
      ))}
      <h3 style={{ fontSize: 14, fontWeight: 700, color: "#fff", margin: "20px 0 10px" }}>Client summary</h3>
      <div style={{ padding: 14, background: "#1a1a2e", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 8, fontSize: 13, color: "rgba(255,255,255,0.85)", lineHeight: 1.7 }}>{aiInsight.client_summary}</div>
    </div>
  );
}

function RunAuditModal({ onClose, onRun }) {
  const [range, setRange] = useState("LAST_30_DAYS");
  const [includeAi, setIncludeAi] = useState(true);
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ background: "#1a1a2e", borderRadius: 12, padding: 24, width: 400, maxWidth: "90vw" }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", margin: "0 0 14px" }}>Run Meta Ads Audit</h3>
        <label style={{ fontSize: 12, color: "rgba(255,255,255,0.55)", display: "block", marginBottom: 4 }}>Date range</label>
        <select value={range} onChange={(e) => setRange(e.target.value)} style={{ width: "100%", background: "#13131f", color: "#fff", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 6, padding: "8px 10px", fontSize: 13, marginBottom: 16 }}>
          <option value="LAST_7_DAYS">Last 7 days</option>
          <option value="LAST_30_DAYS">Last 30 days</option>
          <option value="LAST_90_DAYS">Last 90 days</option>
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#fff", cursor: "pointer", marginBottom: 20 }}>
          <input type="checkbox" checked={includeAi} onChange={(e) => setIncludeAi(e.target.checked)} /> Include AI analysis (Claude) after fetch
        </label>
        <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
          <button onClick={onClose} style={{ background: "rgba(255,255,255,0.06)", color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 600, borderRadius: 6, border: "1px solid rgba(255,255,255,0.14)", cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onRun(range, undefined, undefined, includeAi)} style={{ background: "#1877F2", color: "#fff", padding: "8px 14px", fontSize: 13, fontWeight: 700, borderRadius: 6, border: "none", cursor: "pointer" }}>&#9654; Run Audit</button>
        </div>
      </div>
    </div>
  );
}
