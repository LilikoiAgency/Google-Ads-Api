"use client";
// Collapsible "Advanced" panel on the audit form: pages to audit first, only those
// pages, skip patterns, a page count, and which Search Console / Google Analytics
// property to use. Form state is plain text; toRequestOptions turns it into the
// jobs API `options` (the server validates against the domain).

import { useEffect, useState } from "react";
import { describeOptions } from "../../../../lib/seoAuditV2/options";

export const EMPTY_ADVANCED = { pagesText: "", onlyListed: false, skipText: "", pageCount: "", gscSite: "", ga4Property: null };
export const PAGE_COUNTS = [5, 10, 15, 25, 50];

const splitLines = (text) => String(text || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

// Form state -> API options, or undefined when nothing is set.
export function toRequestOptions(adv) {
  const pages = splitLines(adv?.pagesText);
  const skip = splitLines(adv?.skipText);
  const pageCount = adv?.pageCount ? Number(adv.pageCount) : undefined;
  const gscSite = adv?.gscSite || "";
  const ga4Property = adv?.ga4Property?.id ? adv.ga4Property : null;
  if (!pages.length && !skip.length && !pageCount && !gscSite && !ga4Property) return undefined;
  return {
    pages, skip, onlyListed: !!adv.onlyListed && pages.length > 0,
    ...(pageCount ? { pageCount } : {}),
    ...(gscSite ? { gscSite } : {}),
    ...(ga4Property ? { ga4Property } : {}),
  };
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
    gscSite: o.gscSite || "",
    ga4Property: o.ga4Property || null,
  };
}

const bareHost = (d) => String(d || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");

// The Search Console property "Automatic" would use for a domain (same order as the server).
export function autoGscSite(domain, siteUrls) {
  const d = bareHost(domain);
  if (!d) return null;
  const candidates = [`sc-domain:${d}`, `https://${d}/`, `https://www.${d}/`, `http://${d}/`, `http://www.${d}/`];
  return candidates.find((c) => (siteUrls || []).includes(c)) || null;
}

// Search Console sites and GA4 properties, loaded once when the panel first opens.
function useSourceLists(active) {
  const [lists, setLists] = useState({ loaded: false, gsc: [], ga4: [], gscError: null, ga4Error: null });
  useEffect(() => {
    if (!active || lists.loaded) return undefined;
    let cancelled = false;
    const get = (url) => fetch(url).then((r) => r.json().then((b) => ({ ok: r.ok, b }))).catch(() => ({ ok: false, b: {} }));
    Promise.all([get("/api/gsc-sites"), get("/api/ga4/properties")]).then(([g, a]) => {
      if (cancelled) return;
      setLists({
        loaded: true,
        gsc: (g.b.sites || []).map((x) => x.url).sort(),
        ga4: a.b.properties || [],
        gscError: !g.ok || g.b.connected === false ? "Search Console isn't connected." : null,
        ga4Error: !a.ok ? "Couldn't load Google Analytics properties." : null,
      });
    });
    return () => { cancelled = true; };
  }, [active, lists.loaded]);
  return lists;
}

const label = { fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.7)", display: "block", marginBottom: 6 };
const hint = { fontSize: 11, color: "rgba(255,255,255,0.35)", marginTop: 4 };
const field = {
  width: "100%", padding: "10px 12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.15)",
  background: "rgba(255,255,255,0.06)", color: "#fff", fontSize: 13, outline: "none", boxSizing: "border-box",
  fontFamily: "inherit",
};

export default function AdvancedOptions({ value, onChange, auditType, domain }) {
  const [open, setOpen] = useState(false);
  const lists = useSourceLists(open);
  const auto = autoGscSite(domain, lists.gsc);
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

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
            <div>
              <label htmlFor="adv-gsc" style={label}>Search Console property</label>
              <select
                id="adv-gsc"
                value={adv.gscSite || ""}
                onChange={(e) => set({ gscSite: e.target.value })}
                style={{ ...field, appearance: "auto" }}
              >
                <option value="" style={{ color: "#000" }}>
                  {!lists.loaded ? "Automatic (loading list…)" : auto ? `Automatic: ${auto}` : "Automatic (no match for this domain)"}
                </option>
                {lists.gsc.map((u) => <option key={u} value={u} style={{ color: "#000" }}>{u}</option>)}
              </select>
              <p style={hint}>{lists.gscError || "Pick one if Automatic finds the wrong property or none."}</p>
            </div>
            <div>
              <label htmlFor="adv-ga4" style={label}>Google Analytics property</label>
              <select
                id="adv-ga4"
                value={adv.ga4Property?.id || ""}
                onChange={(e) => {
                  const p = lists.ga4.find((x) => x.id === e.target.value);
                  set({ ga4Property: p ? { id: p.id, name: p.name, account: p.account } : null });
                }}
                style={{ ...field, appearance: "auto" }}
              >
                <option value="" style={{ color: "#000" }}>{lists.loaded ? "Automatic (match by website)" : "Automatic (loading list…)"}</option>
                {lists.ga4.map((p) => <option key={p.id} value={p.id} style={{ color: "#000" }}>{p.account ? `${p.account}: ${p.name}` : p.name}</option>)}
              </select>
              <p style={hint}>{lists.ga4Error || "Only properties our reporting account can read are listed."}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
