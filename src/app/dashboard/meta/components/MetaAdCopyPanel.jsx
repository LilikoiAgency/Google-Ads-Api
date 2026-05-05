"use client";
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";

const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];

function buildCampaignPayload(campaign, creatives) {
  const flags = [];
  if ((campaign.roas || 0) < 1 && (campaign.spend || 0) > 0) flags.push("ROAS < 1");
  if ((campaign.conversions || 0) === 0 && (campaign.spend || 0) > 0) flags.push("Zero conversions with spend");
  if ((campaign.cpm || 0) > 25) flags.push("High CPM (> $25)");
  const topCreative = creatives?.[0]?.creative || null;
  return {
    campaignName: campaign.name,
    objective: campaign.objective || "",
    spend: campaign.spend || 0,
    ctr: campaign.ctr || 0,
    cpa: campaign.conversions > 0 ? (campaign.spend || 0) / campaign.conversions : 0,
    roas: campaign.roas || 0,
    conversions: campaign.conversions || 0,
    currentTitle: topCreative?.title || "",
    currentBody: topCreative?.body || "",
    callToActionType: topCreative?.call_to_action_type || "",
    flags,
  };
}

export default function MetaAdCopyPanel({ open, onClose, selectedAccount, campaigns }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState("form");
  const [creatives, setCreatives] = useState([]);
  const [creativesLoading, setCreativesLoading] = useState(false);
  const [business, setBusiness] = useState("");
  const [audience, setAudience] = useState("");
  const [usps, setUsps] = useState("");
  const [tone, setTone] = useState("Professional");
  const [offer, setOffer] = useState("");
  const [selectedId, setSelectedId] = useState(null);
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState({});

  const campaignsWithSpend = useMemo(
    () => (campaigns || []).filter((c) => (c.spend || 0) > 0),
    [campaigns]
  );

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      const tid = setTimeout(() => {
        setView("form"); setResults(null); setErrorMsg(null);
        setBusiness(""); setAudience(""); setUsps(""); setTone("Professional");
        setOffer(""); setSelectedId(null); setCopied({});
      }, 220);
      return () => clearTimeout(tid);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !campaignsWithSpend.length) return;
    setSelectedId((prev) => {
      if (prev !== null) return prev;
      const under = campaignsWithSpend.find(
        (c) => (c.roas || 0) < 1 || ((c.conversions || 0) === 0 && (c.spend || 0) > 0)
      );
      return under?.id || campaignsWithSpend[0]?.id || null;
    });
  }, [open, campaignsWithSpend]);

  useEffect(() => {
    if (!open || !selectedAccount?.accountId) return;
    const controller = new AbortController();
    setCreatives([]);
    setCreativesLoading(true);
    fetch(`/api/meta-ads/top-creatives?accountId=${encodeURIComponent(selectedAccount.accountId)}&limit=10`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((json) => setCreatives(json?.data || []))
      .catch((err) => { if (err.name !== "AbortError") setCreatives([]); })
      .finally(() => { if (!controller.signal.aborted) setCreativesLoading(false); });
    return () => controller.abort();
  }, [open, selectedAccount?.accountId]);

  const canGenerate = !!selectedId && business.trim() && audience.trim() && usps.trim() && !creativesLoading;

  const handleGenerate = async () => {
    setView("loading"); setErrorMsg(null);
    const campaign = campaignsWithSpend.find((c) => c.id === selectedId);
    if (!campaign) { setErrorMsg("Campaign not found"); setView("error"); return; }
    try {
      const res = await fetch("/api/claude/meta-ad-copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: { business: business.trim(), audience: audience.trim(), usps: usps.trim(), tone, offer: offer.trim() }, campaign: buildCampaignPayload(campaign, creatives) }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setErrorMsg(json.error || `Error ${res.status}`); setView("error"); return; }
      setResults(json.data); setView("results");
    } catch (err) { setErrorMsg(err.message); setView("error"); }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 1500);
    }).catch(() => {});
  };

  if (!mounted || !open) return null;

  const inputStyle = { width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 10, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 620, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#1877f2", margin: "0 0 4px" }}>AI — Meta Ads</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>Meta Ad Copy</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {!selectedAccount && (
            <p style={{ fontSize: 13, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>Select an account first to generate Meta ad copy.</p>
          )}
          {selectedAccount && campaignsWithSpend.length === 0 && (
            <p style={{ fontSize: 13, color: "#6b7280", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>No campaigns with spend found for this account.</p>
          )}
          {selectedAccount && campaignsWithSpend.length > 0 && view === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>Select campaign</p>
                {campaignsWithSpend.map((c) => {
                  const isUnder = (c.roas || 0) < 1 || ((c.conversions || 0) === 0 && (c.spend || 0) > 0);
                  return (
                    <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", border: `1px solid ${selectedId === c.id ? "#1877f2" : "#e5e7eb"}`, borderRadius: 12, marginBottom: 6, cursor: "pointer", background: selectedId === c.id ? "#eff6ff" : "#fff" }}>
                      <input type="radio" name="meta-campaign" value={c.id} checked={selectedId === c.id} onChange={() => setSelectedId(c.id)} aria-label={c.name} style={{ accentColor: "#1877f2" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</p>
                        <p style={{ fontSize: 11, color: "#6b7280", margin: "2px 0 0" }}>
                          ${Number(c.spend || 0).toFixed(0)} spend · {Number(c.roas || 0).toFixed(2)}x ROAS · {c.conversions || 0} conv.
                          {isUnder && <span style={{ marginLeft: 6, color: "#dc2626", fontWeight: 700 }}>⚠ underperforming</span>}
                        </p>
                      </div>
                    </label>
                  );
                })}
              </div>
              <div>
                <label htmlFor="meta-business" style={labelStyle}>Business <span style={{ color: "#dc2626" }}>*</span></label>
                <input id="meta-business" type="text" value={business} onChange={(e) => setBusiness(e.target.value)} placeholder="e.g. HVAC repair company in Phoenix, AZ" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="meta-audience" style={labelStyle}>Target audience <span style={{ color: "#dc2626" }}>*</span></label>
                <input id="meta-audience" type="text" value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="e.g. Homeowners aged 30-55, Phoenix metro" style={inputStyle} />
              </div>
              <div>
                <label htmlFor="meta-usps" style={labelStyle}>Unique selling points <span style={{ color: "#dc2626" }}>*</span></label>
                <textarea id="meta-usps" value={usps} onChange={(e) => setUsps(e.target.value)} placeholder="e.g. Same-day service, 10-year warranty, licensed & insured" rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
              </div>
              <div>
                <label htmlFor="meta-tone" style={labelStyle}>Tone</label>
                <select id="meta-tone" value={tone} onChange={(e) => setTone(e.target.value)} style={{ ...inputStyle, background: "#fff" }}>
                  {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="meta-offer" style={labelStyle}>Current offer <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <input id="meta-offer" type="text" value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="e.g. $99 tune-up, 20% off first service" style={inputStyle} />
              </div>
              {errorMsg && <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", margin: 0 }}>{errorMsg}</p>}
              <button onClick={handleGenerate} disabled={!canGenerate} style={{ padding: "12px 20px", fontSize: 13, fontWeight: 800, background: canGenerate ? "#1877f2" : "#e5e7eb", color: canGenerate ? "#fff" : "#9ca3af", border: "none", borderRadius: 12, cursor: canGenerate ? "pointer" : "not-allowed" }}>
                {creativesLoading ? "Loading creatives…" : "Generate ad copy"}
              </button>
            </div>
          )}
          {view === "loading" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 8 }}>
              {[80, 60, 90, 50, 70].map((w, i) => (
                <div key={i} style={{ height: 14, width: `${w}%`, background: "#e5e7eb", borderRadius: 8 }} />
              ))}
            </div>
          )}
          {view === "error" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "12px 16px", margin: 0 }}>{errorMsg}</p>
              <button onClick={() => setView("form")} style={{ padding: "10px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}>Try again</button>
            </div>
          )}
          {view === "results" && results && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={{ background: "#0f172a", borderRadius: 14, padding: "15px 16px" }}>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#93c5fd", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Diagnosis</p>
                <p style={{ fontSize: 13, color: "#f8fafc", margin: "0 0 14px", lineHeight: 1.5 }}>{results.diagnosis}</p>
                <p style={{ fontSize: 11, fontWeight: 800, color: "#86efac", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.06em" }}>Strategy</p>
                <p style={{ fontSize: 13, color: "#f8fafc", margin: 0, lineHeight: 1.5 }}>{results.strategy}</p>
              </div>
              <ResultSection label="Primary texts" hint="≤125 chars" items={results.primaryTexts || []} maxLen={125} copied={copied} onCopy={handleCopy} idPrefix="pt" />
              <ResultSection label="Headlines" hint="≤40 chars" items={results.headlines || []} maxLen={40} copied={copied} onCopy={handleCopy} idPrefix="hl" />
              <ResultSection label="Descriptions" hint="≤30 chars" items={results.descriptions || []} maxLen={30} copied={copied} onCopy={handleCopy} idPrefix="desc" />
              {results.ctaRecommendation && (
                <div style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 12, padding: 14 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.06em", color: "#15803d", margin: "0 0 6px" }}>CTA recommendation</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: "#111827", margin: "0 0 4px" }}>{results.ctaRecommendation.cta}</p>
                  <p style={{ fontSize: 12, color: "#374151", margin: 0, lineHeight: 1.5 }}>{results.ctaRecommendation.rationale}</p>
                </div>
              )}
              <button onClick={() => setView("form")} style={{ padding: "11px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}>Regenerate</button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

function ResultSection({ label, hint, items, maxLen, copied, onCopy, idPrefix }) {
  return (
    <div>
      <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 10px" }}>
        {label} <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>{hint}</span>
      </p>
      {items.map((item, i) => {
        const len = (item.text || "").length;
        const copyId = `${idPrefix}-${i}`;
        return (
          <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#111827", margin: "0 0 4px", lineHeight: 1.4 }}>{item.text}</p>
            <p style={{ fontSize: 11, color: "#6b7280", margin: "0 0 10px", lineHeight: 1.4 }}>{item.rationale}</p>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: len > maxLen ? "#dc2626" : "#16a34a" }}>{len} / {maxLen} chars</span>
              <button onClick={() => onCopy(item.text, copyId)} style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[copyId] ? "#d1fae5" : "#dbeafe", color: copied[copyId] ? "#065f46" : "#1e40af", border: "none", borderRadius: 8, cursor: "pointer" }}>
                {copied[copyId] ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
