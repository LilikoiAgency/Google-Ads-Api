"use client";
// Pages tab: one card per important page with Google's index status, page speed,
// its top Search Console queries, the fix list and the queries each fix targets,
// plus the Action Plan tasks for that page. Blocks without data are hidden.

import { pagePath, pageHref } from "./ActionPlan";
import { pathKey } from "@/lib/seoAuditV2/tasks";

const LABEL = { fontSize: 11, fontWeight: 700, color: "#888", marginBottom: 4 };
const ROW = { fontSize: 12, color: "#444", lineHeight: 1.6 };

const seconds = (ms) => (ms == null ? null : `${(ms / 1000).toFixed(1)}s`);

function IndexStatus({ index }) {
  if (!index) return null;
  const indexed = index.verdict === "PASS";
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={LABEL}>Google index</p>
      <p style={{ ...ROW, fontWeight: 600, color: indexed ? "#1a7a4a" : "#c0392b" }}>
        {indexed ? "Indexed" : `Not indexed: ${index.coverage_state || index.verdict || "unknown"}`}
      </p>
      {index.canonical_mismatch && index.google_canonical && (
        <p style={{ ...ROW, color: "#7d5a00", wordBreak: "break-all" }}>
          Google picked a different canonical: {index.google_canonical}
        </p>
      )}
    </div>
  );
}

function Speed({ speed }) {
  if (!speed) return null;
  const field = speed.field;
  const m = field || speed;
  const parts = [
    m.lcp_ms != null && `LCP ${seconds(m.lcp_ms)}`,
    m.inp_ms != null && `INP ${Math.round(m.inp_ms)}ms`,
    m.cls != null && `CLS ${m.cls}`,
  ].filter(Boolean);
  const source = field
    ? `Real users${field.origin_fallback ? " (whole site)" : ""}`
    : "Lab test";
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={LABEL}>Page speed (mobile)</p>
      <p style={ROW}>
        {speed.score != null && <strong>Speed {speed.score}/100</strong>}
        {parts.length > 0 && (
          <>{speed.score != null ? " · " : ""}{source}: {parts.join(" · ")}</>
        )}
      </p>
    </div>
  );
}

function TopQueries({ queries }) {
  if (!queries?.length) return null;
  return (
    <div style={{ marginBottom: 10 }}>
      <p style={LABEL}>Top queries</p>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {queries.map((q) => (
          <li key={q.query} style={ROW}>
            <span style={{ fontWeight: 600 }}>{q.query}</span>
            <span style={{ color: "#888" }}> · {q.clicks} clicks · {q.impressions} impressions · position {q.position}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function PageCards({ pages, tasks = [], domain = "" }) {
  if (!pages?.length) return <p style={{ color: "#999", fontSize: 13 }}>No page-level fixes in this audit.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {pages.map((p) => {
        // Pages and tasks are matched by path, so "/a", "/a/" and a full URL agree.
        const key = pathKey(p.page);
        const ids = tasks.filter((t) => pathKey(t.page) === key).map((t) => t.id);
        const href = pageHref(p.page, domain);
        return (
          <div key={p.page} data-page-card style={{ border: "1px solid #eee", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" style={{ fontSize: 15, fontWeight: 700, color: "#0f3460", wordBreak: "break-all", textDecoration: "none" }}>
                  {pagePath(p.page)}
                </a>
              ) : (
                <span style={{ fontSize: 15, fontWeight: 700, color: "#0f3460" }}>{p.page}</span>
              )}
              {ids.length > 0 && (
                <span style={{ fontSize: 11, color: "#888" }}>In the action plan: {ids.join(", ")}</span>
              )}
            </div>
            {(p.index || p.speed || p.top_queries?.length > 0) && (
              <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px", minWidth: 0 }}>
                  <IndexStatus index={p.index} />
                  <Speed speed={p.speed} />
                </div>
                {p.top_queries?.length > 0 && (
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <TopQueries queries={p.top_queries} />
                  </div>
                )}
              </div>
            )}
            {p.fixes?.length > 0 && (
              <ol style={{ margin: 0, paddingLeft: 20 }}>
                {p.fixes.map((f, i) => (
                  <li key={i} style={{ fontSize: 13, color: "#333", lineHeight: 1.6, marginBottom: 8 }}>
                    <span>{f.change}</span>
                    {f.targets_queries?.length > 0 && (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4, alignItems: "center" }}>
                        <span style={{ fontSize: 11, color: "#888" }}>Targets:</span>
                        {f.targets_queries.map((q) => (
                          <span key={q} style={{ fontSize: 11, padding: "1px 8px", borderRadius: 10, background: "#f3e8ff", color: "#6b21a8" }}>{q}</span>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </div>
        );
      })}
    </div>
  );
}
