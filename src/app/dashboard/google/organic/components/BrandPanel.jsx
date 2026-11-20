"use client";
import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { change, guessBrandTerm, rollupTrend } from "@/lib/gscInsights";
import { fmtInt, fmtCtr, fmtPos, DeltaText } from "./format";

const C = { branded: "#7c3aed", nonBranded: "#0ea5e9", anonymized: "#94a3b8" };

function TermsEditor({ terms, onSave, suggestion, saving }) {
  const [list, setList] = useState(terms);
  const [input, setInput] = useState("");
  useEffect(() => { setList(terms); }, [terms]);

  const add = (raw) => {
    const t = raw.trim().toLowerCase();
    if (t && !list.includes(t)) setList((l) => [...l, t]);
    setInput("");
  };
  const dirty = list.join("|") !== terms.join("|");

  return (
    <div className="gsc-terms">
      <div className="gsc-chips">
        {list.map((t) => (
          <span key={t} className="gsc-chip">
            {t}
            <button type="button" aria-label={`Remove ${t}`} onClick={() => setList((l) => l.filter((x) => x !== t))}>×</button>
          </span>
        ))}
        <input
          className="ga4-control gsc-chip-input"
          value={input}
          placeholder={list.length ? "Add a term…" : `e.g. ${suggestion || "company name"}`}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(input); }
            if (e.key === "Backspace" && !input && list.length) setList((l) => l.slice(0, -1));
          }}
          aria-label="Brand term"
        />
      </div>
      <div className="gsc-terms-actions">
        {!list.length && suggestion && (
          <button type="button" className="ga4-link" onClick={() => add(suggestion)}>Use “{suggestion}”</button>
        )}
        <button type="button" className="ga4-btn ga4-btn-primary gsc-btn-sm" disabled={!dirty || saving}
          onClick={() => onSave(input.trim() ? [...list, input.trim().toLowerCase()] : list)}>
          {saving ? "Saving…" : "Save brand terms"}
        </button>
      </div>
      <p className="ga4-sub">
        A query is branded when it contains any term (not case-sensitive). Add misspellings and short forms, e.g. “semper”, “sempersolaris”.
      </p>
    </div>
  );
}

function Tile({ label, color, cur, prev, total, hint, showCompare }) {
  const share = total > 0 ? cur.clicks / total : 0;
  return (
    <div className="gsc-brand-tile">
      <p className="gsc-brand-label"><span className="ga4-swatch" style={{ background: color }} />{label}</p>
      <p className="gsc-brand-value">{fmtInt(cur.clicks)} <span className="gsc-brand-unit">clicks</span></p>
      <p className="gsc-brand-meta">
        {(share * 100).toFixed(0)}% of clicks · {fmtInt(cur.impressions)} impr.
        {cur.ctr !== undefined && <> · CTR {fmtCtr(cur.ctr)}</>}
        {cur.position > 0 && <> · pos {fmtPos(cur.position)}</>}
      </p>
      {showCompare && prev && <p className="gsc-brand-delta"><DeltaText d={change(cur.clicks, prev.clicks)} /> clicks</p>}
      {hint && <p className="gsc-brand-hint">{hint}</p>}
    </div>
  );
}

export default function BrandPanel({ brand, terms, site, totals, granularity, onSaveTerms, hasCompare }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const suggestion = guessBrandTerm(site);

  const save = async (list) => {
    setSaving(true);
    try {
      await onSaveTerms(list);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const head = (
    <div className="ga4-panel-head gsc-panel-head-row">
      <div>
        <h2 className="ga4-h2">Branded vs non-branded</h2>
        <p className="ga4-sub">Non-branded clicks are people finding the business without searching its name, the clearest sign SEO is working.</p>
      </div>
      {brand && !editing && <button type="button" className="ga4-link" onClick={() => setEditing(true)}>Edit brand terms</button>}
    </div>
  );

  if (!brand) {
    return (
      <section className="ga4-card ga4-panel">
        {head}
        <TermsEditor terms={terms} onSave={save} suggestion={suggestion} saving={saving} />
      </section>
    );
  }

  const total = totals?.clicks || 0;
  const cur = brand.current;
  const prev = brand.compare;
  const b = rollupTrend(brand.trend.map((t) => ({ date: t.date, clicks: t.branded, impressions: 0 })), granularity);
  const n = rollupTrend(brand.trend.map((t) => ({ date: t.date, clicks: t.nonBranded, impressions: 0 })), granularity);
  const series = b.map((x, i) => ({ date: x.date, branded: x.clicks, nonBranded: n[i]?.clicks || 0 }));

  return (
    <section className="ga4-card ga4-panel">
      {head}
      {editing && <TermsEditor terms={terms} onSave={save} suggestion={suggestion} saving={saving} />}
      <div className="gsc-brand-grid">
        <Tile label="Non-branded" color={C.nonBranded} cur={cur.nonBranded} prev={prev?.nonBranded} total={total} showCompare={hasCompare} />
        <Tile label="Branded" color={C.branded} cur={cur.branded} prev={prev?.branded} total={total} showCompare={hasCompare} />
        <Tile label="Anonymized" color={C.anonymized} cur={cur.anonymized} prev={prev?.anonymized} total={total} showCompare={hasCompare}
          hint="Rare searches Google hides for privacy. Usually long, specific (mostly non-branded) queries." />
        <div className="gsc-brand-chart">
          <ResponsiveContainer width="100%" height={150}>
            <AreaChart data={series} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Tooltip
                formatter={(v, name) => [fmtInt(v), name === "branded" ? "Branded" : "Non-branded"]}
                labelFormatter={(l) => l}
                contentStyle={{ background: "var(--ga4-pop-bg)", border: "1px solid var(--card-border)", borderRadius: 10, fontSize: 12 }}
              />
              <Area type="monotone" dataKey="nonBranded" stackId="1" stroke={C.nonBranded} fill={C.nonBranded} fillOpacity={0.35} />
              <Area type="monotone" dataKey="branded" stackId="1" stroke={C.branded} fill={C.branded} fillOpacity={0.35} />
            </AreaChart>
          </ResponsiveContainer>
          <p className="ga4-sub">Clicks per {granularity}, branded stacked on non-branded</p>
        </div>
      </div>
      <p className="gsc-brand-terms">Brand terms: {terms.join(", ")}</p>
    </section>
  );
}
