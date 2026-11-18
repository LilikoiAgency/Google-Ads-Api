"use client";
import { useEffect, useState } from "react";
import { PRESETS, isValidRange } from "@/lib/ga4Dates";

export const COMPARE_OPTIONS = [
  { key: "prev", label: "Previous period" },
  { key: "yoy", label: "Same period last year" },
  { key: "none", label: "No comparison" },
];

function customError(draft) {
  if (!draft.startDate || !draft.endDate) return "Pick a start and an end date.";
  if (draft.startDate > draft.endDate) return "The start date must be on or before the end date.";
  if (!isValidRange(draft)) return "Ranges can be at most 3 years.";
  return "";
}

// Date range preset (+ custom From/To) and comparison mode.
// onRangeChange({ rangeKey, custom }) fires for presets immediately and for
// Custom only when Apply is clicked with a valid range.
export default function RangeControls({ rangeKey, range, today, compare, onRangeChange, onCompareChange, stacked = false }) {
  const [editing, setEditing] = useState(rangeKey === "custom");
  const [draft, setDraft] = useState(range || { startDate: "", endDate: "" });
  const [error, setError] = useState("");

  // Keep the draft in step with the applied range when it changes elsewhere.
  useEffect(() => {
    if (range) setDraft(range);
    setEditing(rangeKey === "custom");
    setError("");
  }, [rangeKey, range?.startDate, range?.endDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const onPreset = (key) => {
    if (key === "custom") {
      setEditing(true);
      setDraft(range || { startDate: "", endDate: "" });
      return;
    }
    setEditing(false);
    onRangeChange({ rangeKey: key, custom: null });
  };

  const apply = () => {
    const msg = customError(draft);
    setError(msg);
    if (!msg) onRangeChange({ rangeKey: "custom", custom: { ...draft } });
  };

  const selectValue = editing ? "custom" : rangeKey;

  return (
    <div className={`ga4-range${stacked ? " is-stacked" : ""}`}>
      <label className="ga4-field">
        <span className="ga4-field-label">Range</span>
        <select className="ga4-control ga4-select" value={selectValue} onChange={(e) => onPreset(e.target.value)}>
          {PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </label>

      {editing && (
        <div className="ga4-custom">
          <label className="ga4-field">
            <span className="ga4-field-label">From</span>
            <input type="date" className="ga4-control ga4-date" value={draft.startDate} max={today}
              onChange={(e) => setDraft((d) => ({ ...d, startDate: e.target.value }))} />
          </label>
          <label className="ga4-field">
            <span className="ga4-field-label">To</span>
            <input type="date" className="ga4-control ga4-date" value={draft.endDate} max={today}
              onChange={(e) => setDraft((d) => ({ ...d, endDate: e.target.value }))} />
          </label>
          <button type="button" className="ga4-btn ga4-btn-primary" onClick={apply}>Apply</button>
          {error && <p className="ga4-field-error" role="alert">{error}</p>}
        </div>
      )}

      <label className="ga4-field">
        <span className="ga4-field-label">Compare to</span>
        <select className="ga4-control ga4-select" value={compare} onChange={(e) => onCompareChange(e.target.value)}>
          {COMPARE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}
