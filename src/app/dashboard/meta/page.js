"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import { MetaAdsIcon } from "../components/DashboardIcons";
import MobileFilterSheet from "../components/MobileFilterSheet";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from "recharts";
import "../../globals.css";
import MetaAdsPanel from "./components/MetaAdsPanel";
import MetaAdPreview from "./components/MetaAdPreview";

// ─── priority sort ────────────────────────────────────────────────────────────

const PRIORITY_KEYWORDS = ["semper solaris", "big bully turf", "cmk"];
function priorityIndex(name) {
  const lower = (name || "").toLowerCase();
  const idx = PRIORITY_KEYWORDS.findIndex((kw) => lower.includes(kw));
  return idx === -1 ? PRIORITY_KEYWORDS.length : idx;
}
function prioritySort(list) {
  return [...list].sort((a, b) => {
    const pa = priorityIndex(a.name), pb = priorityIndex(b.name);
    if (pa !== pb) return pa - pb;
    return (a.name || "").localeCompare(b.name || "");
  });
}

// ─── formatters ───────────────────────────────────────────────────────────────

function fmt(n)  { if (n == null) return "—"; return Number(n).toLocaleString(); }
function fmtD(n) { if (n == null) return "—"; return `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
function fmtP(n) { if (n == null) return "—"; return `${Number(n).toFixed(2)}%`; }
function fmtF(n) { if (n == null || n === 0) return "—"; return Number(n).toFixed(2); }

function pctChange(curr, prev) {
  if (prev == null || prev === 0) return null;
  return parseFloat(((curr - prev) / Math.abs(prev) * 100).toFixed(1));
}

// ─── constants ────────────────────────────────────────────────────────────────

const PRESETS = [
  { label: "7 Days",   value: "7d"     },
  { label: "28 Days",  value: "28d"    },
  { label: "MTD",      value: "mtd"    },
  { label: "3 Months", value: "3m"     },
  { label: "6 Months", value: "6m"     },
  { label: "Custom",   value: "custom" },
];

const META_BLUE = "#1877F2";

const STATUS_MAP = {
  ACTIVE:         { dot: "bg-green-500",  text: "text-green-700",  label: "Active"         },
  PAUSED:         { dot: "bg-yellow-400", text: "text-yellow-700", label: "Paused"         },
  DELETED:        { dot: "bg-red-400",    text: "text-red-600",    label: "Deleted"        },
  ARCHIVED:       { dot: "bg-gray-400",   text: "text-gray-500",   label: "Archived"       },
  WITH_ISSUES:    { dot: "bg-orange-400", text: "text-orange-600", label: "With Issues"    },
  IN_PROCESS:     { dot: "bg-blue-400",   text: "text-blue-600",   label: "In Review"      },
  PENDING_REVIEW: { dot: "bg-purple-400", text: "text-purple-600", label: "Pending Review" },
};

const OBJECTIVE_LABELS = {
  AWARENESS: "Awareness", BRAND_AWARENESS: "Brand Awareness", REACH: "Reach",
  TRAFFIC: "Traffic", ENGAGEMENT: "Engagement", APP_INSTALLS: "App Installs",
  APP_PROMOTION: "App Promotion", VIDEO_VIEWS: "Video Views",
  LEAD_GENERATION: "Lead Generation", MESSAGES: "Messages",
  CONVERSIONS: "Conversions", SALES: "Sales", CATALOG_SALES: "Catalog Sales",
  STORE_TRAFFIC: "Store Traffic", OUTCOME_SALES: "Sales", OUTCOME_LEADS: "Leads",
  OUTCOME_TRAFFIC: "Traffic", OUTCOME_AWARENESS: "Awareness",
  OUTCOME_ENGAGEMENT: "Engagement", OUTCOME_APP_PROMOTION: "App Promotion",
};

// ─── icon ─────────────────────────────────────────────────────────────────────

function MetaIcon({ size = 24 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="8" fill="#1877F2"/>
      <path d="M26 12c-1.1 0-2 .45-2.7 1.2C21.95 11.44 20.1 10 18 10c-2.1 0-3.95 1.44-5.3 3.2C11.99 12.45 11.1 12 10 12c-2.2 0-4 1.8-4 4 0 .9.3 1.72.8 2.38C8.1 21.66 12.8 26 18 26s9.9-4.34 11.2-7.62c.5-.66.8-1.48.8-2.38 0-2.2-1.8-4-4-4zm-8 11.5c-3.58 0-7.5-3.8-7.5-7.5 0-1.38 1.12-2.5 2.5-2.5.78 0 1.47.36 1.94.92C14.51 15.37 16.15 16.5 18 16.5s3.49-1.13 4.06-2.08c.47-.56 1.16-.92 1.94-.92 1.38 0 2.5 1.12 2.5 2.5 0 3.7-3.92 7.5-7.5 7.5z" fill="white"/>
    </svg>
  );
}

// ─── metric tooltip ───────────────────────────────────────────────────────────

function MetricTooltip({ desc, deltaText, prevPeriod }) {
  const [show, setShow] = useState(false);
  return (
    <span className="relative inline-flex items-center" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="w-3.5 h-3.5 rounded-full border border-gray-300 text-gray-400 flex items-center justify-center cursor-help text-[9px] font-bold leading-none select-none hover:border-gray-500 hover:text-gray-600 transition">
        i
      </span>
      {show && (
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 w-64 rounded-xl bg-gray-900 text-white text-xs leading-relaxed px-3 py-2.5 shadow-xl pointer-events-none">
          {/* Metric description */}
          <span className="block">{desc}</span>

          {/* Delta explanation with actual dates */}
          {deltaText && (
            <>
              <span className="block border-t border-white/10 my-2" />
              <span className="block text-gray-300">
                <span className="block font-semibold text-white mb-0.5">
                  % badge{prevPeriod ? ` — vs. ${prevPeriod}` : ""}
                </span>
                {deltaText}
              </span>
            </>
          )}
          {!deltaText && (
            <>
              <span className="block border-t border-white/10 my-2" />
              <span className="block text-gray-400 italic">No % comparison for this metric.</span>
            </>
          )}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-gray-900" />
        </span>
      )}
    </span>
  );
}

// ─── metric tooltip definitions ───────────────────────────────────────────────

// desc = what the metric is; delta = what green/red means (null = no % badge)
const METRIC_TIPS = {
  "Total Spend":   { desc: "Total amount spent on ads in this period. Pulled directly from Meta — this is your actual billed amount.",                                                                                            delta: "Green = spending more than the comparison period. Red = spending less. Neither is inherently good — depends on your budget intent."         },
  "Clicks":        { desc: "Total clicks on your ads — link clicks, button clicks, anything that takes someone off Meta.",                                                                                                        delta: "Green = more clicks than the comparison period. Red = fewer clicks."                                                                        },
  "Impressions":   { desc: "How many times your ads were shown. One person seeing the same ad 3 times = 3 impressions.",                                                                                                         delta: "Green = more impressions than the comparison period. Red = fewer."                                                                          },
  "Reach":         { desc: "Unique people who saw your ads at least once. Each person is only counted once regardless of how many times they saw it.",                                                                           delta: "Green = reached more unique people than the comparison period. Red = fewer."                                                                },
  "Avg CTR":       { desc: "Click-Through Rate = Clicks ÷ Impressions. What % of people who saw your ad actually clicked it.",                                                                                                  delta: "Green = CTR went UP (more people clicking). Red = CTR went DOWN."                                                                          },
  "Avg CPC":       { desc: "Cost Per Click = Spend ÷ Clicks. How much you're paying for each click.",                                                                                                                           delta: "Green = CPC went DOWN (paying less per click — more efficient). Red = CPC went UP."                                                        },
  "CPM":           { desc: "Cost Per 1,000 Impressions. How much it costs to show your ad 1,000 times. Lower = cheaper reach.",                                                                                                 delta: "Green = CPM went DOWN (cheaper to reach people). Red = CPM went UP (more expensive)."                                                     },
  "Frequency":     { desc: "Average times each person saw your ad = Impressions ÷ Reach. Above 4–5 often signals ad fatigue — people seeing the same creative too many times and tuning it out.",                               delta: "Green = frequency went DOWN (less repeat exposure). Red = frequency went UP (higher fatigue risk)."                                        },
  "Conversions":   { desc: "Sum of all conversion events from your Meta Pixel — purchases, leads, registrations, etc. Requires your pixel to be set up correctly.",                                                              delta: "Green = more conversions than the comparison period. Red = fewer."                                                                          },
  "Cost/Result":   { desc: "Spend ÷ Conversions. How much each conversion costs you. Shows '—' if there are no conversions.",                                                                                                   delta: "Green = cost went DOWN (more efficient). Red = cost went UP (less efficient)."                                                             },
  "Revenue":       { desc: "Total purchase value from your pixel or Conversions API. Only populated if your site passes order values back to Meta. $0 usually means the pixel isn't configured to send purchase values.",       delta: null                                                                                                                                        },
  "ROAS":          { desc: "Return On Ad Spend = Revenue ÷ Spend. A 3x ROAS means $3 back for every $1 spent. Only meaningful if Revenue is populated.",                                                                        delta: "Green = ROAS improved. Red = ROAS dropped."                                                                                               },
};

// Compute the previous period label (e.g. "02/01/2026 – 02/27/2026") from current period dates
function getPrevPeriodLabel(startDate, endDate) {
  if (!startDate || !endDate) return null;
  const since     = new Date(startDate + "T00:00:00Z");
  const until     = new Date(endDate   + "T00:00:00Z");
  const days      = Math.round((until - since) / 86400000) + 1;
  const prevUntil = new Date(since.getTime() - 86400000);
  const prevSince = new Date(prevUntil.getTime() - (days - 1) * 86400000);
  const fmt = (d) => d.toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
  return `${fmt(prevSince)} – ${fmt(prevUntil)}`;
}

// ─── kpi card (with delta badge + info tooltip) ───────────────────────────────

function KpiCard({ label, value, color, icon, loading, delta, invertDelta = false, prevPeriod }) {
  const up = invertDelta ? delta < 0 : delta > 0;
  const deltaColor = delta == null ? "" : up ? "text-green-600" : "text-red-500";
  const deltaIcon  = delta == null ? "" : delta > 0 ? "▲" : "▼";
  const tip = METRIC_TIPS[label];

  return (
    <div className="rounded-2xl bg-white border border-gray-100 shadow-sm p-5">
      {loading ? (
        <div className="space-y-2">
          <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
          <div className="h-7 bg-gray-100 rounded animate-pulse w-1/2" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1.5 mb-2">
            <span className="text-lg">{icon}</span>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</p>
            {tip && <MetricTooltip desc={tip.desc} deltaText={tip.delta} prevPeriod={prevPeriod} />}
            {delta != null && (
              <span className={`ml-auto text-xs font-semibold ${deltaColor}`}>
                {deltaIcon} {Math.abs(delta)}%
              </span>
            )}
          </div>
          <p className="text-2xl font-bold" style={{ color }}>{value}</p>
        </>
      )}
    </div>
  );
}

// ─── status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] || { dot: "bg-gray-400", text: "text-gray-500", label: status || "Unknown" };
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${s.text}`}>
      <span className={`w-2 h-2 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

// ─── account picker ────────────────────────────────────────────────────────────

function AccountPicker({ accounts, selected, onChange, loading }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[220px] disabled:opacity-50"
      >
        <span className="flex-1 text-left truncate">
          {loading ? "Loading accounts…" : selected ? selected.name : "Select account"}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-full min-w-[300px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden max-h-80 overflow-y-auto">
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
              <div className="min-w-0">
                <p className="font-medium truncate">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">
                  ID: {a.accountId} · {a.currency}
                  {a.business && ` · ${a.business}`}
                  {a.status !== "Active" && (
                    <span className="ml-1 text-orange-500">· {a.status}</span>
                  )}
                </p>
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
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[200px] max-w-[280px]"
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
            <span>📊</span>
            <span>All Campaigns (Overview)</span>
            {!selected && (
              <svg className="w-4 h-4 text-blue-600 ml-auto" fill="none" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400 text-center">No campaigns found.</p>
            ) : filtered.map((c) => {
              const s = STATUS_MAP[c.status] || { dot: "bg-gray-400", text: "text-gray-500", label: c.status };
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
                    <p className={`text-xs mt-0.5 ml-4 ${s.text}`}>
                      {s.label}{c.objective && ` · ${OBJECTIVE_LABELS[c.objective] || c.objective}`}
                    </p>
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

// ─── campaign table ────────────────────────────────────────────────────────────

const TABLE_COLS = [
  { key: "name",          label: "Campaign",       align: "left"  },
  { key: "status",        label: "Status",         align: "left"  },
  { key: "objective",     label: "Objective",      align: "left"  },
  { key: "spend",         label: "Spend",          align: "right" },
  { key: "clicks",        label: "Clicks",         align: "right" },
  { key: "impressions",   label: "Impr.",          align: "right" },
  { key: "frequency",     label: "Freq.",          align: "right" },
  { key: "ctr",           label: "CTR",            align: "right" },
  { key: "cpc",           label: "CPC",            align: "right" },
  { key: "cpm",           label: "CPM",            align: "right" },
  { key: "conversions",   label: "Conv.",          align: "right" },
  { key: "costPerResult", label: "Cost/Result",    align: "right" },
  { key: "roas",          label: "ROAS",           align: "right" },
];

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

const CREATIVE_FORMATS = [
  { key: "MOBILE_FEED_STANDARD",  label: "Mobile" },
  { key: "DESKTOP_FEED_STANDARD", label: "Desktop" },
  { key: "INSTAGRAM_STANDARD",    label: "IG Feed" },
  { key: "FACEBOOK_REELS_MOBILE", label: "Reels" },
];

const RANK_ACCENT = "#1877F2";

function TopCreativeCard({ ad, rank }) {
  const ins = ad.insights || {};
  const [activeFormat, setActiveFormat] = useState(CREATIVE_FORMATS[0].key);
  const [previews, setPreviews] = useState({});
  const statusOk = ad.effective_status === "ACTIVE" || ad.status === "ACTIVE";

  useEffect(() => {
    if (previews[activeFormat]) return;
    let cancelled = false;
    setPreviews((p) => ({ ...p, [activeFormat]: { loading: true } }));
    fetch(`/api/meta-ads/ad/${ad.id}/preview?format=${activeFormat}`)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setPreviews((p) => ({
          ...p,
          [activeFormat]: {
            html: j.html || null,
            unsupported: !!j.unsupported,
            error: j.error || null,
            loading: false,
          },
        }));
      })
      .catch((err) => {
        if (cancelled) return;
        setPreviews((p) => ({ ...p, [activeFormat]: { loading: false, error: err.message } }));
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFormat, ad.id]);

  const current = previews[activeFormat] || { loading: true };

  return (
    <div
      className="rounded-2xl bg-white border border-gray-100 overflow-hidden flex flex-col shadow-sm"
      style={{ transition: "box-shadow .15s, transform .15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.boxShadow = "0 10px 30px rgba(0,0,0,0.08)"; e.currentTarget.style.transform = "translateY(-2px)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.05)"; e.currentTarget.style.transform = "translateY(0)"; }}
    >
      {/* Header: rank + name + status */}
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="flex items-center gap-2">
            <span style={{ background: RANK_ACCENT, color: "#fff", fontSize: 11, fontWeight: 800, padding: "3px 10px", borderRadius: 999, letterSpacing: 0.3 }}>
              #{rank}
            </span>
            <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">Top by spend</span>
          </div>
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

      {/* Placement tabs — light, Meta-blue active indicator */}
      <div className="flex border-b border-gray-100 bg-gray-50 overflow-x-auto" style={{ WebkitOverflowScrolling: "touch" }}>
        {CREATIVE_FORMATS.map((f) => {
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
                color: active ? RANK_ACCENT : "#64748b",
                border: "none",
                borderBottom: `2px solid ${active ? RANK_ACCENT : "transparent"}`,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          );
        })}
      </div>

      {/* Preview */}
      <div
        className={`top-creative-preview ${activeFormat === "FACEBOOK_REELS_MOBILE" ? "is-reels" : ""}`}
        style={{
          background: "#f1f5f9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 20,
          minHeight: 320,
        }}
      >
        <style>{`
          .top-creative-preview iframe {
            max-width: 100% !important;
            display: block;
            border: 0;
            border-radius: 8px;
            box-shadow: 0 4px 14px rgba(15,23,42,0.1);
          }
          .top-creative-preview.is-reels iframe {
            zoom: 1.5;
          }
        `}</style>
        {current.loading && (
          <div className="flex flex-col items-center gap-2" style={{ padding: "60px 0" }}>
            <div style={{ width: 26, height: 26, border: `3px solid rgba(24,119,242,0.2)`, borderTopColor: RANK_ACCENT, borderRadius: "50%", animation: "topCreativeSpin 0.8s linear infinite" }} />
            <p className="text-xs text-gray-500">Loading preview…</p>
            <style>{"@keyframes topCreativeSpin { to { transform: rotate(360deg); } }"}</style>
          </div>
        )}
        {!current.loading && current.html && (
          <div dangerouslySetInnerHTML={{ __html: current.html }} style={{ display: "flex", justifyContent: "center", width: "100%" }} />
        )}
        {!current.loading && !current.html && current.unsupported && (
          <div className="text-center" style={{ padding: "40px 20px" }}>
            <p className="text-xs text-gray-500 mb-3">This ad doesn&apos;t render in {CREATIVE_FORMATS.find((f) => f.key === activeFormat)?.label}.</p>
            {ad.creative?.image_url && (
              <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 10, boxShadow: "0 4px 14px rgba(15,23,42,0.1)" }} />
            )}
          </div>
        )}
        {!current.loading && !current.html && current.error && (
          <div className="text-center" style={{ padding: "40px 20px" }}>
            <p className="text-xs text-orange-600 mb-3">Preview unavailable.</p>
            {ad.creative?.image_url && (
              <img src={ad.creative.image_url} alt="" style={{ maxWidth: "100%", maxHeight: 400, borderRadius: 10 }} />
            )}
            {ad.creative?.body && <p className="text-xs text-gray-500 mt-3 max-w-sm mx-auto">{ad.creative.body}</p>}
          </div>
        )}
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-4 gap-3 px-5 py-4 border-t border-gray-100">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Spend</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-1">{fmtMoney(ins.spend)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">CTR</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-1">{fmtRatio(ins.ctr)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">Conv</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-1">{fmtCount(ins.conversions)}</p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-gray-500 font-semibold">ROAS</p>
          <p className="text-base font-bold text-gray-900 leading-tight mt-1">{fmtRoas(ins.roas)}</p>
        </div>
      </div>
    </div>
  );
}

function TopCreatives({ accountId, range, startDate, endDate }) {
  const [ads, setAds] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!accountId) { setAds(null); return; }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ accountId, range: range || "28d", limit: "3" });
    if (range === "custom" && startDate && endDate) {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }
    fetch(`/api/meta-ads/top-creatives?${params.toString()}`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : r.json().then((j) => { throw new Error(j.error || `HTTP ${r.status}`); }))
      .then((j) => setAds(j.data || []))
      .catch((err) => { if (err.name !== "AbortError") setError(err.message || "Failed to load"); })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, [accountId, range, startDate, endDate]);

  if (!accountId) return null;

  return (
    <>
      <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-800">Top Creatives</p>
            <p className="text-xs text-gray-400 mt-0.5">Highest-spend ads in the current window</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {ads && <p className="text-xs text-gray-400 whitespace-nowrap">{ads.length} of 3</p>}
            <Link
              href={{ pathname: "/dashboard/meta/creatives", query: { accountId, range: range || "28d", ...(range === "custom" && startDate && endDate ? { startDate, endDate } : {}) } }}
              className="text-xs font-semibold whitespace-nowrap rounded-md px-3 py-1.5 transition"
              style={{ background: "rgba(24,119,242,0.08)", color: "#1877F2", border: "1px solid rgba(24,119,242,0.2)" }}
            >
              View all creatives →
            </Link>
          </div>
        </div>

        <div className="p-5 bg-white">
          {loading && (
            <div className="flex items-center justify-center" style={{ padding: 40 }}>
              <div style={{ width: 24, height: 24, border: "3px solid rgba(24,119,242,0.2)", borderTopColor: "#1877F2", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              <p className="ml-3 text-sm text-gray-500">Fetching top creatives…</p>
              <style>{"@keyframes spin { to { transform: rotate(360deg); } }"}</style>
            </div>
          )}
          {!loading && error && (
            <p className="text-sm text-red-500 text-center" style={{ padding: 32 }}>{error}</p>
          )}
          {!loading && !error && ads?.length === 0 && (
            <p className="text-sm text-gray-500 text-center" style={{ padding: 32 }}>No ad-level spend in this window.</p>
          )}
          {!loading && !error && ads?.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5 mx-auto" style={{ maxWidth: 1800 }}>
              {ads.map((ad, i) => (
                <div key={ad.id} style={{ minWidth: 0 }}>
                  <TopCreativeCard ad={ad} rank={i + 1} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function CampaignTable({ campaigns, loading }) {
  const [sort, setSort]     = useState({ key: "spend", dir: "desc" });
  const [search, setSearch] = useState("");

  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const rows = (campaigns || [])
    .filter((c) => (c.name || "").toLowerCase().includes(search.toLowerCase()))
    .slice()
    .sort((a, b) => {
      const va = a[sort.key], vb = b[sort.key];
      if (typeof va === "string") return sort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
      return sort.dir === "asc" ? (va ?? 0) - (vb ?? 0) : (vb ?? 0) - (va ?? 0);
    });

  if (loading) return (
    <div className="p-5 space-y-3">
      {[...Array(5)].map((_, i) => <div key={i} className="h-10 rounded-xl bg-gray-100 animate-pulse" />)}
    </div>
  );

  return (
    <>
      <div className="px-5 py-3 border-b border-gray-100">
        <input type="text" placeholder="Search campaigns…" value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full max-w-xs rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-400" />
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {TABLE_COLS.map((col) => (
                <th key={col.key} onClick={() => toggle(col.key)}
                  className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
                >
                  {col.label}
                  {sort.key === col.key && <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "↑" : "↓"}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={TABLE_COLS.length} className="px-4 py-8 text-center text-sm text-gray-400">No campaigns found.</td></tr>
            ) : rows.map((c) => {
              const freqHigh = c.frequency > 4;
              return (
                <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50/50 transition">
                  <td className="px-4 py-3 font-medium text-gray-900 max-w-[220px] truncate">{c.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{OBJECTIVE_LABELS[c.objective] || c.objective || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmtD(c.spend)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmt(c.clicks)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmt(c.impressions)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${freqHigh ? "text-orange-600" : "text-gray-600"}`}>
                    {fmtF(c.frequency)}
                    {freqHigh && <span className="ml-1 text-orange-400" title="High frequency — possible ad fatigue">⚠</span>}
                  </td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmtP(c.ctr)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmtD(c.cpc)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{fmtD(c.cpm)}</td>
                  <td className="px-4 py-3 text-right text-gray-700">{fmt(c.conversions)}</td>
                  <td className="px-4 py-3 text-right text-gray-600">{c.costPerResult ? fmtD(c.costPerResult) : "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold text-gray-800">{c.roas ? `${c.roas}x` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ─── ad set table ─────────────────────────────────────────────────────────────

const ADSET_COLS = [
  { key: "name",          label: "Ad Set",      align: "left"  },
  { key: "status",        label: "Status",      align: "left"  },
  { key: "spend",         label: "Spend",       align: "right" },
  { key: "clicks",        label: "Clicks",      align: "right" },
  { key: "impressions",   label: "Impr.",       align: "right" },
  { key: "frequency",     label: "Freq.",       align: "right" },
  { key: "ctr",           label: "CTR",         align: "right" },
  { key: "cpc",           label: "CPC",         align: "right" },
  { key: "conversions",   label: "Conv.",       align: "right" },
  { key: "costPerResult", label: "Cost/Result", align: "right" },
  { key: "roas",          label: "ROAS",        align: "right" },
];

function AdSetTable({ adsets, loading, onRowClick }) {
  const [sort, setSort] = useState({ key: "spend", dir: "desc" });
  const toggle = (key) => setSort((s) => ({ key, dir: s.key === key && s.dir === "desc" ? "asc" : "desc" }));

  const rows = (adsets || []).slice().sort((a, b) => {
    const va = a[sort.key], vb = b[sort.key];
    if (typeof va === "string") return sort.dir === "asc" ? va.localeCompare(vb) : vb.localeCompare(va);
    return sort.dir === "asc" ? (va ?? 0) - (vb ?? 0) : (vb ?? 0) - (va ?? 0);
  });

  if (loading) return (
    <div className="p-5 space-y-3">
      {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-xl bg-gray-100 animate-pulse" />)}
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-100">
            {ADSET_COLS.map((col) => (
              <th key={col.key} onClick={() => toggle(col.key)}
                className={`px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-800 transition whitespace-nowrap ${col.align === "right" ? "text-right" : "text-left"}`}
              >
                {col.label}
                {sort.key === col.key && <span className="ml-1 text-gray-400">{sort.dir === "asc" ? "↑" : "↓"}</span>}
              </th>
            ))}
            <th></th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr><td colSpan={ADSET_COLS.length + 1} className="px-4 py-8 text-center text-sm text-gray-400">No ad sets found.</td></tr>
          ) : rows.map((s) => {
            const freqHigh = s.frequency > 4;
            return (
              <tr
                key={s.id}
                onClick={() => onRowClick?.(s)}
                className="border-b border-gray-50 hover:bg-gray-50/50 transition cursor-pointer"
              >
                <td className="px-4 py-3 font-medium text-gray-900 max-w-[240px] truncate">{s.name}</td>
                <td className="px-4 py-3"><StatusBadge status={s.status} /></td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">{fmtD(s.spend)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(s.clicks)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(s.impressions)}</td>
                <td className={`px-4 py-3 text-right font-medium ${freqHigh ? "text-orange-600" : "text-gray-600"}`}>
                  {fmtF(s.frequency)}
                  {freqHigh && <span className="ml-1 text-orange-400" title="High frequency">⚠</span>}
                </td>
                <td className="px-4 py-3 text-right text-gray-600">{fmtP(s.ctr)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{fmtD(s.cpc)}</td>
                <td className="px-4 py-3 text-right text-gray-700">{fmt(s.conversions)}</td>
                <td className="px-4 py-3 text-right text-gray-600">{s.costPerResult ? fmtD(s.costPerResult) : "—"}</td>
                <td className="px-4 py-3 text-right font-semibold text-gray-800">{s.roas ? `${s.roas}x` : "—"}</td>
                <td className="px-3 py-3 text-right text-gray-300 text-base">›</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── ai insights panel (coming soon) ─────────────────────────────────────────

function AiInsightsPanel() {
  return (
    <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden mb-6">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <span className="text-base">✦</span>
          <p className="text-sm font-bold text-gray-900">AI Insights</p>
        </div>
        <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-xs font-semibold text-purple-600">
          Coming Soon
        </span>
      </div>
      <div className="px-5 py-8 flex flex-col items-center gap-3 text-center">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-purple-100 to-blue-100 flex items-center justify-center">
          <span className="text-2xl">🤖</span>
        </div>
        <p className="text-sm font-semibold text-gray-700">AI-powered campaign analysis</p>
        <p className="text-xs text-gray-400 max-w-xs">
          Get automatic insights like &ldquo;3 campaigns have frequency above 5 — consider refreshing creatives&rdquo; or &ldquo;Spend is up 34% but ROAS dropped 18%.&rdquo;
        </p>
        <div className="flex flex-wrap gap-2 mt-2 justify-center">
          {["Ad fatigue detection", "Budget pacing", "ROAS anomalies", "Audience overlap"].map((tag) => (
            <span key={tag} className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-500">{tag}</span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function MetaDashboard() {
  const router = useRouter();
  const { status } = useSession();

  // Accounts
  const [accounts, setAccounts]               = useState([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [selectedAccount, setSelectedAccount] = useState(null);

  // Dashboard data
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [preset, setPreset]           = useState("28d");
  const [showCustom, setShowCustom]   = useState(false);
  const [custom, setCustom]           = useState({ startDate: "", endDate: "" });
  const [customError, setCustomError] = useState("");
  const [trendMetric, setTrendMetric] = useState("spend");
  const [selectedCampaign, setSelectedCampaign] = useState(null);

  // Ad sets
  const [adSets, setAdSets]           = useState(null);
  const [adSetsLoading, setAdSetsLoading] = useState(false);

  // Ad-level panel
  const [adsPanelAdSet, setAdsPanelAdSet] = useState(null);

  // Mobile filter sheet
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/meta");
  }, [status, router]);

  // Load accounts — restore from sessionStorage
  useEffect(() => {
    if (status !== "authenticated") return;

    const restore = (list) => {
      setAccounts(prioritySort(list));
      const saved = sessionStorage.getItem("meta_selected_account");
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (list.some((a) => a.accountId === parsed.accountId)) {
            setSelectedAccount(parsed);
            return;
          }
        } catch {}
      }
    };

    const cached = sessionStorage.getItem("meta_accounts_list_v5");
    if (cached) {
      try { restore(JSON.parse(cached)); setAccountsLoading(false); return; } catch {}
    }

    setAccountsLoading(true);
    fetch("/api/meta-accounts")
      .then((r) => r.json())
      .then((d) => {
        const list = d.accounts || [];
        sessionStorage.setItem("meta_accounts_list_v5", JSON.stringify(list));
        restore(list);
      })
      .catch(() => {})
      .finally(() => setAccountsLoading(false));
  }, [status]);

  const fetchData = useCallback(async (p, c, account) => {
    if (!account) return;
    setLoading(true);
    setError(null);
    setSelectedCampaign(null);
    setAdSets(null);
    try {
      const params = new URLSearchParams({ range: p, accountId: account.accountId });
      if (p === "custom" && c.startDate && c.endDate) {
        params.set("startDate", c.startDate);
        params.set("endDate",   c.endDate);
      }
      const res  = await fetch(`/api/meta-ads?${params}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to fetch");
      setData(json);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch ad sets when a campaign is selected
  useEffect(() => {
    if (!selectedCampaign || !selectedAccount) { setAdSets(null); return; }
    setAdSetsLoading(true);
    setAdSets(null);
    const params = new URLSearchParams({
      accountId:  selectedAccount.accountId,
      campaignId: selectedCampaign.id,
      range:      preset,
    });
    fetch(`/api/meta-ads?${params}`)
      .then((r) => r.json())
      .then((d) => setAdSets(d.adsets || []))
      .catch(() => setAdSets([]))
      .finally(() => setAdSetsLoading(false));
  }, [selectedCampaign, selectedAccount, preset]);

  // Auto-fetch when account or preset changes
  useEffect(() => {
    if (selectedAccount && preset !== "custom") fetchData(preset, custom, selectedAccount);
  }, [selectedAccount, preset]);

  const handleAccountChange = (account) => {
    sessionStorage.setItem("meta_selected_account", JSON.stringify(account));
    setSelectedAccount(account);
    setData(null);
    setSelectedCampaign(null);
    setAdSets(null);
  };

  const handlePreset = (val) => {
    setPreset(val);
    setShowCustom(val === "custom");
    setCustomError("");
  };

  const applyCustom = () => {
    if (!custom.startDate || !custom.endDate) { setCustomError("Select both dates."); return; }
    if (custom.startDate > custom.endDate)     { setCustomError("Start must be before end."); return; }
    setCustomError("");
    fetchData("custom", custom, selectedAccount);
  };

  // KPI totals — use campaign level when selected, else account totals
  const totals     = selectedCampaign
    ? {
        spend: selectedCampaign.spend, clicks: selectedCampaign.clicks,
        impressions: selectedCampaign.impressions, reach: selectedCampaign.reach,
        ctr: selectedCampaign.ctr, cpc: selectedCampaign.cpc, cpm: selectedCampaign.cpm,
        frequency: selectedCampaign.frequency,
        conversions: selectedCampaign.conversions, revenue: selectedCampaign.revenue,
        roas: selectedCampaign.roas, costPerResult: selectedCampaign.costPerResult,
      }
    : (data?.totals || {});

  // Period-over-period deltas (only meaningful at account level)
  const prevPeriodLabel = getPrevPeriodLabel(data?.startDate, data?.endDate);
  const prev = selectedCampaign ? null : data?.prevTotals;
  const deltas = prev ? {
    spend:       pctChange(totals.spend,       prev.spend),
    clicks:      pctChange(totals.clicks,      prev.clicks),
    impressions: pctChange(totals.impressions, prev.impressions),
    reach:       pctChange(totals.reach,       prev.reach),
    ctr:         pctChange(totals.ctr,         prev.ctr),
    cpc:         pctChange(totals.cpc,         prev.cpc),
    cpm:         pctChange(totals.cpm,         prev.cpm),
    frequency:   pctChange(totals.frequency,   prev.frequency),
    conversions: pctChange(totals.conversions, prev.conversions),
    roas:        pctChange(totals.roas,        prev.roas),
    costPerResult: pctChange(totals.costPerResult, prev.costPerResult),
  } : {};

  if (status === "loading") return <DashboardLoader label="Loading..." />;

  return (
    <div className="flex flex-col flex-1">

      <DashboardToolHeader
        icon={<MetaAdsIcon />}
        title="Meta Ads"
        subtitle="Facebook & Instagram Campaigns"
      >
        <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {selectedAccount && (
            <button
              onClick={() => router.push(`/dashboard/meta/audit?accountId=${encodeURIComponent(selectedAccount.accountId)}`)}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(24,119,242,0.15)", border: "1px solid rgba(24,119,242,0.35)", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#1877F2", cursor: "pointer", transition: "background 0.15s", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(24,119,242,0.25)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(24,119,242,0.15)"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              Audit Account
            </button>
          )}
          <AccountPicker
            accounts={accounts}
            selected={selectedAccount}
            onChange={handleAccountChange}
            loading={accountsLoading}
          />
          {data?.campaigns?.length > 0 && (
            <CampaignPicker
              campaigns={data.campaigns}
              selected={selectedCampaign}
              onChange={setSelectedCampaign}
              onClear={() => { setSelectedCampaign(null); setAdSets(null); }}
            />
          )}
        </div>
      </DashboardToolHeader>

      {/* Mobile filter row */}
      <div className="mobile-only" style={{ display: "flex", gap: 8, padding: "8px 16px", background: "rgba(14,8,28,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, alignItems: "center" }}>
        <button
          onClick={() => setFilterOpen(true)}
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
        >
          Filters <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        {selectedAccount && (
          <button
            onClick={() => router.push(`/dashboard/meta/audit?accountId=${encodeURIComponent(selectedAccount.accountId)}`)}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(24,119,242,0.15)", border: "1px solid rgba(24,119,242,0.35)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#1877F2", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            Audit
          </button>
        )}
        {selectedAccount && (
          <span style={{ display: "flex", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
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
            onChange={handleAccountChange}
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
              onClear={() => { setSelectedCampaign(null); setAdSets(null); }}
            />
          </div>
        )}
      </MobileFilterSheet>

      {/* ── Date range bar ── */}
      <div className={`bg-customPurple-dark border-b border-white/10 px-6 py-3 ${!selectedAccount ? "hidden" : ""}`}>
        <div className="mx-auto max-w-7xl flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-400 mr-1">Date range:</span>
          {PRESETS.map((p) => (
            <button key={p.value} onClick={() => handlePreset(p.value)}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                preset === p.value ? "text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}
              style={preset === p.value ? { backgroundColor: META_BLUE } : {}}
            >
              {p.label}
            </button>
          ))}
          {data?.startDate && data?.endDate && (
            <span className="ml-auto text-xs text-gray-400 tabular-nums">
              {new Date(data.startDate + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}
              {" — "}
              {new Date(data.endDate + "T00:00:00").toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" })}
            </span>
          )}
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
              className="rounded-lg px-4 py-1.5 text-xs font-semibold text-white transition"
              style={{ backgroundColor: META_BLUE }}>Apply</button>
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
                    <MetaIcon size={36} />
                  </div>
                  <h2 className="text-xl font-bold text-gray-900 mb-1">Select an Ad Account</h2>
                  <p className="text-sm text-gray-500">Choose which Meta Ads account to view</p>
                </div>

                {accountsLoading ? (
                  <div className="space-y-3">
                    {[...Array(3)].map((_, i) => (
                      <div key={i} className="h-16 rounded-2xl bg-white border border-gray-100 animate-pulse" />
                    ))}
                  </div>
                ) : accounts.length === 0 ? (
                  <div className="rounded-2xl bg-white border border-gray-100 p-8 text-center shadow-sm">
                    <p className="text-gray-400 text-sm">No ad accounts found. Check your Meta access token and System User permissions.</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {accounts.map((a) => (
                      <button
                        key={a.accountId}
                        onClick={() => handleAccountChange(a)}
                        className="w-full flex items-center gap-4 rounded-2xl bg-white border border-gray-100 px-5 py-4 shadow-sm hover:border-blue-300 hover:shadow-md transition text-left group"
                      >
                        <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-50 group-hover:bg-blue-100 transition flex-shrink-0">
                          <MetaIcon size={22} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 truncate">{a.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            ID: {a.accountId} · {a.currency}
                            {a.business && ` · ${a.business}`}
                            {a.status !== "Active" && (
                              <span className="ml-1 text-orange-500">· {a.status}</span>
                            )}
                          </p>
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

          {/* ── Dashboard content ── */}
          {selectedAccount && (<>

          {/* Loading notice */}
          {loading && (
            <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 text-sm text-blue-800 flex items-center gap-3">
              <svg className="w-5 h-5 animate-spin flex-shrink-0" style={{ color: META_BLUE }} fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
              </svg>
              Fetching Meta Ads data…
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              ⚠️ {error}
            </div>
          )}

          {/* Campaign context banner */}
          {selectedCampaign && (
            <div className="mb-4 flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-100 px-4 py-3">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: META_BLUE }} />
              <p className="text-sm font-semibold text-blue-800 truncate">{selectedCampaign.name}</p>
              {selectedCampaign.status && <span className="text-xs text-blue-500 bg-blue-100 rounded-full px-2 py-0.5">{selectedCampaign.status}</span>}
              {selectedCampaign.objective && (
                <span className="text-xs text-blue-400 hidden sm:block">{OBJECTIVE_LABELS[selectedCampaign.objective] || selectedCampaign.objective}</span>
              )}
              <button onClick={() => { setSelectedCampaign(null); setAdSets(null); }} className="ml-auto text-xs text-blue-500 hover:text-blue-700 font-medium flex-shrink-0">
                ← All Campaigns
              </button>
            </div>
          )}

          {/* ── AI Insights (Coming Soon) ── */}
          <AiInsightsPanel />

          {/* ── KPI cards ── */}
          {/* Row 1: Core volume */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
            <KpiCard label="Total Spend"  value={fmtD(totals.spend)}       color={META_BLUE} icon="💰" loading={loading && !data} delta={deltas.spend}        prevPeriod={prevPeriodLabel} />
            <KpiCard label="Clicks"       value={fmt(totals.clicks)}        color="#00B2FF"   icon="🖱️" loading={loading && !data} delta={deltas.clicks}       prevPeriod={prevPeriodLabel} />
            <KpiCard label="Impressions"  value={fmt(totals.impressions)}   color="#34A853"   icon="👁️" loading={loading && !data} delta={deltas.impressions}  prevPeriod={prevPeriodLabel} />
            <KpiCard label="Reach"        value={fmt(totals.reach)}         color="#FBBC04"   icon="📡" loading={loading && !data} delta={deltas.reach}         prevPeriod={prevPeriodLabel} />
          </div>
          {/* Row 2: Efficiency */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-4">
            <KpiCard label="Avg CTR"      value={fmtP(totals.ctr)}          color="#EA4335"   icon="📊" loading={loading && !data} delta={deltas.ctr}          prevPeriod={prevPeriodLabel} />
            <KpiCard label="Avg CPC"      value={fmtD(totals.cpc)}          color="#F59E0B"   icon="💲" loading={loading && !data} delta={deltas.cpc}          prevPeriod={prevPeriodLabel} invertDelta />
            <KpiCard label="CPM"          value={fmtD(totals.cpm)}          color="#8B5CF6"   icon="📺" loading={loading && !data} delta={deltas.cpm}          prevPeriod={prevPeriodLabel} invertDelta />
            <KpiCard label="Frequency"    value={fmtF(totals.frequency)}    color={totals.frequency > 4 ? "#F97316" : "#64748B"} icon="🔁" loading={loading && !data} delta={deltas.frequency} prevPeriod={prevPeriodLabel} invertDelta />
          </div>
          {/* Row 3: Conversions */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-6">
            <KpiCard label="Conversions"    value={fmt(totals.conversions)}     color="#a855f7" icon="✅" loading={loading && !data} delta={deltas.conversions}   prevPeriod={prevPeriodLabel} />
            <KpiCard label="Cost/Result"    value={totals.costPerResult ? fmtD(totals.costPerResult) : "—"} color="#F25022" icon="🎯" loading={loading && !data} delta={deltas.costPerResult} prevPeriod={prevPeriodLabel} invertDelta />
            <KpiCard label="Revenue"        value={fmtD(totals.revenue)}        color="#34A853" icon="📈" loading={loading && !data} prevPeriod={prevPeriodLabel} />
            <KpiCard label="ROAS"           value={totals.roas ? `${totals.roas}x` : "—"} color="#1877F2" icon="🏆" loading={loading && !data} delta={deltas.roas} prevPeriod={prevPeriodLabel} />
          </div>

          {/* ── Trend chart ── */}
          <div className="rounded-2xl bg-white shadow-sm border border-gray-100 p-5 mb-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm font-semibold text-gray-700">
                Performance Trend
                {selectedCampaign && <span className="ml-2 text-xs font-normal text-gray-400">(account-level)</span>}
              </p>
              <div className="flex gap-2">
                {["spend", "clicks", "impressions"].map((m) => (
                  <button key={m} onClick={() => setTrendMetric(m)}
                    className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition ${
                      trendMetric === m ? "text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    }`}
                    style={trendMetric === m ? { backgroundColor: META_BLUE } : {}}
                  >
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
                  <Line type="monotone" dataKey={trendMetric} stroke={META_BLUE} strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-48 flex items-center justify-center text-gray-400 text-sm">
                {data ? "No trend data for this period." : "Select a date range to load data."}
              </div>
            )}
          </div>

          {/* ── Ad sets (shown when campaign selected) ── */}
          {selectedCampaign && (
            <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden mb-6">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">Ad Sets</p>
                  <p className="text-xs text-gray-400 mt-0.5">{selectedCampaign.name}</p>
                </div>
                {adSets && <p className="text-xs text-gray-400">{adSets.length} ad sets</p>}
              </div>
              <AdSetTable adsets={adSets} loading={adSetsLoading} onRowClick={(s) => setAdsPanelAdSet(s)} />
            </div>
          )}

          {/* ── Top creatives ── */}
          {selectedAccount && (
            <TopCreatives
              accountId={selectedAccount.accountId}
              range={preset}
              startDate={custom?.startDate}
              endDate={custom?.endDate}
            />
          )}

          {/* ── Campaign table ── */}
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

      <MetaAdsPanel
        open={!!adsPanelAdSet}
        onClose={() => setAdsPanelAdSet(null)}
        adSet={adsPanelAdSet}
        campaignName={selectedCampaign?.name || null}
        range={preset}
        startDate={custom?.startDate || undefined}
        endDate={custom?.endDate || undefined}
      />
    </div>
  );
}
