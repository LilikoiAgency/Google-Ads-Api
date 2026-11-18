"use client";
import { useEffect, useMemo, useRef, useState } from "react";

// Searchable GA4 property list grouped by account, with a "Refresh list" link
// that re-reads the service account's properties from Google.
export default function PropertyPicker({ properties, value, onChange, onRefresh, refreshing = false }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const ref = useRef(null);
  const inputRef = useRef(null);
  const current = properties.find((p) => p.id === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    inputRef.current?.focus();
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const map = new Map();
    for (const p of properties) {
      if (q && !`${p.name} ${p.account} ${p.id}`.toLowerCase().includes(q)) continue;
      if (!map.has(p.account)) map.set(p.account, []);
      map.get(p.account).push(p);
    }
    return [...map.entries()];
  }, [properties, query]);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  const onSearchKey = (e) => {
    if (e.key === "Enter" && groups.length) pick(groups[0][1][0].id);
  };

  return (
    <div ref={ref} className="ga4-picker">
      <button
        type="button"
        className="ga4-control ga4-picker-btn"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="ga4-picker-text">
          <span className="ga4-picker-name">{current ? current.name : "Select a property"}</span>
          {current && <span className="ga4-picker-account">{current.account}</span>}
        </span>
        <span className="ga4-caret" aria-hidden="true">▾</span>
      </button>

      {open && (
        <div className="ga4-picker-pop">
          <input
            ref={inputRef}
            type="search"
            className="ga4-input"
            placeholder="Search properties"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onSearchKey}
          />
          <div className="ga4-picker-list" role="listbox">
            {groups.length === 0 && <p className="ga4-picker-none">No properties match “{query}”.</p>}
            {groups.map(([account, list]) => (
              <div key={account} role="group" aria-label={account}>
                <p className="ga4-picker-group">{account}</p>
                {list.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={p.id === value}
                    className={`ga4-picker-item${p.id === value ? " is-active" : ""}`}
                    onClick={() => pick(p.id)}
                  >
                    <span>{p.name}</span>
                    <span className="ga4-picker-id">{p.id.replace("properties/", "")}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
          <div className="ga4-picker-foot">
            <span>{properties.length} {properties.length === 1 ? "property" : "properties"}</span>
            <button type="button" className="ga4-link" onClick={onRefresh} disabled={refreshing}>
              {refreshing ? "Refreshing…" : "Refresh list"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
