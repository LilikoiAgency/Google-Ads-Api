"use client";
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { getCampaignVerdict, analyzeSearchTerms, analyzeKeywords } from "../../../../../lib/googleAdsAudit";

const UNDERPERFORMING = new Set(["FIX_QS", "OPTIMIZE", "INVESTIGATE"]);
const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];

function buildCampaignPayload(campaign, auditData) {
  const verdict = getCampaignVerdict(campaign);

  const allKeywords = auditData?.keywords || [];
  const campaignKws = allKeywords.filter((k) => String(k.campaignId) === String(campaign.campaignId));
  const kwAnalysis = campaignKws.length > 0 ? analyzeKeywords(campaignKws) : null;

  const searchTerms = campaign.searchTerms || [];
  const stAnalysis = analyzeSearchTerms(searchTerms, campaignKws);
  const topConvertingTerms = stAnalysis.winners.slice(0, 5).map((t) => t.term);

  const bottom5 = (kwAnalysis?.bottom10 || []).slice(0, 5).map((k) => {
    const failingComponent =
      k.adRelevance === "BELOW_AVERAGE" ? "Ad Relevance" :
      k.expectedCtr === "BELOW_AVERAGE" ? "Expected CTR" :
      k.lpExperience === "BELOW_AVERAGE" ? "Landing Page Experience" :
      "QS";
    return { text: k.text, qs: k.qualityScore, failingComponent };
  });

  const matchTypeSpend = kwAnalysis?.matchTypeSpend || null;

  const flags = [];
  if ((matchTypeSpend?.BROAD || 0) > 0.6) flags.push("Broad match >60% of spend");
  if ((campaign.conversions || 0) === 0 && (campaign.cost || 0) > 300_000_000) flags.push("Zero conversions with real spend");
  if (campaign.searchBudgetLostImpressionShare > 0.25) flags.push("Budget-constrained — impression share lost to budget");

  const ads = campaign.ads || [];
  const currentHeadlines = ads.flatMap((ad) => ad.headlines || []).filter(Boolean).slice(0, 10);
  const currentDescriptions = ads.flatMap((ad) => ad.descriptions || []).filter(Boolean).slice(0, 4);

  return {
    campaignName: campaign.campaignName,
    verdict: verdict.key,
    cost: campaign.cost || 0,
    clicks: campaign.clicks || 0,
    impressions: campaign.impressions || 0,
    conversions: campaign.conversions || 0,
    currentHeadlines,
    currentDescriptions,
    topConvertingTerms,
    bottomKeywords: bottom5,
    matchTypeSpend,
    flags,
  };
}

export default function AdCopyPanel({ open, onClose, selectedCustomer }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [auditData, setAuditData] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [view, setView] = useState("form");
  const [results, setResults] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  const [business, setBusiness] = useState("");
  const [audience, setAudience] = useState("");
  const [usps, setUsps] = useState("");
  const [tone, setTone] = useState("Professional");
  const [offer, setOffer] = useState("");
  const [checkedIds, setCheckedIds] = useState(new Set());

  const campaigns = useMemo(() => selectedCustomer?.campaigns || [], [selectedCustomer]);
  const customerId = String(selectedCustomer?.customer?.customer_client?.id || "");

  useEffect(() => {
    if (!open) return;
    const underperforming = campaigns
      .filter((c) => UNDERPERFORMING.has(getCampaignVerdict(c).key))
      .map((c) => String(c.campaignId));
    setCheckedIds(new Set(underperforming));
  }, [open, campaigns]);

  useEffect(() => {
    if (!open || !customerId) return;
    const controller = new AbortController();
    setAuditLoading(true);
    fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((json) => setAuditData(json?.data || null))
      .catch((err) => { if (err.name !== "AbortError") setAuditData(null); })
      .finally(() => setAuditLoading(false));
    return () => controller.abort();
  }, [open, customerId]);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      const timeoutId = setTimeout(() => {
        setView("form");
        setResults(null);
        setErrorMsg(null);
      }, 220);
      return () => clearTimeout(timeoutId);
    }
  }, [open]);

  const toggleCampaign = (campaignId) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(String(campaignId))) next.delete(String(campaignId));
      else next.add(String(campaignId));
      return next;
    });
  };

  const canGenerate = checkedIds.size > 0 && business.trim() && audience.trim() && usps.trim() && !auditLoading;

  const handleGenerate = async () => {
    setView("loading");
    setErrorMsg(null);
    const selectedCampaigns = campaigns
      .filter((c) => checkedIds.has(String(c.campaignId)))
      .map((c) => buildCampaignPayload(c, auditData));

    try {
      const res = await fetch("/api/claude/ad-copy-strategy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId,
          context: { business, audience, usps, tone, offer },
          campaigns: selectedCampaigns,
        }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setErrorMsg(json.error || `Error ${res.status}`);
        setView("error");
        return;
      }
      setResults(json.data);
      setView("results");
    } catch (err) {
      setErrorMsg(err.message);
      setView("error");
    }
  };

  if (!mounted || !open) return null;

  const panelStyle = {
    position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41,
    width: 620, maxWidth: "100vw",
    background: "#fff",
    borderLeft: "1px solid #e5e7eb",
    display: "flex", flexDirection: "column",
    transform: visible ? "translateX(0)" : "translateX(100%)",
    transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)",
    boxShadow: "-8px 0 40px rgba(0,0,0,0.12)",
  };

  const content = (
    <>
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, zIndex: 40,
          background: "rgba(0,0,0,0.35)",
          backdropFilter: "blur(2px)",
          opacity: visible ? 1 : 0,
          transition: "opacity 0.2s",
        }}
      />

      <div style={panelStyle}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#6366f1", margin: "0 0 4px" }}>AI — Ad Copy Strategy</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>
              {view === "results" ? "Copy Strategy" : "Generate Ad Copy"}
            </h2>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {view === "results" && (
              <button
                onClick={() => setView("form")}
                style={{ fontSize: 12, fontWeight: 700, color: "#6366f1", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: 8, padding: "6px 12px", cursor: "pointer" }}
              >
                Regenerate
              </button>
            )}
            <button
              onClick={onClose}
              aria-label="✕"
              style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}
            >
              ✕
            </button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {view === "form" && (
            <FormView
              campaigns={campaigns}
              checkedIds={checkedIds}
              toggleCampaign={toggleCampaign}
              business={business} setBusiness={setBusiness}
              audience={audience} setAudience={setAudience}
              usps={usps} setUsps={setUsps}
              tone={tone} setTone={setTone}
              offer={offer} setOffer={setOffer}
              canGenerate={canGenerate}
              auditLoading={auditLoading}
              onGenerate={handleGenerate}
            />
          )}
          {view === "loading" && <LoadingView />}
          {view === "results" && results && <ResultsView results={results} />}
          {view === "error" && (
            <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 12, padding: 16, color: "#dc2626", fontSize: 13 }}>
              {errorMsg || "Something went wrong. Try again."}
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}

function FormView({ campaigns, checkedIds, toggleCampaign, business, setBusiness, audience, setAudience, usps, setUsps, tone, setTone, offer, setOffer, canGenerate, auditLoading, onGenerate }) {
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#111827", outline: "none", boxSizing: "border-box", resize: "vertical" };
  const fieldWrap = { marginBottom: 16 };

  return (
    <div>
      <p style={{ fontSize: 13, color: "#6b7280", marginBottom: 20, lineHeight: 1.5 }}>
        Claude will analyze your underperforming campaigns using live data — search terms, keyword QS scores, current ad copy — and write a strategy + example headlines grounded in your actual account.
      </p>

      <div style={fieldWrap}>
        <label htmlFor="cp-business" style={labelStyle}>Business / product description <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea id="cp-business" aria-label="Business / product description" rows={2} placeholder="e.g. We provide emergency HVAC repair in Phoenix" value={business} onChange={(e) => setBusiness(e.target.value)} style={inputStyle} />
      </div>
      <div style={fieldWrap}>
        <label htmlFor="cp-audience" style={labelStyle}>Target audience <span style={{ color: "#ef4444" }}>*</span></label>
        <input id="cp-audience" type="text" aria-label="Target audience" placeholder="e.g. Homeowners 35–60, comparison shopping" value={audience} onChange={(e) => setAudience(e.target.value)} style={{ ...inputStyle, resize: undefined }} />
      </div>
      <div style={fieldWrap}>
        <label htmlFor="cp-usps" style={labelStyle}>Unique selling points <span style={{ color: "#ef4444" }}>*</span></label>
        <textarea id="cp-usps" aria-label="Unique selling points" rows={2} placeholder="e.g. Same-day service, 10-year warranty, financing available" value={usps} onChange={(e) => setUsps(e.target.value)} style={inputStyle} />
      </div>
      <div style={{ ...fieldWrap, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label htmlFor="cp-tone" style={labelStyle}>Tone / voice</label>
          <select id="cp-tone" aria-label="Tone" value={tone} onChange={(e) => setTone(e.target.value)} style={{ ...inputStyle, resize: undefined }}>
            {TONES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="cp-offer" style={labelStyle}>Current offer (optional)</label>
          <input id="cp-offer" type="text" aria-label="Offer" placeholder="e.g. $49 tune-up this month" value={offer} onChange={(e) => setOffer(e.target.value)} style={{ ...inputStyle, resize: undefined }} />
        </div>
      </div>

      <div style={{ marginBottom: 20 }}>
        <p style={{ ...labelStyle, marginBottom: 10 }}>Campaigns to analyze</p>
        {auditLoading && (
          <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Loading keyword data…</p>
        )}
        {campaigns.map((c) => {
          const verdict = getCampaignVerdict(c);
          const isChecked = checkedIds.has(String(c.campaignId));
          return (
            <label key={c.campaignId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
              <input
                type="checkbox"
                aria-label={c.campaignName}
                checked={isChecked}
                onChange={() => toggleCampaign(c.campaignId)}
              />
              <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.campaignName}</span>
              <span style={{ fontSize: 10, fontWeight: 800, color: verdict.color, background: verdict.bg, borderRadius: 4, padding: "2px 7px", border: `1px solid ${verdict.color}40` }}>{verdict.key}</span>
            </label>
          );
        })}
      </div>

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        aria-label="Generate Ad Copy Strategy"
        style={{
          width: "100%", padding: "12px", borderRadius: 10, border: "none",
          background: canGenerate ? "#4f46e5" : "#e5e7eb",
          color: canGenerate ? "#fff" : "#9ca3af",
          fontSize: 14, fontWeight: 800, cursor: canGenerate ? "pointer" : "not-allowed",
        }}
      >
        Generate Ad Copy Strategy
      </button>
    </div>
  );
}

function LoadingView() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 14 }}>
      <div style={{ width: 28, height: 28, borderRadius: "50%", border: "3px solid #e5e7eb", borderTopColor: "#4f46e5", animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontSize: 13, color: "#6b7280", margin: 0 }}>Analyzing campaigns and writing copy…</p>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function ResultsView({ results }) {
  const campaigns = results?.campaigns || [];
  return (
    <div>
      {campaigns.map((c, i) => (
        <div key={i} style={{ marginBottom: 28 }}>
          <h3 style={{ fontSize: 15, fontWeight: 800, color: "#111827", margin: "0 0 6px" }}>{c.campaignName}</h3>

          <div style={{ background: "#fef3c7", border: "1px solid #fcd34d", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#92400e", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Diagnosis</p>
            <p style={{ fontSize: 13, color: "#78350f", margin: 0, lineHeight: 1.5 }}>{c.diagnosis}</p>
          </div>

          <div style={{ background: "#ede9fe", border: "1px solid #c4b5fd", borderRadius: 8, padding: "10px 12px", marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#4c1d95", margin: "0 0 4px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Strategy</p>
            <p style={{ fontSize: 13, color: "#3730a3", margin: 0, lineHeight: 1.5 }}>{c.strategy}</p>
          </div>

          <div style={{ marginBottom: 12 }}>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Headlines</p>
            {(c.headlines || []).map((h, hi) => (
              <div key={hi} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 3px" }}>{h.text}</p>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: 0, lineHeight: 1.4 }}>{h.rationale}</p>
              </div>
            ))}
          </div>

          <div>
            <p style={{ fontSize: 11, fontWeight: 800, color: "#6b7280", margin: "0 0 8px", textTransform: "uppercase", letterSpacing: "0.5px" }}>Descriptions</p>
            {(c.descriptions || []).map((d, di) => (
              <div key={di} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: "8px 12px", marginBottom: 6 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: "#111827", margin: "0 0 3px" }}>{d.text}</p>
                <p style={{ fontSize: 11, color: "#9ca3af", margin: 0, lineHeight: 1.4 }}>{d.rationale}</p>
              </div>
            ))}
          </div>

          {i < campaigns.length - 1 && <div style={{ height: 1, background: "#e5e7eb", margin: "20px 0 0" }} />}
        </div>
      ))}
    </div>
  );
}
