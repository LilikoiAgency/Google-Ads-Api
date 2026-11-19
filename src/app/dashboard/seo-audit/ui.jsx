"use client";
// Small presentational pieces shared by the v1 and v2 audit views.

const SCORE_COLORS = {
  Critical:     { bg: "#fde8e8", text: "#c0392b", ring: "#e74c3c" },
  "Needs Work": { bg: "#fef3cd", text: "#7d5a00", ring: "#f39c12" },
  "On Track":   { bg: "#e8f0fe", text: "#0c3473", ring: "#3498db" },
  Strong:       { bg: "#e6f9f0", text: "#1a7a4a", ring: "#27ae60" },
  Exemplary:    { bg: "#e6f9f0", text: "#0d6e3a", ring: "#16a085" },
};

export function getScoreStatus(score) {
  if (score <= 3) return "Critical";
  if (score <= 5) return "Needs Work";
  if (score <= 7) return "On Track";
  if (score <= 9) return "Strong";
  return "Exemplary";
}

export const CARD = { background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" };
export const CARD_LABEL = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#888" };

export function ScoreCard({ label, score, status, takeaway }) {
  const colors = SCORE_COLORS[status] || SCORE_COLORS["On Track"];
  return (
    <div style={{ ...CARD, textAlign: "center", flex: 1, minWidth: 180 }}>
      <p style={{ ...CARD_LABEL, marginBottom: 12 }}>{label}</p>
      <div style={{ width: 72, height: 72, borderRadius: "50%", border: `4px solid ${colors.ring}`, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 10px" }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: colors.text }}>{score}</span>
      </div>
      <span style={{ display: "inline-block", padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: colors.bg, color: colors.text }}>{status}</span>
      {takeaway && <p style={{ fontSize: 12, color: "#666", marginTop: 8, lineHeight: 1.4 }}>{takeaway}</p>}
    </div>
  );
}

export function CombinedScoreCard({ score, max = 30 }) {
  return (
    <div style={{ ...CARD, textAlign: "center", flex: 1, minWidth: 180, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center" }}>
      <p style={{ ...CARD_LABEL, marginBottom: 12 }}>Combined</p>
      <p style={{ fontSize: 36, fontWeight: 800, color: "#0f3460" }}>
        {score}
        <span style={{ fontSize: 16, color: "#aaa", fontWeight: 500 }}>/{max}</span>
      </p>
    </div>
  );
}

export function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 14, marginTop: 28, paddingBottom: 8, borderBottom: "2px solid #eee" }}>{children}</h3>;
}

export function Tabs({ tabs, active, onSelect }) {
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
          {t.count != null && (
            <span
              title={t.warn ? "This analysis didn't complete" : undefined}
              style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: t.warn ? "#b7791f" : active === t.key ? "#0f3460" : "#aaa" }}
            >
              {t.count}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
