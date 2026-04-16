"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../../components/DashboardToolHeader";
import DashboardLoader from "../../components/DashboardLoader";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer,
} from "recharts";
import "../../../globals.css";

// ─── date helpers ─────────────────────────────────────────────────────────────

function toYMD(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function calcRange(preset, custom) {
  const today = new Date();
  switch (preset) {
    case "7d":   { const s = new Date(today); s.setDate(today.getDate() - 7);   return { startDate: toYMD(s), endDate: toYMD(today) }; }
    case "28d":  { const s = new Date(today); s.setDate(today.getDate() - 28);  return { startDate: toYMD(s), endDate: toYMD(today) }; }
    case "3m":   { const s = new Date(today); s.setMonth(today.getMonth() - 3); return { startDate: toYMD(s), endDate: toYMD(today) }; }
    case "6m":   { const s = new Date(today); s.setMonth(today.getMonth() - 6); return { startDate: toYMD(s), endDate: toYMD(today) }; }
    case "custom": return custom.startDate && custom.endDate ? custom : null;
    default:     return null;
  }
}

const PRESETS = [
  { value: "7d",  label: "7 days" },
  { value: "28d", label: "28 days" },
  { value: "3m",  label: "3 months" },
  { value: "6m",  label: "6 months" },
  { value: "custom", label: "Custom" },
];

// ─── formatters ───────────────────────────────────────────────────────────────

function fmtN(n)   { return n == null ? "—" : Number(n).toLocaleString("en-US"); }
function fmtPct(n) { return n == null ? "—" : `${n}%`; }

// ─── site picker ──────────────────────────────────────────────────────────────

function SitePicker({ sites, selectedSite, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const domain  = (url) => url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const favicon = (url) => `https://www.google.com/s2/favicons?domain=${domain(url)}&sz=32`;
  const current = sites.find((s) => s.url === selectedSite);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[220px]"
      >
        {current && (
          <img src={favicon(current.url)} alt="" className="w-4 h-4 rounded-sm flex-shrink-0"
            onError={(e) => { e.target.style.display = "none"; }} />
        )}
        <span className="flex-1 text-left truncate">{current ? domain(current.url) : "Select property"}</span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[260px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          {sites.map((s) => (
            <button
              key={s.url}
              onClick={() => { onChange(s.url); setOpen(false); }}
              className={`flex items-center gap-3 w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
                s.url === selectedSite ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-700"
              }`}
            >
              <img src={favicon(s.url)} alt="" className="w-5 h-5 rounded-sm flex-shrink-0"
                onError={(e) => { e.target.style.display = "none"; }} />
              <span className="truncate">{domain(s.url)}</span>
              {s.url === selectedSite && (
                <svg className="ml-auto w-4 h-4 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, color, loading }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100" style={{ borderTop: `3px solid ${color}` }}>
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-1">{label}</p>
      {loading
        ? <div className="h-8 w-24 rounded-lg bg-gray-100 animate-pulse mt-1" />
        : <p className="text-2xl font-bold text-gray-900">{value}</p>
      }
    </div>
  );
}

// ─── sortable table ───────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <span className="ml-1 opacity-30 text-gray-500">↕</span>;
  return <span className="ml-1 text-purple-600">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

function DataTable({ rows, columns, sortCol, sortDir, onSort, search, setSearch, emptyMsg }) {
  const [page, setPage] = useState(1);
  const PAGE = 25;

  useEffect(() => setPage(1), [rows, search]);

  const filtered = rows.filter((r) => {
    const first = Object.values(r)[0];
    return String(first).toLowerCase().includes(search.toLowerCase());
  });
  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortCol]; const vb = b[sortCol];
    return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE));
  const pageRows = sorted.slice((page - 1) * PAGE, page * PAGE);

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-400">{fmtN(filtered.length)} results</p>
        <input
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-700 w-52 focus:outline-none focus:border-purple-400"
        />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => onSort(col.key)}
                  className={`px-5 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 cursor-pointer select-none hover:text-gray-800 ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.label}<SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <tr><td colSpan={columns.length} className="px-5 py-10 text-center text-gray-400 text-sm">{emptyMsg || "No data."}</td></tr>
            ) : pageRows.map((row, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                {columns.map((col) => (
                  <td key={col.key} className={`px-5 py-3 text-gray-700 ${col.align === "right" ? "text-right tabular-nums" : "max-w-xs truncate font-medium text-gray-800"}`}>
                    {col.render ? col.render(row[col.key], row) : row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
          <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Previous</button>
            <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-40">Next</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── position badge ───────────────────────────────────────────────────────────

function PosBadge({ pos }) {
  const p = parseFloat(pos);
  const color = p <= 3 ? "#22c55e" : p <= 10 ? "#f59e0b" : "#ef4444";
  return (
    <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: color + "18", color }}>
      {pos}
    </span>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function OrganicPage() {
  const router = useRouter();
  const { status } = useSession();

  // GSC connection
  const [sites, setSites] = useState([]);
  const [gscConnected, setGscConnected] = useState(null);
  const [selectedSite, setSelectedSite] = useState("");

  // Date range
  const [preset, setPreset] = useState("28d");
  const [custom, setCustom] = useState({ startDate: "", endDate: "" });
  const [customError, setCustomError] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  // Data
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Tabs + table state
  const [activeTab, setActiveTab] = useState("queries");
  const [sortCol, setSortCol] = useState("clicks");
  const [sortDir, setSortDir] = useState("desc");
  const [search, setSearch] = useState("");

  // ── auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/google/organic");
  }, [status, router]);

  // ── load GSC sites + check sessionStorage ─────────────────────────────────
  useEffect(() => {
    if (status !== "authenticated") return;

    const loadSites = (list) => {
      setSites(list);
      setGscConnected(true);
      // Restore previously selected site if it still exists in the list
      const savedUrl = sessionStorage.getItem("gsc_selected_site");
      if (savedUrl && list.some((s) => s.url === savedUrl)) {
        setSelectedSite(savedUrl); // skip picker — remembered from session
      }
      // Otherwise selectedSite stays "" → picker screen will show
    };

    const cached = sessionStorage.getItem("gsc_sites_list");
    if (cached) {
      try { loadSites(JSON.parse(cached)); return; } catch {}
    }

    fetch("/api/gsc-sites")
      .then((r) => r.json())
      .then((d) => {
        if (!d.connected) { setGscConnected(false); return; }
        const list = d.sites || [];
        sessionStorage.setItem("gsc_sites_list", JSON.stringify(list));
        loadSites(list);
      })
      .catch(() => setGscConnected(false));
  }, [status]);

  // ── fetch data whenever site or preset changes ────────────────────────────
  const fetchData = useCallback(async (site, p, c) => {
    const range = calcRange(p, c);
    if (!site || !range) return;
    setLoading(true);
    setError(null);
    setSearch("");
    try {
      const params = new URLSearchParams({ siteUrl: site, startDate: range.startDate, endDate: range.endDate });
      const res = await fetch(`/api/organic?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (gscConnected && selectedSite && preset !== "custom") {
      fetchData(selectedSite, preset, custom);
    }
  }, [selectedSite, preset, gscConnected]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const handlePreset = (val) => {
    setPreset(val);
    setShowCustom(val === "custom");
    setCustomError("");
  };

  const applyCustom = () => {
    if (!custom.startDate || !custom.endDate) { setCustomError("Select both dates."); return; }
    if (custom.startDate > custom.endDate) { setCustomError("Start must be before end."); return; }
    setCustomError("");
    fetchData(selectedSite, "custom", custom);
  };

  // ── computed ──────────────────────────────────────────────────────────────
  const opportunities = (data?.queries || []).filter((q) => q.position >= 4 && q.position <= 20);

  const QUERY_COLS = [
    { key: "query",       label: "Query",         align: "left" },
    { key: "clicks",      label: "Clicks",        align: "right", render: fmtN },
    { key: "impressions", label: "Impressions",   align: "right", render: fmtN },
    { key: "ctr",         label: "CTR",           align: "right", render: fmtPct },
    { key: "position",    label: "Position",      align: "right", render: (v) => <PosBadge pos={v} /> },
  ];

  const PAGE_COLS = [
    { key: "page",        label: "Page",          align: "left",  render: (v) => <span className="text-blue-600 truncate block max-w-xs" title={v}>{v.replace(/^https?:\/\/[^/]+/, "")}</span> },
    { key: "clicks",      label: "Clicks",        align: "right", render: fmtN },
    { key: "impressions", label: "Impressions",   align: "right", render: fmtN },
    { key: "ctr",         label: "CTR",           align: "right", render: fmtPct },
    { key: "position",    label: "Position",      align: "right", render: (v) => <PosBadge pos={v} /> },
  ];

  const TABS = [
    { id: "queries",       label: "Top Queries",    count: data?.queries?.length },
    { id: "opportunities", label: "Opportunities",  count: opportunities.length,   badge: true },
    { id: "pages",         label: "Top Pages",      count: data?.pages?.length },
  ];

  // ── render ────────────────────────────────────────────────────────────────
  if (status === "loading" || gscConnected === null) {
    return <DashboardLoader label="Loading..." />;
  }

  return (
    <div className="flex flex-col flex-1">

      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 64 64" width="16" height="16">
            <circle cx="26" cy="26" r="18" fill="none" stroke="#4285F4" strokeWidth="6"/>
            <circle cx="26" cy="26" r="9" fill="#34A853"/>
            <line x1="39" y1="39" x2="57" y2="57" stroke="#EA4335" strokeWidth="6" strokeLinecap="round"/>
            <circle cx="26" cy="26" r="4" fill="#FBBC04"/>
          </svg>
        }
        title="Google Search Organic"
        subtitle="Search Console Performance"
      >
        {gscConnected && sites.length > 0 && selectedSite && (
          <SitePicker sites={sites} selectedSite={selectedSite} onChange={(url) => {
            sessionStorage.setItem("gsc_selected_site", url);
            setSelectedSite(url);
          }} />
        )}
      </DashboardToolHeader>

      {/* ── Date range bar — only shown once a site is selected ── */}
      {gscConnected && selectedSite && (
        <div className="bg-customPurple-dark border-b border-white/10 px-6 py-3">
          <div className="mx-auto max-w-7xl flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-gray-400 mr-1">Date range:</span>
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => handlePreset(p.value)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                  preset === p.value
                    ? "bg-purple-600 text-white"
                    : "bg-white/10 text-gray-300 hover:bg-white/20"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>
          {showCustom && (
            <div className="mx-auto max-w-7xl mt-3 flex items-end gap-3 flex-wrap">
              <label className="text-xs text-gray-400">
                From
                <input type="date" value={custom.startDate} onChange={(e) => setCustom((c) => ({ ...c, startDate: e.target.value }))}
                  className="ml-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-white" />
              </label>
              <label className="text-xs text-gray-400">
                To
                <input type="date" value={custom.endDate} onChange={(e) => setCustom((c) => ({ ...c, endDate: e.target.value }))}
                  className="ml-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-white" />
              </label>
              <button onClick={applyCustom} className="rounded-lg bg-purple-600 hover:bg-purple-500 px-4 py-1.5 text-xs font-semibold text-white transition">Apply</button>
              {customError && <p className="text-xs text-red-400">{customError}</p>}
            </div>
          )}
        </div>
      )}

      {/* ── Body ── */}
      <div className="bg-gray-50 min-h-[calc(100vh-73px)]">
        <div className="mx-auto max-w-7xl px-6 py-8">

          {/* ── Site picker screen (connected but no site chosen yet) ── */}
          {gscConnected && !selectedSite && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-full max-w-lg">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm border border-gray-100 mb-4">
                    <svg viewBox="0 0 48 48" className="w-8 h-8"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">Select a Search Console Property</h2>
                  <p className="text-sm text-gray-500">Your selection will be remembered for this session</p>
                </div>
                {sites.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-gray-100 p-8 text-center shadow-sm">
                    <p className="text-gray-400 text-sm">No properties found in your Search Console account.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {sites.map((s) => {
                      const domain = s.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
                      const faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
                      return (
                        <button key={s.url} onClick={() => {
                          sessionStorage.setItem("gsc_selected_site", s.url);
                          setSelectedSite(s.url);
                        }}
                          className="w-full flex items-center gap-4 rounded-2xl bg-white border border-gray-100 px-5 py-4 shadow-sm hover:border-purple-300 hover:shadow-md transition text-left group"
                        >
                          <img src={faviconUrl} alt="" className="w-10 h-10 rounded-xl flex-shrink-0"
                            onError={(e) => { e.target.style.display = "none"; }} />
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-gray-900 truncate">{domain}</p>
                            <p className="text-xs text-gray-400 mt-0.5">{s.url}</p>
                          </div>
                          <svg className="w-5 h-5 text-gray-300 group-hover:text-purple-500 transition flex-shrink-0" fill="none" viewBox="0 0 24 24">
                            <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* GSC not connected */}
          {!gscConnected && (
            <div className="rounded-2xl border border-white/10 bg-white p-12 text-center shadow-sm">
              <div className="text-4xl mb-4">🔗</div>
              <h2 className="text-xl font-bold text-gray-900 mb-2">Connect Google Search Console</h2>
              <p className="text-gray-500 text-sm mb-6 max-w-md mx-auto">
                Link your Search Console account to view organic query data, clicks, impressions, and rankings.
              </p>
              <a href="/api/gsc-auth" className="inline-flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition px-6 py-3 text-white font-semibold text-sm">
                Connect Search Console
              </a>
            </div>
          )}

          {gscConnected && selectedSite && (
            <>
              {/* Error */}
              {error && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
                  ⚠️ {error}
                </div>
              )}

              {/* KPI cards */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
                <KpiCard label="Total Clicks"       value={fmtN(data?.totals?.clicks)}      color="#4285F4" loading={loading} />
                <KpiCard label="Total Impressions"  value={fmtN(data?.totals?.impressions)}  color="#a855f7" loading={loading} />
                <KpiCard label="Avg. CTR"           value={fmtPct(data?.totals?.ctr)}        color="#34A853" loading={loading} />
                <KpiCard label="Avg. Position"      value={data?.totals?.position ?? "—"}    color="#FBBC04" loading={loading} />
              </div>

              {/* Trend chart */}
              <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-5 mb-6">
                <p className="text-sm font-semibold text-gray-700 mb-4">Clicks &amp; Impressions Over Time</p>
                {loading ? (
                  <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
                ) : data?.trend?.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={data.trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                      <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                      <YAxis yAxisId="left"  tick={{ fontSize: 11 }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                      <Tooltip contentStyle={{ fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Line yAxisId="left"  type="monotone" dataKey="clicks"      stroke="#4285F4" strokeWidth={2} dot={false} name="Clicks" />
                      <Line yAxisId="right" type="monotone" dataKey="impressions" stroke="#a855f7" strokeWidth={2} dot={false} name="Impressions" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-48 flex items-center justify-center text-gray-400 text-sm">No trend data available</div>
                )}
              </div>

              {/* Tabs */}
              <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
                {/* Tab bar */}
                <div className="flex border-b border-gray-100">
                  {TABS.map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => { setActiveTab(tab.id); setSearch(""); setSortCol("clicks"); setSortDir("desc"); }}
                      className={`flex items-center gap-2 px-6 py-4 text-sm font-semibold transition border-b-2 ${
                        activeTab === tab.id
                          ? "border-purple-600 text-purple-700"
                          : "border-transparent text-gray-500 hover:text-gray-700"
                      }`}
                    >
                      {tab.label}
                      {tab.count != null && (
                        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                          tab.badge && tab.count > 0
                            ? "bg-amber-100 text-amber-700"
                            : "bg-gray-100 text-gray-500"
                        }`}>
                          {fmtN(tab.count)}
                        </span>
                      )}
                    </button>
                  ))}
                </div>

                {/* Tab description */}
                {activeTab === "opportunities" && (
                  <div className="px-5 py-3 bg-amber-50 border-b border-amber-100 text-xs text-amber-800 font-medium">
                    💡 Queries ranking positions 4–20 with significant impressions. These are your best SEO quick wins — a small ranking improvement means a big jump in clicks.
                  </div>
                )}

                {/* Tab content */}
                {loading ? (
                  <div className="p-8 text-center text-gray-400 text-sm animate-pulse">Loading data…</div>
                ) : (
                  <>
                    {activeTab === "queries" && (
                      <DataTable
                        rows={data?.queries || []}
                        columns={QUERY_COLS}
                        sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
                        search={search} setSearch={setSearch}
                        emptyMsg="No query data available."
                      />
                    )}
                    {activeTab === "opportunities" && (
                      <DataTable
                        rows={opportunities}
                        columns={QUERY_COLS}
                        sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
                        search={search} setSearch={setSearch}
                        emptyMsg="No opportunities found — all your top queries are already in positions 1–3! 🎉"
                      />
                    )}
                    {activeTab === "pages" && (
                      <DataTable
                        rows={data?.pages || []}
                        columns={PAGE_COLS}
                        sortCol={sortCol} sortDir={sortDir} onSort={handleSort}
                        search={search} setSearch={setSearch}
                        emptyMsg="No page data available."
                      />
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
