"use client";
import { useState, useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { getCampaignVerdict, analyzeSearchTerms, analyzeKeywords } from "../../../../../lib/googleAdsAudit";

const UNDERPERFORMING = new Set(["FIX_QS", "OPTIMIZE", "INVESTIGATE"]);
const TONES = ["Professional", "Urgent", "Friendly", "Direct", "Trust-building"];
const GOALS = ['Leads', 'Sales', 'Awareness', 'Traffic'];
const NEW_TONES = ['Professional', 'Friendly', 'Urgent', 'Bold'];

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
  const [selectedId, setSelectedId] = useState(null);

  // New state for two-mode toggle
  const [mode, setMode] = useState('existing'); // will be overridden by effect
  const [newProduct, setNewProduct] = useState('');
  const [newKeywords, setNewKeywords] = useState('');
  const [newUsps, setNewUsps] = useState('');
  const [newCta, setNewCta] = useState('');
  const [newGoal, setNewGoal] = useState(null);
  const [newTone, setNewTone] = useState(null);
  const [newPageUrl, setNewPageUrl] = useState('');
  const [newPageContent, setNewPageContent] = useState('');
  const [newFetchStatus, setNewFetchStatus] = useState('idle'); // 'idle' | 'loading' | 'error'
  const [newFetchError, setNewFetchError] = useState('');
  const [existingFocus, setExistingFocus] = useState('');
  const newFetchAbortRef = useRef(null);

  const campaigns = useMemo(() => selectedCustomer?.campaigns || [], [selectedCustomer]);
  const customerId = String(selectedCustomer?.customer?.customer_client?.id || "");

  useEffect(() => {
    if (!open) return;
    const first = campaigns.find((c) => UNDERPERFORMING.has(getCampaignVerdict(c).key));
    setSelectedId(first ? String(first.campaignId) : null);
  }, [open, campaigns]);

  useEffect(() => {
    if (!open) return;
    const hasUnderperforming = campaigns.some(c => UNDERPERFORMING.has(getCampaignVerdict(c).key));
    setMode(hasUnderperforming ? 'existing' : 'new');
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

  const canGenerateExisting = !!selectedId && business.trim() && audience.trim() && usps.trim() && !auditLoading;
  const canGenerateNew = !!(newProduct.trim() && newKeywords.trim() && newUsps.trim() && newCta.trim() && newFetchStatus !== 'loading');
  const canGenerate = mode === 'existing' ? canGenerateExisting : canGenerateNew;

  const handleGenerate = async () => {
    setView('loading');
    setErrorMsg(null);
    try {
      if (mode === 'new') {
        const body = {
          product: newProduct,
          keywords: newKeywords,
          usps: newUsps,
          cta: newCta,
          ...(newGoal && { goal: newGoal }),
          ...(newTone && { tone: newTone }),
          ...(newPageContent && { pageContent: newPageContent }),
        };
        const res = await fetch('/api/claude/ad-copy-new', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok || json.error) { setErrorMsg(json.error || `Error ${res.status}`); setView('error'); return; }
        setResults({ mode: 'new', ...json.data });
      } else {
        const campaign = campaigns.find(c => String(c.campaignId) === selectedId);
        const selectedCampaigns = campaign ? [buildCampaignPayload(campaign, auditData)] : [];
        const res = await fetch('/api/claude/ad-copy-strategy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerId,
            context: { business, audience, usps, tone, offer, focus: existingFocus },
            campaigns: selectedCampaigns,
          }),
        });
        const json = await res.json();
        if (!res.ok || json.error) { setErrorMsg(json.error || `Error ${res.status}`); setView('error'); return; }
        setResults({ mode: 'existing', ...json.data });
      }
      setView('results');
    } catch (err) {
      setErrorMsg(err.message);
      setView('error');
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
              {view === "results" ? "Copy Strategy" : mode === 'new' ? "New Campaign Copy" : "Generate Ad Copy"}
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
              mode={mode} setMode={setMode}
              campaigns={campaigns}
              selectedId={selectedId} setSelectedId={setSelectedId}
              business={business} setBusiness={setBusiness}
              audience={audience} setAudience={setAudience}
              usps={usps} setUsps={setUsps}
              tone={tone} setTone={setTone}
              offer={offer} setOffer={setOffer}
              existingFocus={existingFocus} setExistingFocus={setExistingFocus}
              newProduct={newProduct} setNewProduct={setNewProduct}
              newKeywords={newKeywords} setNewKeywords={setNewKeywords}
              newUsps={newUsps} setNewUsps={setNewUsps}
              newCta={newCta} setNewCta={setNewCta}
              newGoal={newGoal} setNewGoal={setNewGoal}
              newTone={newTone} setNewTone={setNewTone}
              newPageUrl={newPageUrl} setNewPageUrl={setNewPageUrl}
              newPageContent={newPageContent} setNewPageContent={setNewPageContent}
              newFetchStatus={newFetchStatus} setNewFetchStatus={setNewFetchStatus}
              newFetchError={newFetchError} setNewFetchError={setNewFetchError}
              newFetchAbortRef={newFetchAbortRef}
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

function NewCampaignForm({ newProduct, setNewProduct, newKeywords, setNewKeywords,
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
        <label style={labelStyle}>Target keywords <span style={{ color: '#ef4444' }}>*</span></label>
        <input aria-label="Target keywords" value={newKeywords} onChange={e => setNewKeywords(e.target.value)}
          placeholder="e.g. emergency plumber, burst pipe repair, 24 hour plumber" style={inputStyle} />
        <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 3 }}>Separate with commas.</div>
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
              style={{ fontSize: 12, border: newGoal === g ? '1px solid #4f46e5' : '1px solid #d1d5db', borderRadius: 20, padding: '5px 14px', color: newGoal === g ? '#4f46e5' : '#374151', background: newGoal === g ? '#ede9fe' : 'transparent', cursor: 'pointer' }}>
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
              style={{ fontSize: 12, border: newTone === t ? '1px solid #4f46e5' : '1px solid #d1d5db', borderRadius: 20, padding: '5px 14px', color: newTone === t ? '#4f46e5' : '#374151', background: newTone === t ? '#ede9fe' : 'transparent', cursor: 'pointer' }}>
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
            style={{ fontSize: 12, background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 14px', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
            {newFetchStatus === 'loading' ? 'Fetching…' : 'Fetch'}
          </button>
        </div>
        {newFetchError && <div style={{ fontSize: 11, color: '#dc2626', marginTop: 4 }}>{newFetchError}</div>}
        {newPageContent && <div style={{ fontSize: 11, color: '#16a34a', marginTop: 4 }}>Page content loaded.</div>}
      </div>
    </div>
  );
}

function FormView({ mode, setMode, campaigns, selectedId, setSelectedId, business, setBusiness, audience, setAudience, usps, setUsps, tone, setTone, offer, setOffer, existingFocus, setExistingFocus, newProduct, setNewProduct, newKeywords, setNewKeywords, newUsps, setNewUsps, newCta, setNewCta, newGoal, setNewGoal, newTone, setNewTone, newPageUrl, setNewPageUrl, newPageContent, setNewPageContent, newFetchStatus, setNewFetchStatus, newFetchError, setNewFetchError, newFetchAbortRef, canGenerate, auditLoading, onGenerate }) {
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };
  const inputStyle = { width: "100%", border: "1px solid #d1d5db", borderRadius: 8, padding: "8px 12px", fontSize: 13, color: "#111827", outline: "none", boxSizing: "border-box", resize: "vertical" };
  const fieldWrap = { marginBottom: 16 };

  return (
    <div>
      {/* Mode toggle */}
      <div style={{ display: 'flex', background: '#f3f4f6', borderRadius: 10, padding: 3, gap: 2, marginBottom: 16 }}>
        {[['new', 'New campaign'], ['existing', 'Existing campaign']].map(([m, label]) => (
          <button key={m} onClick={() => setMode(m)}
            style={{ flex: 1, textAlign: 'center', fontSize: 12, fontWeight: mode === m ? 700 : 600, color: mode === m ? '#4f46e5' : '#6b7280', background: mode === m ? '#fff' : 'transparent', border: 'none', padding: 7, borderRadius: 8, boxShadow: mode === m ? '0 1px 3px rgba(0,0,0,.1)' : 'none', cursor: 'pointer' }}>
            {label}
          </button>
        ))}
      </div>

      {mode === 'new' ? (
        <NewCampaignForm
          newProduct={newProduct} setNewProduct={setNewProduct}
          newKeywords={newKeywords} setNewKeywords={setNewKeywords}
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
            <p style={{ ...labelStyle, marginBottom: 10 }}>Campaign to analyze</p>
            {auditLoading && (
              <p style={{ fontSize: 11, color: "#9ca3af", marginBottom: 8 }}>Loading keyword data…</p>
            )}
            {campaigns.map((c) => {
              const verdict = getCampaignVerdict(c);
              const isSelected = selectedId === String(c.campaignId);
              return (
                <label key={c.campaignId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "1px solid #f3f4f6", cursor: "pointer" }}>
                  <input
                    type="radio"
                    name="campaign-select"
                    aria-label={c.campaignName}
                    checked={isSelected}
                    onChange={() => setSelectedId(String(c.campaignId))}
                  />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 600, color: "#111827" }}>{c.campaignName}</span>
                  <span style={{ fontSize: 10, fontWeight: 800, color: verdict.color, background: verdict.bg, borderRadius: 4, padding: "2px 7px", border: `1px solid ${verdict.color}40` }}>{verdict.key}</span>
                </label>
              );
            })}
          </div>

          {selectedId && (() => {
            const sel = campaigns.find(c => String(c.campaignId) === selectedId);
            const ads = sel?.ads || [];
            const headlines = ads.flatMap(ad => ad.headlines || []).filter(Boolean).slice(0, 10);
            const descriptions = ads.flatMap(ad => ad.descriptions || []).filter(Boolean).slice(0, 4);
            if (!headlines.length && !descriptions.length) return null;
            return (
              <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 10, padding: 12, marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '.06em', color: '#6366f1', marginBottom: 8 }}>Current ad copy · pulled from your account</div>
                {headlines.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: '#374151', marginBottom: 6, fontWeight: 600 }}>Headlines</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 10 }}>
                      {headlines.map((h, i) => <span key={i} style={{ fontSize: 11, background: '#fff', border: '1px solid #e0e7ff', borderRadius: 6, padding: '3px 8px', color: '#374151' }}>{h}</span>)}
                    </div>
                  </>
                )}
                {descriptions.length > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: '#374151', marginBottom: 4, fontWeight: 600 }}>Descriptions</div>
                    <div style={{ fontSize: 11, color: '#6b7280', lineHeight: 1.5 }}>{descriptions.join(' ')}</div>
                  </>
                )}
              </div>
            );
          })()}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, fontWeight: 700, color: '#374151', display: 'block', marginBottom: 6 }}>
              Anything specific to focus on? <span style={{ fontSize: 11, fontWeight: 400, color: '#9ca3af' }}>optional</span>
            </label>
            <input type="text" aria-label="Focus area" value={existingFocus} onChange={e => setExistingFocus(e.target.value)}
              placeholder="e.g. Improve CTR, descriptions feel generic"
              style={{ width: '100%', border: '1px solid #d1d5db', borderRadius: 8, padding: '8px 12px', fontSize: 13, outline: 'none', boxSizing: 'border-box' }} />
          </div>
        </>
      )}

      <button
        onClick={onGenerate}
        disabled={!canGenerate}
        aria-label={mode === 'new' ? 'Generate Ad Copy' : 'Generate Ad Copy Strategy'}
        style={{
          width: "100%", padding: "12px", borderRadius: 10, border: "none",
          background: canGenerate ? "#4f46e5" : "#e5e7eb",
          color: canGenerate ? "#fff" : "#9ca3af",
          fontSize: 14, fontWeight: 800, cursor: canGenerate ? "pointer" : "not-allowed",
          marginTop: 8,
        }}
      >
        {mode === 'new' ? 'Generate Ad Copy' : 'Generate Ad Copy Strategy'}
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

function NewCampaignResultsView({ results }) {
  return (
    <div>
      <div style={{ marginBottom: 20 }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Headlines</p>
        {(results.headlines || []).map((h, i) => (
          <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>{h.text}</p>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, lineHeight: 1.4 }}>{h.rationale}</p>
          </div>
        ))}
      </div>
      <div>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#6b7280', margin: '0 0 8px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Descriptions</p>
        {(results.descriptions || []).map((d, i) => (
          <div key={i} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '8px 12px', marginBottom: 6 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>{d.text}</p>
            <p style={{ fontSize: 11, color: '#9ca3af', margin: 0, lineHeight: 1.4 }}>{d.rationale}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ResultsView({ results }) {
  if (results?.mode === 'new') {
    return <NewCampaignResultsView results={results} />;
  }
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
