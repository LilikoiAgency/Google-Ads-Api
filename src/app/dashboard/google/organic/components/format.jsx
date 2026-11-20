// Formatting for the Organic Search page. Shares number/delta style with GA4.
import { fmtInt, fmtRate, DeltaText } from "../../analytics/components/format";
import { change } from "@/lib/gscInsights";

export { fmtInt, DeltaText };

export const fmtCtr = (r) => fmtRate(r);
export const fmtPos = (p) => (Number.isFinite(p) && p > 0 ? p.toFixed(1) : "—");

// Path of a full URL ('https://x.com/a/b?c' -> '/a/b?c'); keeps the host when the
// site spans several hosts (domain properties).
export function shortUrl(url, { keepHost = false } = {}) {
  try {
    const u = new URL(url);
    const path = `${u.pathname}${u.search}` || "/";
    return keepHost ? `${u.hostname.replace(/^www\./, "")}${path}` : path;
  } catch {
    return String(url || "");
  }
}

// Change in a count vs the compare period.
export function Change({ cur, prev, show = true }) {
  if (!show) return null;
  return <DeltaText d={prev === null || prev === undefined ? null : change(cur, prev)} />;
}

// Position change: lower is better, so moving up the page shows as ▲ in green.
export function PosChange({ cur, prev, show = true }) {
  if (!show) return null;
  if (!(prev > 0) || !(cur > 0)) return <span className="ga4-delta ga4-delta-flat">—</span>;
  const diff = prev - cur;
  const t = Math.abs(diff).toFixed(1);
  if (t === "0.0") return <span className="ga4-delta ga4-delta-flat">0.0</span>;
  return (
    <span
      className={`ga4-delta ${diff > 0 ? "ga4-delta-up" : "ga4-delta-down"}`}
      title={diff > 0 ? `Moved up ${t} positions` : `Moved down ${t} positions`}
    >
      {diff > 0 ? "▲" : "▼"} {t}
    </span>
  );
}

// Position pill: top 3 / page one / page two / deeper.
export function PosPill({ pos }) {
  if (!(pos > 0)) return <span className="gsc-pos">—</span>;
  const tier = pos <= 3 ? "top" : pos <= 10 ? "one" : pos <= 20 ? "two" : "deep";
  return <span className={`gsc-pos gsc-pos-${tier}`}>{pos.toFixed(1)}</span>;
}
