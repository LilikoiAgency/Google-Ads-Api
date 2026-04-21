// src/app/dashboard/pacing/PacingTrendChart.jsx
"use client";

import { useEffect, useState, useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";

const CLIENT_COLORS = {
  BBT: "#4ecca3", // teal
  SMP: "#f5a623", // amber
  CMK: "#3182ce", // blue
  MSP: "#a855f7", // purple
};
const FALLBACK = "#9ca3af";

const C = {
  card:    "#1a1a2e",
  cardAlt: "#13131f",
  border:  "rgba(255,255,255,0.08)",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.55)",
  textMut: "rgba(255,255,255,0.35)",
};

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: "10px 12px", fontSize: 12, color: C.textPri,
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 6 }}>{fmtDate(label)}</div>
      {payload.map((p) => (
        <div key={p.dataKey} style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: p.color }} />
          <span style={{ color: C.textSec }}>{p.name}:</span>
          <span style={{ fontWeight: 600 }}>{p.value == null ? "—" : p.value.toFixed(1) + "%"}</span>
        </div>
      ))}
    </div>
  );
}

export default function PacingTrendChart() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pacing/trends?days=${days}`)
      .then((r) => r.ok ? r.json() : null)
      .then((j) => { if (j?.data) setData(j.data); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [days]);

  const series = data?.series || [];
  const clients = data?.clients || [];

  // Compute Y-axis max so we always show 100% line and any over-pacing peaks
  const yMax = useMemo(() => {
    let max = 130;
    for (const row of series) {
      for (const c of clients) {
        const v = row[c.key + "_pct"];
        if (v != null && v > max) max = v;
      }
    }
    return Math.ceil(max / 10) * 10; // round to nearest 10
  }, [series, clients]);

  if (loading) {
    return <div style={{ padding: 30, textAlign: "center", color: C.textSec, fontSize: 13 }}>Loading trends…</div>;
  }

  if (!series.length) {
    return (
      <div style={{ padding: 30, textAlign: "center", color: C.textSec, fontSize: 13 }}>
        No trend data yet. Reports start accumulating after the first cron run.
      </div>
    );
  }

  return (
    <div style={{ padding: "16px 20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 240px", minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.textPri }}>Pacing % over time</div>
          <div style={{ fontSize: 11, color: C.textMut, marginTop: 2 }}>
            Each line = one client&apos;s end-of-month pacing as % of total budget. 100% = on track. Last {days} days, {series.length} report{series.length === 1 ? "" : "s"}.
          </div>
        </div>
        <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              style={{
                background: d === days ? "rgba(78,204,163,0.15)" : "rgba(255,255,255,0.04)",
                color: d === days ? "#4ecca3" : C.textSec,
                border: `1px solid ${d === days ? "rgba(78,204,163,0.4)" : C.border}`,
                borderRadius: 5, padding: "4px 12px", fontSize: 11, fontWeight: 700, cursor: "pointer",
              }}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={series} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" />
          <XAxis
            dataKey="date"
            tickFormatter={fmtDate}
            stroke={C.textMut}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            domain={[0, yMax]}
            stroke={C.textMut}
            tick={{ fontSize: 11 }}
            tickFormatter={(v) => v + "%"}
          />
          {/* Shaded zones for under / on-track / over */}
          <ReferenceArea y1={85} y2={115} fill="#38a169" fillOpacity={0.06} />
          <ReferenceLine y={100} stroke="#4ecca3" strokeDasharray="4 4" strokeOpacity={0.6} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          {clients.map((c) => (
            <Line
              key={c.key}
              type="monotone"
              dataKey={c.key + "_pct"}
              name={c.name}
              stroke={CLIENT_COLORS[c.key] || FALLBACK}
              strokeWidth={2}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
