"use client";
import { useMemo, useState } from "react";
import { CHANNEL_COLORS } from "@/lib/ga4Channels";
import { fmtInt, fmtRate, DeltaText } from "./format";

// Sort value for a column; null deltas sort last in either direction.
function sortValue(row, key) {
  if (key === "channel") return row.channel.toLowerCase();
  if (key === "dUsers") return row.deltas?.users ?? null;
  if (key === "dSessions") return row.deltas?.sessions ?? null;
  return row.current?.[key] ?? 0;
}

function SortHeader({ col, sort, onSort }) {
  const active = sort.key === col.key;
  return (
    <th className={col.num ? "ga4-num" : ""} aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" className="ga4-sort" onClick={() => onSort(col.key)}>
        {col.label}
        <span className={`ga4-sort-icon${active ? " is-active" : ""}`} aria-hidden="true">
          {active ? (sort.dir === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

// Channel rows for the selected view. The total row always uses `totals`
// (deduplicated by GA), never the sum of the rows.
export default function ChannelTable({ channels, totals, totalDeltas = {}, hasCompare, showKeyEvents = true }) {
  const [sort, setSort] = useState({ key: "sessions", dir: "desc" });

  const cols = [
    { key: "channel", label: "Channel" },
    { key: "users", label: "Users", num: true },
    hasCompare && { key: "dUsers", label: "Δ", num: true },
    { key: "sessions", label: "Sessions", num: true },
    hasCompare && { key: "dSessions", label: "Δ", num: true },
    { key: "engagedSessions", label: "Engaged", num: true },
    { key: "engagementRate", label: "Eng. rate", num: true },
    showKeyEvents && { key: "keyEvents", label: "Key events", num: true },
  ].filter(Boolean);

  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "channel" ? "asc" : "desc" }));

  const rows = useMemo(() => {
    const out = [...channels];
    out.sort((a, b) => {
      const va = sortValue(a, sort.key);
      const vb = sortValue(b, sort.key);
      if (va === vb) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      const cmp = va > vb ? 1 : -1;
      return sort.dir === "asc" ? cmp : -cmp;
    });
    return out;
  }, [channels, sort]);

  const cells = (m, d) => (
    <>
      <td className="ga4-num">{fmtInt(m.users)}</td>
      {hasCompare && <td className="ga4-num"><DeltaText d={d?.users} /></td>}
      <td className="ga4-num">{fmtInt(m.sessions)}</td>
      {hasCompare && <td className="ga4-num"><DeltaText d={d?.sessions} /></td>}
      <td className="ga4-num">{fmtInt(m.engagedSessions)}</td>
      <td className="ga4-num">{fmtRate(m.engagementRate)}</td>
      {showKeyEvents && <td className="ga4-num">{fmtInt(m.keyEvents)}</td>}
    </>
  );

  return (
    <div className="ga4-table-wrap">
      <table className="ga4-table">
        <thead>
          <tr>
            {cols.map((c) => <SortHeader key={c.key} col={c} sort={sort} onSort={onSort} />)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={cols.length} className="ga4-empty-cell">No traffic in this view for this range.</td></tr>
          ) : rows.map((r) => (
            <tr key={r.channel}>
              <td className="ga4-sticky">
                <span className="ga4-swatch" style={{ background: CHANNEL_COLORS[r.channel] || CHANNEL_COLORS.fallback }} />
                {r.channel}
              </td>
              {cells(r.current, r.deltas)}
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="ga4-total-row">
            <td className="ga4-sticky">Total (unique users)</td>
            {cells(totals, totalDeltas)}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
