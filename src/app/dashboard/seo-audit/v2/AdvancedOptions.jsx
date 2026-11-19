"use client";
// Collapsible "Advanced" panel on the audit form: pages to audit first, only those
// pages, skip patterns and a page count. Form state is plain text; toRequestOptions
// turns it into the jobs API `options` (the server validates against the domain).

import { useState } from "react";
import { describeOptions } from "../../../../lib/seoAuditV2/options";

export const EMPTY_ADVANCED = { pagesText: "", onlyListed: false, skipText: "", pageCount: "" };
export const PAGE_COUNTS = [5, 10, 15, 25, 50];

const splitLines = (text) => String(text || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

// Form state -> API options, or undefined when nothing is set.
export function toRequestOptions(adv) {
  const pages = splitLines(adv?.pagesText);
  const skip = splitLines(adv?.skipText);
  const pageCount = adv?.pageCount ? Number(adv.pageCount) : undefined;
  if (!pages.length && !skip.length && !pageCount) return undefined;
  return { pages, skip, onlyListed: !!adv.onlyListed && pages.length > 0, ...(pageCount ? { pageCount } : {}) };
}

// Saved audit options -> form state (so "Run again" repeats the same selection).
export function fromAuditOptions(o) {
  if (!o) return EMPTY_ADVANCED;
  const path = (u) => {
    try { return new URL(u).pathname + new URL(u).search; } catch { return u; }
  };
  return {
    pagesText: (o.pages || []).map(path).join("\n"),
    onlyListed: !!o.onlyListed,
    skipText: (o.skip || []).join(", "),
    pageCount: o.pageCount ? String(o.pageCount) : "",
  };
}

const label = { fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", display: "block", marginBottom: 6 };
const hint = { fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 };
const field = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};

export default function AdvancedOptions({ value, onChange, auditType }) {
  const [open, setOpen] = useState(false);
  const adv = value || EMPTY_ADVANCED;
  const set = (patch) => onChange({ ...adv, ...patch });
  const opts = toRequestOptions(adv);
  const summary = describeOptions(opts ? { pageCount: null, ...opts } : null);
  const hasPages = splitLines(adv.pagesText).length > 0;
  const defaultCount = auditType === "quick" ? 5 : 50;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{ background: "none", border: "none", padding: 0, cursor: "pointer", display: "flex", alignItems: "center", gap: 8, color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600, textAlign: "left" }}
        >
          <span style={{ display: "inline-block", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>▸</span>
          Advanced
          {!open && summary && <span style={{ color: "#5eead4", fontWeight: 500 }}>· {summary}</span>}
        </button>
        {summary && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_ADVANCED)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(255,255,255,0.35)", fontSize: 12, textDecoration: "underline" }}
          >
            Clear
          </button>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 12, padding: 16, borderRadius: 12, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.03)", display: "grid", gap: 16 }}>
          <div>
            <label htmlFor="adv-pages" style={label}>Pages to audit first</label>
            <textarea
              id="adv-pages"
              rows={4}
              placeholder={"/las-vegas-turf\n/pet-turf"}
              value={adv.pagesText}
              onChange={(e) => set({ pagesText: e.target.value })}
              style={{ ...field, resize: "vertical" }}
            />
            <p style={hint}>One per line. Paths or full URLs on this site. These are always included.</p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, fontSize: 13, color: hasPages ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.3)", cursor: hasPages ? "pointer" : "not-allowed" }}>
              <input
                type="checkbox"
                checked={adv.onlyListed && hasPages}
                disabled={!hasPages}
                onChange={(e) => set({ onlyListed: e.target.checked })}
              />
              Only audit these pages
            </label>
          </div>

          {!(adv.onlyListed && hasPages) && (
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 12 }}>
              <div>
                <label htmlFor="adv-skip" style={label}>Skip pages matching</label>
                <input
                  id="adv-skip"
                  type="text"
                  placeholder="/blog/*, /tag/*"
                  value={adv.skipText}
                  onChange={(e) => set({ skipText: e.target.value })}
                  style={field}
                />
                <p style={hint}>* matches anything. Doesn&apos;t remove pages you listed above.</p>
              </div>
              <div>
                <label htmlFor="adv-count" style={label}>Number of pages</label>
                <select
                  id="adv-count"
                  value={adv.pageCount}
                  onChange={(e) => set({ pageCount: e.target.value })}
                  style={{ ...field, appearance: "auto" }}
                >
                  <option value="" style={{ color: "#000" }}>Default ({defaultCount})</option>
                  {PAGE_COUNTS.map((n) => <option key={n} value={String(n)} style={{ color: "#000" }}>{n}</option>)}
                </select>
                <p style={hint}>More pages take longer and cost more.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
