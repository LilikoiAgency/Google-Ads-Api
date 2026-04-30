"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const C = {
  bg: "#0f0f17",
  card: "#1a1a2e",
  border: "rgba(255,255,255,0.08)",
  accent: "#e94560",
  teal: "#4ecca3",
  amber: "#f5a623",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.55)",
};

const AUDITS = [
  {
    key: "search_term_waste",
    title: "Search Term Waste Audit",
    eyebrow: "Query quality",
    description: "Find wasted spend, irrelevant intent, PMax/AI query leakage, negative keywords, and converting terms to build out.",
    accent: C.teal,
  },
  {
    key: "tracking_integrity",
    title: "Conversion Tracking Audit",
    eyebrow: "Measurement",
    description: "Inspect conversion actions, primary goals, stale signals, and campaigns spending with zero recorded conversions.",
    accent: C.accent,
  },
  {
    key: "landing_page_alignment",
    title: "Landing Page Alignment Audit",
    eyebrow: "Intent match",
    description: "Review landing page spend, zero-conversion URLs, CVR gaps, quality score signals, and query-to-page alignment.",
    accent: C.amber,
  },
  {
    key: "budget_impression_share",
    title: "Budget & Impression Share Audit",
    eyebrow: "Opportunity",
    description: "Separate budget-limited winners from rank-limited or inefficient campaigns that should not receive more spend.",
    accent: "#60a5fa",
  },
  {
    key: "bidding_strategy",
    title: "Bidding Strategy Audit",
    eyebrow: "Bid logic",
    description: "Check bid strategy fit, conversion-volume readiness, target pressure, learning constraints, and lag risk.",
    accent: "#a78bfa",
  },
  {
    key: "asset_creative",
    title: "Asset & Creative Coverage Audit",
    eyebrow: "Creative inputs",
    description: "Review RSAs, pinned headlines, missing extensions, PMax asset groups, and asset coverage gaps.",
    accent: "#fb7185",
  },
];

const DATE_RANGE_OPTIONS = [
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "LAST_60_DAYS", label: "Last 60 days" },
  { value: "LAST_90_DAYS", label: "Last 90 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "LAST_MONTH", label: "Last month" },
  { value: "THIS_YEAR", label: "This year" },
  { value: "CUSTOM", label: "Custom range" },
];

function formatDateInputValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function getDefaultCustomDateRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 29);
  return {
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
  };
}

function AuditTypesInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const dateRange = searchParams.get("dateRange") || "LAST_30_DAYS";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const defaultCustomRange = useMemo(() => getDefaultCustomDateRange(), []);
  const [customDates, setCustomDates] = useState({
    startDate: startDate || defaultCustomRange.startDate,
    endDate: endDate || defaultCustomRange.endDate,
  });

  const baseParams = useMemo(() => {
    const params = new URLSearchParams();
    ["customerId", "campaignId", "dateRange", "startDate", "endDate"].forEach((key) => {
      const value = searchParams.get(key);
      if (value) params.set(key, value);
    });
    return params;
  }, [searchParams]);

  function updateDateRange(nextDateRange, nextStartDate = startDate, nextEndDate = endDate) {
    const params = new URLSearchParams(baseParams);
    params.set("dateRange", nextDateRange);
    params.delete("startDate");
    params.delete("endDate");
    if (nextDateRange === "CUSTOM" && nextStartDate && nextEndDate) {
      params.set("startDate", nextStartDate);
      params.set("endDate", nextEndDate);
    }
    router.push(`/dashboard/google/ads/audit-types?${params.toString()}`);
  }

  function openAudit(type) {
    const params = new URLSearchParams(baseParams);
    params.set("auditType", type);
    router.push(`/dashboard/google/ads/audit-types/${type}?${params.toString()}`);
  }

  function openFullAudit() {
    const params = new URLSearchParams(baseParams);
    params.delete("auditType");
    router.push(`/dashboard/google/ads/audit?${params.toString()}`);
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.textPri, padding: 32 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 28 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1.6px", color: C.accent, margin: "0 0 8px" }}>Specialized Google Ads Audits</p>
            <h1 style={{ fontSize: 30, lineHeight: 1.15, margin: 0 }}>Choose a focused audit</h1>
            <p style={{ margin: "8px 0 0", color: C.textSec, fontSize: 14 }}>Date range: <span style={{ color: C.textPri, fontWeight: 800 }}>{DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label || dateRange}</span></p>
          </div>
          <button onClick={() => router.back()} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 16px", color: C.textSec, fontWeight: 700, cursor: "pointer" }}>
            Back
          </button>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 18 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.textSec, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.8px", marginRight: 4 }}>Date range</span>
            {DATE_RANGE_OPTIONS.filter((option) => option.value !== "CUSTOM").map((option) => (
              <button
                key={option.value}
                onClick={() => updateDateRange(option.value)}
                style={{
                  background: dateRange === option.value ? C.accent : "rgba(255,255,255,0.05)",
                  border: `1px solid ${dateRange === option.value ? C.accent : C.border}`,
                  borderRadius: 7,
                  color: dateRange === option.value ? "#fff" : C.textSec,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 900,
                  padding: "8px 10px",
                }}
              >
                {option.label}
              </button>
            ))}
            <button
              onClick={() => updateDateRange("CUSTOM", customDates.startDate, customDates.endDate)}
              style={{
                background: dateRange === "CUSTOM" ? C.accent : "rgba(255,255,255,0.05)",
                border: `1px solid ${dateRange === "CUSTOM" ? C.accent : C.border}`,
                borderRadius: 7,
                color: dateRange === "CUSTOM" ? "#fff" : C.textSec,
                cursor: "pointer",
                fontSize: 12,
                fontWeight: 900,
                padding: "8px 10px",
              }}
            >
              Custom range
            </button>
          </div>
          {dateRange === "CUSTOM" && (
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 12 }}>
              <input type="date" value={customDates.startDate} max={customDates.endDate || undefined} onChange={(e) => setCustomDates((cur) => ({ ...cur, startDate: e.target.value }))} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 7, color: C.textPri, padding: "8px 10px" }} />
              <span style={{ color: C.textSec, fontSize: 13 }}>to</span>
              <input type="date" value={customDates.endDate} min={customDates.startDate || undefined} onChange={(e) => setCustomDates((cur) => ({ ...cur, endDate: e.target.value }))} style={{ background: "rgba(255,255,255,0.05)", border: `1px solid ${C.border}`, borderRadius: 7, color: C.textPri, padding: "8px 10px" }} />
              <button onClick={() => updateDateRange("CUSTOM", customDates.startDate, customDates.endDate)} disabled={!customDates.startDate || !customDates.endDate || customDates.startDate > customDates.endDate} style={{ background: C.teal, border: "none", borderRadius: 7, color: "#06130f", cursor: "pointer", fontSize: 12, fontWeight: 900, padding: "9px 12px", opacity: !customDates.startDate || !customDates.endDate || customDates.startDate > customDates.endDate ? 0.5 : 1 }}>Apply</button>
            </div>
          )}
        </div>

        <button onClick={openFullAudit} style={{ width: "100%", textAlign: "left", background: "rgba(233,69,96,0.08)", border: "1px solid rgba(233,69,96,0.25)", borderRadius: 10, padding: 20, marginBottom: 18, cursor: "pointer" }}>
          <p style={{ margin: "0 0 6px", fontSize: 12, textTransform: "uppercase", letterSpacing: "1px", color: C.accent, fontWeight: 900 }}>Original Audit</p>
          <p style={{ margin: 0, fontSize: 18, color: C.textPri, fontWeight: 800 }}>Full Account Audit</p>
          <p style={{ margin: "7px 0 0", color: C.textSec, fontSize: 14 }}>The existing comprehensive audit with the original full-account workflow.</p>
        </button>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))", gap: 14 }}>
          {AUDITS.map((audit) => (
            <button key={audit.key} onClick={() => openAudit(audit.key)} style={{ textAlign: "left", background: C.card, border: `1px solid ${C.border}`, borderTop: `3px solid ${audit.accent}`, borderRadius: 10, padding: 20, minHeight: 168, cursor: "pointer" }}>
              <p style={{ margin: "0 0 8px", fontSize: 11, textTransform: "uppercase", letterSpacing: "1px", color: audit.accent, fontWeight: 900 }}>{audit.eyebrow}</p>
              <p style={{ margin: "0 0 10px", fontSize: 18, color: C.textPri, fontWeight: 800 }}>{audit.title}</p>
              <p style={{ margin: 0, color: C.textSec, fontSize: 14, lineHeight: 1.55 }}>{audit.description}</p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AuditTypesPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: C.bg }} />}>
      <AuditTypesInner />
    </Suspense>
  );
}
