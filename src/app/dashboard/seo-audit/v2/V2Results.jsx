"use client";
// The v2 results view: header with data sources and gaps, client summary, then
// Action Plan / Pages / per-area findings tabs.

import { useState } from "react";
import { Tabs, SectionTitle } from "../ui";
import ClientSummary from "./ClientSummary";
import ActionPlan from "./ActionPlan";
import PageCards from "./PageCards";
import PassFindings, { IncompleteNotice } from "./PassFindings";
import { describeOptions } from "../../../../lib/seoAuditV2/options";
import { flattenTasks } from "../../../../lib/seoAuditV2/tasks";
import ReportDownload from "./ReportDownload";

const SOURCES = [
  ["crawl", "Site crawl"],
  ["search_console", "Search Console"],
  ["url_inspection", "URL Inspection"],
  ["sitemaps", "Sitemaps"],
  ["ga4", "Google Analytics"],
  ["pagespeed", "Page speed"],
];

const STATUS_TEXT = {
  not_connected: "not connected",
  no_site: "site not in our Search Console",
  no_property: "no GA4 property for this site",
  no_data: "no data yet",
  error: "couldn't load",
  permission: "no access",
  timeout: "timed out",
};

function DataSources({ sources, gaps }) {
  const parts = SOURCES.filter(([k]) => sources?.[k]).map(([k, label]) => {
    const s = sources[k];
    const ok = s.status === "ok";
    const detail = ok && k === "crawl" && s.pages ? ` (${s.pages} pages)` : "";
    return (
      <span key={k} style={{ color: ok ? "#5eead4" : "#999" }}>
        {ok ? "✓" : "–"} {label}{detail}{!ok ? ` — ${STATUS_TEXT[s.status] || s.status}` : ""}
      </span>
    );
  });
  return (
    <div style={{ marginTop: 8 }}>
      {parts.length > 0 && (
        <p style={{ fontSize: 12, display: "flex", gap: 14, flexWrap: "wrap" }}>
          <span style={{ color: "#888" }}>Data:</span>
          {parts}
        </p>
      )}
      {gaps?.length > 0 && (
        <div style={{ marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(251,191,36,0.08)", border: "1px solid rgba(251,191,36,0.25)" }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#fbbf24", marginBottom: 4 }}>Data gaps</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {gaps.map((g) => <li key={g} style={{ fontSize: 12, color: "#fcd34d", lineHeight: 1.6 }}>{g}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function V2Results({ result, domain, actions }) {
  const [tab, setTab] = useState("plan");
  if (!result) return null;
  const tasks = result.action_plan || [];
  // Page cards list each page's own fixes, including ones nested in groups.
  const pageTasks = flattenTasks(tasks).filter((t) => !t.group);
  const findings = result.findings || {};
  const pagesCrawled = result.data_sources?.crawl?.pages;
  // Older results have no passes_completed; treat every area as complete there.
  const incomplete = (area) => result.passes_completed?.[area] === false;
  const flagged = (area, count) => (incomplete(area) ? { count: "!", warn: true } : { count });

  const tabs = [
    { key: "plan", label: "Action Plan", count: tasks.length },
    { key: "pages", label: "Pages", ...flagged("content", result.pages?.length || 0) },
    { key: "technical", label: "Technical", ...flagged("technical", findings.technical?.length || 0) },
    { key: "local", label: "Local & AI search", ...flagged("local", findings.local?.length || 0) },
    { key: "conversion", label: "Conversion", ...flagged("conversion", findings.conversion?.length || 0) },
  ];
  const areaLabel = (key) => tabs.find((t) => t.key === key).label;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 360px" }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{result.domain || domain}</h2>
          <p style={{ fontSize: 13, color: "#aaa" }}>
            {result.audit_type === "quick" ? "Quick" : "Full"} audit
            {pagesCrawled ? <> &middot; {pagesCrawled} pages crawled</> : null}
            {result.audit_date ? <> &middot; {result.audit_date}</> : null}
          </p>
          {result.audit_options && (
            <p style={{ fontSize: 12, color: "#5eead4", marginTop: 2 }}>Custom pages: {describeOptions(result.audit_options)}</p>
          )}
          <DataSources sources={result.data_sources} gaps={result.data_gaps} />
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap" }}>
          <ReportDownload result={result} />
          {actions}
        </div>
      </div>

      <ClientSummary result={result} />

      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        <Tabs tabs={tabs} active={tab} onSelect={setTab} />
        {tab === "plan" && <ActionPlan tasks={tasks} domain={result.domain || domain} auditDate={result.audit_date} />}
        {tab === "pages" && (
          <>
            {incomplete("content") && <IncompleteNotice area="Content" />}
            {(!incomplete("content") || result.pages?.length > 0) && <PageCards pages={result.pages} tasks={pageTasks} domain={result.domain || domain} />}
            {findings.content?.length > 0 && (
              <>
                <SectionTitle>Content findings</SectionTitle>
                <PassFindings findings={findings.content} />
              </>
            )}
          </>
        )}
        {tab === "technical" && <PassFindings findings={findings.technical} incomplete={incomplete("technical") ? areaLabel("technical") : undefined} />}
        {tab === "local" && <PassFindings findings={findings.local} incomplete={incomplete("local") ? areaLabel("local") : undefined} />}
        {tab === "conversion" && (
          <PassFindings
            findings={findings.conversion}
            incomplete={incomplete("conversion") ? areaLabel("conversion") : undefined}
            intro={result.data_sources?.ga4 && result.data_sources.ga4.status !== "ok" ? "Conversion analysis needs Google Analytics, which wasn't available for this site." : undefined}
          />
        )}
      </div>
    </div>
  );
}
