"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import "../../globals.css";

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

// ─── UI Components ───────────────────────────────────────────────────────────

const SCORE_COLORS = {
  Critical:     { bg: "#fde8e8", text: "#c0392b", ring: "#e74c3c" },
  "Needs Work": { bg: "#fef3cd", text: "#7d5a00", ring: "#f39c12" },
  "On Track":   { bg: "#e8f0fe", text: "#0c3473", ring: "#3498db" },
  Strong:       { bg: "#e6f9f0", text: "#1a7a4a", ring: "#27ae60" },
  Exemplary:    { bg: "#e6f9f0", text: "#0d6e3a", ring: "#16a085" },
};

function getScoreStatus(score) {
  if (score <= 3) return "Critical";
  if (score <= 5) return "Needs Work";
  if (score <= 7) return "On Track";
  if (score <= 9) return "Strong";
  return "Exemplary";
}

function ScoreCard({ label, score, status, takeaway }) {
  const colors = SCORE_COLORS[status] || SCORE_COLORS["On Track"];
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center", flex: 1, minWidth: 180 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#888", marginBottom: 12 }}>{label}</p>
      <div style={{ width: 72, height: 72, borderRadius: "50%", border: `4px solid ${colors.ring}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: colors.text }}>{score}</span>
      </div>
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: colors.bg, color: colors.text }}>{status}</span>
      {takeaway && <p style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.4 }}>{takeaway}</p>}
    </div>
  );
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

function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 14, marginTop: 28, paddingBottom: 8, borderBottom: "2px solid #eee" }}>{children}</h3>;
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

// ─── Tab system ──────────────────────────────────────────────────────────────

function Tabs({ tabs, active, onSelect }) {
  return (
    <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 20, borderBottom: "2px solid #eee", paddingBottom: 0 }}>
      {tabs.map((t) => (
        <button
          key={t.key}
          onClick={() => onSelect(t.key)}
          style={{
            padding: "8px 16px",
            fontSize: 13,
            fontWeight: active === t.key ? 700 : 500,
            color: active === t.key ? "#0f3460" : "#888",
            background: active === t.key ? "#e8f0fe" : "transparent",
            border: "none",
            borderBottom: active === t.key ? "2px solid #0f3460" : "2px solid transparent",
            borderRadius: "8px 8px 0 0",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
        >
          {t.label}
        </button>
      ))}
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

// ─── Main Page ───────────────────────────────────────────────────────────────

const STEPS = { CONFIGURE: 0, CRAWLING: 1, ANALYZING: 2, RESULTS: 3 };

export default function SEOAuditPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  // Form state
  const [domain, setDomain] = useState("");
  const [auditType, setAuditType] = useState("full");

  // Flow state
  const [step, setStep] = useState(STEPS.CONFIGURE);
  const [error, setError] = useState(null);

  // Data
  const [crawlData, setCrawlData] = useState(null);
  const [auditResult, setAuditResult] = useState(null);
  const [remainingToday, setRemainingToday] = useState(null);

  // History
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [loadingAuditId, setLoadingAuditId] = useState(null);

  // Tabs
  const [activeTab, setActiveTab] = useState("seo");

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard/seo-audit");
    }
  }, [authStatus, router]);

  // ── Fetch audit history on mount ───────────────────────────────────────
  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetch("/api/seo-audit/history")
      .then((res) => res.json())
      .then((data) => setHistory(data.audits || []))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [authStatus]);

  // ── Run crawl ──────────────────────────────────────────────────────────────
  async function handleRunAudit(forceRerun = false) {
    setError(null);
    setStep(STEPS.CRAWLING);

    try {
      // Step 1: Crawl
      const crawlRes = await fetch("/api/seo-audit/crawl", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain, auditType, forceRerun }),
      });

      if (!crawlRes.ok) {
        const err = await crawlRes.json().catch(() => ({}));
        throw new Error(err.error || `Crawl failed (${crawlRes.status})`);
      }

      const crawlJson = await crawlRes.json();
      const crawl = crawlJson.data ?? crawlJson; // unwrap { data: ... } envelope
      setCrawlData(crawl);

      // Step 2: Analyze
      setStep(STEPS.ANALYZING);

      const analyzeRes = await fetch("/api/seo-audit/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ crawlData: crawl, forceRerun }),
      });

      if (!analyzeRes.ok) {
        const err = await analyzeRes.json().catch(() => ({}));
        throw new Error(err.error || `Analysis failed (${analyzeRes.status})`);
      }

      const result = await analyzeRes.json();
      setAuditResult(result.data?.audit);
      setRemainingToday(result.data?.remainingToday);
      setStep(STEPS.RESULTS);

      // Refresh history list so the new audit appears
      fetch("/api/seo-audit/history")
        .then((r) => r.json())
        .then((d) => setHistory(d.audits || []))
        .catch(() => {});
    } catch (err) {
      setError(err.message);
      setStep(STEPS.CONFIGURE);
    }
  }

  function handleReset() {
    setStep(STEPS.CONFIGURE);
    setCrawlData(null);
    setAuditResult(null);
    setError(null);
    setDomain("");
  }

  // ── Load a past audit from history ─────────────────────────────────────
  async function handleLoadAudit(auditId) {
    setError(null);
    setLoadingAuditId(auditId);
    try {
      const res = await fetch(`/api/seo-audit/history?id=${auditId}`);
      if (!res.ok) throw new Error("Failed to load audit");
      const doc = await res.json();
      setCrawlData(doc.crawlData || null);
      setAuditResult(doc.auditResult);
      setDomain(doc.domain || "");
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

  // ── Build tab list based on available data ─────────────────────────────────
  const audit = auditResult;

  const tabList = [
    { key: "seo", label: "SEO Analysis" },
    { key: "geo", label: "GEO Analysis" },
    { key: "aeo", label: "AEO Analysis" },
  ];
  if (audit?.search_console_analysis) tabList.push({ key: "gsc", label: "Search Console" });
  if (audit?.google_ads_analysis) tabList.push({ key: "ads", label: "Google Ads" });
  if (audit?.technical_health) tabList.push({ key: "tech", label: "Technical Health" });
  tabList.push({ key: "recs", label: "Recommendations" });
  if (audit?.strengths?.length) tabList.push({ key: "strengths", label: "Strengths" });

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
            <circle cx="22" cy="22" r="13" stroke="#0d9488" strokeWidth="2.5"/>
            <line x1="31.5" y1="31.5" x2="42" y2="42" stroke="#0d9488" strokeWidth="3.5" strokeLinecap="round"/>
            <rect x="15" y="24" width="3.5" height="7" rx="1" fill="#f59e0b"/>
            <rect x="20.25" y="20" width="3.5" height="11" rx="1" fill="#0d9488"/>
            <rect x="25.5" y="16" width="3.5" height="15" rx="1" fill="#6366f1"/>
          </svg>
        }
        title="SEO / GEO / AEO Audit"
        subtitle="AI-powered site analysis"
      />

      <div className="mx-auto max-w-5xl px-6 py-10">
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
                  <p style={{ fontSize: 13, color: "rgba(255,255,255,0.5)", marginTop: 2 }}>SEO + GEO + AEO analysis powered by AI</p>
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
                  { value: "full", label: "Full Audit", desc: "Up to 10 pages", icon: "9+" },
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

              {/* Submit button */}
              <button
                onClick={() => handleRunAudit()}
                disabled={!domain.trim()}
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
                Run Audit
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
                        onClick={() => handleLoadAudit(a._id)}
                      >
                        {/* Score circle */}
                        <div style={{
                          width: 44, height: 44, borderRadius: "50%",
                          border: `2px solid ${combined >= 20 ? "#0d9488" : combined >= 12 ? "#f59e0b" : "#ef4444"}`,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          flexShrink: 0, marginRight: 16,
                        }}>
                          <span style={{ fontSize: 15, fontWeight: 800, color: "#fff" }}>{combined}</span>
                        </div>

                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
                            <p style={{ fontSize: 15, fontWeight: 700, color: "#fff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {a.domain}
                            </p>
                            {isToday && (
                              <span style={{ fontSize: 10, fontWeight: 700, background: "rgba(13,148,136,0.2)", color: "#5eead4", padding: "2px 8px", borderRadius: 10 }}>Today</span>
                            )}
                          </div>
                          <div style={{ display: "flex", gap: 10, fontSize: 12, alignItems: "center" }}>
                            <span style={{ color: "#5eead4" }}>SEO {a.scores?.seo ?? "—"}</span>
                            <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
                            <span style={{ color: "#a78bfa" }}>GEO {a.scores?.geo ?? "—"}</span>
                            <span style={{ color: "rgba(255,255,255,0.15)" }}>/</span>
                            <span style={{ color: "#fbbf24" }}>AEO {a.scores?.aeo ?? "—"}</span>
                            <span style={{ color: "rgba(255,255,255,0.2)", marginLeft: 4 }}>
                              {a.auditType === "quick" ? "Quick" : "Full"} &middot; {a.pagesCrawled}p &middot; {new Date(a.createdAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: "flex", gap: 6, marginLeft: 12, flexShrink: 0 }}>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleLoadAudit(a._id); }}
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
                            {loadingAuditId === a._id ? "Loading..." : "View"}
                          </button>
                          <button
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
                          </button>
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

        {/* ── Step 1: Crawling ───────────────────────────────────────────── */}
        {step === STEPS.CRAWLING && (
          <DashboardLoader label="Crawling site..." />
        )}

        {/* ── Step 2: Analyzing ──────────────────────────────────────────── */}
        {step === STEPS.ANALYZING && (
          <div style={{ textAlign: "center" }}>
            <DashboardLoader label="Analyzing with AI..." />
            {crawlData && (
              <div style={{ marginTop: 24 }}>
                <CrawlProgress pages={crawlData.pages_crawled || []} errors={crawlData.crawl_errors || []} />
              </div>
            )}
          </div>
        )}

        {/* ── Step 3: Results ────────────────────────────────────────────── */}
        {step === STEPS.RESULTS && audit && (
          <div>
            {/* Top bar */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff", marginBottom: 4 }}>
                  {audit.audit_summary?.domain || domain}
                </h2>
                <p style={{ fontSize: 13, color: "#aaa" }}>
                  {audit.audit_summary?.audit_type === "full" ? "Full" : "Quick"} audit &middot; {audit.audit_summary?.pages_reviewed || crawlData?.pages_crawled?.length || 0} pages reviewed &middot; {audit.audit_summary?.audit_date}
                </p>
              </div>
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={() => handleRunAudit(true)}
                  style={{ padding: "8px 16px", borderRadius: 10, background: "rgba(13,148,136,0.15)", border: "1px solid rgba(13,148,136,0.3)", color: "#5eead4", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  Re-run Audit
                </button>
                <button
                  onClick={handleReset}
                  style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.2)", background: "transparent", color: "#ccc", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                >
                  New Audit
                </button>
              </div>
            </div>

            {remainingToday != null && (
              <p style={{ fontSize: 11, color: "#888", marginBottom: 16 }}>
                {remainingToday} audit{remainingToday !== 1 ? "s" : ""} remaining today
              </p>
            )}

            {/* Score cards */}
            {audit.audit_summary?.scores && (
              <div style={{ display: "flex", gap: 16, marginBottom: 24, flexWrap: "wrap" }}>
                <ScoreCard
                  label="SEO"
                  score={audit.audit_summary.scores.seo?.score}
                  status={audit.audit_summary.scores.seo?.status || getScoreStatus(audit.audit_summary.scores.seo?.score)}
                  takeaway={audit.audit_summary.scores.seo?.key_takeaway}
                />
                <ScoreCard
                  label="GEO"
                  score={audit.audit_summary.scores.geo?.score}
                  status={audit.audit_summary.scores.geo?.status || getScoreStatus(audit.audit_summary.scores.geo?.score)}
                  takeaway={audit.audit_summary.scores.geo?.key_takeaway}
                />
                <ScoreCard
                  label="AEO"
                  score={audit.audit_summary.scores.aeo?.score}
                  status={audit.audit_summary.scores.aeo?.status || getScoreStatus(audit.audit_summary.scores.aeo?.score)}
                  takeaway={audit.audit_summary.scores.aeo?.key_takeaway}
                />
                <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center", flex: 1, minWidth: 180, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
                  <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#888", marginBottom: 12 }}>Combined</p>
                  <p style={{ fontSize: 36, fontWeight: 800, color: "#0f3460" }}>
                    {audit.audit_summary.scores.combined?.score}
                    <span style={{ fontSize: 16, color: "#aaa", fontWeight: 500 }}>/{audit.audit_summary.scores.combined?.max || 30}</span>
                  </p>
                </div>
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
              {activeTab === "ads" && <AdsSection data={audit.google_ads_analysis} />}
              {activeTab === "tech" && <TechnicalSection data={audit.technical_health} />}
              {activeTab === "recs" && <RecommendationsSection data={audit.priority_recommendations} />}
              {activeTab === "strengths" && <StrengthsSection data={audit.strengths} />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
