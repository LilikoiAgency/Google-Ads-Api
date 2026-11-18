"use client";
// Live progress of a v2 audit job: each step with its state, an elapsed timer,
// data gaps as they are found, and Retry when the job (or a request) failed.

import { useEffect, useState } from "react";
import { CARD } from "../ui";

const RECENT_MS = 60 * 60 * 1000;

function formatElapsed(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

function StepIcon({ status }) {
  const base = { width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 12, fontWeight: 800 };
  if (status === "done") return <span aria-hidden style={{ ...base, background: "#e6f9f0", color: "#1a7a4a" }}>&#10003;</span>;
  if (status === "failed") return <span aria-hidden style={{ ...base, background: "#fde8e8", color: "#c0392b" }}>&#10007;</span>;
  if (status === "running") {
    return (
      <span aria-hidden style={{ ...base, border: "2.5px solid #e8f0fe", borderTopColor: "#0d9488", animation: "seoV2Spin 0.8s linear infinite", boxSizing: "border-box" }} />
    );
  }
  return <span aria-hidden style={{ ...base, border: "2px solid #ddd", boxSizing: "border-box" }} />;
}

const STATUS_TEXT = { pending: "Waiting", running: "Working…", done: "Done", failed: "Failed" };

export default function ProgressSteps({ progress, error, onRetry, onBack }) {
  const status = progress?.status;
  const finished = status === "done" || status === "failed";
  // Time from job creation when it was started recently; otherwise from when this view opened.
  const [openedAt] = useState(() => Date.now());
  const created = progress?.createdAt ? Date.parse(progress.createdAt) : NaN;
  const startedAt = Number.isFinite(created) && openedAt - created < RECENT_MS ? created : openedAt;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (finished) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [finished]);

  const steps = progress?.steps || [];
  const gaps = progress?.dataGaps || [];
  const showRetry = status === "failed" || Boolean(error);
  const doneCount = steps.filter((s) => s.status === "done").length;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <style>{"@keyframes seoV2Spin { to { transform: rotate(360deg); } }"}</style>
      <div style={{ ...CARD, padding: 24 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 4 }}>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e" }}>
            {status === "failed" ? "Audit stopped" : status === "done" ? "Audit finished" : "Auditing"} {progress?.domain || ""}
          </h2>
          <span style={{ fontSize: 12, color: "#888", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
            Elapsed {formatElapsed(now - startedAt)}
          </span>
        </div>
        <p style={{ fontSize: 12, color: "#888", marginBottom: 18 }}>
          {progress?.auditType === "quick" ? "Quick audit" : progress?.auditType === "full" ? "Full audit · usually 5–9 minutes" : "Loading…"}
          {steps.length > 0 && ` · ${doneCount} of ${steps.length} steps done`}
          {!finished && " · keep this tab open"}
        </p>

        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          {steps.map((s) => (
            <li
              key={s.key}
              data-testid={`step-${s.key}`}
              data-status={s.status}
              style={{
                display: "flex", gap: 12, alignItems: "flex-start", padding: "10px 12px", borderRadius: 10,
                background: s.status === "running" ? "#f0fdfa" : s.status === "failed" ? "#fff5f5" : "transparent",
              }}
            >
              <StepIcon status={s.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: s.status === "running" ? 700 : 600, color: s.status === "pending" ? "#999" : "#1a1a2e" }}>{s.label}</p>
                {s.status === "failed" && s.error && (
                  <p style={{ fontSize: 12, color: "#c0392b", marginTop: 2, wordBreak: "break-word" }}>{s.error}</p>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 600, color: s.status === "failed" ? "#c0392b" : s.status === "done" ? "#1a7a4a" : "#999" }}>
                {STATUS_TEXT[s.status] || s.status}
              </span>
            </li>
          ))}
        </ol>

        {gaps.length > 0 && (
          <div style={{ marginTop: 16, padding: "12px 14px", background: "#fffbeb", borderRadius: 10, border: "1px solid #fde68a" }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#7d5a00", marginBottom: 6 }}>Data gaps so far</p>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {gaps.map((g) => <li key={g} style={{ fontSize: 12, color: "#6d4c00", lineHeight: 1.6 }}>{g}</li>)}
            </ul>
          </div>
        )}

        {(error || status === "failed") && (
          <div role="alert" style={{ marginTop: 16, padding: "12px 14px", background: "#fde8e8", borderRadius: 10, fontSize: 13, color: "#7b1c1c", lineHeight: 1.5 }}>
            {error || "A step failed after its automatic retries. Retry picks up from the failed step; finished steps are kept."}
          </div>
        )}

        {(showRetry || onBack) && (
          <div style={{ display: "flex", gap: 10, marginTop: 18 }}>
            {showRetry && (
              <button
                onClick={onRetry}
                style={{ padding: "9px 20px", borderRadius: 10, background: "linear-gradient(135deg, #0d9488 0%, #0f766e 100%)", color: "#fff", fontSize: 13, fontWeight: 700, border: "none", cursor: "pointer" }}
              >
                Retry
              </button>
            )}
            {onBack && (
              <button
                onClick={onBack}
                style={{ padding: "9px 16px", borderRadius: 10, background: "transparent", color: "#555", fontSize: 13, fontWeight: 600, border: "1px solid #ddd", cursor: "pointer" }}
              >
                Back to audits
              </button>
            )}
          </div>
        )}
        {!finished && !error && (
          <p style={{ fontSize: 11, color: "#aaa", marginTop: 14 }}>
            If you leave, the audit pauses. Open it from Past Audits to pick up where it stopped.
          </p>
        )}
      </div>
    </div>
  );
}
