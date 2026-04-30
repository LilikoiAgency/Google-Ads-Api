"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { runAudit, fmtCurrency, fmtPct } from "../../../../../../lib/googleAdsAudit";

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

const AUDITS = {
  search_term_waste: {
    title: "Search Term Waste Audit",
    eyebrow: "Query quality",
    focus: "Wasted spend, irrelevant intent, PMax/AI query leakage, negatives, and exact-match buildouts.",
  },
  tracking_integrity: {
    title: "Conversion Tracking Audit",
    eyebrow: "Measurement",
    focus: "Conversion action health, primary goals, stale signals, and spend with zero recorded conversions.",
  },
  landing_page_alignment: {
    title: "Landing Page Alignment Audit",
    eyebrow: "Intent match",
    focus: "Landing page spend, zero-conversion URLs, CVR gaps, quality score, and query-to-page alignment.",
  },
  budget_impression_share: {
    title: "Budget & Impression Share Audit",
    eyebrow: "Opportunity",
    focus: "Budget-limited winners, rank-limited campaigns, and spend that should not receive more budget.",
  },
  bidding_strategy: {
    title: "Bidding Strategy Audit",
    eyebrow: "Bid logic",
    focus: "Bid strategy fit, conversion-volume readiness, target pressure, learning constraints, and lag risk.",
  },
  asset_creative: {
    title: "Asset & Creative Coverage Audit",
    eyebrow: "Creative inputs",
    focus: "RSAs, pinned headlines, missing extensions, PMax asset groups, and asset coverage gaps.",
  },
};

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

function formatDateLabel(dateRange, startDate, endDate) {
  if (dateRange === "CUSTOM" && startDate && endDate) {
    const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${formatter.format(new Date(`${startDate}T00:00:00`))} - ${formatter.format(new Date(`${endDate}T00:00:00`))}`;
  }
  return DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label || dateRange.replace(/_/g, " ").toLowerCase();
}

function kpi(label, value, color) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "16px 18px" }}>
      <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.7px", fontWeight: 800 }}>{label}</p>
      <p style={{ fontSize: 24, color: color || C.textPri, margin: 0, fontWeight: 900 }}>{value}</p>
    </div>
  );
}

function row(left, mid, right, tone) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 150px 120px", gap: 14, padding: "11px 0", borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
      <span style={{ color: C.textPri, fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{left}</span>
      <span style={{ color: C.textSec, fontSize: 13 }}>{mid}</span>
      <span style={{ color: tone || C.textSec, fontSize: 13, fontWeight: 800, textAlign: "right" }}>{right}</span>
    </div>
  );
}

function EmptyState({ children = "No rows found for this audit." }) {
  return <p style={{ color: C.textSec, fontSize: 15, margin: "10px 0" }}>{children}</p>;
}

function SearchTermTable({ rows = [], tone = C.textSec, empty }) {
  if (!rows.length) return <EmptyState>{empty}</EmptyState>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 780 }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 90px 90px 120px 90px", gap: 12, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
          {["Search term", "Campaign", "Clicks", "Conv.", "Spend", "CPA"].map((label) => (
            <span key={label} style={{ fontSize: 11, color: C.textSec, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.7px", textAlign: ["Clicks", "Conv.", "Spend", "CPA"].includes(label) ? "right" : "left" }}>{label}</span>
          ))}
        </div>
        {rows.map((term, index) => {
          const conversions = Number(term.conversions || 0);
          const cost = Number(term.cost || 0);
          const cpa = conversions > 0 ? cost / conversions : null;
          return (
            <div key={`${term.term}-${term.campaignName || ""}-${index}`} style={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 90px 90px 120px 90px", gap: 12, padding: "11px 0", borderBottom: `1px solid ${C.border}`, alignItems: "start" }}>
              <span style={{ color: C.textPri, fontSize: 14, lineHeight: 1.35, wordBreak: "break-word" }}>{term.term || "Unknown term"}</span>
              <span style={{ color: C.textSec, fontSize: 13, lineHeight: 1.35 }} title={(term.campaignNames || [term.campaignName]).filter(Boolean).join(", ")}>
                {term.campaignLabel || term.campaignName || "-"}
              </span>
              <span style={{ color: C.textSec, fontSize: 13, textAlign: "right" }}>{term.clicks || 0}</span>
              <span style={{ color: conversions > 0 ? C.teal : C.accent, fontSize: 13, fontWeight: 800, textAlign: "right" }}>{conversions.toFixed(1)}</span>
              <span style={{ color: tone, fontSize: 13, fontWeight: 800, textAlign: "right" }}>{fmtCurrency(cost)}</span>
              <span style={{ color: cpa ? C.textSec : C.accent, fontSize: 13, textAlign: "right" }}>{cpa ? fmtCurrency(cpa) : "-"}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function aggregateSearchTerms(rows = []) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = (row.term || "Unknown term").toLowerCase().trim();
    const existing = grouped.get(key) || {
      ...row,
      term: row.term || "Unknown term",
      clicks: 0,
      conversions: 0,
      cost: 0,
      campaignNames: [],
    };
    existing.clicks += Number(row.clicks || 0);
    existing.conversions += Number(row.conversions || 0);
    existing.cost += Number(row.cost || 0);
    if (row.campaignName && !existing.campaignNames.includes(row.campaignName)) {
      existing.campaignNames.push(row.campaignName);
    }
    grouped.set(key, existing);
  });

  return Array.from(grouped.values())
    .map((row) => ({
      ...row,
      campaignLabel: row.campaignNames.length === 1 ? row.campaignNames[0] : `${row.campaignNames.length} campaigns`,
    }))
    .sort((a, b) => {
      if ((b.conversions || 0) !== (a.conversions || 0)) return (b.conversions || 0) - (a.conversions || 0);
      return (b.cost || 0) - (a.cost || 0);
    });
}

const ASSET_TYPES = ["SITELINK", "CALLOUT", "STRUCTURED_SNIPPET", "CALL", "IMAGE"];
const ASSET_LABELS = {
  SITELINK: "Sitelink",
  CALLOUT: "Callout",
  STRUCTURED_SNIPPET: "Snippet",
  CALL: "Call",
  IMAGE: "Image",
};

function AssetCoverageMatrix({ assets = [] }) {
  if (!assets.length) return <EmptyState>No campaign asset coverage rows were returned.</EmptyState>;
  return (
    <div style={{ overflowX: "auto" }}>
      <div style={{ minWidth: 780 }}>
        <div style={{ display: "grid", gridTemplateColumns: `minmax(260px,1fr) ${ASSET_TYPES.map(() => "92px").join(" ")} 90px`, gap: 8, padding: "10px 0", borderBottom: `1px solid ${C.border}` }}>
          <span style={{ fontSize: 11, color: C.textSec, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.7px" }}>Campaign</span>
          {ASSET_TYPES.map((type) => <span key={type} style={{ fontSize: 11, color: C.textSec, fontWeight: 900, textAlign: "center" }}>{ASSET_LABELS[type]}</span>)}
          <span style={{ fontSize: 11, color: C.textSec, fontWeight: 900, textAlign: "right" }}>Score</span>
        </div>
        {assets.map((asset, index) => (
          <div key={`${asset.campaignName}-${index}`} style={{ display: "grid", gridTemplateColumns: `minmax(260px,1fr) ${ASSET_TYPES.map(() => "92px").join(" ")} 90px`, gap: 8, padding: "12px 0", borderBottom: `1px solid ${C.border}`, alignItems: "center" }}>
            <div>
              <p style={{ color: C.textPri, fontSize: 14, lineHeight: 1.35, margin: 0, fontWeight: 800 }}>{asset.campaignName}</p>
              {asset.missingTypes?.length > 0 && (
                <p style={{ color: C.textSec, fontSize: 12, lineHeight: 1.4, margin: "4px 0 0" }}>Missing {asset.missingTypes.map((type) => ASSET_LABELS[type] || type).join(", ")}</p>
              )}
            </div>
            {ASSET_TYPES.map((type) => {
              const present = asset.presentTypes?.includes(type);
              return (
                <span key={type} style={{ color: present ? C.teal : C.accent, fontSize: 13, fontWeight: 900, textAlign: "center" }}>
                  {present ? "Present" : "Missing"}
                </span>
              );
            })}
            <span style={{ color: asset.coverageScore >= 0.8 ? C.teal : asset.coverageScore >= 0.6 ? C.amber : C.accent, fontSize: 15, fontWeight: 900, textAlign: "right" }}>
              {Math.round((asset.coverageScore || 0) * 100)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildAiPayload(audit, meta, customerId, accountName, dateRange) {
  const toDollars = (micros) => (micros == null ? null : Math.round((micros || 0) / 1_000_000));
  return {
    accountName,
    customerId,
    dateRange,
    auditType: meta.key,
    auditTypeLabel: meta.title,
    auditTypeFocus: meta.focus,
    summary: {
      totalCost: toDollars(audit.summary.totalCost),
      totalConversions: audit.summary.totalConversions,
      blendedCPA: toDollars(audit.summary.blendedCPA),
      lrRatio: audit.summary.lrRatio,
    },
    campaigns: audit.campaigns.map((c) => ({
      campaignName: c.campaignName,
      verdict: c.verdict?.key,
      cost: toDollars(c.cost),
      clicks: c.clicks,
      conversions: c.conversions,
      cpa: toDollars(c.cpa),
      searchBudgetLostImpressionShare: c.searchBudgetLostImpressionShare,
      searchRankLostImpressionShare: c.searchRankLostImpressionShare,
    })),
    searchTerms: audit.searchTerms,
    keywords: audit.keywords,
    bidding: audit.bidding,
    assets: audit.assets,
    pmaxData: audit.pmaxData,
    conversionActions: audit.conversionActions,
    landingPages: audit.landingPages,
    campaignSearchTerms: audit.campaignSearchTerms,
    recentChanges: audit.changeStatus,
    geoPerformance: audit.geoPerformance,
    daypartPerformance: audit.daypartPerformance,
    conversionLag: audit.conversionLag,
  };
}

function FocusContent({ type, audit }) {
  if (type === "tracking_integrity") {
    const primary = audit.conversionActions.filter((a) => a.primaryForGoal);
    const stale = primary.filter((a) => !a.lastReceivedRequestDateTime && !a.lastConversionDate);
    const zero = audit.campaigns.filter((c) => (c.cost || 0) > 0 && (c.conversions || 0) === 0).sort((a, b) => b.cost - a.cost);
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, marginBottom: 24 }}>
          {kpi("Conversion actions", audit.conversionActions.length)}
          {kpi("Primary actions", primary.length, primary.length ? C.teal : C.accent)}
          {kpi("Primary no signal", stale.length, stale.length ? C.accent : C.teal)}
          {kpi("Zero-conv spenders", zero.length, zero.length ? C.amber : C.teal)}
        </div>
        <Section title="Conversion Actions">
          {audit.conversionActions.map((a, i) => row(a.name, a.primaryForGoal ? "Primary" : "Secondary", a.lastReceivedRequestDateTime || a.lastConversionDate || "No signal", !a.lastReceivedRequestDateTime && !a.lastConversionDate ? C.accent : C.textSec))}
        </Section>
        <Section title="Campaigns Spending With Zero Conversions">
          {zero.slice(0, 15).map((c) => row(c.campaignName, `${c.clicks || 0} clicks`, fmtCurrency(c.cost), C.accent))}
        </Section>
      </>
    );
  }

  if (type === "landing_page_alignment") {
    const pages = [...audit.landingPages].sort((a, b) => b.cost - a.cost);
    return <Section title="Landing Pages by Spend">{pages.slice(0, 30).map((p) => row(p.url, p.device || p.campaignName, `${fmtCurrency(p.cost)} / ${Number(p.conversions || 0).toFixed(1)} conv`, p.conversions ? C.teal : C.accent))}</Section>;
  }

  if (type === "budget_impression_share") {
    const rows = [...audit.campaigns].sort((a, b) => ((b.searchBudgetLostImpressionShare || 0) + (b.searchRankLostImpressionShare || 0)) - ((a.searchBudgetLostImpressionShare || 0) + (a.searchRankLostImpressionShare || 0)));
    return <Section title="Budget vs Rank Constraints">{rows.map((c) => row(c.campaignName, `Budget ${fmtPct(c.searchBudgetLostImpressionShare || 0)} / Rank ${fmtPct(c.searchRankLostImpressionShare || 0)}`, `${fmtCurrency(c.cost)} / ${Number(c.conversions || 0).toFixed(1)} conv`, c.conversions ? C.teal : C.amber))}</Section>;
  }

  if (type === "bidding_strategy") {
    return <Section title="Bidding Strategy Fit">{audit.bidding.map((b) => row(b.campaignName, b.biddingStrategyType?.replace(/_/g, " ") || "Unknown", b.recommendation || "No issue", b.status === "warn" ? C.accent : b.status === "info" ? C.amber : C.teal))}</Section>;
  }

  if (type === "asset_creative") {
    const lowCoverage = audit.assets.filter((asset) => (asset.coverageScore || 0) < 0.8);
    const pinnedCount = audit.adStrength?.pinnedCount || 0;
    const underHeadlined = audit.adStrength?.underHeadlined || [];
    return (
      <>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
          {kpi("Campaigns checked", audit.assets.length)}
          {kpi("Coverage gaps", lowCoverage.length, lowCoverage.length ? C.accent : C.teal)}
          {kpi("Under-headlined RSAs", underHeadlined.length, underHeadlined.length ? C.amber : C.teal)}
          {kpi("Pinned assets", pinnedCount, pinnedCount ? C.amber : C.teal)}
        </div>
        <Section title="Extension Coverage by Campaign">
          <AssetCoverageMatrix assets={audit.assets} />
        </Section>
        {underHeadlined.length > 0 && (
          <Section title="Responsive Search Ads With Too Few Headlines">
            {underHeadlined.map((item, index) => row(item.campaignName || item.campaignId || `Ad ${index + 1}`, `${item.headlineCount || 0} headlines`, "Add more headlines", C.amber))}
          </Section>
        )}
        {audit.pmaxData?.length > 0 && (
          <Section title="Performance Max Creative Coverage">
            {audit.pmaxData.map((pmax, index) => row(
              pmax.campaignName,
              `${pmax.assetGroupCount} asset group${pmax.assetGroupCount === 1 ? "" : "s"}`,
              `${fmtCurrency(pmax.cost)} / ${Number(pmax.conversions || 0).toFixed(1)} conv`,
              pmax.flags?.length ? C.accent : C.teal
            ))}
          </Section>
        )}
      </>
    );
  }

  const pmaxOrAiSpend = audit.campaignSearchTerms.filter((t) => ["PERFORMANCE_MAX", "AI_MAX_BROAD_MATCH", "AI_MAX_KEYWORDLESS", "DYNAMIC_SEARCH_ADS"].includes(t.matchSource)).reduce((s, t) => s + (t.cost || 0), 0);
  const sourceRows = aggregateSearchTerms(audit.campaignSearchTerms.filter((t) => ["PERFORMANCE_MAX", "AI_MAX_BROAD_MATCH", "AI_MAX_KEYWORDLESS", "DYNAMIC_SEARCH_ADS"].includes(t.matchSource)));
  const wastedRows = aggregateSearchTerms(audit.searchTerms.wasted);
  const uncoveredRows = aggregateSearchTerms(audit.searchTerms.uncoveredWinners);
  const hasWaste = (audit.searchTerms.totalWastedCost || 0) > 0;
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 12, marginBottom: 24 }}>
        {kpi("Wasted spend", fmtCurrency(audit.searchTerms.totalWastedCost), audit.searchTerms.totalWastedCost ? C.accent : C.teal)}
        {kpi("Waste ratio", fmtPct(audit.searchTerms.wasteRatio), audit.searchTerms.wasteRatio > 0.08 ? C.accent : C.teal)}
        {kpi("PMax / AI / DSA query spend", fmtCurrency(pmaxOrAiSpend), pmaxOrAiSpend ? C.amber : C.textPri)}
        {kpi("Wasted terms", wastedRows.length, wastedRows.length ? C.accent : C.teal)}
      </div>
      {!hasWaste && (
        <div style={{ background: "rgba(78,204,163,0.08)", border: "1px solid rgba(78,204,163,0.22)", borderRadius: 10, padding: "14px 16px", marginBottom: 20 }}>
          <p style={{ color: C.teal, fontSize: 15, fontWeight: 800, margin: "0 0 4px" }}>No zero-conversion search term waste found in this range.</p>
          <p style={{ color: C.textSec, fontSize: 14, lineHeight: 1.55, margin: 0 }}>The remaining rows are buildout opportunities: converting queries that do not appear as exact-match keywords in the keyword audit data.</p>
        </div>
      )}
      <Section title={`Wasted Search Terms (${wastedRows.length})`}>
        <SearchTermTable rows={wastedRows} tone={C.accent} empty="No significant wasted spend detected." />
      </Section>
      <Section title={`Exact-Match Buildout Opportunities (${uncoveredRows.length})`}>
        <SearchTermTable rows={uncoveredRows} tone={C.teal} empty="No uncovered exact-match buildout opportunities found." />
      </Section>
      {sourceRows.length > 0 && (
        <Section title={`PMax / AI / DSA Search Terms (${sourceRows.length})`}>
          <SearchTermTable rows={sourceRows} tone={C.amber} empty="No PMax, AI Max, or DSA search term rows found." />
        </Section>
      )}
    </>
  );
}

function Section({ title, children }) {
  return (
    <div style={{ marginBottom: 28 }}>
      <p style={{ fontSize: 12, fontWeight: 900, color: C.textSec, textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 12px" }}>{title}</p>
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: "8px 18px" }}>{children}</div>
    </div>
  );
}

function SpecializedAuditInner() {
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const type = String(params.type || "");
  const meta = { key: type, ...(AUDITS[type] || AUDITS.search_term_waste) };
  const customerId = searchParams.get("customerId");
  const dateRange = searchParams.get("dateRange") || "LAST_30_DAYS";
  const startDate = searchParams.get("startDate");
  const endDate = searchParams.get("endDate");
  const defaultCustomRange = useMemo(() => getDefaultCustomDateRange(), []);
  const [customDates, setCustomDates] = useState({
    startDate: startDate || defaultCustomRange.startDate,
    endDate: endDate || defaultCustomRange.endDate,
  });
  const [accountData, setAccountData] = useState(null);
  const [auditData, setAuditData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiInsight, setAiInsight] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!customerId) return;
    try {
      const raw = sessionStorage.getItem(`auditAccountData:${customerId}`) || sessionStorage.getItem("auditAccountData");
      if (raw) setAccountData(JSON.parse(raw));
    } catch {}
  }, [customerId]);

  useEffect(() => {
    if (!customerId) return;
    const qs = new URLSearchParams({ customerId, dateRange });
    if (dateRange === "CUSTOM" && startDate && endDate) {
      qs.set("startDate", startDate);
      qs.set("endDate", endDate);
    }
    setLoading(true);
    fetch(`/api/googleads/audit?${qs.toString()}`)
      .then((r) => r.ok ? r.json() : Promise.reject(r.status))
      .then((json) => setAuditData(json.data || null))
      .catch((err) => setError(String(err)))
      .finally(() => setLoading(false));
  }, [customerId, dateRange, startDate, endDate]);

  const audit = useMemo(() => accountData ? runAudit(accountData, auditData, null) : null, [accountData, auditData]);
  const accountName = accountData?.customer?.customer_client?.descriptive_name || "Account";
  const dateLabel = formatDateLabel(dateRange, startDate, endDate);

  function buildPageParams(next = {}) {
    const params = new URLSearchParams();
    if (customerId) params.set("customerId", customerId);
    const nextDateRange = next.dateRange || dateRange;
    const nextStartDate = next.startDate ?? startDate;
    const nextEndDate = next.endDate ?? endDate;
    params.set("dateRange", nextDateRange);
    if (nextDateRange === "CUSTOM" && nextStartDate && nextEndDate) {
      params.set("startDate", nextStartDate);
      params.set("endDate", nextEndDate);
    }
    return params;
  }

  function applyDateRange(nextDateRange) {
    const next = { dateRange: nextDateRange };
    if (nextDateRange === "CUSTOM") {
      next.startDate = customDates.startDate;
      next.endDate = customDates.endDate;
    }
    setAiInsight(null);
    router.push(`/dashboard/google/ads/audit-types/${type}?${buildPageParams(next).toString()}`);
  }

  function applyCustomDates() {
    if (!customDates.startDate || !customDates.endDate || customDates.startDate > customDates.endDate) return;
    setAiInsight(null);
    router.push(`/dashboard/google/ads/audit-types/${type}?${buildPageParams({
      dateRange: "CUSTOM",
      startDate: customDates.startDate,
      endDate: customDates.endDate,
    }).toString()}`);
  }

  async function runAi() {
    if (!audit || !customerId) return;
    setAiLoading(true);
    setError(null);
    try {
      const payload = buildAiPayload(audit, meta, customerId, accountName, dateRange);
      const res = await fetch("/api/claude/google-ads-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, payload }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setAiInsight(json.data);
    } catch (err) {
      setError(err.message);
    } finally {
      setAiLoading(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.textPri, padding: 28 }}>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 18, alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 900, textTransform: "uppercase", letterSpacing: "1.5px", color: C.accent, margin: "0 0 6px" }}>{meta.eyebrow}</p>
            <h1 style={{ fontSize: 28, margin: "0 0 8px", lineHeight: 1.15 }}>{meta.title}</h1>
            <p style={{ fontSize: 15, color: C.textSec, margin: 0 }}>{accountName} - {meta.focus}</p>
            <p style={{ fontSize: 13, color: C.textSec, margin: "8px 0 0" }}>Date range: <span style={{ color: C.textPri, fontWeight: 800 }}>{dateLabel}</span></p>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => router.push(`/dashboard/google/ads/audit-types?${buildPageParams().toString()}`)} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", color: C.textSec, fontWeight: 800, cursor: "pointer" }}>All Specialized Audits</button>
            <button onClick={() => router.push(`/dashboard/google/ads/audit?${buildPageParams().toString()}`)} style={{ background: "rgba(255,255,255,0.06)", border: `1px solid ${C.border}`, borderRadius: 8, padding: "9px 14px", color: C.textSec, fontWeight: 800, cursor: "pointer" }}>Full Audit</button>
          </div>
        </div>

        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 14, marginBottom: 22 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <span style={{ color: C.textSec, fontSize: 12, fontWeight: 900, textTransform: "uppercase", letterSpacing: "0.8px", marginRight: 4 }}>Date range</span>
            {DATE_RANGE_OPTIONS.filter((option) => option.value !== "CUSTOM").map((option) => (
              <button
                key={option.value}
                onClick={() => applyDateRange(option.value)}
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
              onClick={() => applyDateRange("CUSTOM")}
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
              <button onClick={applyCustomDates} disabled={!customDates.startDate || !customDates.endDate || customDates.startDate > customDates.endDate} style={{ background: C.teal, border: "none", borderRadius: 7, color: "#06130f", cursor: "pointer", fontSize: 12, fontWeight: 900, padding: "9px 12px", opacity: !customDates.startDate || !customDates.endDate || customDates.startDate > customDates.endDate ? 0.5 : 1 }}>Apply</button>
            </div>
          )}
        </div>

        {loading && <p style={{ color: C.textSec }}>Loading specialized audit data...</p>}
        {error && <p style={{ color: C.accent }}>{error}</p>}
        {!accountData && <p style={{ color: C.textSec }}>No account data loaded. Go back to Google Ads and choose an account first.</p>}

        {audit && (
          <>
            <FocusContent type={type} audit={audit} />
            <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 8, padding: 20, marginTop: 28 }}>
              <p style={{ fontSize: 12, fontWeight: 900, color: C.textSec, textTransform: "uppercase", letterSpacing: "1px", margin: "0 0 8px" }}>AI {meta.title}</p>
              <p style={{ color: C.textSec, fontSize: 15, lineHeight: 1.6, margin: "0 0 16px" }}>
                Claude will analyze this account only through the lens of {meta.title.toLowerCase()}: {meta.focus}
              </p>
              <button onClick={runAi} disabled={aiLoading} style={{ background: C.accent, border: "none", borderRadius: 8, padding: "10px 18px", color: "#fff", fontWeight: 900, cursor: aiLoading ? "not-allowed" : "pointer" }}>
                {aiLoading ? "Running..." : `Run AI ${meta.title}`}
              </button>
              {aiInsight && (
                <div style={{ marginTop: 18, borderTop: `1px solid ${C.border}`, paddingTop: 18 }}>
                  <p style={{ fontSize: 18, color: C.textPri, fontWeight: 800, margin: "0 0 10px" }}>{aiInsight.account_grade ? `Grade ${aiInsight.account_grade}` : "AI Findings"}</p>
                  <p style={{ color: C.textSec, lineHeight: 1.7, margin: "0 0 16px" }}>{aiInsight.executive_summary}</p>
                  {(aiInsight.top_3_priorities || []).map((p, i) => <p key={i} style={{ color: C.textPri, lineHeight: 1.6, margin: "8px 0" }}>{i + 1}. {p}</p>)}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default function SpecializedAuditPage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", background: C.bg }} />}>
      <SpecializedAuditInner />
    </Suspense>
  );
}
