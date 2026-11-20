"use client";
// Collapsible "Advanced" panel on the audit form: pages to audit first, only those
// pages, skip patterns, a page count, and which Search Console / Google Analytics
// property to use. Form state is plain text; toRequestOptions turns it into the
// jobs API `options` (the server validates against the domain).

import { useEffect, useState } from "react";
import { sameBrief } from "../../../../lib/seoAuditV2/briefs";
import { isUsablePhrase } from "../../../../lib/seoAuditV2/corrections";
import { describeOptions, MAX_LOCATIONS, MAX_TARGETS, MAX_TARGET_KEYWORDS } from "../../../../lib/seoAuditV2/options";

export const EMPTY_ADVANCED = { pagesText: "", onlyListed: false, skipText: "", pageCount: "", gscSite: "", ga4Property: null, locations: null, targets: [],
  // Company brief: brief = the edited copy (null = untouched), briefLoaded = what was saved when editing started,
  // briefDomain = the site it was edited for. Saved separately from the audit options.
  brief: null, briefLoaded: null, briefDomain: "" };
export const PAGE_COUNTS = [5, 10, 15, 25, 50];

const splitLines = (text) => String(text || "").split(/[\n,]/).map((s) => s.trim()).filter(Boolean);

// Form state -> API options, or undefined when nothing is set.
export function toRequestOptions(adv) {
  const pages = splitLines(adv?.pagesText);
  const skip = splitLines(adv?.skipText);
  const pageCount = adv?.pageCount ? Number(adv.pageCount) : undefined;
  const gscSite = adv?.gscSite || "";
  const ga4Property = adv?.ga4Property?.id ? adv.ga4Property : null;
  // locations: null = untouched (the server uses saved picks, else the automatic match); an array = the user's picks,
  // and an empty one means they unticked every location, so no reviews are pulled.
  const locations = Array.isArray(adv?.locations) ? adv.locations : null;
  // Target keyword rows with a page; keywords left empty ask for recommendations.
  const targets = (adv?.targets || [])
    .map((t) => ({ page: String(t.page || "").trim(), keywords: splitLines(t.keywords) }))
    .filter((t) => t.page || t.keywords.length);
  if (!pages.length && !skip.length && !pageCount && !gscSite && !ga4Property && !locations && !targets.length) return undefined;
  return {
    pages, skip, onlyListed: !!adv.onlyListed && pages.length > 0,
    ...(pageCount ? { pageCount } : {}),
    ...(gscSite ? { gscSite } : {}),
    ...(ga4Property ? { ga4Property } : {}),
    ...(locations ? { locations } : {}),
    ...(targets.length ? { targets } : {}),
  };
}

// Saved audit options -> form state (so "Run again" repeats the same selection).
export function fromAuditOptions(o) {
  if (!o) return EMPTY_ADVANCED;
  const path = (u) => {
    try { return new URL(u).pathname + new URL(u).search; } catch { return u; }
  };
  // Target pages are added to pages on the server; list them only under target
  // keywords. With "only these pages" the list stays whole, so the box stays ticked.
  const targetUrls = new Set(o.onlyListed ? [] : (o.targets || []).map((t) => t.url));
  return {
    pagesText: (o.pages || []).filter((u) => !targetUrls.has(u)).map(path).join("\n"),
    onlyListed: !!o.onlyListed,
    skipText: (o.skip || []).join(", "),
    pageCount: o.pageCount ? String(o.pageCount) : "",
    gscSite: o.gscSite || "",
    ga4Property: o.ga4Property || null,
    locations: Array.isArray(o.locations) ? o.locations : null,
    targets: (o.targets || []).map((t) => ({ page: path(t.url), keywords: (t.keywords || []).join("\n") })),
  };
}

export const bareHost = (d) => String(d || "").trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "").replace(/^www\./, "");

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

// Google listings for the domain (and the picks saved for it), loaded once when the panel opens.
function useLocations(active, domain) {
  const [state, setState] = useState({ key: null, saved: null, found: [], status: "loading" });
  const key = bareHost(domain);
  useEffect(() => {
    if (!active || !key || state.key === key) return undefined;
    let cancelled = false;
    fetch(`/api/seo-audit/v2/locations?domain=${encodeURIComponent(key)}`)
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return;
        setState({ key, saved: Array.isArray(b.saved) ? b.saved : null, found: Array.isArray(b.found) ? b.found : [], status: b.status === "not_connected" ? "not_connected" : b.status === "ok" ? "ok" : "error" });
      })
      .catch(() => { if (!cancelled) setState({ key, saved: null, found: [], status: "error" }); });
    return () => { cancelled = true; };
  }, [active, key, state.key]);
  return state.key === key ? state : { key, saved: null, found: [], status: "loading" };
}

// The saved company brief for the domain, loaded once when the panel opens.
function useBrief(active, domain) {
  const [state, setState] = useState({ key: null, brief: null, status: "loading" });
  const key = bareHost(domain);
  useEffect(() => {
    if (!active || !key || state.key === key) return undefined;
    let cancelled = false;
    fetch(`/api/seo-audit/v2/brief?domain=${encodeURIComponent(key)}`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (cancelled) return;
        setState({ key, brief: ok && b.brief ? b.brief : null, status: ok ? "ok" : "error" });
      })
      .catch(() => { if (!cancelled) setState({ key, brief: null, status: "error" }); });
    return () => { cancelled = true; };
  }, [active, key, state.key]);
  return state.key === key ? state : { key, brief: null, status: "loading" };
}

const EMPTY_BRIEF = { services: "", exclude: [], areas: "", notes: "" };
const toBrief = (b) => ({ ...EMPTY_BRIEF, ...(b || {}), exclude: [...(b?.exclude || [])] });

// What the agency knows about the business that the homepage doesn't show.
function BriefEditor({ adv, set, domain, loaded }) {
  const key = bareHost(domain);
  const edited = adv.brief && adv.briefDomain === key ? adv.brief : null;
  const current = toBrief(edited || loaded.brief);
  const [input, setInput] = useState("");
  const [error, setError] = useState("");
  useEffect(() => { setInput(""); setError(""); }, [key]);
  // Not editable until the saved brief is known, or an edit would overwrite it with partial text.
  const locked = loaded.status !== "ok";
  // The baseline stays what it was when editing began (page.js advances it after each save).
  const update = (patch) => set({ brief: { ...current, ...patch }, briefLoaded: edited ? adv.briefLoaded : loaded.brief, briefDomain: key });
  const addExclusion = () => {
    const phrase = input.trim();
    if (!phrase) return;
    if (!isUsablePhrase(phrase)) {
      setError(phrase.length < 4 ? "Use at least 4 characters for each service not to recommend." : "Each service not to recommend must be 80 characters or fewer.");
      return;
    }
    setError("");
    if (!current.exclude.some((e) => e.toLowerCase() === phrase.toLowerCase())) update({ exclude: [...current.exclude, phrase] });
    setInput("");
  };
  return (
    <div>
      <span style={label}>Company brief</span>
      <p style={{ ...hint, marginTop: 0, marginBottom: 8 }}>
        {loaded.status === "loading" ? "Loading the saved brief…" : loaded.status === "error" ? "Couldn't load the saved brief for this site." : "Facts the homepage doesn't show. It is saved for this website and used in every audit."}
      </p>
      <div style={{ display: "grid", gap: 12 }}>
        <div>
          <label htmlFor="adv-brief-services" style={label}>Services</label>
          <textarea id="adv-brief-services" rows={3} maxLength={1000} disabled={locked} placeholder="What the business actually sells" value={current.services} onChange={(e) => update({ services: e.target.value })} style={{ ...field, resize: "vertical" }} />
        </div>
        <div>
          <label htmlFor="adv-brief-areas" style={label}>Service areas</label>
          <input id="adv-brief-areas" type="text" maxLength={300} disabled={locked} placeholder="Tampa, Brandon, Riverview" value={current.areas} onChange={(e) => update({ areas: e.target.value })} style={field} />
        </div>
        <div>
          <label htmlFor="adv-brief-exclude" style={label}>Don&apos;t recommend</label>
          {current.exclude.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
              {current.exclude.map((e) => (
                <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px", borderRadius: 999, background: "rgba(255,255,255,0.08)", fontSize: 12, color: "rgba(255,255,255,0.8)" }}>
                  {e}
                  <button type="button" aria-label={`Remove ${e}`} onClick={() => update({ exclude: current.exclude.filter((x) => x !== e) })} disabled={locked} style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(255,255,255,0.5)", fontSize: 12 }}>✕</button>
                </span>
              ))}
            </div>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <input
              id="adv-brief-exclude"
              type="text"
              maxLength={80}
              disabled={locked}
              placeholder="A service to never recommend"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addExclusion(); } }}
              style={field}
            />
            <button type="button" aria-label="Add service not to recommend" onClick={addExclusion} disabled={locked || !input.trim()} style={{ ...field, width: "auto", cursor: !locked && input.trim() ? "pointer" : "not-allowed", fontWeight: 600, whiteSpace: "nowrap" }}>
              Add
            </button>
          </div>
          {error && <p role="alert" style={{ ...hint, color: "#fca5a5" }}>{error}</p>}
        </div>
        <div>
          <label htmlFor="adv-brief-notes" style={label}>Notes</label>
          <textarea id="adv-brief-notes" rows={2} maxLength={1000} disabled={locked} placeholder="Anything else the audit should know" value={current.notes} onChange={(e) => update({ notes: e.target.value })} style={{ ...field, resize: "vertical" }} />
        </div>
      </div>
    </div>
  );
}

const toPick = (c) => ({ source: "places", id: c.id, name: c.name });
const ratingText = (c) => [typeof c.rating === "number" ? `${c.rating.toFixed(1)} ★` : null, typeof c.count === "number" ? `${c.count} reviews` : null].filter(Boolean).join(" · ");

function LocationPicker({ adv, set, domain, active }) {
  const loaded = useLocations(active, domain);
  const [added, setAdded] = useState([]); // listings added by hand, so they keep their rating text
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [candidates, setCandidates] = useState([]);

  const defaults = loaded.saved || loaded.found.map(toPick);
  const picks = Array.isArray(adv.locations) ? adv.locations : defaults;
  const ticked = new Set(picks.map((p) => p.id));
  const full = picks.length >= MAX_LOCATIONS;
  const info = new Map([...loaded.found, ...added].map((c) => [c.id, c]));
  // Found listings first, then picks that aren't in the found list (saved earlier, or added by hand).
  const rows = [...loaded.found.map(toPick), ...picks.filter((p) => !loaded.found.some((f) => f.id === p.id))];

  const toggle = (pick) => set({ locations: ticked.has(pick.id) ? picks.filter((p) => p.id !== pick.id) : [...picks, pick] });
  const choose = (c) => {
    setAdded((a) => (a.some((x) => x.id === c.id) ? a : [...a, c]));
    if (!ticked.has(c.id)) set({ locations: [...picks, toPick(c)] });
    setCandidates([]); setInput(""); setNote("");
  };
  const add = async () => {
    if (!input.trim() || full) return;
    setBusy(true); setNote(""); setCandidates([]);
    try {
      const r = await fetch("/api/seo-audit/v2/locations/resolve", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ input: input.trim() }) });
      const b = await r.json();
      const list = Array.isArray(b.candidates) ? b.candidates : [];
      if (b.status === "not_connected") setNote("Google reviews aren't connected (no Places API key).");
      else if (!r.ok || b.status === "error") setNote("Couldn't look up that location.");
      else if (!list.length) setNote("No Google listing found for that.");
      else if (list.length === 1) choose(list[0]);
      else setCandidates(list);
    } catch {
      setNote("Couldn't look up that location.");
    }
    setBusy(false);
  };

  const emptyMsg = loaded.status === "not_connected" ? "Google reviews aren't connected (no Places API key)."
    : loaded.status === "error" ? "Couldn't look up Google listings."
    : loaded.status === "loading" ? "Looking up Google listings…"
    : !rows.length ? "No Google listing links to this website. Add one below." : null;

  return (
    <div>
      <span style={label}>Google Business Profiles</span>
      {emptyMsg ? <p style={{ ...hint, marginTop: 0, marginBottom: 8 }}>{emptyMsg}</p> : (
        <p style={{ ...hint, marginTop: 0, marginBottom: 8 }}>
          {loaded.saved ? "Your saved picks for" : `Found ${rows.length} location${rows.length === 1 ? "" : "s"} for`} {bareHost(domain)}:
        </p>
      )}
      <div style={{ display: "grid", gap: 6 }}>
        {rows.map((p) => {
          const c = info.get(p.id);
          const checked = ticked.has(p.id);
          return (
            <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "rgba(255,255,255,0.75)", cursor: !checked && full ? "not-allowed" : "pointer" }}>
              <input type="checkbox" checked={checked} disabled={!checked && full} onChange={() => toggle(p)} />
              <span style={{ flex: 1, minWidth: 0 }}>{p.name}{c?.address ? <span style={{ color: "rgba(255,255,255,0.35)" }}> · {c.address}</span> : null}</span>
              {c && ratingText(c) && <span style={{ color: "rgba(255,255,255,0.45)", whiteSpace: "nowrap" }}>{ratingText(c)}</span>}
              <span style={{ fontSize: 11, color: "rgba(255,255,255,0.35)" }}>{p.source === "gbp" ? "Managed" : "Public"}</span>
            </label>
          );
        })}
      </div>
      {full && <p style={hint}>Up to {MAX_LOCATIONS} locations per audit. Untick one to add another.</p>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          type="text"
          aria-label="Add a location"
          placeholder={'Paste a Google Maps link, or "name, city"'}
          value={input}
          disabled={full}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }}
          style={field}
        />
        <button
          type="button"
          onClick={add}
          disabled={busy || full || !input.trim()}
          style={{ ...field, width: "auto", cursor: busy || full || !input.trim() ? "not-allowed" : "pointer", fontWeight: 600, whiteSpace: "nowrap" }}
        >
          {busy ? "Looking…" : "Add"}
        </button>
      </div>
      {note && <p role="status" style={hint}>{note}</p>}
      {candidates.length > 0 && (
        <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
          <p style={hint}>Several matches. Pick one:</p>
          {candidates.map((c) => (
            <button key={c.id} type="button" onClick={() => choose(c)} style={{ ...field, textAlign: "left", cursor: "pointer" }}>
              {c.name}{c.address ? ` · ${c.address}` : ""}{ratingText(c) ? ` · ${ratingText(c)}` : ""}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Pages the agency wants to rank, each with its keywords (none = recommend some).
function TargetsEditor({ adv, set }) {
  const rows = adv.targets || [];
  const update = (i, patch) => set({ targets: rows.map((r, k) => (k === i ? { ...r, ...patch } : r)) });
  const remove = (i) => set({ targets: rows.filter((_, k) => k !== i) });
  const addRow = () => set({ targets: [...rows, { page: "", keywords: "" }] });
  return (
    <div>
      <span style={label}>Target keywords</span>
      <p style={{ ...hint, marginTop: 0, marginBottom: 8 }}>
        Pick a page and the searches it should rank for, or leave the keywords empty to get recommendations. Uses Google Ads Keyword Planner volumes.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        {rows.map((r, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1.4fr) auto", gap: 8, alignItems: "start" }}>
            <input
              type="text"
              aria-label={`Target page ${i + 1}`}
              placeholder="/panel-upgrades"
              value={r.page}
              onChange={(e) => update(i, { page: e.target.value })}
              style={field}
            />
            <textarea
              rows={2}
              aria-label={`Keywords for target page ${i + 1}`}
              placeholder={"panel upgrade tampa\nelectrical panel replacement\n(leave empty for recommendations)"}
              value={r.keywords}
              onChange={(e) => update(i, { keywords: e.target.value })}
              style={{ ...field, resize: "vertical" }}
            />
            <button type="button" onClick={() => remove(i)} aria-label={`Remove target page ${i + 1}`} style={{ ...field, width: "auto", cursor: "pointer" }}>
              ✕
            </button>
          </div>
        ))}
      </div>
      {rows.length < MAX_TARGETS ? (
        <button type="button" onClick={addRow} style={{ ...field, width: "auto", marginTop: rows.length ? 8 : 0, cursor: "pointer", fontWeight: 600 }}>
          + Add a page
        </button>
      ) : (
        <p style={hint}>Up to {MAX_TARGETS} pages per audit.</p>
      )}
      {rows.length > 0 && <p style={hint}>One keyword per line, up to {MAX_TARGET_KEYWORDS} per page. These pages are always audited.</p>}
    </div>
  );
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
  const briefLoaded = useBrief(open, domain);
  const opts = toRequestOptions(adv);
  const optsSummary = describeOptions(opts ? { pageCount: null, ...opts } : null);
  const briefEdited = !!adv.brief && adv.briefDomain === bareHost(domain);
  const hasBrief = briefEdited ? !sameBrief(adv.brief, null) : !!briefLoaded.brief;
  const summary = [optsSummary, hasBrief ? "company brief" : ""].filter(Boolean).join(", ");
  const clearable = !!optsSummary || briefEdited;
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
        {clearable && (
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
          <TargetsEditor adv={adv} set={set} />
          <LocationPicker adv={adv} set={set} domain={domain} active={open} />
          <BriefEditor adv={adv} set={set} domain={domain} loaded={briefLoaded} />
        </div>
      )}
    </div>
  );
}
