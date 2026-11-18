"use client";
import { useEffect, useRef, useState } from "react";
import { VIEWS } from "@/lib/ga4Channels";

// The view the file opens on: the one on screen if it's included, else the first included.
export function openingView(current, selected) {
  if (selected.includes(current)) return current;
  return VIEWS.map((v) => v.key).find((k) => selected.includes(k)) || null;
}

function hintFor(selected) {
  if (!selected.length) return "Pick at least one view.";
  if (selected.length === 1) {
    const label = VIEWS.find((v) => v.key === selected[0])?.label;
    return `The client sees only ${label}. No other numbers are in the file.`;
  }
  return `The client can switch between these ${selected.length} views. Unticked views aren't in the file at all.`;
}

// "Download report" button with a small menu for choosing which views go into the file.
// Every time it opens, the choice resets to just the view on screen, so nothing extra
// (like paid traffic) goes to a client unless someone ticks it on purpose.
export default function DownloadMenu({ currentView, disabled = false, onDownload, compact = false }) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState([currentView]);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggleOpen = () => {
    if (!open) setSelected([currentView]);
    setOpen((o) => !o);
  };

  const toggleView = (key) =>
    setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  const includesPaid = selected.includes("paid") || selected.includes("all");

  const download = () => {
    const view = openingView(currentView, selected);
    if (!view) return;
    onDownload({ view, views: VIEWS.map((v) => v.key).filter((k) => selected.includes(k)) });
    setOpen(false);
  };

  return (
    <div className="ga4-dl" ref={ref}>
      <button
        type="button"
        className={`ga4-btn ga4-btn-primary${compact ? " ga4-btn-sm" : ""}`}
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 4v11m0 0l-4.5-4.5M12 15l4.5-4.5M5 20h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {compact ? "Download" : "Download report"}
        <span aria-hidden="true" className="ga4-dl-caret">▾</span>
      </button>

      {open && (
        <div className="ga4-dl-pop" role="dialog" aria-label="Choose what goes in the report">
          <p className="ga4-dl-title">What goes in the report?</p>
          <div className="ga4-dl-options">
            {VIEWS.map((v) => (
              <label key={v.key} className={`ga4-dl-option${selected.includes(v.key) ? " is-on" : ""}`}>
                <input
                  type="checkbox"
                  checked={selected.includes(v.key)}
                  onChange={() => toggleView(v.key)}
                />
                <span>{v.label}</span>
                {v.key === currentView && <span className="ga4-dl-tag">on screen</span>}
              </label>
            ))}
          </div>
          <p className="ga4-dl-hint">{hintFor(selected)}</p>
          {includesPaid && <p className="ga4-dl-paid">Includes paid traffic numbers.</p>}
          <button
            type="button"
            className="ga4-btn ga4-btn-primary ga4-dl-go"
            disabled={!selected.length}
            onClick={download}
          >
            Download
          </button>
        </div>
      )}
    </div>
  );
}
