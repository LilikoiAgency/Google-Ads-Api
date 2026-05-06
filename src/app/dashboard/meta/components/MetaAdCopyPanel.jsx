"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";

const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];
const GOALS = ['Leads', 'Sales', 'Awareness', 'Traffic'];
const NEW_TONES = ['Professional', 'Friendly', 'Urgent', 'Bold'];

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

  // New state for two-mode toggle
  const [mode, setMode] = useState('existing');
  const [newProduct, setNewProduct] = useState('');
  const [newAudience, setNewAudience] = useState('');
  const [newUsps, setNewUsps] = useState('');
  const [newCta, setNewCta] = useState('');
  const [newGoal, setNewGoal] = useState(null);
  const [newTone, setNewTone] = useState(null);
  const [newPageUrl, setNewPageUrl] = useState('');
  const [newPageContent, setNewPageContent] = useState('');
  const [newFetchStatus, setNewFetchStatus] = useState('idle');
  const [newFetchError, setNewFetchError] = useState('');
  const [existingFocus, setExistingFocus] = useState('');
  const newFetchAbortRef = useRef(null);

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
        setMode('existing'); setNewProduct(''); setNewAudience(''); setNewUsps('');
        setNewCta(''); setNewGoal(null); setNewTone(null); setNewPageUrl('');
        setNewPageContent(''); setNewFetchStatus('idle'); setNewFetchError('');
        setExistingFocus('');
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
    if (!open) return;
    const hasUnderperforming = campaignsWithSpend.some(
      c => (c.roas || 0) < 1 || ((c.conversions || 0) === 0 && (c.spend || 0) > 0)
    );
    setMode(hasUnderperforming ? 'existing' : 'new');
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

  const canGenerateExisting = !!selectedId && business.trim() && audience.trim() && usps.trim() && !creativesLoading;
  const canGenerateNew = !!(newProduct.trim() && newAudience.trim() && newUsps.trim() && newCta.trim() && newFetchStatus !== 'loading');
  const canGenerate = mode === 'existing' ? canGenerateExisting : canGenerateNew;

  const handleGenerate = async () => {
    setView("loading"); setErrorMsg(null);
    try {
      if (mode === 'new') {
        const body = {
          product: newProduct,
          audience: newAudience,
          usps: newUsps,
          cta: newCta,
          ...(newGoal && { goal: newGoal }),
          ...(newTone && { tone: newTone }),
          ...(newPageContent && { pageContent: newPageContent }),
        };
        const res = await fetch('/api/claude/meta-ad-copy-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || json.error) { setErrorMsg(json.error || `Error ${res.status}`); setView("error"); return; }
        setResults({ mode: 'new', ...json.data });
      } else {
        const campaign = campaignsWithSpend.find((c) => c.id === selectedId);
        if (!campaign) { setErrorMsg("Campaign not found"); setView("error"); return; }
        const res = await fetch("/api/claude/meta-ad-copy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            context: { business: business.trim(), audience: audience.trim(), usps: usps.trim(), tone, offer: offer.trim(), focus: existingFocus },
            campaign: buildCampaignPayload(campaign, creatives),
          }),
        });
        const json = await res.json();
        if (!res.ok || json.error) { setErrorMsg(json.error || `Error ${res.status}`); setView("error"); return; }
        setResults({ mode: 'existing', ...json.data });
      }
      setView("results");
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
              {/* Mode toggle */}
              <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2 }}>
                {[['new', 'New campaign'], ['existing', 'Existing campaign']].map(([m, label]) => (
                  <button key={m} onClick={() => setMode(m)}
                    style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: mode === m ? 700 : 600, color: mode === m ? '#1877f2' : '#6b7280', background: mode === m ? '#fff' : 'transparent', border: 'none', padding: 7, borderRadius: 8, boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.1)' : 'none', cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>

              {mode === 'new' ? (
                <MetaNewCampaignForm
                  newProduct={newProduct} setNewProduct={setNewProduct}
                  newAudience={newAudience} setNewAudience={setNewAudience}
                  newUsps={newUsps} setNewUsps={setNewUsps}
                  newCta={newCta} setNewCta={setNewCta}
                  newGoal={newGoal} setNewGoal={setNewGoal}
                  newTone={newTone} setNewTone={setNewTone}
                  newPageUrl={newPageUrl} setNewPageUrl={setNewPageUrl}
                  newPageContent={newPageContent} setNewPageContent={setNewPageContent}
                  newFetchStatus={newFetchStatus} setNewFetchStatus={setNewFetchStatus}
                  newFetchError={newFetchError} setNewFetchError={setNewFetchError}
                  newFetchAbortRef={newFetchAbortRef}
                />
              ) : (
                <>
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

                  {selectedId && (() => {
                    const topCreative = creatives.find(cr => cr.campaignId === selectedId)?.creative;
                    if (!topCreative?.body && !topCreative?.title) return null;
                    return (
                      <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 10, padding: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#1877f2', marginBottom: 8 }}>
                          Current ad copy · pulled from your account
                        </div>
                        {topCreative.body && (
                          <>
                            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>Primary text</div>
                            <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5, marginBottom: 10 }}>{topCreative.body}</div>
                          </>
                        )}
                        {topCreative.title && (
                          <>
                            <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>Headline</div>
                            <div style={{ fontSize: 11, color: '#374151' }}>{topCreative.title}</div>
                          </>
                        )}
                      </div>
                    );
                  })()}

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
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
                      Anything specific to focus on? <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>optional</span>
                    </label>
                    <input type="text" aria-label="Focus area" value={existingFocus} onChange={e => setExistingFocus(e.target.value)}
                      placeholder="e.g. Improve CTR, creative feels stale"
                      style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid #d1d5db', borderRadius: 10, outline: 'none', boxSizing: 'border-box' }} />
                  </div>
                </>
              )}

              {errorMsg && <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", margin: 0 }}>{errorMsg}</p>}
              <button onClick={handleGenerate} disabled={!canGenerate} style={{ padding: "12px 20px", fontSize: 13, fontWeight: 800, background: canGenerate ? "#1877f2" : "#e5e7eb", color: canGenerate ? "#fff" : "#9ca3af", border: "none", borderRadius: 12, cursor: canGenerate ? "pointer" : "not-allowed" }}>
                {mode === 'new' ? 'Generate ad copy' : (creativesLoading ? "Loading creatives…" : "Generate ad copy")}
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
          {view === "results" && results && results.mode === 'new' && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
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
          {view === "results" && results && results.mode !== 'new' && (
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

function MetaNewCampaignForm({ newProduct, setNewProduct, newAudience, setNewAudience,
  newUsps, setNewUsps, newCta, setNewCta, newGoal, setNewGoal, newTone, setNewTone,
  newPageUrl, setNewPageUrl, newPageContent, setNewPageContent,
  newFetchStatus, setNewFetchStatus, newFetchError, setNewFetchError, newFetchAbortRef }) {

  const inputStyle = { width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, color: '#111827', outline: 'none', boxSizing: 'border-box' };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 };

  async function handleFetch() {
    if (!newPageUrl.trim()) return;
    if (newFetchAbortRef.current) newFetchAbortRef.current.abort();
    const controller = new AbortController();
    newFetchAbortRef.current = controller;
    setNewFetchStatus('loading');
    setNewFetchError('');
    try {
      const res = await fetch('/api/fetch-page-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: newPageUrl }),
        signal: controller.signal,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Fetch failed');
      setNewPageContent(json.content || '');
      setNewFetchStatus('idle');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setNewFetchError(err.message);
      setNewPageUrl('');
      setNewPageContent('');
      setNewFetchStatus('error');
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>What are you selling? <span style={{ color: '#ef4444' }}>*</span></label>
        <input aria-label="What are you selling" value={newProduct} onChange={e => setNewProduct(e.target.value)}
          placeholder="e.g. Emergency plumbing repair services in Miami" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>Target audience <span style={{ color: '#ef4444' }}>*</span></label>
        <input aria-label="Target audience" value={newAudience} onChange={e => setNewAudience(e.target.value)}
          placeholder="e.g. Homeowners 30–55, interested in home improvement" style={inputStyle} />
      </div>
      <div>
        <label style={labelStyle}>What makes you different? <span style={{ color: '#ef4444' }}>*</span></label>
        <textarea aria-label="What makes you different" rows={3} value={newUsps} onChange={e => setNewUsps(e.target.value)}
          placeholder="e.g. Licensed & insured, 60-min response, upfront pricing, 5-star rated"
          style={{ ...inputStyle, resize: 'vertical' }} />
      </div>
      <div>
        <label style={labelStyle}>Main offer or CTA <span style={{ color: '#ef4444' }}>*</span></label>
        <input aria-label="Main offer or CTA" value={newCta} onChange={e => setNewCta(e.target.value)}
          placeholder="e.g. Free estimate · Call now · 20% off first visit" style={inputStyle} />
      </div>
      <div style={{ borderTop: '1px solid #f3f4f6' }} />
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Campaign goal <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>optional</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {GOALS.map(g => (
            <button key={g} onClick={() => setNewGoal(newGoal === g ? null : g)}
              style={{ fontSize: 12, border: newGoal === g ? '1px solid #1877f2' : '1px solid #d1d5db', borderRadius: 20, padding: '5px 14px', color: newGoal === g ? '#1877f2' : '#374151', background: newGoal === g ? '#eff6ff' : 'transparent', cursor: 'pointer' }}>
              {g}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 6 }}>Tone <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>optional</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {NEW_TONES.map(t => (
            <button key={t} onClick={() => setNewTone(newTone === t ? null : t)}
              style={{ fontSize: 12, border: newTone === t ? '1px solid #1877f2' : '1px solid #d1d5db', borderRadius: 20, padding: '5px 14px', color: newTone === t ? '#1877f2' : '#374151', background: newTone === t ? '#eff6ff' : 'transparent', cursor: 'pointer' }}>
              {t}
            </button>
          ))}
        </div>
      </div>
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 5 }}>Landing page URL <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>optional</span></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input aria-label="Landing page URL" value={newPageUrl} onChange={e => setNewPageUrl(e.target.value)}
            placeholder="https://" style={{ flex: 1, border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none' }} />
          <button onClick={handleFetch} disabled={!newPageUrl.trim() || newFetchStatus === 'loading'}
            style={{ fontSize: 12, background: '#1877f2', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {newFetchStatus === 'loading' ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {newFetchError && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{newFetchError}</div>}
        {newPageContent && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>Page content loaded.</div>}
      </div>
    </div>
  );
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
