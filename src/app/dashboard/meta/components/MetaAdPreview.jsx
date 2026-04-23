// src/app/dashboard/meta/components/MetaAdPreview.jsx
"use client";

import { useEffect, useState } from "react";

const FORMATS = [
  { key: "MOBILE_FEED_STANDARD",  label: "Mobile" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop" },
  { key: "INSTAGRAM_STANDARD",    label: "IG Feed" },
  { key: "FACEBOOK_REELS_MOBILE", label: "Reels" },
];

const C = {
  card:     "#1a1a2e",
  cardAlt:  "#13131f",
  border:   "rgba(255,255,255,0.08)",
  accent:   "#e94560",
  teal:     "#4ecca3",
  amber:    "#f5a623",
  textPri:  "#ffffff",
  textSec:  "rgba(255,255,255,0.55)",
  textMut:  "rgba(255,255,255,0.35)",
};

const STATUS_COLORS = {
  ACTIVE:     C.teal,
  PAUSED:     C.textMut,
  DELETED:    C.accent,
  ARCHIVED:   C.textMut,
};

function fmtCurrency(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtInt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}
function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
}
function fmtRoas(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2) + "x";
}

export default function MetaAdPreview({ ad, hideMetrics = false, fill = false, previewMinHeight = 360 }) {
  const [activeFormat, setActiveFormat] = useState(FORMATS[0].key);
  // Local cache: { [format]: { html, unsupported, loading, error } }
  const [previews, setPreviews] = useState({});

  // Lazy-fetch the active format if we haven't seen it yet.
  useEffect(() => {
    if (previews[activeFormat]) return;
    let cancelled = false;
    setPreviews((p) => ({ ...p, [activeFormat]: { loading: true } }));
    fetch(`/api/meta-ads/ad/${ad.id}/preview?format=${activeFormat}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setPreviews((p) => ({
          ...p,
          [activeFormat]: {
            html: j.html || null,
            unsupported: !!j.unsupported,
            error: j.error || null,
            loading: false,
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { loading: false, error: err.message } }));
      });
    return () => { cancelled = true; };
    // `previews` intentionally excluded: including it causes the effect to re-run
    // after setPreviews({loading:true}), which cancels the in-flight fetch and
    // short-circuits before starting a new one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFormat, ad.id]);

  const current = previews[activeFormat] || { loading: true };
  const statusColor = STATUS_COLORS[ad.effective_status] || STATUS_COLORS[ad.status] || C.textMut;

  const containerStyle = fill
    ? { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: "hidden", display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }
    : { background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, marginBottom: 14, overflow: "hidden" };

  const previewAreaStyle = fill
    ? { background: "#0a0a12", flex: 1, minHeight: 0, display: "flex", alignItems: "center", justifyContent: "center", overflow: "auto" }
    : { background: "#0a0a12", minHeight: previewMinHeight, display: "flex", alignItems: "center", justifyContent: "center" };

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={{ padding: "12px 14px", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, borderBottom: `1px solid ${C.border}` }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={ad.name}>
            {ad.name}
          </p>
          {ad.creative?.title && (
            <p style={{ fontSize: 11, color: C.textSec, margin: "2px 0 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {ad.creative.title}
            </p>
          )}
        </div>
        <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px", padding: "3px 8px", borderRadius: 10, color: statusColor, border: `1px solid ${statusColor}55`, background: `${statusColor}18` }}>
          {ad.effective_status || ad.status}
        </span>
      </div>

      {/* Placement tabs */}
      <div style={{ display: "flex", gap: 0, borderBottom: `1px solid ${C.border}`, background: C.cardAlt, overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
        {FORMATS.map((f) => (
          <button
            key={f.key}
            onClick={() => setActiveFormat(f.key)}
            style={{
              flexShrink: 0,
              padding: "8px 12px",
              fontSize: 11,
              fontWeight: 700,
              background: "transparent",
              color: activeFormat === f.key ? C.textPri : C.textSec,
              border: "none",
              borderBottom: `2px solid ${activeFormat === f.key ? C.accent : "transparent"}`,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Preview */}
      <div style={previewAreaStyle}>
        {current.loading && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, color: C.textMut, fontSize: 12, padding: 40, alignSelf: "center" }}>
            <div style={{ width: 26, height: 26, border: `3px solid rgba(255,255,255,0.14)`, borderTopColor: C.accent, borderRadius: "50%", animation: "metaAdPreviewSpin 0.8s linear infinite" }} />
            <span>Loading preview&hellip;</span>
            <style>{"@keyframes metaAdPreviewSpin { to { transform: rotate(360deg); } }"}</style>
          </div>
        )}
        {!current.loading && current.html && (
          <div
            className="meta-preview-frame"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "100%", padding: "12px 8px", overflow: "hidden" }}
          >
            <style>{".meta-preview-frame iframe { max-width: 100% !important; display: block; margin: 0 auto; border: 0; }"}</style>
            <div dangerouslySetInnerHTML={{ __html: current.html }} style={{ width: "100%", display: "flex", justifyContent: "center" }} />
          </div>
        )}
        {!current.loading && !current.html && current.unsupported && (
          <div style={{ padding: 40, textAlign: "center", color: C.textMut, fontSize: 12, alignSelf: "center" }}>
            This ad doesn&apos;t render in {FORMATS.find((f) => f.key === activeFormat)?.label}.
            {ad.creative?.image_url && (
              <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", marginTop: 16, borderRadius: 8 }} />
            )}
          </div>
        )}
        {!current.loading && !current.html && current.error && (
          <div style={{ padding: 40, textAlign: "center", color: C.amber, fontSize: 12, alignSelf: "center" }}>
            Preview unavailable. {ad.creative?.image_url && <><br /><img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", marginTop: 12, borderRadius: 8 }} /></>}
            {ad.creative?.body && <p style={{ color: C.textSec, marginTop: 12 }}>{ad.creative.body}</p>}
          </div>
        )}
      </div>

      {/* Metrics */}
      {!hideMetrics && (
      <div style={{ padding: "12px 14px", background: C.card }}>
        <MetricRow items={[
          { label: "Spend",   value: fmtCurrency(ad.insights?.spend) },
          { label: "Impr",    value: fmtInt(ad.insights?.impressions) },
          { label: "Clicks",  value: fmtInt(ad.insights?.clicks) },
          { label: "CTR",     value: fmtPct(ad.insights?.ctr) },
        ]} />
        <div style={{ height: 8 }} />
        <MetricRow items={[
          { label: "Conv",   value: fmtInt(ad.insights?.conversions) },
          { label: "CPA",    value: fmtCurrency(ad.insights?.cost_per_conversion) },
          { label: "ROAS",   value: fmtRoas(ad.insights?.roas) },
        ]} />
      </div>
      )}
    </div>
  );
}

function MetricRow({ items }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${items.length}, 1fr)`, gap: 8 }}>
      {items.map((it) => (
        <div key={it.label}>
          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.5px", color: "rgba(255,255,255,0.5)", margin: 0 }}>{it.label}</p>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#ffffff", margin: "2px 0 0" }}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}
