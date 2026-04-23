// src/app/dashboard/meta/creatives/page.js
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

const RANGES = [
  { key: "7d",  label: "Last 7 days" },
  { key: "28d", label: "Last 28 days" },
  { key: "mtd", label: "Month to date" },
  { key: "3m",  label: "Last 3 months" },
  { key: "6m",  label: "Last 6 months" },
];

const STATUSES = [
  { key: "active",   label: "Active only" },
  { key: "inactive", label: "Paused / Inactive" },
  { key: "all",      label: "All statuses" },
];

const SORTS = [
  { key: "spend_desc",       label: "Top spenders",   dir: "desc", field: "spend" },
  { key: "conversions_desc", label: "Most conversions", dir: "desc", field: "conversions" },
  { key: "roas_desc",        label: "Best ROAS",       dir: "desc", field: "roas" },
  { key: "ctr_desc",         label: "Best CTR",        dir: "desc", field: "ctr" },
  { key: "cpa_asc",          label: "Lowest CPA (best efficiency)", dir: "asc",  field: "cost_per_conversion" },
  { key: "frequency_desc",   label: "Highest frequency (fatigue)",  dir: "desc", field: "frequency" },
  { key: "waste_desc",       label: "Zero-conv waste (worst)",      dir: "desc", field: "zero_conv_spend" },
];

const PLACEMENT_FORMATS = [
  { key: "MOBILE_FEED_STANDARD",  label: "Mobile" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop" },
  { key: "INSTAGRAM_STANDARD",    label: "IG Feed" },
  { key: "FACEBOOK_REELS_MOBILE", label: "Reels" },
];

const ACCENT = "#1877F2";

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return "$" + Math.round(n).toLocaleString("en-US");
}
function fmtCount(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(Math.round(n));
}
function fmtRatio(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return (n * 100).toFixed(2) + "%";
}
function fmtRoas(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2) + "x";
}
function fmtFreq(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AllCreativesPage() {
  return (
    <Suspense fallback={<div className="p-10 text-gray-500">Loading…</div>}>
      <AllCreativesInner />
    </Suspense>
  );
}

function AllCreativesInner() {
  const router = useRouter();
  const sp = useSearchParams();
  const accountId = sp.get("accountId") || "";
  const initialRange = sp.get("range") || "28d";
  const initialStart = sp.get("startDate") || "";
  const initialEnd = sp.get("endDate") || "";

  const [range, setRange] = useState(initialRange);
  const [status, setStatus] = useState("active");
  const [sortKey, setSortKey] = useState("spend_desc");
  const [search, setSearch] = useState("");

  const [ads, setAds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Ad review state ────────────────────────────────────────────
  const [reviews, setReviews] = useState({});            // { [adId]: reviewResult }
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 });
  const [reviewModal, setReviewModal] = useState(null);  // adId | null
  const [reviewUsage, setReviewUsage] = useState(null);  // { count, limit, remaining }
  const [reviewError, setReviewError] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ accountId, range, limit: "200" });
    if (range === "custom" && initialStart && initialEnd) {
      params.set("startDate", initialStart);
      params.set("endDate", initialEnd);
    }
    fetch(`/api/meta-ads/top-creatives?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : r.json().then((j) => { throw new Error(j.error || `HTTP ${r.status}`); }))
      .then((j) => setAds(j.data || []))
      .catch((err) => { if (err.name !== "AbortError") setError(err.message || "Failed to load"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [accountId, range, initialStart, initialEnd]);

  const filtered = useMemo(() => {
    if (!ads) return [];
    const q = search.trim().toLowerCase();
    let list = ads;
    if (status === "active") list = list.filter((a) => a.effective_status === "ACTIVE" || a.status === "ACTIVE");
    else if (status === "inactive") list = list.filter((a) => (a.effective_status || a.status) !== "ACTIVE");
    if (q) list = list.filter((a) => (a.name || "").toLowerCase().includes(q));

    const sort = SORTS.find((s) => s.key === sortKey) || SORTS[0];
    const pull = (ad) => {
      if (sort.field === "zero_conv_spend") {
        return (ad.insights?.conversions || 0) === 0 ? (ad.insights?.spend || 0) : -1;
      }
      return ad.insights?.[sort.field];
    };
    const dir = sort.dir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      const av = pull(a);
      const bv = pull(b);
      // Nulls / undefined go to the bottom regardless of direction
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return dir * ((bv || 0) - (av || 0));
    });
    return list;
  }, [ads, search, status, sortKey]);

  async function reviewAll() {
    if (!filtered.length || reviewLoading) return;
    setReviewLoading(true);
    setReviewError(null);
    setReviewProgress({ current: 0, total: filtered.length });

    const CHUNK = 10;
    const chunks = [];
    for (let i = 0; i < filtered.length; i += CHUNK) chunks.push(filtered.slice(i, i + CHUNK));

    let processed = 0;
    for (const chunk of chunks) {
      const adPayloads = chunk.map((ad) => ({
        id: ad.id,
        name: ad.name || '',
        title: ad.creative?.title || '',
        body: ad.creative?.body || '',
        ctaType: ad.creative?.call_to_action_type || '',
        imageUrl: null,
        metrics: ad.insights || {},
      }));

      try {
        const res = await fetch('/api/claude/ad-review', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ads: adPayloads, mode: 'batch', accountId }),
        });
        const json = await res.json();

        if (res.status === 429 || json.limitReached) {
          setReviewError(json.error || 'Daily review limit reached.');
          if (json.usage) setReviewUsage(json.usage);
          break;
        }
        if (!res.ok) {
          setReviewError(json.error || `Error ${res.status}`);
          break;
        }

        if (json.usage) setReviewUsage(json.usage);
        const newReviews = {};
        (json.reviews || []).forEach((r) => { newReviews[r.adId] = r; });
        setReviews((prev) => ({ ...prev, ...newReviews }));
      } catch (err) {
        setReviewError(err.message || 'Network error');
        break;
      }

      processed += chunk.length;
      setReviewProgress({ current: processed, total: filtered.length });
      if (processed < filtered.length) await new Promise((r) => setTimeout(r, 500));
    }

    setReviewLoading(false);
  }

  const activeCount = (ads || []).filter((a) => a.effective_status === "ACTIVE" || a.status === "ACTIVE").length;
  const totalCount = ads?.length || 0;

  if (!accountId) {
    return (
      <div className="p-10">
        <p className="text-sm text-gray-600">No account selected. Go back and pick one.</p>
        <button onClick={() => router.back()} className="mt-3 text-sm font-semibold text-blue-600">← Back</button>
      </div>
    );
  }

  return (
    <div className="flex flex-col min-h-screen" style={{ background: "#f7f8fa" }}>
      {/* Top bar */}
      <div className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="flex items-center gap-4 flex-wrap">
          <button onClick={() => router.back()} className="text-sm font-semibold text-gray-600 hover:text-gray-900 flex items-center gap-1 flex-shrink-0">
            ← Back
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider" style={{ color: ACCENT }}>All creatives</p>
            <p className="text-lg font-bold text-gray-900 truncate">Meta Ads</p>
          </div>
          {ads && (
            <p className="text-xs text-gray-400 whitespace-nowrap">
              {filtered.length} shown · {activeCount} active · {totalCount} total
            </p>
          )}
        </div>

        {/* Filter + sort bar */}
        <div className="mt-4 flex items-center gap-2 flex-wrap">
          <SelectPill label="Date" value={range} options={RANGES} onChange={setRange} />
          <SelectPill label="Status" value={status} options={STATUSES} onChange={setStatus} />
          <SelectPill label="Sort" value={sortKey} options={SORTS} onChange={setSortKey} />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ad name…"
            className="text-xs border border-gray-200 rounded-md px-3 py-1.5 bg-white flex-1 min-w-[180px] max-w-[320px]"
          />
          <button
            onClick={reviewAll}
            disabled={reviewLoading || !ads?.length}
            style={{
              marginLeft: "auto",
              background: reviewLoading ? "#93c5fd" : ACCENT,
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "7px 14px",
              fontSize: 12,
              fontWeight: 700,
              cursor: reviewLoading || !ads?.length ? "not-allowed" : "pointer",
              opacity: !ads?.length ? 0.5 : 1,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexShrink: 0,
            }}
          >
            {reviewLoading ? (
              <>
                <span style={{ display: "inline-block", width: 12, height: 12, border: "2px solid rgba(255,255,255,0.4)", borderTopColor: "#fff", borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
                Reviewing {reviewProgress.current}–{Math.min(reviewProgress.current + 10, reviewProgress.total)} of {reviewProgress.total}…
              </>
            ) : (
              <>★ Review All</>
            )}
          </button>
        </div>
        {reviewError && (
          <div className="mt-2 text-xs text-red-500 font-medium">{reviewError}</div>
        )}
        {reviewUsage && !reviewError && (
          <div className="mt-2 text-[11px] text-gray-400">{reviewUsage.remaining} reviews remaining today</div>
        )}
      </div>

      {/* Body */}
      <div className="flex-1 p-6">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div style={{ width: 26, height: 26, border: "3px solid rgba(24,119,242,0.2)", borderTopColor: ACCENT, borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
            <p className="ml-3 text-sm text-gray-500">Fetching all creatives…</p>
            <style>{"@keyframes ccSpin { to { transform: rotate(360deg); } }"}</style>
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        )}
        {!loading && !error && filtered.length === 0 && ads && (
          <p className="text-sm text-gray-500 text-center py-10">No creatives match the current filter.</p>
        )}
        {!loading && !error && filtered.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mx-auto" style={{ maxWidth: 1800 }}>
            {filtered.map((ad, i) => (
              <LazyCreativeCard
                key={ad.id}
                ad={ad}
                rank={i + 1}
                accountId={accountId}
                review={reviews[ad.id] || null}
                batchReviewInProgress={reviewLoading}
                onOpenReviewModal={() => setReviewModal(ad.id)}
                onReviewDone={(result, usage) => {
                  setReviews((prev) => ({ ...prev, [ad.id]: result }));
                  if (usage) setReviewUsage(usage);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Filter pill: label + native select, styled ─────────────────────────────────

function SelectPill({ label, value, options, onChange }) {
  return (
    <label className="flex items-center gap-2 text-xs bg-white border border-gray-200 rounded-md px-3 py-1.5 cursor-pointer">
      <span className="text-gray-500 font-semibold uppercase tracking-wider text-[10px]">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-xs font-medium text-gray-800 bg-transparent focus:outline-none cursor-pointer"
        style={{ border: "none", padding: 0 }}
      >
        {options.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
      </select>
    </label>
  );
}

// ── Lazy-loading card: only fetches live preview when scrolled near viewport ──

function LazyCreativeCard({ ad, rank, accountId, review, batchReviewInProgress, onOpenReviewModal, onReviewDone }) {
  const ins = ad.insights || {};
  const statusOk = ad.effective_status === "ACTIVE" || ad.status === "ACTIVE";
  const [activeFormat, setActiveFormat] = useState(PLACEMENT_FORMATS[0].key);
  const [previews, setPreviews] = useState({});
  const [visible, setVisible] = useState(false);
  const cardRef = useRef(null);
  const [singleReviewLoading, setSingleReviewLoading] = useState(false);

  // IntersectionObserver: flip `visible` true once the card approaches the viewport
  useEffect(() => {
    const el = cardRef.current;
    if (!el || visible) return;
    const observer = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { setVisible(true); observer.disconnect(); } }),
      { rootMargin: "400px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [visible]);

  // Fetch preview only once the card is visible
  useEffect(() => {
    if (!visible || previews[activeFormat]) return;
    let cancelled = false;
    setPreviews((p) => ({ ...p, [activeFormat]: { loading: true } }));
    fetch(`/api/meta-ads/ad/${ad.id}/preview?format=${activeFormat}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { html: j.html || null, unsupported: !!j.unsupported, error: j.error || null, loading: false } }));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { loading: false, error: err.message } }));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeFormat, ad.id]);

  async function reviewSingle() {
    if (singleReviewLoading || batchReviewInProgress) return;
    setSingleReviewLoading(true);
    try {
      const res = await fetch('/api/claude/ad-review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ads: [{
            id: ad.id,
            name: ad.name || '',
            title: ad.creative?.title || '',
            body: ad.creative?.body || '',
            ctaType: ad.creative?.call_to_action_type || '',
            imageUrl: ad.creative?.image_url || null,
            metrics: ad.insights || {},
          }],
          mode: 'single',
          accountId,
        }),
      });
      const json = await res.json();
      if (res.ok && json.reviews?.length) {
        onReviewDone(json.reviews[0], json.usage);
      }
    } catch (err) {
      console.error('[reviewSingle]', err);
    } finally {
      setSingleReviewLoading(false);
    }
  }

  const current = visible ? (previews[activeFormat] || { loading: true }) : null;

  return (
    <div
      ref={cardRef}
      className="rounded-2xl bg-white border border-gray-100 overflow-hidden flex flex-col shadow-sm"
      style={{ transition: "box-shadow .15s, transform .15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center gap-3 mb-2">
          <span style={{ background: ACCENT, color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, letterSpacing: 0.3 }}>
            #{rank}
          </span>
          <button
            onClick={review ? onOpenReviewModal : reviewSingle}
            disabled={singleReviewLoading || batchReviewInProgress}
            style={{
              fontSize: 11,
              fontWeight: 700,
              padding: "3px 10px",
              borderRadius: 999,
              border: `1px solid ${ACCENT}`,
              background: review ? ACCENT : "transparent",
              color: review ? "#fff" : ACCENT,
              cursor: singleReviewLoading || batchReviewInProgress ? "not-allowed" : "pointer",
              display: "flex",
              alignItems: "center",
              gap: 4,
              opacity: batchReviewInProgress && !singleReviewLoading ? 0.5 : 1,
              flexShrink: 0,
            }}
          >
            {singleReviewLoading ? (
              <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${ACCENT}40`, borderTopColor: ACCENT, borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
            ) : (
              "★"
            )}
            {review ? "Reviewed" : "Review"}
          </button>
          <span
            className="text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-full"
            style={{
              background: statusOk ? "rgba(34,197,94,0.12)" : "rgba(100,116,139,0.12)",
              color: statusOk ? "#16a34a" : "#64748b",
            }}
          >
            {ad.effective_status || ad.status || "—"}
          </span>
        </div>
        <p className="text-sm font-semibold text-gray-900 truncate" title={ad.name}>
          {ad.name || "Untitled ad"}
        </p>
      </div>

      {/* Placement tabs */}
      <div className="flex border-b border-gray-100 bg-gray-50 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {PLACEMENT_FORMATS.map((f) => {
          const active = f.key === activeFormat;
          return (
            <button
              key={f.key}
              onClick={() => setActiveFormat(f.key)}
              className="flex-shrink-0 font-semibold whitespace-nowrap transition"
              style={{
                padding: "10px 16px",
                fontSize: 12,
                background: "transparent",
                color: active ? ACCENT : "#64748b",
                border: "none",
                borderBottom: `2px solid ${active ? ACCENT : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Preview area */}
      <div
        className={`cc-preview ${activeFormat === "FACEBOOK_REELS_MOBILE" ? "is-reels" : ""}`}
        style={{ background: "#f1f5f9", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, minHeight: 320 }}
      >
        <style>{`
          .cc-preview iframe { max-width: 100% !important; display: block; border: 0; border-radius: 8px; box-shadow: 0 4px 14px rgba(15,23,42,0.1); }
          .cc-preview.is-reels iframe { zoom: 1.5; }
        `}</style>
        {!visible && <PreviewPlaceholder imageUrl={ad.creative?.image_url} />}
        {visible && current?.loading && <PreviewSpinner />}
        {visible && !current?.loading && current?.html && (
          <div dangerouslySetInnerHTML={{ __html: current.html }} style={{ display: "flex", justifyContent: "center", width: "100%" }} />
        )}
        {visible && !current?.loading && !current?.html && current?.unsupported && (
          <div className="text-center" style={{ padding: "40px 20px" }}>
            <p className="text-xs text-gray-500 mb-3">Doesn&apos;t render in {PLACEMENT_FORMATS.find((f) => f.key === activeFormat)?.label}.</p>
            {ad.creative?.image_url && (
              <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 10 }} />
            )}
          </div>
        )}
        {visible && !current?.loading && !current?.html && current?.error && (
          <div className="text-center" style={{ padding: "40px 20px" }}>
            <p className="text-xs text-orange-600 mb-3">Preview unavailable.</p>
            {ad.creative?.image_url && <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 10 }} />}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-5 gap-3 px-5 py-4 border-t border-gray-100">
        <MetricCell label="Spend" value={fmtMoney(ins.spend)} />
        <MetricCell label="CTR"   value={fmtRatio(ins.ctr)} />
        <MetricCell label="Conv"  value={fmtCount(ins.conversions)} />
        <MetricCell label="CPA"   value={ins.cost_per_conversion ? fmtMoney(ins.cost_per_conversion) : "—"} />
        <MetricCell label="ROAS"  value={fmtRoas(ins.roas)} />
      </div>
      <div className="px-5 pb-3 -mt-2 text-[10px] text-gray-400 font-medium">
        Frequency {fmtFreq(ins.frequency)} · {fmtCount(ins.impressions)} impressions
      </div>
      {review && (
        <ReviewFooterStrip review={review} onClick={onOpenReviewModal} />
      )}
    </div>
  );
}

const VERDICT_COLORS = {
  APPROVED: { bg: "rgba(22,163,74,0.1)",  border: "#16a34a", text: "#15803d" },
  REVISE:   { bg: "rgba(217,119,6,0.1)",  border: "#d97706", text: "#b45309" },
  REJECT:   { bg: "rgba(220,38,38,0.1)",  border: "#dc2626", text: "#b91c1c" },
};

function ReviewFooterStrip({ review, onClick }) {
  const colors = VERDICT_COLORS[review.status] || VERDICT_COLORS.REVISE;
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
        padding: "10px 20px",
        background: colors.bg,
        borderTop: `2px solid ${colors.border}`,
        borderRight: "none",
        borderBottom: "none",
        borderLeft: "none",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1,
          color: colors.text,
          background: colors.bg,
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          padding: "2px 7px",
        }}>
          {review.status}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: colors.text }}>
          {review.overallScore}/100
        </span>
        <span style={{ fontSize: 11, color: "#64748b", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {review.summary}
        </span>
      </span>
      <span style={{ fontSize: 11, color: colors.text, fontWeight: 600, flexShrink: 0 }}>
        View full review →
      </span>
    </button>
  );
}

function MetricCell({ label, value }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">{label}</p>
      <p className="text-sm font-bold text-gray-900 leading-tight mt-1">{value}</p>
    </div>
  );
}

function PreviewSpinner() {
  return (
    <div className="flex flex-col items-center gap-2" style={{ padding: "60px 0" }}>
      <div style={{ width: 26, height: 26, border: `3px solid rgba(24,119,242,0.2)`, borderTopColor: ACCENT, borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
      <p className="text-xs text-gray-500">Loading preview…</p>
      <style>{"@keyframes ccSpin { to { transform: rotate(360deg); } }"}</style>
    </div>
  );
}

function PreviewPlaceholder({ imageUrl }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3" style={{ padding: "20px 0", width: "100%" }}>
      {imageUrl ? (
        <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 10, opacity: 0.85 }} />
      ) : (
        <div style={{ width: "100%", height: 280, background: "linear-gradient(135deg,#e2e8f0,#cbd5e1)", borderRadius: 10 }} />
      )}
      <p className="text-[11px] text-gray-400 font-medium">Scroll to load preview</p>
    </div>
  );
}
