// src/app/dashboard/meta/creatives/page.js
"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { clientCache } from "../../../../lib/clientCache";

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
  const [page, setPage] = useState(1);

  const [ads, setAds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // ── Ad review state ────────────────────────────────────────────
  const [reviews, setReviews] = useState({});            // { [adId]: reviewResult }
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewProgress, setReviewProgress] = useState({ current: 0, total: 0 });
  const [reviewModal, setReviewModal] = useState(null);       // adId | null
  const [reviewModalPreview, setReviewModalPreview] = useState(null); // previewHtml | null
  const [reviewUsage, setReviewUsage] = useState(null);  // { count, limit, remaining }
  const [reviewError, setReviewError] = useState(null);

  useEffect(() => {
    if (!accountId) return;
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ accountId, range, limit: "500" });
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

  const PAGE_SIZE = 24;
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Reset to page 1 whenever filters or sort change
  useEffect(() => { setPage(1); }, [search, status, sortKey, range]);

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
      <style>{"@keyframes ccSpin { to { transform: rotate(360deg); } }"}</style>
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
              {filtered.length} filtered · {activeCount} active · {totalCount} total
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
          </div>
        )}
        {!loading && error && (
          <p className="text-sm text-red-500 text-center py-10">{error}</p>
        )}
        {!loading && !error && filtered.length === 0 && ads && (
          <p className="text-sm text-gray-500 text-center py-10">No creatives match the current filter.</p>
        )}
        {!loading && !error && filtered.length > 0 && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mx-auto" style={{ maxWidth: 1800 }}>
              {paginated.map((ad, i) => (
                <LazyCreativeCard
                  key={ad.id}
                  ad={ad}
                  rank={(page - 1) * PAGE_SIZE + i + 1}
                  accountId={accountId}
                  review={reviews[ad.id] || null}
                  batchReviewInProgress={reviewLoading}
                  onOpenReviewModal={(previewHtml) => { setReviewModal(ad.id); setReviewModalPreview(previewHtml || null); }}
                  onReviewDone={(result, usage) => {
                    if (result) setReviews((prev) => ({ ...prev, [ad.id]: result }));
                    if (usage) setReviewUsage(usage);
                  }}
                  onReviewError={(msg) => setReviewError(msg)}
                />
              ))}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-3 mt-8 pb-4">
                <button
                  onClick={() => { setPage((p) => Math.max(1, p - 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  disabled={page === 1}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  ← Prev
                </button>
                <span className="text-sm text-gray-500">
                  Page {page} of {totalPages} · <span className="text-gray-700 font-medium">{filtered.length} creatives</span>
                </span>
                <button
                  onClick={() => { setPage((p) => Math.min(totalPages, p + 1)); window.scrollTo({ top: 0, behavior: "smooth" }); }}
                  disabled={page === totalPages}
                  className="text-sm font-semibold px-4 py-2 rounded-lg border border-gray-200 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </div>
      {reviewModal && reviews[reviewModal] && filtered.some((a) => a.id === reviewModal) && (
        <ReviewModal
          adId={reviewModal}
          ads={filtered}
          review={reviews[reviewModal]}
          previewHtml={reviewModalPreview}
          onClose={() => { setReviewModal(null); setReviewModalPreview(null); }}
        />
      )}
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

function LazyCreativeCard({ ad, rank, accountId, review, batchReviewInProgress, onOpenReviewModal, onReviewDone, onReviewError }) {
  const ins = ad.insights || {};
  const statusOk = ad.effective_status === "ACTIVE" || ad.status === "ACTIVE";
  const [activeFormat, setActiveFormat] = useState(PLACEMENT_FORMATS[0].key);
  const [previews, setPreviews] = useState({});
  const [visible, setVisible] = useState(false);
  const cardRef = useRef(null);
  const [singleReviewLoading, setSingleReviewLoading] = useState(false);
  // Tracks in-flight preview fetches synchronously so React StrictMode double-invocation
  // and rapid re-renders can't kick off duplicate requests for the same format.
  const fetchingFormats = useRef(new Set());

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

  // Fetch preview only once per format, guarded by both state and a ref
  useEffect(() => {
    if (!visible || previews[activeFormat] || fetchingFormats.current.has(activeFormat)) return;
    const cacheKey = `preview:${ad.id}:${activeFormat}`;
    const cached = clientCache.get(cacheKey);
    if (cached) { setPreviews((p) => ({ ...p, [activeFormat]: cached })); return; }
    fetchingFormats.current.add(activeFormat);
    let cancelled = false;
    setPreviews((p) => ({ ...p, [activeFormat]: { loading: true } }));
    fetch(`/api/meta-ads/ad/${ad.id}/preview?format=${activeFormat}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        const result = { html: j.html || null, unsupported: !!j.unsupported, error: j.error || null, loading: false };
        clientCache.set(cacheKey, result, 15 * 60 * 1000);
        setPreviews((p) => ({ ...p, [activeFormat]: result }));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { loading: false, error: err.message } }));
      })
      .finally(() => { fetchingFormats.current.delete(activeFormat); });
    return () => { cancelled = true; fetchingFormats.current.delete(activeFormat); };
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
            previewHtml: previews[activeFormat]?.html || null,
            metrics: ad.insights || {},
          }],
          mode: 'single',
          accountId,
        }),
      });
      const json = await res.json();
      if (res.status === 429 || json.limitReached) {
        if (onReviewError) onReviewError(json.error || 'Daily review limit reached.');
        if (json.usage) onReviewDone(null, json.usage);
        return;
      }
      if (!res.ok) {
        if (onReviewError) onReviewError(json.error || `Error ${res.status}`);
        return;
      }
      if (json.reviews?.length) {
        const result = json.reviews[0];
        const extracted = extractAdImageFromHtml(previews[activeFormat]?.html);
        if (extracted) result.previewImageUrl = extracted;
        onReviewDone(result, json.usage);
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
            onClick={review ? () => onOpenReviewModal(previews[activeFormat]?.html || null) : reviewSingle}
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
        `}
        </style>
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
        <ReviewFooterStrip review={review} onClick={() => onOpenReviewModal(previews[activeFormat]?.html || null)} />
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

function ScoreBar({ label, score, max = 25 }) {
  const pct = Math.round((score / max) * 100);
  const color = pct >= 80 ? "#16a34a" : pct >= 60 ? "#d97706" : "#dc2626";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ width: 50, fontSize: 12, fontWeight: 600, color: "#64748b" }}>{label}</span>
      <div style={{ flex: 1, height: 8, background: "#e2e8f0", borderRadius: 99 }}>
        <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 99, transition: "width .4s" }} />
      </div>
      <span style={{ width: 36, fontSize: 12, fontWeight: 700, color, textAlign: "right" }}>{score}/{max}</span>
    </div>
  );
}

function ReviewSection({ title, children }) {
  return (
    <div>
      <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 8 }}>{title}</p>
      {children}
    </div>
  );
}

function TagList({ label, items, color }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <span style={{ fontSize: 11, fontWeight: 700, color, textTransform: "uppercase", letterSpacing: 0.5 }}>{label}: </span>
      {items.map((item, i) => (
        <span key={i} style={{ fontSize: 12, color: "#475569", marginRight: 6 }}>{item}{i < items.length - 1 ? " ·" : ""}</span>
      ))}
    </div>
  );
}

function Rec({ text }) {
  return (
    <p style={{ fontSize: 12, color: "#475569", fontStyle: "italic", marginTop: 4 }}>→ {text}</p>
  );
}

function extractAdImageFromHtml(html) {
  if (!html) return null;
  // Prefer the main ad image (data-ad-preview="image" tag)
  const previewImg = html.match(/data-ad-preview="image"[^>]*src="([^"]+)"/);
  if (previewImg) return previewImg[1].replace(/&amp;/g, '&');
  // Fallback: largest scontent image (Meta CDN)
  const allSrc = [...html.matchAll(/src="(https:\/\/scontent[^"]+\.(?:jpg|png|jpeg)[^"]*)"/g)];
  if (allSrc.length) return allSrc[allSrc.length - 1][1].replace(/&amp;/g, '&');
  return null;
}

function ReviewModal({ adId, ads, review, previewHtml, onClose }) {
  const ad = (ads || []).find((a) => a.id === adId);

  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  if (!review) return null;

  const verdictColors = VERDICT_COLORS[review.status] || VERDICT_COLORS.REVISE;
  const imageUrl = review.previewImageUrl || ad?.creative?.image_url || null;

  return (
    <div
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      style={{
        position: "fixed", inset: 0, zIndex: 9999,
        background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "flex-start", justifyContent: "center",
        overflowY: "auto", padding: "40px 16px",
      }}
    >
      <div
        style={{
          background: "#fff", borderRadius: 16, width: "100%", maxWidth: 700,
          boxShadow: "0 25px 60px rgba(0,0,0,0.25)", overflow: "hidden",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ padding: "24px 28px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, marginBottom: 4 }}>Ad Review</p>
              <p style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", lineHeight: 1.3 }}>{ad?.name || adId}</p>
            </div>
            <button
              onClick={onClose}
              style={{ background: "none", border: "none", fontSize: 22, color: "#94a3b8", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14 }}>
            <span style={{
              fontSize: 11, fontWeight: 800, letterSpacing: 1, color: verdictColors.text,
              background: verdictColors.bg, border: `1px solid ${verdictColors.border}`,
              borderRadius: 6, padding: "3px 10px",
            }}>
              {review.status}
            </span>
            <span style={{ fontSize: 24, fontWeight: 900, color: verdictColors.text }}>{review.overallScore}<span style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8" }}>/100</span></span>
            <span style={{ fontSize: 13, color: "#64748b", flex: 1 }}>{review.summary}</span>
          </div>
        </div>

        <div style={{ padding: "24px 28px", display: "flex", flexDirection: "column", gap: 24 }}>
          {(previewHtml || imageUrl) && (
            <div style={{ background: "#f1f5f9", borderRadius: 12, padding: "20px", display: "flex", justifyContent: "center" }}>
              {previewHtml ? (
                <div dangerouslySetInnerHTML={{ __html: previewHtml }} style={{ display: "flex", justifyContent: "center", width: "100%" }} />
              ) : (
                <img src={imageUrl} alt="" style={{ maxWidth: "100%", maxHeight: 480, borderRadius: 8 }} />
              )}
            </div>
          )}

          {/* Score grid */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <p style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", marginBottom: 4 }}>Scores</p>
            <ScoreBar label="Hook"   score={review.scores?.hook  ?? 0} />
            <ScoreBar label="Proof"  score={review.scores?.proof ?? 0} />
            <ScoreBar label="CTA"    score={review.scores?.cta   ?? 0} />
            <ScoreBar label="Visual" score={review.scores?.visual ?? 0} />
          </div>

          {review.hook && (
            <ReviewSection title="Hook">
              {review.hook.strengths?.length > 0 && <TagList label="Strengths" items={review.hook.strengths} color="#16a34a" />}
              {review.hook.issues?.length > 0 && <TagList label="Issues" items={review.hook.issues} color="#dc2626" />}
              {review.hook.recommendation && <Rec text={review.hook.recommendation} />}
            </ReviewSection>
          )}

          {review.proof && (
            <ReviewSection title="Proof">
              {review.proof.elements?.length > 0 && <TagList label="Present" items={review.proof.elements} color="#16a34a" />}
              {review.proof.missing?.length > 0 && <TagList label="Missing" items={review.proof.missing} color="#d97706" />}
              {review.proof.recommendation && <Rec text={review.proof.recommendation} />}
            </ReviewSection>
          )}

          {review.cta && (
            <ReviewSection title="CTA">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                {[["Placement", review.cta.placement], ["Clarity", review.cta.clarity], ["Urgency", review.cta.urgency]].map(([k, v]) => v && (
                  <span key={k} style={{ fontSize: 12, color: "#475569" }}><b>{k}:</b> {v}</span>
                ))}
              </div>
              {review.cta.recommendation && <Rec text={review.cta.recommendation} />}
            </ReviewSection>
          )}

          {review.visual && (
            <ReviewSection title="Visual / Authenticity">
              <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 6 }}>
                {review.visual.productionQuality && <span style={{ fontSize: 12, color: "#475569" }}><b>Quality:</b> {review.visual.productionQuality}</span>}
                {review.visual.authenticity && <span style={{ fontSize: 12, color: "#475569" }}><b>Authenticity:</b> {review.visual.authenticity}</span>}
              </div>
              {review.visual.issues?.length > 0 && <TagList label="Issues" items={review.visual.issues} color="#dc2626" />}
            </ReviewSection>
          )}

          {review.platformFit?.length > 0 && (
            <ReviewSection title="Platform Fit">
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {review.platformFit.map((p) => (
                  <span key={p} style={{ fontSize: 11, fontWeight: 600, background: "#eff6ff", color: "#1d4ed8", borderRadius: 6, padding: "3px 10px" }}>{p}</span>
                ))}
              </div>
            </ReviewSection>
          )}

          {review.actionItems && (
            <ReviewSection title="Action Items">
              {review.actionItems.required?.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#dc2626", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Required</p>
                  {review.actionItems.required.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
                      <span style={{ color: "#dc2626", fontSize: 14, lineHeight: 1.2 }}>•</span>
                      <span style={{ fontSize: 13, color: "#1e293b" }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
              {review.actionItems.recommended?.length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 700, color: "#d97706", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 4 }}>Recommended</p>
                  {review.actionItems.recommended.map((item, i) => (
                    <div key={i} style={{ display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 3 }}>
                      <span style={{ color: "#d97706", fontSize: 14, lineHeight: 1.2 }}>•</span>
                      <span style={{ fontSize: 13, color: "#1e293b" }}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </ReviewSection>
          )}

          {review.prediction && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", background: "#f8fafc", borderRadius: 10 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>Prediction:</span>
              <span style={{
                fontSize: 13, fontWeight: 800,
                color: review.prediction === "High potential" ? "#16a34a" : review.prediction === "Medium" ? "#d97706" : "#dc2626",
              }}>
                {review.prediction}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewSpinner() {
  return (
    <div className="flex flex-col items-center gap-2" style={{ padding: "60px 0" }}>
      <div style={{ width: 26, height: 26, border: `3px solid rgba(24,119,242,0.2)`, borderTopColor: ACCENT, borderRadius: "50%", animation: "ccSpin 0.8s linear infinite" }} />
      <p className="text-xs text-gray-500">Loading preview…</p>
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
