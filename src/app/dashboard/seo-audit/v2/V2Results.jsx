"use client";
// The v2 results as a clean report sheet: header (domain, details, actions), a stat
// strip (scores and plan size), the summary, the top moves, the Action Plan /
// Pages / per-area tabs, and "About this audit" (data sources and gaps) at the end.

import { useState } from "react";
import s from "./audit.module.css";
import { auditSans } from "./fonts";
import { SectionTitle } from "../ui";
import { StatStrip, SummaryBox, TopMoves } from "./ClientSummary";
import ActionPlan from "./ActionPlan";
import PageCards from "./PageCards";
import PassFindings, { IncompleteNotice } from "./PassFindings";
import ReportDownload from "./ReportDownload";
import { describeOptions } from "../../../../lib/seoAuditV2/options";
import { flattenTasks } from "../../../../lib/seoAuditV2/tasks";

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

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function AboutAudit({ sources, gaps }) {
  const items = SOURCES.filter(([k]) => sources?.[k]);
  if (!items.length && !gaps?.length) return null;
  return (
    <details className={s.about}>
      <summary>
        About this audit
        {gaps?.length > 0 && <span className={s.gapHint}>, {gaps.length} data gap{gaps.length === 1 ? "" : "s"}</span>}
      </summary>
      {items.length > 0 && (
        <ul className={s.sources}>
          {items.map(([k, label]) => {
            const src = sources[k];
            const ok = src.status === "ok";
            const detail = ok && k === "crawl" && src.pages ? `, ${src.pages} pages` : "";
            return (
              <li key={k} className={ok ? s.ok : s.off}>
                {label}{detail}{!ok ? ` (${STATUS_TEXT[src.status] || src.status})` : ""}
              </li>
            );
          })}
        </ul>
      )}
      {gaps?.length > 0 && (
        <ul className={s.gaps}>
          {gaps.map((g) => <li key={g}>{g}</li>)}
        </ul>
      )}
    </details>
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
  const site = result.domain || domain;
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
  const meta = [
    `${result.audit_type === "quick" ? "Quick" : "Full"} audit`,
    formatDate(result.audit_date),
    pagesCrawled ? `${pagesCrawled} pages reviewed` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className={`${s.doc} ${auditSans.variable}`}>
      <header className={s.cover}>
        <div className={s.coverTop}>
          <div style={{ minWidth: 0 }}>
            <h2 className={s.domain}>{site}</h2>
            <p className={s.meta}>{meta}</p>
            {result.audit_options && <p className={s.custom}>Custom pages: {describeOptions(result.audit_options)}</p>}
          </div>
          <div className={s.actions}>
            <ReportDownload result={result} />
            {actions}
          </div>
        </div>
      </header>

      <StatStrip scores={result.scores} tasks={tasks} />
      <SummaryBox summary={result.client_summary} scores={result.scores} />

      <div className={s.sheet}>
        <TopMoves moves={result.top_moves} />

        <div className={s.tabs} role="tablist" aria-label="Audit sections">
          {tabs.map((t) => (
            <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={s.tab} onClick={() => setTab(t.key)}>
              {t.label}
              <span className={t.warn ? s.tabWarn : s.tabCount}>{t.count}</span>
            </button>
          ))}
        </div>

        <div role="tabpanel">
          {tab === "plan" && <ActionPlan tasks={tasks} domain={site} auditDate={result.audit_date} />}
          {tab === "pages" && (
            <>
              {incomplete("content") && <IncompleteNotice area="Content" />}
              {(!incomplete("content") || result.pages?.length > 0) && <PageCards pages={result.pages} tasks={pageTasks} domain={site} />}
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

        <AboutAudit sources={result.data_sources} gaps={result.data_gaps} />
      </div>
    </article>
  );
}
