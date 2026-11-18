"use client";
// One analysis area's findings: title, detail and the evidence behind it.

export default function PassFindings({ findings, intro }) {
  if (!findings?.length) {
    return <p style={{ color: "#999", fontSize: 13 }}>No findings in this area.{intro ? ` ${intro}` : ""}</p>;
  }
  return (
    <div>
      {intro && <p style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>{intro}</p>}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {findings.map((f, i) => (
          <div key={i} style={{ border: "1px solid #eee", borderLeft: "4px solid #0f3460", borderRadius: 10, padding: "12px 16px" }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>{f.title}</p>
            {f.detail && <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{f.detail}</p>}
            {f.evidence?.length > 0 && (
              <ul style={{ margin: "8px 0 0", paddingLeft: 18 }}>
                {f.evidence.map((e, j) => (
                  <li key={j} style={{ fontSize: 12, color: "#666", lineHeight: 1.6, wordBreak: "break-word" }}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
