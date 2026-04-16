"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import { MicrosoftAdsIcon as BingIcon } from "../components/DashboardIcons";
import MobileFilterSheet from "../components/MobileFilterSheet";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer, BarChart, Bar,
} from "recharts";
import "../../globals.css";

// ─── priority sort ────────────────────────────────────────────────────────────

const PRIORITY_KEYWORDS = ["semper solaris", "big bully turf", "cmk"];
function priorityIndex(name) {
  const lower = (name || "").toLowerCase();
  const idx = PRIORITY_KEYWORDS.findIndex((kw) => lower.includes(kw));
  return idx === -1 ? PRIORITY_KEYWORDS.length : idx;
}
function prioritySort(list, nameKey = "name") {
  return [...list].sort((a, b) => {
    const pa = priorityIndex(a[nameKey]), pb = priorityIndex(b[nameKey]);
    if (pa !== pb) return pa - pb;
    return (a[nameKey] || "").localeCompare(b[nameKey] || "");
  });
}

// ─── formatters ───────────────────────────────────────────────────────────────

const fmt  = (n) => n == null ? "—" : Number(n).toLocaleString("en-US");
const fmtD = (n) => n == null ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtP = (n) => n == null ? "—" : `${n}%`;

// ─── date presets ─────────────────────────────────────────────────────────────

const PRESETS = [
  { value: "7d",     label: "7 days" },
  { value: "28d",    label: "28 days" },
  { value: "mtd",    label: "Month to Date" },
  { value: "3m",     label: "3 months" },
  { value: "6m",     label: "6 months" },
  { value: "custom", label: "Custom" },
];

// ─── Microsoft Ads icon ───────────────────────────────────────────────────────

function MicrosoftAdsIcon({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022" rx="1" />
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" rx="1" />
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" rx="1" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1" />
    </svg>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KpiCard({ label, value, color, icon, loading }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm border border-gray-100" style={{ borderTop: `3px solid ${color}` }}>
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{label}</p>
        <span className="text-lg">{icon}</span>
      </div>
      {loading
        ? <div className="h-8 w-24 rounded-lg bg-gray-100 animate-pulse mt-1" />
        : <p className="text-2xl font-bold text-gray-900">{value}</p>
      }
    </div>
  );
}

// ─── status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = (status || "").toLowerCase();
  const styles = {
    active:   { bg: "#dcfce7", color: "#15803d" },
    paused:   { bg: "#fef9c3", color: "#854d0e" },
    deleted:  { bg: "#fee2e2", color: "#b91c1c" },
  };
  const style = styles[s] || { bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold capitalize"
      style={{ background: style.bg, color: style.color }}>
      {status || "—"}
    </span>
  );
}

// ─── sortable table ───────────────────────────────────────────────────────────

function SortIcon({ col, sortCol, sortDir }) {
  if (sortCol !== col) return <span className="ml-1 opacity-30">↕</span>;
  return <span className="ml-1 text-blue-600">{sortDir === "asc" ? "↑" : "↓"}</span>;
}

function CampaignTable({ campaigns, loading }) {
  const [sortCol, setSortCol]   = useState("spend");
  const [sortDir, setSortDir]   = useState("desc");
  const [search, setSearch]     = useState("");

  const handleSort = (col) => {
    if (sortCol === col) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(col); setSortDir("desc"); }
  };

  const filtered = (campaigns || []).filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase())
  );
  const sorted = [...filtered].sort((a, b) => {
    const va = a[sortCol]; const vb = b[sortCol];
    if (typeof va === "string") return sortDir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return sortDir === "asc" ? (va > vb ? 1 : -1) : (va < vb ? 1 : -1);
  });

  const COLS = [
    { key: "name",        label: "Campaign",    render: (v) => <span className="font-medium text-gray-900 max-w-[220px] truncate block">{v}</span> },
    { key: "status",      label: "Status",      render: (v) => <StatusBadge status={v} /> },
    { key: "budget",      label: "Daily Budget", render: (v) => v != null ? fmtD(v) : "—", align: "right" },
    { key: "spend",       label: "Spend",       render: fmtD, align: "right" },
    { key: "clicks",      label: "Clicks",      render: fmt,  align: "right" },
    { key: "impressions", label: "Impressions", render: fmt,  align: "right" },
    { key: "ctr",         label: "CTR",         render: fmtP, align: "right" },
    { key: "cpc",         label: "Avg CPC",     render: fmtD, align: "right" },
    { key: "conversions", label: "Conversions", render: fmt,  align: "right" },
  ];

  if (loading) {
    return (
      <div className="space-y-2 p-5">
        {[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <p className="text-xs text-gray-400">{fmt(filtered.length)} campaigns</p>
        <input type="text" placeholder="Search campaigns…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="rounded-xl border border-gray-200 px-3 py-1.5 text-sm text-gray-700 w-52 focus:outline-none focus:border-blue-400" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {COLS.map((col) => (
                <th key={col.key} onClick={() => handleSort(col.key)}
                  className={`px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 cursor-pointer select-none hover:text-gray-800 ${col.align === "right" ? "text-right" : "text-left"}`}>
                  {col.label}<SortIcon col={col.key} sortCol={sortCol} sortDir={sortDir} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 ? (
              <tr><td colSpan={COLS.length} className="px-5 py-10 text-center text-gray-400">No campaigns found.</td></tr>
            ) : sorted.map((c, i) => (
              <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition">
                {COLS.map((col) => (
                  <td key={col.key} className={`px-4 py-3 ${col.align === "right" ? "text-right tabular-nums text-gray-600" : ""}`}>
                    {col.render ? col.render(c[col.key], c) : c[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── account picker ───────────────────────────────────────────────────────────

function AccountPicker({ accounts, selected, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = accounts.find((a) => a.accountId === selected?.accountId);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[220px] disabled:opacity-50"
      >
        <span className="flex-1 text-left truncate">
          {loading ? "Loading accounts…" : current ? current.name : "Select account"}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-full min-w-[280px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden max-h-72 overflow-y-auto">
          {loading ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">Loading accounts…</div>
          ) : accounts.length === 0 ? (
            <div className="px-4 py-4 text-sm text-gray-400 text-center">No accounts found.</div>
          ) : accounts.map((a) => (
            <button
              key={a.accountId}
              onClick={() => { onChange(a); setOpen(false); }}
              className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
                a.accountId === selected?.accountId ? "bg-blue-50 text-blue-700 font-medium" : "text-gray-700"
              }`}
            >
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">ID: {a.accountId} · {a.currency}</p>
              </div>
              {a.accountId === selected?.accountId && (
                <svg className="w-4 h-4 text-blue-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24">
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

// ─── campaign picker ──────────────────────────────────────────────────────────

const BING_STATUS_COLORS = {
  active:   { dot: "bg-green-500",  text: "text-green-700",  label: "Active"   },
  paused:   { dot: "bg-yellow-400", text: "text-yellow-700", label: "Paused"   },
  deleted:  { dot: "bg-red-400",    text: "text-red-600",    label: "Deleted"  },
};

function CampaignPicker({ campaigns, selected, onChange, onClear }) {
  const [open, setOpen]     = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = (campaigns || []).filter((c) =>
    (c.name || "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[200px] max-w-[260px]"
      >
        <span className="flex-1 text-left truncate font-medium">
          {selected ? selected.name : "All Campaigns"}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          <div className="px-3 py-2 border-b border-gray-100">
            <input autoFocus type="text" placeholder="Search campaigns…" value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-400" />
          </div>
          <button
            onClick={() => { onClear(); setOpen(false); setSearch(""); }}
            className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left transition hover:bg-gray-50 border-b border-gray-100 ${
              !selected ? "bg-blue-50 text-blue-700 font-semibold" : "text-gray-700"
            }`}
          >
            <span className="text-base">📊</span>
            <span>All Campaigns (Overview)</span>
            {!selected && (
              <svg className="w-4 h-4 text-blue-600 ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400 text-center">No campaigns found.</p>
            ) : filtered.map((c) => {
              const key = (c.status || "").toLowerCase();
              const s = BING_STATUS_COLORS[key] || { dot: "bg-gray-400", text: "text-gray-500", label: c.status || "Unknown" };
              const isSelected = selected?.id === c.id;
              return (
                <button key={c.id}
                  onClick={() => { onChange(c); setOpen(false); setSearch(""); }}
                  className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${isSelected ? "bg-blue-50" : ""}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <p className={`font-medium truncate ${isSelected ? "text-blue-700" : "text-gray-800"}`}>{c.name}</p>
                    </div>
                    <p className={`text-xs mt-0.5 ml-4 ${s.text}`}>{s.label}</p>
                  </div>
                  {isSelected && (
                    <svg className="w-4 h-4 text-blue-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24">
                      <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function BingDashboard() {
  const router = useRouter();
  const { status } = useSession();

  // Accounts
  const [accounts, setAccounts]         = useState([]);
  const [selectedAccount, setSelectedAccount] = useState(null);
  const [accountsLoading, setAccountsLoading] = useState(false);

  const [preset, setPreset]   = useState("28d");
  const [custom, setCustom]   = useState({ startDate: "", endDate: "" });
  const [showCustom, setShowCustom] = useState(false);
  const [customError, setCustomError] = useState("");

  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [trendMetric, setTrendMetric] = useState("spend");
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  // Mobile filter sheet
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/bing");
  }, [status, router]);

  // Load accounts — restore from sessionStorage if available
  useEffect(() => {
    if (status !== "authenticated") return;

    const loadAccounts = (list) => {
      setAccounts(prioritySort(list));
      const saved = sessionStorage.getItem("bing_selected_account");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (list.some((a) => a.accountId === parsed.accountId)) {
            setSelectedAccount(parsed); // skip picker — remembered from session
            return;
          }
        } catch {}
      }
      // No saved account → picker screen will show
    };

    const cachedList = sessionStorage.getItem("bing_accounts_list_v2");
    if (cachedList) {
      try { loadAccounts(JSON.parse(cachedList)); setAccountsLoading(false); return; } catch {}
    }

    setAccountsLoading(true);
    fetch("/api/bing-accounts")
      .then((r) => r.json())
      .then((d) => {
        const list = d.accounts || [];
        sessionStorage.setItem("bing_accounts_list_v2", JSON.stringify(list));
        loadAccounts(list);
      })
      .catch(() => {
        const fallback = [{ accountId: null, customerId: null, name: "Default Account", currency: "USD" }];
        setAccounts(fallback);
      })
      .finally(() => setAccountsLoading(false));
  }, [status]);

  const fetchData = useCallback(async (p, c, account) => {
    if (!account) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        preset:     p,
        accountId:  account.accountId,
        customerId: account.customerId,
      });
      if (p === "custom" && c.startDate && c.endDate) {
        params.set("startDate", c.startDate);
        params.set("endDate", c.endDate);
      }
      const res  = await fetch(`/api/bing-dashboard?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch");
      setData(json);
      setSelectedCampaign(null); // reset campaign selection on new data load
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-fetch when account or preset changes
  useEffect(() => {
    if (selectedAccount && preset !== "custom") fetchData(preset, custom, selectedAccount);
  }, [selectedAccount, preset]);

  const handlePreset = (val) => {
    setPreset(val);
    setShowCustom(val === "custom");
    setCustomError("");
  };

  const applyCustom = () => {
    if (!custom.startDate || !custom.endDate) { setCustomError("Select both dates."); return; }
    if (custom.startDate > custom.endDate) { setCustomError("Start must be before end."); return; }
    setCustomError("");
    fetchData("custom", custom, selectedAccount);
  };

  if (status === "loading") {
    return <DashboardLoader label="Loading..." />;
  }

  // When a campaign is selected, use its numbers; otherwise use account totals
  const accountTotals = data?.totals || {};
  const totals = selectedCampaign
    ? {
        spend:       selectedCampaign.spend,
        clicks:      selectedCampaign.clicks,
        impressions: selectedCampaign.impressions,
        ctr:         selectedCampaign.ctr,
        cpc:         selectedCampaign.cpc,
        conversions: selectedCampaign.conversions,
        revenue:     selectedCampaign.revenue,
        roas:        selectedCampaign.roas,
      }
    : accountTotals;

  return (
    <div className="flex flex-col flex-1">

      <DashboardToolHeader
        icon={<BingIcon />}
        title="Microsoft Advertising"
        subtitle="Bing Ads Dashboard"
      >
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <AccountPicker
            accounts={accounts}
            selected={selectedAccount}
            onChange={(a) => { sessionStorage.setItem("bing_selected_account", JSON.stringify(a)); setSelectedAccount(a); setData(null); setSelectedCampaign(null); }}
            loading={accountsLoading}
          />
          {data?.campaigns?.length > 0 && (
            <CampaignPicker
              campaigns={data.campaigns}
              selected={selectedCampaign}
              onChange={setSelectedCampaign}
              onClear={() => setSelectedCampaign(null)}
            />
          )}
        </div>
      </DashboardToolHeader>

      {/* Mobile filter row */}
      <div className="mobile-only" style={{ display: "flex", gap: 8, padding: "8px 16px", background: "rgba(14,8,28,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button
          onClick={() => setFilterOpen(true)}
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
        >
          Filters <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        {selectedAccount && (
          <span style={{ display: "flex", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 4px" }}>
            {selectedAccount.name}
          </span>
        )}
      </div>

      {/* Mobile filter sheet */}
      <MobileFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={() => setFilterOpen(false)}
      >
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Account</p>
          <AccountPicker
            accounts={accounts}
            selected={selectedAccount}
            onChange={(a) => { sessionStorage.setItem("bing_selected_account", JSON.stringify(a)); setSelectedAccount(a); setData(null); setSelectedCampaign(null); }}
            loading={accountsLoading}
          />
        </div>
        {data?.campaigns?.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Campaign</p>
            <CampaignPicker
              campaigns={data.campaigns}
              selected={selectedCampaign}
              onChange={setSelectedCampaign}
              onClear={() => setSelectedCampaign(null)}
            />
          </div>
        )}
      </MobileFilterSheet>

      {/* ── Date range bar — only shown once an account is selected ── */}
      <div className={`bg-customPurple-dark border-b border-white/10 px-6 py-3 ${!selectedAccount ? "hidden" : ""}`}>
        <div className="mx-auto max-w-7xl flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-400 mr-1">Date range:</span>
          {PRESETS.map((p) => (
            <button key={p.value} onClick={() => handlePreset(p.value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                preset === p.value ? "bg-blue-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}>
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
            <button onClick={applyCustom}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition">Apply</button>
            {customError && <p className="text-xs text-red-400">{customError}</p>}
          </div>
        )}
      </div>

      {/* ── Body ── */}
      <div className="bg-gray-50 min-h-[calc(100vh-73px)]">
        <div className="mx-auto max-w-7xl px-6 py-8">

          {/* ── Account selection screen ── */}
          {!selectedAccount && (
            <div className="flex flex-col items-center justify-center py-16">
              <div className="w-full max-w-lg">
                <div className="text-center mb-8">
                  <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm border border-gray-100 mb-4">
                    <MicrosoftAdsIcon size={32} />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">Select an Account</h2>
                  <p className="text-sm text-gray-500">Choose which Microsoft Advertising account to view</p>
                </div>

                {accountsLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 rounded-2xl bg-white border border-gray-100 animate-pulse" />
                    ))}
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-gray-100 p-8 text-center shadow-sm">
                    <p className="text-gray-400 text-sm">No accounts found. Check your Bing Ads credentials.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((a) => (
                      <button
                        key={a.accountId}
                        onClick={() => { sessionStorage.setItem("bing_selected_account", JSON.stringify(a)); setSelectedAccount(a); }}
                        className="w-full flex items-center gap-4 rounded-2xl bg-white border border-gray-100 px-5 py-4 shadow-sm hover:border-blue-300 hover:shadow-md transition text-left group"
                      >
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition flex-shrink-0">
                          <MicrosoftAdsIcon size={20} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{a.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">Account ID: {a.accountId} · {a.currency}</p>
                        </div>
                        <svg className="w-5 h-5 text-gray-300 group-hover:text-blue-500 transition flex-shrink-0" fill="none" viewBox="0 0 24 24">
                          <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── Dashboard content (only shown when account is selected) ── */}
          {selectedAccount && (<>

          {/* Loading notice */}
          {loading && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 flex items-center gap-3">
              <svg className="w-5 h-5 animate-spin text-blue-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Fetching Microsoft Advertising report… this may take 15–30 seconds.
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              ⚠️ {error}
            </div>
          )}

          {/* Campaign context label */}
          {selectedCampaign && (
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <span className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0" />
              <p className="text-sm font-semibold text-blue-800 truncate">{selectedCampaign.name}</p>
              <span className="text-xs text-blue-500 bg-blue-100 rounded-full px-2 py-0.5">{selectedCampaign.status}</span>
              <button onClick={() => setSelectedCampaign(null)} className="ml-auto text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0">
                ← All Campaigns
              </button>
            </div>
          )}

          {/* KPI cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-4 mb-6">
            <KpiCard label="Total Spend"       value={fmtD(totals.spend)}        color="#0078D4" icon="💰" loading={loading && !data} />
            <KpiCard label="Clicks"            value={fmt(totals.clicks)}         color="#00A4EF" icon="🖱️" loading={loading && !data} />
            <KpiCard label="Impressions"       value={fmt(totals.impressions)}    color="#7FBA00" icon="👁️" loading={loading && !data} />
            <KpiCard label="Avg CTR"           value={fmtP(totals.ctr)}          color="#FFB900" icon="📊" loading={loading && !data} />
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
            <KpiCard label="Avg CPC"           value={fmtD(totals.cpc)}          color="#F25022" icon="💲" loading={loading && !data} />
            <KpiCard label="Conversions"       value={fmt(totals.conversions)}   color="#a855f7" icon="✅" loading={loading && !data} />
            <KpiCard label="Revenue"           value={fmtD(totals.revenue)}      color="#34A853" icon="📈" loading={loading && !data} />
            <KpiCard label="ROAS"              value={totals.roas != null ? `${totals.roas}x` : "—"} color="#4285F4" icon="🎯" loading={loading && !data} />
          </div>

          {/* Trend chart */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-700">Performance Trend</p>
              <div className="flex gap-2">
                {["spend", "clicks", "impressions"].map((m) => (
                  <button key={m} onClick={() => setTrendMetric(m)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                      trendMetric === m ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {loading && !data ? (
              <div className="h-48 bg-gray-50 rounded-xl animate-pulse" />
            ) : data?.trend?.length > 0 ? (
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={data.trend} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} tickFormatter={(v) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => trendMetric === "spend" ? `$${v}` : v} />
                  <Tooltip
                    contentStyle={{ fontSize: 12 }}
                    formatter={(v) => [trendMetric === "spend" ? fmtD(v) : fmt(v), trendMetric]}
                  />
                  <Line type="monotone" dataKey={trendMetric} stroke="#0078D4" strokeWidth={2} dot={false} name={trendMetric} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                {data ? "No trend data available for this period." : "Select a date range to load data."}
              </div>
            )}
          </div>

          {/* Campaign table */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">
                {selectedCampaign ? selectedCampaign.name : "All Campaigns"}
              </p>
              {data && (
                <p className="text-xs text-gray-400">
                  {selectedCampaign ? "1 campaign selected" : `${data.campaigns?.length || 0} campaigns`}
                </p>
              )}
            </div>
            <CampaignTable
              campaigns={selectedCampaign ? [selectedCampaign] : data?.campaigns}
              loading={loading && !data}
            />
          </div>

          </>)}
        </div>
      </div>
    </div>
  );
}
