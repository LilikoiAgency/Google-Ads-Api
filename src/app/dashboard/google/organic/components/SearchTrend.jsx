"use client";
import { useMemo, useState } from "react";
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, ReferenceArea,
} from "recharts";
import { rollupTrend } from "@/lib/gscInsights";
import { fmtInt, fmtCtr, fmtPos } from "./format";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const label = (date, gran) => {
  const [y, m, d] = date.split("-").map(Number);
  if (gran === "month") return `${MONTHS[m - 1]} ${y}`;
  return `${gran === "week" ? "Wk of " : ""}${MONTHS[m - 1]} ${d}`;
};

const METRICS = [
  { key: "volume", label: "Clicks & impressions" },
  { key: "ctr", label: "CTR" },
  { key: "position", label: "Position" },
];
const GRANS = [{ key: "day", label: "Day" }, { key: "week", label: "Week" }, { key: "month", label: "Month" }];
const COLORS = { clicks: "#4285F4", impressions: "#a855f7", ctr: "#16a34a", position: "#f59e0b" };

function bucketOf(date, gran) {
  return rollupTrend([{ date, clicks: 0, impressions: 0, position: 0 }], gran)[0]?.date || date;
}

function TrendTooltip({ active, payload, label: l, metric }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const fmt = (k, v) => (k === "ctr" || k === "prevCtr" ? fmtCtr(v) : k === "position" || k === "prevPosition" ? fmtPos(v) : fmtInt(v));
  const lines = metric === "volume"
    ? [["Clicks", "clicks"], ["Impressions", "impressions"], ["Clicks (compare)", "prevClicks"]]
    : metric === "ctr" ? [["CTR", "ctr"], ["CTR (compare)", "prevCtr"]] : [["Position", "position"], ["Position (compare)", "prevPosition"]];
  return (
    <div className="ga4-tooltip">
      <p className="ga4-tooltip-title">{l}{row.preliminary ? " · preliminary" : ""}</p>
      {lines.filter(([, k]) => row[k] !== undefined && row[k] !== null).map(([name, k]) => (
        <p key={k} className="ga4-tooltip-row">
          <span className="ga4-tooltip-name">{name}</span>
          <span className="ga4-tooltip-val">{fmt(k, row[k])}</span>
        </p>
      ))}
      {row.notes?.map((n) => <p key={n.id} className="gsc-tooltip-note">📌 {n.label}</p>)}
    </div>
  );
}

export default function SearchTrend({
  trend, trendCompare, granularity, onGranularityChange, firstIncompleteDate,
  annotations = [], onAddAnnotation, onRemoveAnnotation, hasPosition = true, loading = false,
}) {
  const [metric, setMetric] = useState("volume");
  const [noteOpen, setNoteOpen] = useState(false);
  const [draft, setDraft] = useState({ date: "", label: "" });
  const [saving, setSaving] = useState(false);

  const data = useMemo(() => {
    const cur = rollupTrend(trend || [], granularity);
    const prev = trendCompare ? rollupTrend(trendCompare, granularity) : null;
    const notesBy = new Map();
    for (const a of annotations) {
      const k = bucketOf(a.date, granularity);
      if (!notesBy.has(k)) notesBy.set(k, []);
      notesBy.get(k).push(a);
    }
    const prelimBucket = firstIncompleteDate ? bucketOf(firstIncompleteDate, granularity) : null;
    return cur.map((t, i) => ({
      ...t,
      label: label(t.date, granularity),
      prevClicks: prev?.[i]?.clicks ?? null,
      prevCtr: prev?.[i]?.ctr ?? null,
      prevPosition: prev?.[i]?.position || null,
      position: t.position || null,
      preliminary: !!prelimBucket && t.date >= prelimBucket,
      notes: notesBy.get(t.date) || null,
    }));
  }, [trend, trendCompare, granularity, annotations, firstIncompleteDate]);

  const prelim = data.filter((d) => d.preliminary);
  const metrics = hasPosition ? METRICS : METRICS.filter((m) => m.key !== "position");
  const noteMarks = data.filter((d) => d.notes);

  const save = async () => {
    if (!draft.date || !draft.label.trim()) return;
    setSaving(true);
    try {
      await onAddAnnotation({ date: draft.date, label: draft.label.trim() });
      setDraft({ date: "", label: "" });
      setNoteOpen(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ga4-card ga4-panel">
      <div className="ga4-panel-head ga4-chart-head">
        <div>
          <h2 className="ga4-h2">Performance over time</h2>
          <p className="ga4-sub">
            {trendCompare ? "Dashed line = comparison period" : "Current period"}
            {prelim.length > 0 ? " · shaded = preliminary, Google is still counting" : ""}
          </p>
        </div>
        <div className="gsc-chart-controls">
          <div className="ga4-segment ga4-segment-sm" role="group" aria-label="Chart metric">
            {metrics.map((m) => (
              <button key={m.key} type="button" className={`ga4-segment-btn${metric === m.key ? " is-active" : ""}`}
                aria-pressed={metric === m.key} onClick={() => setMetric(m.key)}>{m.label}</button>
            ))}
          </div>
          <div className="ga4-segment ga4-segment-sm" role="group" aria-label="Chart granularity">
            {GRANS.map((g) => (
              <button key={g.key} type="button" className={`ga4-segment-btn${granularity === g.key ? " is-active" : ""}`}
                aria-pressed={granularity === g.key} onClick={() => onGranularityChange(g.key)}>{g.label}</button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="ga4-skel" style={{ height: 280 }} />
      ) : data.length === 0 ? (
        <div className="ga4-chart-empty">No search data in this range.</div>
      ) : (
        <div className="ga4-chart">
          <ResponsiveContainer width="100%" height={280}>
            <ComposedChart data={data} margin={{ top: 16, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid vertical={false} strokeDasharray="0" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} tick={{ fontSize: 11 }} />
              {metric === "volume" && <>
                <YAxis yAxisId="l" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={fmtInt} />
                <YAxis yAxisId="r" orientation="right" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 11 }} tickFormatter={fmtInt} />
              </>}
              {metric === "ctr" && <YAxis yAxisId="l" tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11 }} tickFormatter={fmtCtr} />}
              {metric === "position" && <YAxis yAxisId="l" reversed tickLine={false} axisLine={false} width={40} tick={{ fontSize: 11 }} domain={[1, "auto"]} allowDecimals={false} />}
              <Tooltip content={<TrendTooltip metric={metric} />} cursor={{ stroke: "var(--ga4-grid)" }} />
              {prelim.length > 0 && (
                <ReferenceArea yAxisId="l" x1={prelim[0].label} x2={prelim[prelim.length - 1].label} fill="var(--ga4-accent-soft)" ifOverflow="extendDomain" />
              )}
              {noteMarks.map((d) => (
                <ReferenceLine key={d.date} yAxisId="l" x={d.label} stroke="#f59e0b" strokeDasharray="3 3"
                  label={{ value: "📌", position: "top", fontSize: 12 }} />
              ))}
              {metric === "volume" && <>
                <Line yAxisId="l" type="monotone" dataKey="clicks" name="Clicks" stroke={COLORS.clicks} strokeWidth={2} dot={false} />
                <Line yAxisId="r" type="monotone" dataKey="impressions" name="Impressions" stroke={COLORS.impressions} strokeWidth={2} dot={false} />
                {trendCompare && <Line yAxisId="l" type="monotone" dataKey="prevClicks" name="Clicks (compare)" stroke={COLORS.clicks} strokeOpacity={0.45} strokeDasharray="5 4" strokeWidth={1.5} dot={false} />}
              </>}
              {metric === "ctr" && <>
                <Line yAxisId="l" type="monotone" dataKey="ctr" name="CTR" stroke={COLORS.ctr} strokeWidth={2} dot={false} />
                {trendCompare && <Line yAxisId="l" type="monotone" dataKey="prevCtr" stroke={COLORS.ctr} strokeOpacity={0.45} strokeDasharray="5 4" strokeWidth={1.5} dot={false} />}
              </>}
              {metric === "position" && <>
                <Line yAxisId="l" type="monotone" dataKey="position" name="Position" stroke={COLORS.position} strokeWidth={2} dot={false} connectNulls />
                {trendCompare && <Line yAxisId="l" type="monotone" dataKey="prevPosition" stroke={COLORS.position} strokeOpacity={0.45} strokeDasharray="5 4" strokeWidth={1.5} dot={false} connectNulls />}
              </>}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="gsc-legend-row">
        {metric === "volume" && <>
          <span className="gsc-legend"><span className="ga4-swatch" style={{ background: COLORS.clicks }} />Clicks (left)</span>
          <span className="gsc-legend"><span className="ga4-swatch" style={{ background: COLORS.impressions }} />Impressions (right)</span>
        </>}
        {annotations.length > 0 && <span className="gsc-legend">📌 Notes</span>}
        {onAddAnnotation && (
          <button type="button" className="ga4-link gsc-note-toggle" onClick={() => setNoteOpen((o) => !o)}>
            {noteOpen ? "Close notes" : `Notes${annotations.length ? ` (${annotations.length})` : ""}`}
          </button>
        )}
      </div>

      {noteOpen && (
        <div className="gsc-notes">
          <p className="ga4-sub">Mark site launches, redesigns, migrations or Google updates. Notes are shared with everyone on this site.</p>
          <div className="gsc-note-form">
            <input type="date" className="ga4-control" value={draft.date}
              onChange={(e) => setDraft((d) => ({ ...d, date: e.target.value }))} aria-label="Note date" />
            <input type="text" className="ga4-control gsc-note-input" placeholder="e.g. New service pages launched" maxLength={120}
              value={draft.label} onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
              onKeyDown={(e) => { if (e.key === "Enter") save(); }} aria-label="Note text" />
            <button type="button" className="ga4-btn ga4-btn-primary" disabled={saving || !draft.date || !draft.label.trim()} onClick={save}>
              {saving ? "Saving…" : "Add note"}
            </button>
          </div>
          {annotations.length > 0 && (
            <ul className="gsc-note-list">
              {[...annotations].reverse().map((a) => (
                <li key={a.id}>
                  <span className="gsc-note-date">{a.date}</span>
                  <span className="gsc-note-label">{a.label}</span>
                  <button type="button" className="ga4-link" onClick={() => onRemoveAnnotation(a.id)} aria-label={`Delete note ${a.label}`}>Delete</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
