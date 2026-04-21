// src/app/dashboard/meta/components/MetaAdsPanel.jsx
"use client";

import { useEffect, useMemo, useState } from "react";
import MetaAdPreview from "./MetaAdPreview";

const C = {
  bg:       "#0f0f17",
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

const SORT_OPTIONS = [
  { key: "spend",       label: "Spend" },
  { key: "impressions", label: "Impressions" },
  { key: "ctr",         label: "CTR" },
  { key: "conversions", label: "Conversions" },
  { key: "roas",        label: "ROAS" },
];

export default function MetaAdsPanel({ open, onClose, adSet, campaignName, range, startDate, endDate }) {
  const [ads, setAds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [sortKey, setSortKey] = useState("spend");
  const [activeOnly, setActiveOnly] = useState(true);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Fetch ads when panel opens or inputs change
  useEffect(() => {
    if (!open || !adSet?.id) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setAds(null);

    const params = new URLSearchParams({ range: range || "28d" });
    if (range === "custom" && startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }

    fetch(`/api/meta-ads/ad-set/${adSet.id}/ads?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : r.json().then((j) => { throw new Error(j.error || `HTTP ${r.status}`); }))
      .then((j) => { setAds(j.data || []); })
      .catch((err) => {
        if (err.name !== "AbortError") setError(err.message || "Failed to load ads");
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [open, adSet?.id, range, startDate, endDate]);

  const visibleAds = useMemo(() => {
    if (!ads) return [];
    let list = activeOnly ? ads.filter((a) => a.effective_status === "ACTIVE" || a.status === "ACTIVE") : ads;
    list = [...list].sort((a, b) => {
      const av = a.insights?.[sortKey] ?? 0;
      const bv = b.insights?.[sortKey] ?? 0;
      return (bv || 0) - (av || 0);
    });
    return list;
  }, [ads, sortKey, activeOnly]);

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, left: 0, zIndex: 40,
          background: "rgba(0,0,0,0.5)", transition: "opacity 0.2s",
        }}
      />
      {/* Panel */}
      <div style={{
        position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
        width: 560, maxWidth: "100vw",
        background: C.bg,
        borderLeft: `1px solid ${C.border}`,
        display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 40px rgba(0,0,0,0.6)",
      }}>
        {/* Header */}
        <div style={{ padding: "16px 18px", borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1px", color: C.accent, margin: "0 0 4px" }}>ADS IN AD SET</p>
              {campaignName && (
                <p style={{ fontSize: 11, color: C.textSec, margin: "0 0 2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {campaignName}
                </p>
              )}
              <p style={{ fontSize: 15, fontWeight: 700, color: C.textPri, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={adSet?.name}>
                {adSet?.name || "Ad set"}
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" style={{ flexShrink: 0, background: "rgba(255,255,255,0.08)", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", color: C.textSec, fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>

          {/* Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <label style={{ fontSize: 11, color: C.textSec, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={activeOnly}
                onChange={(e) => setActiveOnly(e.target.checked)}
              />
              Active only
            </label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 11, color: C.textSec }}>Sort:</span>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value)}
                style={{ background: C.cardAlt, color: C.textPri, border: `1px solid ${C.border}`, borderRadius: 5, padding: "4px 8px", fontSize: 12 }}
              >
                {SORT_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
              </select>
            </div>
            <span style={{ fontSize: 11, color: C.textMut, marginLeft: "auto" }}>
              {ads ? `${visibleAds.length} of ${ads.length} ads` : ""}
            </span>
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "14px 14px 40px" }}>
          {loading && (
            <div style={{ padding: 40, textAlign: "center", color: C.textSec, fontSize: 13 }}>Loading ads…</div>
          )}
          {!loading && error && (
            <div style={{ padding: 18, background: "rgba(233,69,96,0.1)", border: "1px solid rgba(233,69,96,0.3)", borderRadius: 8, color: C.accent, fontSize: 13 }}>
              {error}
            </div>
          )}
          {!loading && !error && visibleAds.length === 0 && (
            <div style={{ padding: 40, textAlign: "center", color: C.textMut, fontSize: 13 }}>
              {ads?.length === 0 ? "No ads in this ad set." : "No ads match the current filter."}
            </div>
          )}
          {!loading && !error && visibleAds.map((ad) => (
            <MetaAdPreview key={ad.id} ad={ad} />
          ))}
        </div>
      </div>
    </>
  );
}
