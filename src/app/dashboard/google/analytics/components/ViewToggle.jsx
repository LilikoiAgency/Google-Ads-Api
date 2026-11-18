"use client";
import { VIEWS } from "@/lib/ga4Channels";

// Organic search | All non-paid | Paid | Everything. Purely local: no refetch.
export default function ViewToggle({ value, onChange }) {
  return (
    <div className="ga4-segment" role="group" aria-label="Traffic view">
      {VIEWS.map((v) => (
        <button
          key={v.key}
          type="button"
          aria-pressed={v.key === value}
          className={`ga4-segment-btn${v.key === value ? " is-active" : ""}`}
          onClick={() => onChange(v.key)}
        >
          {v.label}
        </button>
      ))}
    </div>
  );
}
