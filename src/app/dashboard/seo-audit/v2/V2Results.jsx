"use client";
// The v2 results as a full-width dashboard: header, headline numbers, searches you
// almost win next to the scores, the top moves, the plan by area and impact vs
// effort, then the Action Plan / Pages / per-area tabs and "About this audit".

import { useMemo, useState } from "react";
import s from "./audit.module.css";
import { auditSans } from "./fonts";
import { SectionTitle } from "../ui";
import { KpiRow, Opportunities, ScoresCard, TopMoves, PlanBreakdown } from "./ClientSummary";
import ActionPlan from "./ActionPlan";
import PageCards from "./PageCards";
import PassFindings, { IncompleteNotice } from "./PassFindings";
import Reputation from "./Reputation";
import TargetKeywords from "./TargetKeywords";
import ReportDownload from "./ReportDownload";
import { describeOptions } from "../../../../lib/seoAuditV2/options";
import { flattenTasks } from "../../../../lib/seoAuditV2/tasks";
import { applyCorrections } from "../../../../lib/seoAuditV2/corrections";
import p from "./plan.module.css";

const SOURCES = [
  ["crawl", "Site crawl"],
  ["search_console", "Search Console"],
  ["url_inspection", "URL Inspection"],
  ["sitemaps", "Sitemaps"],
  ["ga4", "Google Analytics"],
  ["pagespeed", "Page speed"],
  ["reviews", "Google reviews"],
  ["ai_search", "Web search check"],
  ["keyword_planner", "Keyword Planner"],
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
            const detail = ok && k === "crawl" && src.pages ? `, ${src.pages} pages`
              : src.site ? `: ${src.site}` : src.property ? `: ${src.property}` : "";
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

// Corrections added after the plan was last built (or rebuilt) call for "Update the plan".
export function needsReplan(result, corrections) {
  const built = Date.parse(result?.replanned_at || result?.audit_date || "");
  if (Number.isNaN(built)) return false;
  return (corrections || []).some((c) => Date.parse(c?.at) > built);
}

function ReplanBar({ review }) {
  return (
    <div className={p.replanBar}>
      <p>Rewrites the summary, scores and plan without the hidden work. About a minute.</p>
      <button type="button" className={p.primary} disabled={review.replanning} onClick={() => review.onReplan?.()}>
        {review.replanning ? "Updating the plan…" : "Update the plan"}
      </button>
      {review.replanError && <p role="alert" className={p.error} style={{ flexBasis: "100%" }}>{review.replanError}</p>}
    </div>
  );
}

// review (saved audits only): { auditId, corrections, canReplan, onCorrect, onUndo,
// onReplan, replanning, replanError }. Without it nothing is hidden or editable.
export default function V2Results({ result: raw, domain, actions, onBack, review }) {
  const [tab, setTab] = useState("plan");
  const [focusTask, setFocusTask] = useState(null); // a task opened from another tab
  const corrections = review?.corrections;
  const { result, hidden } = useMemo(() => {
    if (!raw || !corrections?.length) return { result: raw, hidden: [] };
    const out = applyCorrections(raw, corrections);
    // A hidden task's follow-ups go with it; list only the task itself.
    const tied = new Set(out.hidden.flatMap((h) => h.task.follow_ups || []));
    return { result: out.result, hidden: out.hidden.filter((h) => !tied.has(h.task)) };
  }, [raw, corrections]);
  if (!result) return null;
  const showReplan = Boolean(review?.canReplan && (review.replanning || needsReplan(result, corrections)));
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
    // Only present when reviews or the web search produced data; a skipped pass is never flagged.
    ...(result.reputation ? [{ key: "reputation", label: "Reputation", count: result.reputation.locations?.length || 0 }] : []),
    ...(result.targets ? [{ key: "targets", label: "Target keywords", ...flagged("targets", result.targets.pages?.length || 0) }] : []),
  ];
  const areaLabel = (key) => tabs.find((t) => t.key === key).label;
  const meta = [
    formatDate(result.audit_date),
    pagesCrawled ? `${pagesCrawled} pages crawled` : null,
    result.search?.range ? `Search Console ${result.search.range.startDate} to ${result.search.range.endDate}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <article className={`${s.doc} ${auditSans.variable}`}>
      <header className={s.top}>
        <div style={{ minWidth: 0 }}>
          {onBack ? (
            <button type="button" className={s.back} onClick={onBack}>
              <span aria-hidden>←</span> All audits
            </button>
          ) : (
            <p className={s.crumb}>SEO audits / {site}</p>
          )}
          <h2 className={s.domain}>
            {site}
            <span className={s.pill}>{result.audit_type === "quick" ? "Quick audit" : "Full audit"}</span>
          </h2>
          <p className={s.meta}>{meta}</p>
          {result.audit_options && <p className={s.custom}>Custom pages: {describeOptions(result.audit_options)}</p>}
        </div>
        <div className={s.actions}>
          <ReportDownload result={result} hiddenCount={hidden.length} />
          {actions}
        </div>
      </header>

      {showReplan && <ReplanBar review={review} />}
      <KpiRow result={result} />
      <div className={s.grid}>
        <Opportunities search={result.search} gscStatus={result.data_sources?.search_console?.status} />
        <ScoresCard scores={result.scores} summary={result.client_summary} />
      </div>
      <TopMoves moves={result.top_moves} />
      <PlanBreakdown plan={tasks} />

      <div className={s.tabs} role="tablist" aria-label="Audit sections">
        {tabs.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={s.tab} onClick={() => { setTab(t.key); setFocusTask(null); }}>
            {t.label}
            <span className={t.warn ? s.tabWarn : s.tabCount}>{t.count}</span>
          </button>
        ))}
      </div>

      <div className={`${s.card} ${s.panel}`}>
        <div role="tabpanel">
          {tab === "plan" && (
            <ActionPlan
              key={focusTask || "plan"}
              tasks={tasks}
              domain={site}
              auditDate={result.audit_date}
              focusId={focusTask}
              hidden={hidden}
              onCorrect={review?.onCorrect}
              onUndo={review?.onUndo}
            />
          )}
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
          {tab === "targets" && (
            <TargetKeywords
              targets={result.targets}
              findings={findings.targets}
              incomplete={incomplete("targets")}
              onTask={(id) => { setFocusTask(id); setTab("plan"); }}
            />
          )}
          {tab === "reputation" && (
            <>
              <Reputation reputation={result.reputation} />
              {findings.reputation?.length > 0 && (
                <>
                  <SectionTitle>Reputation findings</SectionTitle>
                  <PassFindings findings={findings.reputation} />
                </>
              )}
            </>
          )}
        </div>
      </div>

      <AboutAudit sources={result.data_sources} gaps={result.data_gaps} />
    </article>
  );
}
