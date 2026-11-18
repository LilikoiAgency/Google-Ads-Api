// Display formatting shared by the Web Traffic (GA4) components.
// Delta text comes from the download's formatDelta so the screen and the
// client report always read the same ("▲ 12%", "▼ 1.1 pts", "—").
import { formatDelta } from "@/lib/ga4ReportHtml";

export { formatDelta };

export function fmtInt(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

export function fmtRate(r) {
  return Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : "0.0%";
}

// 'up' | 'down' | 'flat' from formatted delta text.
export function deltaDir(text) {
  if (text.startsWith("▲")) return "up";
  if (text.startsWith("▼")) return "down";
  return "flat";
}

export function DeltaText({ d, pts = false, className = "" }) {
  const text = formatDelta(d, { pts });
  return <span className={`ga4-delta ga4-delta-${deltaDir(text)} ${className}`}>{text}</span>;
}
