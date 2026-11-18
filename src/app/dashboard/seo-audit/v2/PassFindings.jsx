"use client";
// One analysis area's findings: title, detail and the evidence behind it.
// When the area's analysis didn't complete, a gap notice replaces the empty state.

export function IncompleteNotice({ area }) {
  return (
    <p role="note" style={{ fontSize: 13, color: "#7d5a00", background: "#fef3cd", border: "1px solid #f5d77a", borderRadius: 10, padding: "10px 14px", marginBottom: 12 }}>
      {area} analysis didn&apos;t complete — rerun to include it
    </p>
  );
}

export default function PassFindings({ findings, intro, incomplete }) {
  if (incomplete && !findings?.length) return <IncompleteNotice area={incomplete} />;
  if (!findings?.length) {
    return <p style={{ color: "#999", fontSize: 13 }}>No findings in this area.{intro ? ` ${intro}` : ""}</p>;
  }
  return (
    <div>
      {incomplete && <IncompleteNotice area={incomplete} />}
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
