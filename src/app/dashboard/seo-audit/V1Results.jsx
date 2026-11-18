"use client";
// The v1 audit results view (audits saved before v2). Kept so old audits in history still render.

import { useState } from "react";
import { ScoreCard, CombinedScoreCard, SectionTitle, Tabs, getScoreStatus } from "./ui";

// ─── Formatters ──────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null) return "\u2014";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) {
  if (n == null) return "\u2014";
  return Number(n).toLocaleString("en-US");
}
function fmtPct(n) {
  if (n == null) return "\u2014";
  return (Number(n) * 100).toFixed(1) + "%";
}

const STATUS_CHIP = {
  Good:             { bg: "#e6f9f0", color: "#1a7a4a" },
  "Needs Attention": { bg: "#fef3cd", color: "#7d5a00" },
  Missing:          { bg: "#fde8e8", color: "#c0392b" },
};

function StatusChip({ status }) {
  const s = STATUS_CHIP[status] || STATUS_CHIP["Needs Attention"];
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {status}
    </span>
  );
}

const PRIORITY_CHIP = {
  critical:  { bg: "#fde8e8", color: "#c0392b" },
  high:      { bg: "#fef3cd", color: "#7d5a00" },
  medium:    { bg: "#e8f0fe", color: "#0c3473" },
  quick_win: { bg: "#e6f9f0", color: "#1a7a4a" },
};

function PriorityChip({ priority }) {
  const s = PRIORITY_CHIP[priority] || PRIORITY_CHIP.medium;
  const label = priority === "quick_win" ? "Quick Win" : priority.charAt(0).toUpperCase() + priority.slice(1);
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: s.bg, color: s.color }}>
      {label}
    </span>
  );
}

function FindingsTable({ findings }) {
  if (!findings || !findings.length) return <p style={{ color: "#999", fontSize: 13 }}>No findings in this section.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8f9fb" }}>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Signal</th>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Finding</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", width: 120 }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {findings.map((f, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333", whiteSpace: "nowrap" }}>{f.signal}</td>
              <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{f.finding}</td>
              <td style={{ padding: "10px 12px", textAlign: "center" }}><StatusChip status={f.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Crawl progress ──────────────────────────────────────────────────────────

function CrawlProgress({ pages, errors }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 12 }}>
        Crawled {pages.length} page{pages.length !== 1 ? "s" : ""}
        {errors.length > 0 && <span style={{ color: "#e74c3c" }}> ({errors.length} failed)</span>}
      </p>
      {pages.map((p, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
          <span style={{ color: "#27ae60" }}>&#10003;</span>
          <span style={{ color: "#333" }}>{p.url}</span>
          <span style={{ color: "#999", fontSize: 11 }}>({p.page_type})</span>
        </div>
      ))}
      {errors.map((e, i) => (
        <div key={`err-${i}`} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
          <span style={{ color: "#e74c3c" }}>&#10007;</span>
          <span style={{ color: "#999" }}>{e.url}</span>
          <span style={{ color: "#e74c3c", fontSize: 11 }}>({e.error})</span>
        </div>
      ))}
    </div>
  );
}

// ─── Results sections ────────────────────────────────────────────────────────

function SEOSection({ data }) {
  if (!data) return null;
  return (
    <div>
      <SectionTitle>Technical On-Page</SectionTitle>
      <FindingsTable findings={data.technical_on_page} />
      <SectionTitle>Content Quality</SectionTitle>
      <FindingsTable findings={data.content_quality} />
      <SectionTitle>Structured Data</SectionTitle>
      <FindingsTable findings={data.structured_data} />
    </div>
  );
}

function GEOSection({ data }) {
  if (!data) return null;
  return (
    <div>
      <SectionTitle>E-E-A-T Assessment</SectionTitle>
      <FindingsTable findings={data.eeat_assessment} />
      <SectionTitle>Content for AI Synthesis</SectionTitle>
      <FindingsTable findings={data.content_for_ai} />
      <SectionTitle>Technical GEO</SectionTitle>
      <FindingsTable findings={data.technical_geo} />
    </div>
  );
}

function AEOSection({ data }) {
  if (!data) return null;
  return (
    <div>
      <SectionTitle>Featured Snippet Eligibility</SectionTitle>
      <FindingsTable findings={data.snippet_eligibility} />
      <SectionTitle>Structured Answer Formats</SectionTitle>
      <FindingsTable findings={data.structured_answers} />
      <SectionTitle>Voice Search Readiness</SectionTitle>
      <FindingsTable findings={data.voice_search} />
    </div>
  );
}

function GSCSection({ data }) {
  if (!data) return <p style={{ color: "#999", fontSize: 13 }}>No Google Search Console data included in this audit.</p>;
  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>{data.summary}</p>
      {data.branded_vs_nonbranded && (
        <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Branded Clicks</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#0f3460" }}>{fmtPct(data.branded_vs_nonbranded.branded_click_share)}</p>
          </div>
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 200 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Non-Branded Clicks</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#27ae60" }}>{fmtPct(data.branded_vs_nonbranded.nonbranded_click_share)}</p>
          </div>
        </div>
      )}
      {data.top_opportunities?.length > 0 && (
        <>
          <SectionTitle>Top Opportunities</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Type</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Query / Page</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Current</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.top_opportunities.map((o, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{o.type?.replace(/_/g, " ")}</td>
                    <td style={{ padding: "10px 12px", color: "#333", maxWidth: 240, wordBreak: "break-all" }}>{o.query_or_page}</td>
                    <td style={{ padding: "10px 12px", color: "#666" }}>{o.current_metric}</td>
                    <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{o.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function fmtChange(n) {
  if (n == null) return "—";
  return `${n > 0 ? "▲" : n < 0 ? "▼" : ""} ${Math.abs(n)}%`.trim();
}

function AnalyticsSection({ data }) {
  if (!data) return <p style={{ color: "#999", fontSize: 13 }}>No Google Analytics data included in this audit.</p>;
  const trend = data.organic_trend || {};
  const stat = (label, value, color = "#0f3460") => (
    <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 160 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>{label}</p>
      <p style={{ fontSize: 20, fontWeight: 800, color }}>{value}</p>
    </div>
  );
  const changeColor = (n) => (n == null ? "#0f3460" : n >= 0 ? "#27ae60" : "#c0392b");
  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>{data.summary}</p>
      <div style={{ display: "flex", gap: 16, marginBottom: 16, flexWrap: "wrap" }}>
        {stat("Organic share of visits", fmtPct(data.organic_share_of_sessions))}
        {stat("Organic visits vs prior 90 days", fmtChange(trend.sessions_change_pct), changeColor(trend.sessions_change_pct))}
        {data.key_events_configured
          ? stat("Organic key events vs prior", fmtChange(trend.key_events_change_pct), changeColor(trend.key_events_change_pct))
          : stat("Lead tracking", "Not set up", "#c0392b")}
      </div>
      {trend.assessment && <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>{trend.assessment}</p>}
      {data.page_insights?.length > 0 && (
        <>
          <SectionTitle>Page Insights</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Page</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Finding</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.page_insights.map((p, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", color: "#333", maxWidth: 220, wordBreak: "break-all", fontWeight: 600 }}>{p.page}</td>
                    <td style={{ padding: "10px 12px", color: "#666", lineHeight: 1.5 }}>{p.finding}</td>
                    <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{p.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data.channel_insight && (
        <>
          <SectionTitle>Organic vs Other Channels</SectionTitle>
          <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{data.channel_insight}</p>
        </>
      )}
    </div>
  );
}

const SOURCE_STATUS = {
  ok: null,
  not_connected: "not connected",
  no_site: "this site isn't in Search Console for our login",
  no_property: "no GA4 property found for this site",
  no_data: "no data yet",
  error: "couldn't load",
};

// "Data: Site crawl · Search Console (sc-domain:x) · GA4 (BBT)" with reasons for anything missing.
function DataSourcesLine({ sources }) {
  if (!sources) return null;
  const part = (label, s, detail) => {
    if (!s) return null;
    const ok = s.status === "ok";
    return (
      <span key={label} style={{ color: ok ? "#5eead4" : "#888" }}>
        {ok ? "✓" : "–"} {label}{ok && detail ? ` (${detail})` : ""}{!ok ? ` — ${SOURCE_STATUS[s.status] || s.status}` : ""}
      </span>
    );
  };
  return (
    <p style={{ fontSize: 12, marginTop: 6, display: "flex", gap: 14, flexWrap: "wrap" }}>
      <span style={{ color: "#5eead4" }}>{"✓"} Site crawl</span>
      {part("Search Console", sources.search_console, sources.search_console?.site)}
      {part("Google Analytics", sources.ga4, sources.ga4?.property)}
      {sources.range && <span style={{ color: "#888" }}>{sources.range.startDate} to {sources.range.endDate}</span>}
    </p>
  );
}

function AdsSection({ data }) {
  if (!data) return <p style={{ color: "#999", fontSize: 13 }}>No Google Ads data included in this audit.</p>;
  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>{data.summary}</p>
      <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        {data.total_spend != null && (
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 140 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Total Spend</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#0f3460" }}>{fmt$(data.total_spend)}</p>
          </div>
        )}
        {data.total_conversions != null && (
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 140 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Conversions</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#27ae60" }}>{fmtN(data.total_conversions)}</p>
          </div>
        )}
        {data.blended_cpa != null && (
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 140 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Blended CPA</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#e67e22" }}>{fmt$(data.blended_cpa)}</p>
          </div>
        )}
        {data.blended_roas != null && (
          <div style={{ background: "#f8f9fb", borderRadius: 10, padding: "12px 16px", flex: 1, minWidth: 140 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>Blended ROAS</p>
            <p style={{ fontSize: 20, fontWeight: 800, color: "#8e44ad" }}>{data.blended_roas.toFixed(2)}x</p>
          </div>
        )}
      </div>
      {data.top_performers?.length > 0 && (
        <>
          <SectionTitle>Top Performers</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Campaign</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Spend</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Conv</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>CPA</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {data.top_performers.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{c.campaign}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt$(c.spend)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{c.conversions}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt$(c.cpa)}</td>
                    <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{c.assessment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data.underperformers?.length > 0 && (
        <>
          <SectionTitle>Underperformers</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Campaign</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Spend</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Conv</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>CPA</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Assessment</th>
                </tr>
              </thead>
              <tbody>
                {data.underperformers.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{c.campaign}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt$(c.spend)}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{c.conversions}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt$(c.cpa)}</td>
                    <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{c.assessment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {data.paid_vs_organic_overlap?.length > 0 && (
        <>
          <SectionTitle>Paid vs Organic Overlap</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#f8f9fb" }}>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Keyword</th>
                  <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Organic Pos</th>
                  <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Ad Spend</th>
                  <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.paid_vs_organic_overlap.map((o, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
                    <td style={{ padding: "10px 12px", fontWeight: 600 }}>{o.keyword}</td>
                    <td style={{ padding: "10px 12px", textAlign: "center" }}>{o.organic_position}</td>
                    <td style={{ padding: "10px 12px", textAlign: "right" }}>{fmt$(o.ad_spend_on_keyword)}</td>
                    <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{o.recommendation}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function TechnicalSection({ data }) {
  if (!data) return null;
  return (
    <div>
      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6, marginBottom: 16 }}>{data.summary}</p>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#555", marginBottom: 8 }}>{data.health_score_assessment}</p>
      {data.critical_errors?.length > 0 && (
        <>
          <SectionTitle>Critical Errors</SectionTitle>
          {data.critical_errors.map((e, i) => (
            <div key={i} style={{ background: "#fde8e8", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#c0392b" }}>{e.issue} ({e.count})</p>
              <p style={{ fontSize: 12, color: "#7b1c1c", marginTop: 4 }}>{e.impact}</p>
              <p style={{ fontSize: 12, color: "#333", marginTop: 4 }}>{e.action}</p>
            </div>
          ))}
        </>
      )}
      {data.warnings?.length > 0 && (
        <>
          <SectionTitle>Warnings</SectionTitle>
          {data.warnings.map((w, i) => (
            <div key={i} style={{ background: "#fef3cd", borderRadius: 10, padding: "12px 16px", marginBottom: 10 }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: "#7d5a00" }}>{w.issue} ({w.count})</p>
              <p style={{ fontSize: 12, color: "#6d4c00", marginTop: 4 }}>{w.impact}</p>
              <p style={{ fontSize: 12, color: "#333", marginTop: 4 }}>{w.action}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function RecommendationsSection({ data }) {
  if (!data?.length) return <p style={{ color: "#999", fontSize: 13 }}>No recommendations.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f8f9fb" }}>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", width: 90 }}>Priority</th>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Issue</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", width: 80 }}>Dimension</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", width: 70 }}>Effort</th>
            <th style={{ textAlign: "center", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", width: 70 }}>Impact</th>
            <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Action</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #f0f0f0" }}>
              <td style={{ padding: "10px 12px", textAlign: "center" }}><PriorityChip priority={r.priority} /></td>
              <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{r.issue}</td>
              <td style={{ padding: "10px 12px", textAlign: "center", color: "#666" }}>{r.dimension}</td>
              <td style={{ padding: "10px 12px", textAlign: "center", color: "#666", textTransform: "capitalize" }}>{r.effort}</td>
              <td style={{ padding: "10px 12px", textAlign: "center", color: "#666", textTransform: "capitalize" }}>{r.impact?.replace(/_/g, " ")}</td>
              <td style={{ padding: "10px 12px", color: "#444", lineHeight: 1.5 }}>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function StrengthsSection({ data }) {
  if (!data?.length) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {data.map((s, i) => (
        <div key={i} style={{ background: "#e6f9f0", borderRadius: 10, padding: "14px 18px", borderLeft: "4px solid #27ae60" }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: "#1a7a4a", marginBottom: 4 }}>{s.strength}</p>
          <p style={{ fontSize: 12, color: "#333", lineHeight: 1.5 }}>{s.evidence}</p>
        </div>
      ))}
    </div>
  );
}

// ─── v1 results view ─────────────────────────────────────────────────────────

export default function V1Results({ audit, crawlData, domain, actions }) {
  const [activeTab, setActiveTab] = useState("seo");
  if (!audit) return null;

  const tabList = [
    { key: "seo", label: "SEO Analysis" },
    { key: "geo", label: "GEO Analysis" },
    { key: "aeo", label: "AEO Analysis" },
  ];
  if (audit.search_console_analysis) tabList.push({ key: "gsc", label: "Search Console" });
  if (audit.site_analytics_analysis) tabList.push({ key: "ga4", label: "Site Analytics" });
  if (audit.google_ads_analysis) tabList.push({ key: "ads", label: "Google Ads" });
  if (audit.technical_health) tabList.push({ key: "tech", label: "Technical Health" });
  tabList.push({ key: "recs", label: "Recommendations" });
  if (audit.strengths?.length) tabList.push({ key: "strengths", label: "Strengths" });

  const scores = audit.audit_summary?.scores;

  return (
    <div>
      {/* Top bar */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
            {audit.audit_summary?.domain || domain}
          </h2>
          <p style={{ fontSize: 13, color: "#aaa" }}>
            {audit.audit_summary?.audit_type === "full" ? "Full" : "Quick"} audit &middot; {audit.audit_summary?.pages_reviewed || crawlData?.pages_crawled?.length || 0} pages reviewed &middot; {audit.audit_summary?.audit_date}
          </p>
          <DataSourcesLine sources={audit.data_sources} />
        </div>
        {actions}
      </div>

      {/* Score cards */}
      {scores && (
        <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
          {["seo", "geo", "aeo"].map((k) => (
            <ScoreCard
              key={k}
              label={k.toUpperCase()}
              score={scores[k]?.score}
              status={scores[k]?.status || getScoreStatus(scores[k]?.score)}
              takeaway={scores[k]?.key_takeaway}
            />
          ))}
          <CombinedScoreCard score={scores.combined?.score} max={scores.combined?.max || 30} />
        </div>
      )}

      {/* Executive summary */}
      {audit.audit_summary?.executive_summary && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>Executive Summary</p>
          <p style={{ fontSize: 14, color: "#333", lineHeight: 1.7 }}>{audit.audit_summary.executive_summary}</p>
        </div>
      )}

      {/* Top 3 priorities */}
      {audit.audit_summary?.top_3_priorities?.length > 0 && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 10 }}>Top 3 Priorities</p>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {audit.audit_summary.top_3_priorities.map((p, i) => (
              <li key={i} style={{ fontSize: 13, color: "#333", lineHeight: 1.7, marginBottom: 6 }}>{p}</li>
            ))}
          </ol>
        </div>
      )}

      {/* Biggest strength */}
      {audit.audit_summary?.biggest_strength && (
        <div style={{ background: "#e6f9f0", borderRadius: 12, padding: "14px 20px", marginBottom: 24, borderLeft: "4px solid #27ae60" }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#1a7a4a", marginBottom: 4 }}>Biggest Strength</p>
          <p style={{ fontSize: 13, color: "#333", lineHeight: 1.5 }}>{audit.audit_summary.biggest_strength}</p>
        </div>
      )}

      {/* Crawl summary */}
      {crawlData && (
        <div style={{ marginBottom: 24 }}>
          <CrawlProgress pages={crawlData.pages_crawled || []} errors={crawlData.crawl_errors || []} />
        </div>
      )}

      {/* Tabbed analysis sections */}
      <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
        <Tabs tabs={tabList} active={activeTab} onSelect={setActiveTab} />

        {activeTab === "seo" && <SEOSection data={audit.seo_analysis} />}
        {activeTab === "geo" && <GEOSection data={audit.geo_analysis} />}
        {activeTab === "aeo" && <AEOSection data={audit.aeo_analysis} />}
        {activeTab === "gsc" && <GSCSection data={audit.search_console_analysis} />}
        {activeTab === "ga4" && <AnalyticsSection data={audit.site_analytics_analysis} />}
        {activeTab === "ads" && <AdsSection data={audit.google_ads_analysis} />}
        {activeTab === "tech" && <TechnicalSection data={audit.technical_health} />}
        {activeTab === "recs" && <RecommendationsSection data={audit.priority_recommendations} />}
        {activeTab === "strengths" && <StrengthsSection data={audit.strengths} />}
      </div>
    </div>
  );
}
