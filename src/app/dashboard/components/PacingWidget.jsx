// src/app/dashboard/components/PacingWidget.jsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const STATUS_META = {
  ON_TRACK:  { label: "On Track",  bg: "rgba(56,161,105,0.12)", text: "#38a169", border: "rgba(56,161,105,0.3)" },
  UNDER:     { label: "Under",     bg: "rgba(49,130,206,0.12)", text: "#3182ce", border: "rgba(49,130,206,0.3)" },
  OVER:      { label: "Over",      bg: "rgba(221,107,32,0.14)", text: "#dd6b20", border: "rgba(221,107,32,0.35)" },
  NO_BUDGET: { label: "No Budget", bg: "rgba(245,158,11,0.14)", text: "#f59e0b", border: "rgba(245,158,11,0.35)" },
  INACTIVE:  { label: "Inactive",  bg: "rgba(156,163,175,0.12)", text: "#9ca3af", border: "rgba(156,163,175,0.3)" },
};

const CACHE_MS = 60_000;
let cachedReport = null;
let cachedAt = 0;
let latestRequest = null;

function getLatestReport() {
  const now = Date.now();
  if (cachedReport && now - cachedAt < CACHE_MS) {
    return Promise.resolve(cachedReport);
  }

  if (!latestRequest) {
    latestRequest = fetch("/api/pacing/latest")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        cachedReport = j?.data || null;
        cachedAt = Date.now();
        return cachedReport;
      })
      .catch(() => null)
      .finally(() => {
        latestRequest = null;
      });
  }

  return latestRequest;
}

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(0) + "%";
}

function fmtRelative(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return `Today, ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function PacingWidget() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    getLatestReport().then((data) => {
      if (!active) return;
      if (data) setReport(data);
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  if (loading || !report) return null;
  const clients = report.summary?.clients || [];
  if (!clients.length) return null;

  return (
    <div style={{ marginBottom: 50 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 16 }}>
        <p style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--section-label)", margin: 0 }}>
          Pacing Snapshot
        </p>
        <Link href="/dashboard/pacing" style={{ fontSize: 13, fontWeight: 600, color: "var(--link-label)", textDecoration: "none" }}>
          View full report → <span style={{ color: "var(--banner-body)", fontWeight: 400, marginLeft: 6 }}>{fmtRelative(report.createdAt)}</span>
        </Link>
      </div>
      <div className="pacing-widget-cards">
        {clients.map((c) => {
          const meta = STATUS_META[c.status] || STATUS_META.INACTIVE;
          return (
            <Link
              key={c.key}
              href="/dashboard/pacing"
              style={{
                background: "var(--card-bg)", border: "1px solid var(--card-border)",
                borderRadius: 16, padding: 18, textDecoration: "none",
                display: "flex", flexDirection: "column", gap: 12,
                transition: "background 0.15s, border-color 0.15s, transform 0.1s",
                boxShadow: "var(--card-shadow)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--card-bg-hover)"; e.currentTarget.style.borderColor = "var(--card-border-hover)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "var(--card-bg)"; e.currentTarget.style.borderColor = "var(--card-border)"; }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0, lineHeight: 1.2 }}>
                  {c.name}
                </p>
                <span style={{
                  fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.5px",
                  padding: "3px 8px", borderRadius: 10, whiteSpace: "nowrap",
                  background: meta.bg, color: meta.text, border: `1px solid ${meta.border}`,
                }}>
                  {meta.label}
                </span>
              </div>

              <div>
                <p style={{ fontSize: 11, color: "var(--banner-body)", textTransform: "uppercase", letterSpacing: "0.5px", margin: "0 0 2px", opacity: 0.7 }}>Spend / Budget</p>
                <p style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>
                  {fmt(c.totalSpend)} <span style={{ color: "var(--banner-body)", fontWeight: 400, fontSize: 13 }}>/ {fmt(c.totalBudget) || "—"}</span>
                </p>
              </div>

              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", borderTop: "1px solid var(--card-border)", paddingTop: 10 }}>
                <div>
                  <p style={{ fontSize: 11, color: "var(--banner-body)", margin: "0 0 1px", opacity: 0.7 }}>EOM Pacing</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", margin: 0 }}>{fmt(c.totalEomPacing)}</p>
                </div>
                <div style={{ textAlign: "right" }}>
                  <p style={{ fontSize: 11, color: "var(--banner-body)", margin: "0 0 1px", opacity: 0.7 }}>Pacing</p>
                  <p style={{ fontSize: 16, fontWeight: 800, color: meta.text, margin: 0 }}>{fmtPct(c.pacingPct)}</p>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
