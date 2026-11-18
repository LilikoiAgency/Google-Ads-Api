"use client";
// Pages tab: one card per important page with its fix list and the queries each fix targets,
// plus the Action Plan tasks for that page.

import { pagePath } from "./ActionPlan";

export default function PageCards({ pages, tasks = [] }) {
  if (!pages?.length) return <p style={{ color: "#999", fontSize: 13 }}>No page-level fixes in this audit.</p>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {pages.map((p) => {
        const ids = tasks.filter((t) => t.page === p.page).map((t) => t.id);
        const isUrl = /^https?:\/\//i.test(p.page || "");
        return (
          <div key={p.page} style={{ border: "1px solid #eee", borderRadius: 12, padding: "14px 18px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
              {isUrl ? (
                <a href={p.page} target="_blank" rel="noopener noreferrer" style={{ fontSize: 15, fontWeight: 700, color: "#0f3460", wordBreak: "break-all", textDecoration: "none" }}>
                  {pagePath(p.page)}
                </a>
              ) : (
                <span style={{ fontSize: 15, fontWeight: 700, color: "#0f3460" }}>{p.page}</span>
              )}
              {ids.length > 0 && (
                <span style={{ fontSize: 11, color: "#888" }}>In the action plan: {ids.join(", ")}</span>
              )}
            </div>
            <ol style={{ margin: 0, paddingLeft: 20 }}>
              {(p.fixes || []).map((f, i) => (
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
          </div>
        );
      })}
    </div>
  );
}
