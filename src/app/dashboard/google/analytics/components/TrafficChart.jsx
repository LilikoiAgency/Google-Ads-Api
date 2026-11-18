"use client";
import { useMemo, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { CHANNEL_COLORS } from "@/lib/ga4Channels";
import { fmtInt } from "./format";

const GRANULARITIES = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
];

const colorOf = (channel) => CHANNEL_COLORS[channel] || CHANNEL_COLORS.fallback;

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value > 0).sort((a, b) => b.value - a.value);
  return (
    <div className="ga4-tooltip">
      <p className="ga4-tooltip-title">{label}</p>
      {rows.length === 0 && <p className="ga4-tooltip-row">No users</p>}
      {rows.map((p) => (
        <p key={p.dataKey} className="ga4-tooltip-row">
          <span className="ga4-swatch ga4-swatch-sm" style={{ background: p.color }} />
          <span className="ga4-tooltip-name">{p.dataKey}</span>
          <span className="ga4-tooltip-val">{fmtInt(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

// Users over time, stacked by channel (current period only). Clicking a legend
// item hides/shows that channel locally; the granularity switch refetches.
export default function TrafficChart({ series, granularity, onGranularityChange, viewLabel, loading = false }) {
  const [hidden, setHidden] = useState(() => new Set());

  const data = useMemo(() => {
    if (!series) return [];
    return series.labels.map((label, i) => {
      const row = { label };
      for (const ds of series.datasets) row[ds.channel] = Number.isFinite(ds.data[i]) ? ds.data[i] : 0;
      return row;
    });
  }, [series]);

  const datasets = series?.datasets || [];
  const visible = datasets.filter((d) => !hidden.has(d.channel));
  const hasData = datasets.some((d) => d.data.some((x) => x > 0));

  const toggle = (channel) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(channel)) next.delete(channel);
      else next.add(channel);
      return next;
    });

  return (
    <section className="ga4-card ga4-panel">
      <div className="ga4-panel-head ga4-chart-head">
        <div>
          <h2 className="ga4-h2">Users over time</h2>
          <p className="ga4-sub">Stacked by channel · current period</p>
        </div>
        <div className="ga4-segment ga4-segment-sm" role="group" aria-label="Chart granularity">
          {GRANULARITIES.map((g) => (
            <button
              key={g.key}
              type="button"
              aria-pressed={g.key === granularity}
              className={`ga4-segment-btn${g.key === granularity ? " is-active" : ""}`}
              onClick={() => g.key !== granularity && onGranularityChange(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !series ? (
        <div className="ga4-skel" style={{ height: 280 }} />
      ) : !hasData ? (
        <div className="ga4-chart-empty">No {viewLabel ? `${viewLabel.toLowerCase()} ` : ""}traffic in this range.</div>
      ) : (
        <>
          <div className="ga4-chart">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap={data.length > 60 ? 1 : "18%"}>
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} interval="preserveStartEnd" tick={{ fontSize: 11 }} />
                <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={(v) => fmtInt(v)} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "var(--ga4-cursor)" }} />
                {visible.map((d, i) => (
                  <Bar
                    key={d.channel}
                    dataKey={d.channel}
                    stackId="users"
                    fill={colorOf(d.channel)}
                    radius={i === visible.length - 1 ? [3, 3, 0, 0] : 0}
                    isAnimationActive={false}
                  />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="ga4-legend" role="group" aria-label="Show or hide channels">
            {datasets.map((d) => {
              const off = hidden.has(d.channel);
              return (
                <button
                  key={d.channel}
                  type="button"
                  aria-pressed={!off}
                  className={`ga4-legend-item${off ? " is-off" : ""}`}
                  onClick={() => toggle(d.channel)}
                  title={off ? `Show ${d.channel}` : `Hide ${d.channel}`}
                >
                  <span className="ga4-swatch" style={{ background: colorOf(d.channel) }} />
                  {d.channel}
                </button>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
