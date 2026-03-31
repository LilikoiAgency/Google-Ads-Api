"use client";

import { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── formatters ────────────────────────────────────────────────────────────────

function fmtD(n)  { if (n == null || n === 0) return "$0"; return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`; }
function fmt(n)   { if (n == null) return "—"; return Number(n).toLocaleString(); }
function fmtDate(d) {
  if (!d) return "—";
  return new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
function fmtWeek(start, end) {
  if (!start) return "—";
  const s = new Date(start + "T00:00:00Z");
  const e = new Date(end   + "T00:00:00Z");
  const opts = { month: "short", day: "numeric", timeZone: "UTC" };
  return `${s.toLocaleDateString("en-US", opts)} – ${e.toLocaleDateString("en-US", { ...opts, year: "numeric" })}`;
}

// ── KPI card ──────────────────────────────────────────────────────────────────

function KpiCard({ label, value, sub, color, icon }) {
  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xl">{icon}</span>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-3xl font-bold" style={{ color }}>{value}</p>
      {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
  );
}

// ── platform pill ─────────────────────────────────────────────────────────────

const PLATFORM_STYLES = {
  google: { label: "Google Ads",   bg: "bg-blue-100",   text: "text-blue-700"   },
  bing:   { label: "Microsoft Ads", bg: "bg-sky-100",    text: "text-sky-700"    },
  meta:   { label: "Meta Ads",     bg: "bg-indigo-100", text: "text-indigo-700" },
};

function PlatformPill({ platform }) {
  const s = PLATFORM_STYLES[platform] || { label: platform, bg: "bg-gray-100", text: "text-gray-600" };
  return <span className={`rounded-full px-3 py-1 text-xs font-semibold ${s.bg} ${s.text}`}>{s.label}</span>;
}

// ── state map (abbreviation for chart labels) ─────────────────────────────────

const STATE_NAMES = {
  AL:"Alabama", AK:"Alaska", AZ:"Arizona", AR:"Arkansas", CA:"California",
  CO:"Colorado", CT:"Connecticut", DE:"Delaware", FL:"Florida", GA:"Georgia",
  HI:"Hawaii", ID:"Idaho", IL:"Illinois", IN:"Indiana", IA:"Iowa",
  KS:"Kansas", KY:"Kentucky", LA:"Louisiana", ME:"Maine", MD:"Maryland",
  MA:"Massachusetts", MI:"Michigan", MN:"Minnesota", MS:"Mississippi", MO:"Missouri",
  MT:"Montana", NE:"Nebraska", NV:"Nevada", NH:"New Hampshire", NJ:"New Jersey",
  NM:"New Mexico", NY:"New York", NC:"North Carolina", ND:"North Dakota", OH:"Ohio",
  OK:"Oklahoma", OR:"Oregon", PA:"Pennsylvania", RI:"Rhode Island", SC:"South Carolina",
  SD:"South Dakota", TN:"Tennessee", TX:"Texas", UT:"Utah", VT:"Vermont",
  VA:"Virginia", WA:"Washington", WV:"West Virginia", WI:"Wisconsin", WY:"Wyoming",
};

// ── inner portal (needs Suspense because of useSearchParams) ──────────────────

function ClientPortalInner() {
  const params       = useParams();
  const searchParams = useSearchParams();
  const slug         = params.slug;
  const token        = searchParams.get("token");

  const [error, setError]   = useState(null);
  const [client, setClient] = useState(null); // from validate

  // Global period — controls both performance and audience
  const [period, setPeriod] = useState("week"); // "week" | "mtd"

  // Performance data
  const [perfData,    setPerfData]    = useState(null);
  const [perfLoading, setPerfLoading] = useState(true);

  // Channel filter
  const [selectedChannel, setSelectedChannel] = useState(""); // "" = all, or "google"/"bing"/"meta"

  // Audience data
  const [audience,         setAudience]         = useState(null);
  const [audLoading,       setAudLoading]        = useState(true);
  const [audError,         setAudError]          = useState(null);
  const [audPage,          setAudPage]           = useState(1);
  const [showDetails,      setShowDetails]       = useState(false);
  const [selectedSegment,  setSelectedSegment]   = useState(""); // "" = all

  // ── load performance ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!slug || !token) { setError("Invalid link."); return; }
    const CACHE_KEY = `portal_perf_${slug}_v2`;
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    try {
      const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      if (cached && Date.now() - cached.ts < CACHE_TTL) {
        setPerfData(cached.data);
        setPerfLoading(false);
        return;
      }
    } catch (_) {}
    setPerfLoading(true);
    fetch(`/api/portal/${slug}/performance?token=${token}&weeks=12`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setError(d.error); return; }
        setPerfData(d);
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d })); } catch (_) {}
      })
      .catch(() => setError("Failed to load data."))
      .finally(() => setPerfLoading(false));
  }, [slug, token]);

  // ── load audience ─────────────────────────────────────────────────────────
  const loadAudience = (page = 1, p = period, seg = selectedSegment) => {
    if (!slug || !token) return;
    const CACHE_KEY = `portal_aud_${slug}_${p}_${seg}_p${page}_v2`;
    const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
    if (page === 1) {
      try {
        const cached = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
        if (cached && Date.now() - cached.ts < CACHE_TTL) {
          setAudience(cached.data);
          setAudPage(1);
          setAudLoading(false);
          return;
        }
      } catch (_) {}
    }
    setAudLoading(true);
    setAudError(null);
    const segParam = seg ? `&segment=${encodeURIComponent(seg)}` : "";
    fetch(`/api/portal/${slug}/audience?token=${token}&page=${page}&period=${p}${segParam}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) { setAudError(d.error); return; }
        setAudience(d);
        setAudPage(page);
        if (page === 1) {
          try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), data: d })); } catch (_) {}
        }
      })
      .catch(() => setAudError("Failed to load audience data."))
      .finally(() => setAudLoading(false));
  };

  useEffect(() => { if (!error) loadAudience(1, period, selectedSegment); }, [slug, token, error, period, selectedSegment]);

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <p className="text-4xl mb-4">🔒</p>
        <p className="text-lg font-semibold text-gray-700 mb-1">Access Denied</p>
        <p className="text-sm text-gray-400">{error}</p>
      </div>
    </div>
  );

  const weekly    = perfData?.weekly || [];
  const platforms = perfData?.connectedPlatforms || {};
  const activePlats = Object.entries(platforms).filter(([, v]) => v).map(([k]) => k);

  // Aggregate performance data for the selected period (all-channel totals)
  const currentWeek = (() => {
    if (!weekly.length) return null;
    if (period === "week") return weekly[weekly.length - 1];
    // MTD: sum all weeks whose Monday falls in the current month
    const monthPrefix = new Date().toISOString().slice(0, 7); // "YYYY-MM"
    const mtdWeeks = weekly.filter((w) => (w.weekStart || "").startsWith(monthPrefix));
    if (!mtdWeeks.length) return weekly[weekly.length - 1]; // fallback
    const spend       = parseFloat(mtdWeeks.reduce((s, w) => s + w.spend, 0).toFixed(2));
    const conversions = mtdWeeks.reduce((s, w) => s + w.conversions, 0);
    const byPlatform  = ["google", "bing", "meta"].reduce((acc, p) => {
      acc[p] = {
        spend:       parseFloat(mtdWeeks.reduce((s, w) => s + (w.byPlatform?.[p]?.spend || 0), 0).toFixed(2)),
        conversions: mtdWeeks.reduce((s, w) => s + (w.byPlatform?.[p]?.conversions || 0), 0),
      };
      return acc;
    }, {});
    return { spend, conversions, byPlatform, cpl: conversions > 0 ? parseFloat((spend / conversions).toFixed(2)) : null };
  })();

  // KPI values — filtered to selectedChannel when one is active
  const displayWeek = (() => {
    if (!currentWeek) return null;
    if (!selectedChannel) return currentWeek;
    const pd = currentWeek.byPlatform?.[selectedChannel];
    if (!pd) return currentWeek;
    return {
      spend:       pd.spend,
      conversions: pd.conversions,
      cpl:         pd.conversions > 0 ? parseFloat((pd.spend / pd.conversions).toFixed(2)) : null,
      byPlatform:  currentWeek.byPlatform,
    };
  })();

  // Chart data — MTD uses day-by-day daily array, weekly view uses last 8 weeks
  const chartDisplayData = (() => {
    const monthPrefix = new Date().toISOString().slice(0, 7);
    if (period === "mtd") {
      const allDaily = perfData?.daily || [];
      const inMonth  = allDaily.filter((d) => (d.date || "").startsWith(monthPrefix));
      const src      = inMonth.length ? inMonth : allDaily.slice(-30);
      return src.map((d) => ({
        ...d,
        weekStart:   d.date,  // reuse XAxis dataKey
        spend:       selectedChannel ? (d.byPlatform?.[selectedChannel]?.spend || 0) : d.spend,
        conversions: selectedChannel ? (d.byPlatform?.[selectedChannel]?.conversions || 0) : d.conversions,
      }));
    }
    // weekly — last 8 weeks, filtered to channel
    const src = weekly.slice(-8);
    return src.map((w) => ({
      ...w,
      spend:       selectedChannel ? (w.byPlatform?.[selectedChannel]?.spend || 0) : w.spend,
      conversions: selectedChannel ? (w.byPlatform?.[selectedChannel]?.conversions || 0) : w.conversions,
    }));
  })();

  return (
    <div className="min-h-screen bg-gray-50">

      {/* ── Header ── */}
      <header className="bg-white border-b border-gray-100 shadow-sm px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center justify-between gap-4">
          {/* Co-branded logos */}
          <div className="flex items-center gap-4">
            <img
              src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
              alt="Lilikoi Agency"
              className="h-8 w-8 rounded-full object-contain"
              onError={(e) => { e.target.style.display = "none"; }}
            />
            {perfData && (
              <>
                <span className="text-gray-300 text-xl font-thin select-none">|</span>
                {perfData.clientLogo ? (
                  <img src={perfData.clientLogo} alt={perfData.clientName} className="h-8 max-w-[120px] object-contain" />
                ) : (
                  <span className="text-sm font-bold text-gray-800">
                    {perfData.clientName || slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                )}
              </>
            )}
          </div>

          {/* Platform pills */}
          <div className="hidden sm:flex items-center gap-2">
            {activePlats.map((p) => <PlatformPill key={p} platform={p} />)}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">

        {/* ── Page Header + Period Toggle ── */}
        <div className="flex items-center justify-between mb-6 flex-wrap gap-4">
          <div>
            <p className="text-2xl font-bold text-gray-900">Performance Report</p>
            <p className="text-sm text-gray-400 mt-0.5">Market Domination · Overview</p>
            <p className="text-xs text-gray-400 mt-1">
              {(() => {
                const now = new Date();
                if (period === "week") {
                  const day  = now.getUTCDay();
                  const mon  = new Date(now);
                  mon.setUTCDate(now.getUTCDate() + (day === 0 ? -6 : 1 - day));
                  const sun  = new Date(mon);
                  sun.setUTCDate(mon.getUTCDate() + 6);
                  return fmtWeek(mon.toISOString().slice(0, 10), sun.toISOString().slice(0, 10));
                }
                // MTD
                const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
                return `${monthStart.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })} · through today`;
              })()}
            </p>
          </div>
          <div className="flex rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden text-sm font-semibold">
            {[
              { key: "week", label: "This Week" },
              { key: "mtd",  label: "Month to Date" },
            ].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => { setPeriod(key); setAudience(null); setSelectedSegment(""); setSelectedChannel(""); }}
                className={`px-5 py-2.5 transition ${period === key ? "bg-purple-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* ── KPI Cards ── */}
        {perfLoading ? (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[...Array(3)].map((_, i) => <div key={i} className="h-28 rounded-2xl bg-white border border-gray-100 animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <KpiCard label="Total Spend"   value={fmtD(displayWeek?.spend)}       color="#6d28d9" icon="💰" sub={selectedChannel ? `${PLATFORM_STYLES[selectedChannel]?.label || selectedChannel} only` : "Combined across all platforms"} />
            <KpiCard label="Conversions"   value={fmt(displayWeek?.conversions)}   color="#059669" icon="✅" sub="Leads, purchases & sign-ups" />
            <KpiCard label="Cost Per Lead" value={displayWeek?.cpl ? fmtD(displayWeek.cpl) : "—"} color="#d97706" icon="🎯" sub="Average cost per conversion" />
          </div>
        )}

        {/* ── Channel Breakdown ── */}
        {!perfLoading && currentWeek?.byPlatform && activePlats.length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 mb-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Spend by Channel</p>
              <div className="flex items-center gap-2 text-xs text-gray-400">
                {selectedChannel && (
                  <button
                    onClick={() => setSelectedChannel("")}
                    className="rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 font-semibold px-3 py-1 transition"
                  >
                    ✕ All Channels
                  </button>
                )}
                <span className="text-gray-300 hidden sm:inline">Click a channel to filter</span>
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              {activePlats.map((p) => {
                const pd = currentWeek.byPlatform[p];
                if (!pd || pd.spend === 0) return null;
                const pct       = currentWeek.spend > 0 ? Math.round((pd.spend / currentWeek.spend) * 100) : 0;
                const styles    = PLATFORM_STYLES[p] || { label: p, bg: "bg-gray-100", text: "text-gray-600" };
                const barColors = { google: "#4285F4", bing: "#00809D", meta: "#1877F2" };
                const isActive  = selectedChannel === p;
                const isDimmed  = selectedChannel && !isActive;
                return (
                  <button
                    key={p}
                    onClick={() => setSelectedChannel(isActive ? "" : p)}
                    className={`flex-1 min-w-[140px] text-left rounded-xl p-2 -m-2 transition cursor-pointer
                      ${isActive ? "ring-2 ring-purple-500 bg-purple-50" : "hover:bg-gray-50"}
                      ${isDimmed ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className={`text-xs font-semibold ${styles.text}`}>{styles.label}</span>
                      <span className="text-xs font-bold text-gray-700">{fmtD(pd.spend)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-2 mb-1">
                      <div className="h-2 rounded-full transition-all" style={{ width: `${pct}%`, background: barColors[p] || "#6d28d9" }} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-gray-400">{pct}% of total</span>
                      {pd.conversions > 0 && <span className="text-xs text-gray-400">{fmt(pd.conversions)} conv.</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Trend Chart ── */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <p className="text-sm font-bold text-gray-800">
              {period === "week"
                ? `8-Week Performance Trend${selectedChannel ? ` · ${PLATFORM_STYLES[selectedChannel]?.label || selectedChannel}` : ""}`
                : `Month to Date · Daily${selectedChannel ? ` · ${PLATFORM_STYLES[selectedChannel]?.label || selectedChannel}` : ""}`}
            </p>
            {period === "mtd" && !perfData?.daily?.length && !perfLoading && (
              <span className="text-xs text-gray-400">Daily data loading…</span>
            )}
          </div>
          {perfLoading ? (
            <div className="h-52 bg-gray-50 rounded-xl animate-pulse" />
          ) : chartDisplayData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={chartDisplayData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="weekStart"
                  tick={{ fontSize: 10 }}
                  tickFormatter={(v) => new Date(v + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}
                  interval={period === "mtd" ? Math.floor(chartDisplayData.length / 6) : 0}
                />
                <YAxis yAxisId="spend" tick={{ fontSize: 10 }} tickFormatter={(v) => `$${v}`} />
                <YAxis yAxisId="conv"  tick={{ fontSize: 10 }} orientation="right" />
                <Tooltip
                  contentStyle={{ fontSize: 12 }}
                  formatter={(v, name) => [name === "spend" ? fmtD(v) : fmt(v), name === "spend" ? "Spend" : "Conversions"]}
                  labelFormatter={(v) => {
                    if (period === "mtd") return fmtDate(v);
                    const w = chartDisplayData.find((d) => d.weekStart === v);
                    return w?.weekEnd ? fmtWeek(v, w.weekEnd) : fmtDate(v);
                  }}
                />
                <Legend formatter={(v) => v === "spend" ? "Spend" : "Conversions"} />
                <Bar yAxisId="spend" dataKey="spend"       fill="#6d28d9" radius={[4, 4, 0, 0]} opacity={0.85} />
                <Bar yAxisId="conv"  dataKey="conversions" fill="#059669" radius={[4, 4, 0, 0]} opacity={0.85} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">No performance data for this period.</div>
          )}
        </div>

        {/* ── Audience Lab Section ── */}
        <div className="rounded-2xl bg-white border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 bg-gradient-to-r from-purple-50 to-white">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <p className="text-sm font-bold text-gray-900">🎯 Your Targeted Audience</p>
                <p className="text-xs text-gray-500 mt-0.5">People actively targeted in your Market Domination campaign</p>
              </div>
              <div className="flex items-center gap-3">
                {audience?.lastUpdated && (
                  <p className="text-xs text-gray-400">
                    Last sync: <span className="font-semibold text-gray-600">{fmtDate(audience.lastUpdated.slice(0, 10))}</span>
                  </p>
                )}
                {audLoading && (
                  <div className="text-xs text-gray-400 animate-pulse">Loading…</div>
                )}
              </div>
            </div>
          </div>

          {/* Summary */}
          <div className="px-5 py-5">
            {audLoading && !audience ? (
              <div className="space-y-3">
                {[...Array(3)].map((_, i) => <div key={i} className="h-8 rounded-xl bg-gray-100 animate-pulse" />)}
              </div>
            ) : audError ? (
              <div className="text-center py-6">
                <p className="text-sm font-medium text-red-500 mb-1">⚠️ Could not load audience data</p>
                <p className="text-xs text-gray-400">{audError}</p>
                <button onClick={() => loadAudience(1)} className="mt-3 text-xs font-semibold text-purple-600 hover:text-purple-800 transition">Try again</button>
              </div>
            ) : audience ? (
              <>
                {/* Segment filter */}
                {audience.availableSegments?.length > 1 && (
                  <div className="flex flex-wrap gap-2 mb-4">
                    <button
                      onClick={() => setSelectedSegment("")}
                      className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selectedSegment === "" ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                    >
                      All Segments
                    </button>
                    {audience.availableSegments.map((s) => (
                      <button
                        key={s.key}
                        onClick={() => setSelectedSegment(s.key)}
                        className={`rounded-full px-3 py-1.5 text-xs font-semibold transition ${selectedSegment === s.key ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}
                      >
                        {s.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Big count */}
                <div className="flex items-baseline gap-3 mb-5">
                  <p className="text-5xl font-black text-purple-700">{fmt(audience.total)}</p>
                  <p className="text-sm text-gray-500 font-medium">
                    {selectedSegment
                      ? `people in ${audience.availableSegments?.find((s) => s.key === selectedSegment)?.name || "this segment"}`
                      : period === "week" ? "people targeted this week" : "people targeted this month"}
                  </p>
                </div>

                {/* State breakdown */}
                {audience.byState?.length > 0 && (
                  <div className="mb-5">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">By State</p>
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
                      {audience.byState.slice(0, 12).map((s) => {
                        const pct = audience.total > 0 ? Math.round((s.count / audience.total) * 100) : 0;
                        return (
                          <div key={s.state} className="rounded-xl bg-gray-50 px-3 py-2">
                            <div className="flex items-center justify-between mb-1">
                              <p className="text-xs font-semibold text-gray-700">{STATE_NAMES[s.state] || s.state}</p>
                              <p className="text-xs font-bold text-purple-600">{pct}%</p>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="text-xs text-gray-400 mt-1">{fmt(s.count)} people</p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* View details toggle */}
                <button
                  onClick={() => { setShowDetails((v) => !v); if (!showDetails) loadAudience(1); }}
                  className="flex items-center gap-2 text-sm font-semibold text-purple-600 hover:text-purple-800 transition"
                >
                  {showDetails ? "▲ Hide details" : "▼ View individual records"}
                </button>

                {/* Detail table */}
                {showDetails && (
                  <div className="mt-4">
                    <div className="rounded-xl border border-gray-100 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Name</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">City</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">State</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">ZIP</th>
                            <th className="px-4 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Segment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {audLoading ? (
                            [...Array(5)].map((_, i) => (
                              <tr key={i}><td colSpan={5} className="px-4 py-3"><div className="h-4 bg-gray-100 rounded animate-pulse" /></td></tr>
                            ))
                          ) : audience.records?.length === 0 ? (
                            <tr><td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">No records found.</td></tr>
                          ) : audience.records?.map((r, i) => (
                            <tr key={i} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                              <td className="px-4 py-2.5 font-medium text-gray-800">{r.name || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600">{r.city || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600">{r.state || "—"}</td>
                              <td className="px-4 py-2.5 text-gray-600 font-mono text-xs">{r.zip || "—"}</td>
                              <td className="px-4 py-2.5">
                                <span className="rounded-full bg-purple-100 text-purple-700 text-xs font-semibold px-2 py-0.5">{r.segment}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {/* Pagination */}
                    {audience.totalPages > 1 && (
                      <div className="flex items-center justify-between mt-3">
                        <p className="text-xs text-gray-400">Page {audPage} of {audience.totalPages} · {fmt(audience.total)} total records</p>
                        <div className="flex gap-2">
                          <button onClick={() => loadAudience(audPage - 1)} disabled={audPage <= 1}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">← Prev</button>
                          <button onClick={() => loadAudience(audPage + 1)} disabled={audPage >= audience.totalPages}
                            className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 transition">Next →</button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-6">
                <p className="text-2xl mb-2">🎯</p>
                <p className="text-sm font-medium text-gray-500">No audience data yet</p>
                <p className="text-xs text-gray-400 mt-1">Audience segments will appear here once your Market Domination campaign is set up.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center">
          <p className="text-xs text-gray-400">
            Powered by <span className="font-semibold">Lilikoi Agency</span> · Data refreshes every Monday
          </p>
        </div>

      </div>
    </div>
  );
}

export default function ClientPortal() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <div className="text-gray-400 text-sm">Loading…</div>
      </div>
    }>
      <ClientPortalInner />
    </Suspense>
  );
}
