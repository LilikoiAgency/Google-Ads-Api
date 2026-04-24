"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import "../../../globals.css";
import ContentArea from "../../components/ContentArea";
import { isAdmin } from "../../../../lib/admins";
import { sortWithPinned } from "../../../../lib/googleAdsHelpers";
import DashboardToolHeader from "../../components/DashboardToolHeader";
import DashboardLoader from "../../components/DashboardLoader";
import { GoogleAdsIcon } from "../../components/DashboardIcons";
import MobileFilterSheet from "../../components/MobileFilterSheet";

const DATE_RANGE_OPTIONS = [
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "LAST_90_DAYS", label: "Last 90 days" },
  { value: "THIS_MONTH", label: "This month" },
  { value: "CUSTOM", label: "Custom range" },
];

const CAMPAIGN_STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "INACTIVE", label: "Inactive" },
  { value: "ALL", label: "All" },
];

const CACHE_VERSION = "v3";
const LAST_UPDATED_KEY = "lastUpdated";
const SELECTED_CUSTOMER_KEY = "selectedCustomerId";
const SELECTED_CAMPAIGN_KEY = "selectedCampaignSelection";
const SELECTED_DATE_RANGE_KEY = "selectedDateRange";
const SELECTED_STATUS_FILTER_KEY = "selectedCampaignStatusFilter";
const CUSTOM_DATE_RANGE_KEY = "customDateRange";
const CACHE_TTL_MS = 60 * 60 * 1000;

function formatDateInputValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 10);
}

function parseDateLiteral(value) {
  if (!value || typeof value !== "string") return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function getDefaultCustomDateRange() {
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(endDate.getDate() - 29);
  return {
    startDate: formatDateInputValue(startDate),
    endDate: formatDateInputValue(endDate),
  };
}

function getDateSelectionKey(dateRange, customDateRange) {
  if (dateRange === "CUSTOM") {
    return `${dateRange}:${customDateRange?.startDate || "unset"}:${customDateRange?.endDate || "unset"}`;
  }
  return dateRange;
}

function getCampaignCacheKey(dateRange, statusFilter, customDateRange) {
  return `campaignData:${CACHE_VERSION}:${getDateSelectionKey(dateRange, customDateRange)}:${statusFilter}`;
}

function getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange) {
  return `campaignDataFetchedAt:${CACHE_VERSION}:${getDateSelectionKey(dateRange, customDateRange)}:${statusFilter}`;
}

function getLastUpdatedKey(dateRange, statusFilter, customDateRange) {
  return `${LAST_UPDATED_KEY}:${getDateSelectionKey(dateRange, customDateRange)}:${statusFilter}`;
}

function formatDateWindow(dateWindow) {
  if (!dateWindow?.startDate || !dateWindow?.endDate) return null;
  const formatter = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
  const startDate = parseDateLiteral(dateWindow.startDate);
  const endDate = parseDateLiteral(dateWindow.endDate);
  if (!startDate || !endDate) return null;
  return `${formatter.format(startDate)} - ${formatter.format(endDate)}`;
}

function getStoredCampaignData(dateRange, statusFilter, customDateRange) {
  const storedData = localStorage.getItem(getCampaignCacheKey(dateRange, statusFilter, customDateRange));
  const storedFetchedAt = localStorage.getItem(getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange));
  if (!storedData || !storedFetchedAt) return null;
  if (Date.now() - Number(storedFetchedAt) > CACHE_TTL_MS) {
    localStorage.removeItem(getCampaignCacheKey(dateRange, statusFilter, customDateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange));
    return null;
  }
  try {
    const parsedData = JSON.parse(storedData);
    return Array.isArray(parsedData?.validCampaignsData) ? parsedData : null;
  } catch {
    localStorage.removeItem(getCampaignCacheKey(dateRange, statusFilter, customDateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange));
    return null;
  }
}

function resolveSelectedCampaign(campaignData, customerId, campaignSelection) {
  if (!customerId || !campaignSelection?.campaignId) return null;
  const selectedCustomer = campaignData.find((item) => String(item.customer.customer_client.id) === String(customerId));
  if (!selectedCustomer) return null;
  return selectedCustomer.campaigns?.find((campaign) => campaign.campaignId === campaignSelection.campaignId) || null;
}

// ─── Account dropdown ─────────────────────────────────────────────────────────

function AccountDropdown({ accounts, selectedId, onChange, pinnedAccountIds, isAdminUser, onTogglePin }) {
  const [open, setOpen]       = useState(false);
  const [showAll, setShowAll] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setShowAll(false); }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = accounts.find((a) => a.id === selectedId);
  const { pinned, unpinned } = sortWithPinned(accounts, pinnedAccountIds);

  useEffect(() => {
    if (selectedId && unpinned.some((a) => a.id === selectedId)) setShowAll(true);
  }, [selectedId, pinnedAccountIds]);

  const AccountRow = ({ a, isPinned }) => (
    <div className="flex items-stretch">
      <button
        onClick={() => { onChange(a.id); setOpen(false); setShowAll(false); }}
        className={`flex items-center gap-3 flex-1 min-w-0 px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
          a.id === selectedId ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
        }`}
      >
        <div className="min-w-0 flex-1">
          <p className="font-medium truncate">{a.name}</p>
          <p className="text-xs text-gray-400 mt-0.5">ID: {a.id}</p>
        </div>
        {a.id === selectedId && (
          <svg className="w-4 h-4 text-purple-600 flex-shrink-0" fill="none" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
      {isAdminUser && (
        <button
          onClick={(e) => { e.stopPropagation(); onTogglePin(a.id); setShowAll(true); }}
          title={isPinned ? "Remove from main accounts (affects all users)" : "Pin to top for all users"}
          className={`flex-shrink-0 px-3 border-l border-gray-100 flex flex-col items-center justify-center gap-0.5 transition hover:bg-gray-50 ${isPinned ? "text-amber-500" : "text-gray-300 hover:text-amber-400"}`}
        >
          <span className="text-base leading-none">{isPinned ? "⭐" : "☆"}</span>
          <span className="text-[9px] font-semibold leading-none">{isPinned ? "Main" : "Pin"}</span>
        </button>
      )}
    </div>
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[180px]"
      >
        <span className="flex-1 text-left truncate font-medium">{current?.name || "Select account"}</span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[280px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          {pinned.length > 0 && (
            <div className="px-4 pt-2 pb-1">
              <p className="text-[10px] font-bold uppercase tracking-widest text-amber-500">⭐ Main Accounts</p>
              <p className="text-[9px] text-gray-400 mt-0.5">Pinned by admin · visible to everyone</p>
            </div>
          )}
          {pinned.map((a) => <AccountRow key={a.id} a={a} isPinned />)}

          {unpinned.length > 0 && (
            <>
              {pinned.length > 0 && (
                <div className="border-t border-gray-100">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
                    className="w-full px-4 py-2 text-xs text-gray-400 text-left hover:bg-gray-50 flex items-center gap-1"
                  >
                    {showAll ? "▲ Show less" : `▾ ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
                  </button>
                </div>
              )}
              {(showAll || pinned.length === 0) && (
                <>
                  {pinned.length === 0 && isAdminUser && (
                    <div className="px-4 pt-2 pb-1">
                      <p className="text-[10px] text-gray-400">Star an account to pin it to the top</p>
                    </div>
                  )}
                  {unpinned.map((a) => <AccountRow key={a.id} a={a} isPinned={false} />)}
                </>
              )}
            </>
          )}

          {pinned.length === 0 && unpinned.length === 0 && (
            <p className="px-4 py-4 text-sm text-gray-400 text-center">No accounts found.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Campaign dropdown ────────────────────────────────────────────────────────

// Google Ads API returns status as a number: 2=ENABLED, 3=PAUSED, 4=REMOVED
const STATUS_NUM_MAP = { 2: "enabled", 3: "paused", 4: "removed" };
const STATUS_COLORS = {
  enabled:  { dot: "bg-green-500",  text: "text-green-700",  label: "Enabled"  },
  paused:   { dot: "bg-yellow-400", text: "text-yellow-700", label: "Paused"   },
  removed:  { dot: "bg-red-400",    text: "text-red-600",    label: "Removed"  },
};

function getCampaignStatus(status) {
  if (typeof status === "number") return STATUS_NUM_MAP[status] || "unknown";
  if (typeof status === "string") return status.toLowerCase();
  return "unknown";
}

function CampaignDropdown({ campaigns, selectedCampaign, onChange, onClear }) {
  const [open, setOpen]   = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setSearch(""); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filtered = campaigns.filter((c) =>
    c.campaignName.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/10 px-4 py-2 text-sm text-white hover:bg-white/20 transition min-w-[200px] max-w-[260px]"
      >
        <span className="flex-1 text-left truncate font-medium">
          {selectedCampaign ? selectedCampaign.campaignName : "All Campaigns"}
        </span>
        <svg className="w-4 h-4 text-gray-400 flex-shrink-0" fill="none" viewBox="0 0 24 24">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          {/* Search */}
          <div className="px-3 py-2 border-b border-gray-100">
            <input
              autoFocus
              type="text"
              placeholder="Search campaigns…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:border-blue-400"
            />
          </div>
          {/* All campaigns option */}
          <button
            onClick={() => { onClear(); setOpen(false); setSearch(""); }}
            className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm text-left transition hover:bg-gray-50 border-b border-gray-100 ${
              !selectedCampaign ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
            }`}
          >
            <span className="text-base">📊</span>
            <span>All Campaigns (Overview)</span>
            {!selectedCampaign && (
              <svg className="w-4 h-4 text-purple-600 flex-shrink-0 ml-auto" fill="none" viewBox="0 0 24 24">
                <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
          {/* Campaign list */}
          <div className="max-h-72 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-4 py-4 text-sm text-gray-400 text-center">No campaigns found.</p>
            ) : filtered.map((c) => {
              const statusKey = getCampaignStatus(c.status);
              const s = STATUS_COLORS[statusKey] || { dot: "bg-gray-400", text: "text-gray-500", label: statusKey };
              const isSelected = selectedCampaign?.campaignId === c.campaignId;
              return (
                <button
                  key={c.campaignId}
                  onClick={() => { onChange(c.campaignId); setOpen(false); setSearch(""); }}
                  className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
                    isSelected ? "bg-purple-50" : ""
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${s.dot}`} />
                      <p className={`font-medium truncate ${isSelected ? "text-purple-700" : "text-gray-800"}`}>
                        {c.campaignName}
                      </p>
                    </div>
                    <p className={`text-xs mt-0.5 ml-4 ${s.text}`}>{s.label}</p>
                  </div>
                  {isSelected && (
                    <svg className="w-4 h-4 text-purple-600 flex-shrink-0 ml-2" fill="none" viewBox="0 0 24 24">
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

// ─── Account Brief Card ───────────────────────────────────────────────────────

const DATE_BRIEF_OPTIONS = [
  { value: 'LAST_7_DAYS',  label: 'Last 7 days'  },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
  { value: 'THIS_MONTH',   label: 'This month'   },
];

function AccountBriefCard({ selectedCustomer, currentDateRange }) {
  const [briefRange, setBriefRange] = useState(
    DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange) ? currentDateRange : 'LAST_30_DAYS'
  );
  const [state, setState] = useState({ status: 'idle', briefing: null, generatedAt: null, error: null });
  const [collapsed, setCollapsed] = useState(false);
  const fetchingRef = useRef(false);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const customerName = selectedCustomer?.customer?.customer_client?.descriptive_name || '';
  const campaigns = selectedCustomer?.campaigns || [];
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0) / 1_000_000;

  async function fetchBrief(force = false) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const res = await fetch('/api/claude/account-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, customerName, campaigns, dateLabel: briefRange, forceRefresh: force }),
      });
      const json = await res.json();
      if (json.skipped) {
        setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      } else if (!res.ok || json.error) {
        setState({ status: 'error', briefing: null, generatedAt: null, error: json.error || `Error ${res.status}` });
      } else {
        setState({ status: 'done', briefing: json.briefing, generatedAt: json.generatedAt, error: null });
        setCollapsed(false);
      }
    } catch (err) {
      setState({ status: 'error', briefing: null, generatedAt: null, error: err.message });
    } finally {
      fetchingRef.current = false;
    }
  }

  useEffect(() => {
    if (!customerId || totalSpend === 0) {
      setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      return;
    }
    fetchBrief(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  if (totalSpend === 0 || state.status === 'no_spend') return null;

  const { status, briefing, generatedAt, error } = state;
  const genTime = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div style={{ margin: '0 0 20px 0', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderBottom: collapsed ? 'none' : '1px solid #f3f4f6', background: '#fafafa' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#111' }}>AI Briefing</span>
        {genTime && <span style={{ fontSize: 11, color: '#9ca3af' }}>Generated {genTime}</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <select
            value={briefRange}
            onChange={(e) => setBriefRange(e.target.value)}
            style={{ fontSize: 11, border: '1px solid #e5e7eb', borderRadius: 6, padding: '3px 6px', background: '#fff', color: '#374151' }}
          >
            {DATE_BRIEF_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            onClick={() => fetchBrief(true)}
            disabled={status === 'loading'}
            style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: status === 'loading' ? '#93c5fd' : '#4f46e5', border: 'none', borderRadius: 6, padding: '4px 10px', cursor: status === 'loading' ? 'not-allowed' : 'pointer' }}
          >
            {status === 'loading' ? 'Running…' : 'Re-run'}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            style={{ fontSize: 11, color: '#6b7280', background: 'none', border: 'none', cursor: 'pointer', padding: '4px 6px' }}
          >
            {collapsed ? '▼ Show' : '▲ Hide'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div style={{ padding: '14px 16px' }}>
          {status === 'loading' && (
            <div style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              {[60, 80, 45].map((w, i) => (
                <div key={i} style={{ height: 12, width: `${w}%`, background: '#f3f4f6', borderRadius: 6, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
              ))}
            </div>
          )}
          {status === 'error' && (
            <p style={{ fontSize: 12, color: '#ef4444', margin: 0 }}>{error}</p>
          )}
          {status === 'done' && briefing && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 13, fontWeight: 600, color: '#111', margin: 0 }}>{briefing.headline}</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#16a34a', margin: '0 0 8px 0' }}>Top Performers</p>
                  {(briefing.topPerformers || []).map((p, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#111', margin: '0 0 2px 0' }}>{p.name}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: '0 0 2px 0' }}>{p.metric}</p>
                      <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>{p.insight}</p>
                    </div>
                  ))}
                </div>
                <div>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#dc2626', margin: '0 0 8px 0' }}>Needs Attention</p>
                  {(briefing.bottomPerformers || []).map((p, i) => (
                    <div key={i} style={{ marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 600, color: '#111', margin: '0 0 2px 0' }}>{p.name}</p>
                      <p style={{ fontSize: 11, color: '#ef4444', margin: '0 0 2px 0' }}>{p.issue}</p>
                      <p style={{ fontSize: 11, color: '#374151', margin: 0 }}>→ {p.recommendation}</p>
                    </div>
                  ))}
                </div>
              </div>
              {(briefing.actions || []).length > 0 && (
                <div style={{ borderTop: '1px solid #f3f4f6', paddingTop: 12 }}>
                  <p style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#4f46e5', margin: '0 0 8px 0' }}>Priority Actions</p>
                  {briefing.actions.map((a, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 6, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: '#4f46e5', borderRadius: '50%', width: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>{a.priority}</span>
                      <div>
                        <span style={{ fontSize: 12, fontWeight: 600, color: '#111' }}>{a.action}</span>
                        {a.impact && <span style={{ fontSize: 11, color: '#6b7280' }}> — {a.impact}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function GoogleAdsDashboard() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const [allCampaignData, setAllCampaignData] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [dateRange, setDateRange] = useState("LAST_7_DAYS");
  const [campaignStatusFilter, setCampaignStatusFilter] = useState("ACTIVE");
  const [customDateRange, setCustomDateRange] = useState(getDefaultCustomDateRange());
  const [dateWindowLabel, setDateWindowLabel] = useState(null);
  const [customDateError, setCustomDateError] = useState(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // ── Account picker state (null = checking, true = show picker, false = skip) ─
  const [showPicker, setShowPicker]           = useState(null);
  const [pickerCustomers, setPickerCustomers] = useState([]);
  const [pickerLoading, setPickerLoading]     = useState(false);
  const [pinnedAccountIds, setPinnedAccountIds] = useState([]);
  const [pickerShowAll, setPickerShowAll]       = useState(false);
  const isAdminUser = isAdmin(session?.user?.email || '');
  const [filterOpen, setFilterOpen] = useState(false);

  const updateLastUpdated = (
    date = new Date(),
    currentDateRange = dateRange,
    currentStatusFilter = campaignStatusFilter,
    currentCustomDateRange = customDateRange
  ) => {
    const formattedDate = date.toLocaleString();
    setLastUpdated(formattedDate);
    localStorage.setItem(getLastUpdatedKey(currentDateRange, currentStatusFilter, currentCustomDateRange), formattedDate);
  };

  const applyCampaignData = (campaignData) => {
    const storedCustomerId = localStorage.getItem(SELECTED_CUSTOMER_KEY);
    const storedCampaignSelection = localStorage.getItem(SELECTED_CAMPAIGN_KEY);
    let parsedCampaignSelection = null;
    if (storedCampaignSelection) {
      try { parsedCampaignSelection = JSON.parse(storedCampaignSelection); }
      catch { localStorage.removeItem(SELECTED_CAMPAIGN_KEY); }
    }
    const nextSelectedCustomerId =
      storedCustomerId && campaignData.some((item) => String(item.customer.customer_client.id) === String(storedCustomerId))
        ? storedCustomerId
        : campaignData[0]?.customer.customer_client.id || null;
    const nextSelectedCampaign = resolveSelectedCampaign(campaignData, nextSelectedCustomerId, parsedCampaignSelection);
    setAllCampaignData(campaignData);
    setSelectedCustomerId(nextSelectedCustomerId);
    setSelectedCampaign(nextSelectedCampaign);
  };

  const fetchData = async ({
    forceRefresh = false,
    requestedDateRange = dateRange,
    requestedStatusFilter = campaignStatusFilter,
    requestedCustomDateRange = customDateRange,
  } = {}) => {
    if (status !== "authenticated") return;
    setIsFetching(true);
    setError(null);
    if (!forceRefresh) {
      const cachedData = getStoredCampaignData(requestedDateRange, requestedStatusFilter, requestedCustomDateRange);
      if (cachedData) {
        applyCampaignData(cachedData.validCampaignsData);
        setDateWindowLabel(formatDateWindow(cachedData.dateWindow));
        setLastUpdated(localStorage.getItem(getLastUpdatedKey(requestedDateRange, requestedStatusFilter, requestedCustomDateRange)));
        setIsFetching(false);
        return;
      }
    }
    try {
      const queryParams = new URLSearchParams({ dateRange: requestedDateRange, statusFilter: requestedStatusFilter });
      if (requestedDateRange === "CUSTOM") {
        queryParams.set("startDate", requestedCustomDateRange.startDate);
        queryParams.set("endDate", requestedCustomDateRange.endDate);
      }
      const response = await fetch(`/api/googleads?${queryParams.toString()}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/?callbackUrl=/dashboard/google/ads");
        return;
      }
      if (!response.ok) throw new Error("Failed to fetch dashboard data");
      const { data: responseData } = await response.json();
      const data = responseData ?? {};
      const validCampaignsData = data.validCampaignsData || [];
      const cachedPayload = { validCampaignsData, dateWindow: data.dateWindow || null };
      localStorage.setItem(getCampaignCacheKey(requestedDateRange, requestedStatusFilter, requestedCustomDateRange), JSON.stringify(cachedPayload));
      localStorage.setItem(getCampaignCacheTimeKey(requestedDateRange, requestedStatusFilter, requestedCustomDateRange), String(Date.now()));
      updateLastUpdated(new Date(), requestedDateRange, requestedStatusFilter, requestedCustomDateRange);
      applyCampaignData(validCampaignsData);
      setDateWindowLabel(formatDateWindow(data.dateWindow));
    } catch (err) {
      setError(err.message || "Failed to fetch dashboard data");
    } finally {
      setIsFetching(false);
    }
  };

  // ── Step 1: check sessionStorage for saved account, or show picker ──────────
  useEffect(() => {
    if (status !== "authenticated") return;

    // Always fetch preferences (needed for both picker and dropdown)
    fetch("/api/googleads/preferences")
      .then((r) => r.json())
      .then((d) => setPinnedAccountIds(d?.data?.pinnedAccountIds ?? []))
      .catch(() => {});

    const savedId = sessionStorage.getItem("gads_customer_id");
    if (savedId) {
      setShowPicker(false);
    } else {
      setShowPicker(true);
      setPickerLoading(true);
      const cached = sessionStorage.getItem("gads_customers_list");
      if (cached) {
        try { setPickerCustomers(JSON.parse(cached)); } catch {}
        setPickerLoading(false);
      } else {
        fetch("/api/customers")
          .then((r) => r.json())
          .then((d) => {
            const list = d.customers || [];
            setPickerCustomers(list);
            sessionStorage.setItem("gads_customers_list", JSON.stringify(list));
          })
          .catch(() => setPickerCustomers([]))
          .finally(() => setPickerLoading(false));
      }
    }
  }, [status]);

  // ── Step 2: load campaign data — only after account is picked ────────────────
  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard/google/ads");
      return;
    }
    if (status !== "authenticated" || showPicker !== false) return;
    const storedDateRange = localStorage.getItem(SELECTED_DATE_RANGE_KEY);
    const nextDateRange = DATE_RANGE_OPTIONS.some((o) => o.value === storedDateRange) ? storedDateRange : "LAST_7_DAYS";
    const storedStatusFilter = localStorage.getItem(SELECTED_STATUS_FILTER_KEY);
    const nextStatusFilter = CAMPAIGN_STATUS_OPTIONS.some((o) => o.value === storedStatusFilter) ? storedStatusFilter : "ACTIVE";
    let nextCustomDateRange = getDefaultCustomDateRange();
    const storedCustomDateRange = localStorage.getItem(CUSTOM_DATE_RANGE_KEY);
    if (storedCustomDateRange) {
      try {
        const parsed = JSON.parse(storedCustomDateRange);
        if (parsed?.startDate && parsed?.endDate) nextCustomDateRange = parsed;
      } catch { localStorage.removeItem(CUSTOM_DATE_RANGE_KEY); }
    }
    const storedLastUpdated = localStorage.getItem(getLastUpdatedKey(nextDateRange, nextStatusFilter, nextCustomDateRange));
    setDateRange(nextDateRange);
    setCampaignStatusFilter(nextStatusFilter);
    setCustomDateRange(nextCustomDateRange);
    if (storedLastUpdated) setLastUpdated(storedLastUpdated);
    fetchData({ requestedDateRange: nextDateRange, requestedStatusFilter: nextStatusFilter, requestedCustomDateRange: nextCustomDateRange });
  }, [router, status, showPicker]);

  useEffect(() => {
    if (selectedCustomerId) localStorage.setItem(SELECTED_CUSTOMER_KEY, selectedCustomerId);
    else localStorage.removeItem(SELECTED_CUSTOMER_KEY);
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCampaign && selectedCustomerId) {
      localStorage.setItem(SELECTED_CAMPAIGN_KEY, JSON.stringify({ customerId: selectedCustomerId, campaignId: selectedCampaign.campaignId }));
    } else {
      localStorage.removeItem(SELECTED_CAMPAIGN_KEY);
    }
  }, [selectedCampaign, selectedCustomerId]);

  useEffect(() => { localStorage.setItem(SELECTED_DATE_RANGE_KEY, dateRange); }, [dateRange]);
  useEffect(() => { localStorage.setItem(SELECTED_STATUS_FILTER_KEY, campaignStatusFilter); }, [campaignStatusFilter]);
  useEffect(() => { localStorage.setItem(CUSTOM_DATE_RANGE_KEY, JSON.stringify(customDateRange)); }, [customDateRange]);

  const handleCustomerSelect = (customerId) => {
    sessionStorage.setItem("gads_customer_id", customerId);
    setSelectedCustomerId(customerId);
    setSelectedCampaign(null);
  };

  const handleCampaignSelect = (campaignId) => {
    const selectedCustomer = allCampaignData.find((item) => String(item.customer.customer_client.id) === String(selectedCustomerId));
    const campaign = selectedCustomer?.campaigns?.find((item) => item.campaignId === campaignId) || null;
    setSelectedCampaign(campaign);
  };

  const refreshData = () => {
    localStorage.removeItem(getCampaignCacheKey(dateRange, campaignStatusFilter, customDateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange, campaignStatusFilter, customDateRange));
    fetchData({ forceRefresh: true, requestedDateRange: dateRange, requestedStatusFilter: campaignStatusFilter, requestedCustomDateRange: customDateRange });
  };

  const handleTogglePin = async (accountId) => {
    const previous = pinnedAccountIds;
    const optimistic = previous.includes(accountId)
      ? previous.filter((id) => id !== accountId)
      : [...previous, accountId];
    setPinnedAccountIds(optimistic);

    try {
      const res = await fetch("/api/googleads/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId }),
      });
      if (!res.ok) throw new Error("Failed to update pin");
      const { data } = await res.json();
      setPinnedAccountIds(data.pinnedAccountIds);
    } catch {
      setPinnedAccountIds(previous);
    }
  };

  const handleDateRangeChange = (event) => {
    const nextDateRange = event.target.value;
    setCustomDateError(null);
    setDateRange(nextDateRange);
    setSelectedCampaign(null);
    setLastUpdated(localStorage.getItem(getLastUpdatedKey(nextDateRange, campaignStatusFilter, customDateRange)));
    setDateWindowLabel(null);
    if (nextDateRange !== "CUSTOM") {
      fetchData({ requestedDateRange: nextDateRange, requestedStatusFilter: campaignStatusFilter, requestedCustomDateRange: customDateRange });
    }
  };

  const handleCampaignStatusFilterChange = (nextStatusFilter) => {
    setCustomDateError(null);
    setCampaignStatusFilter(nextStatusFilter);
    setSelectedCampaign(null);
    setLastUpdated(localStorage.getItem(getLastUpdatedKey(dateRange, nextStatusFilter)));
    setDateWindowLabel(null);
    fetchData({ requestedDateRange: dateRange, requestedStatusFilter: nextStatusFilter, requestedCustomDateRange: customDateRange });
  };

  const handleCustomDateChange = (field, value) => {
    setCustomDateError(null);
    setCustomDateRange((cur) => ({ ...cur, [field]: value }));
  };

  const applyCustomDateRange = () => {
    if (!customDateRange.startDate || !customDateRange.endDate) {
      setCustomDateError("Choose both a start date and end date.");
      return;
    }
    if (customDateRange.startDate > customDateRange.endDate) {
      setCustomDateError("Start date must be on or before end date.");
      return;
    }
    setCustomDateError(null);
    setDateRange("CUSTOM");
    setSelectedCampaign(null);
    setLastUpdated(localStorage.getItem(getLastUpdatedKey("CUSTOM", campaignStatusFilter, customDateRange)));
    setDateWindowLabel(null);
    fetchData({ requestedDateRange: "CUSTOM", requestedStatusFilter: campaignStatusFilter, requestedCustomDateRange: customDateRange });
  };

  if (showPicker === null || status === "loading" || (showPicker === false && isFetching && allCampaignData.length === 0 && !error)) {
    return (
      <DashboardLoader label="Pulling data from Google..." />
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-100 p-6">
        <div className="max-w-lg rounded-2xl bg-white p-6 shadow-md">
          <h2 className="text-xl font-semibold text-customPurple">Dashboard unavailable</h2>
          <p className="mt-2 text-sm text-gray-600">{error}</p>
          <button
            className="mt-4 rounded-lg bg-customPurple px-4 py-2 text-white hover:bg-customPurple-light"
            onClick={refreshData}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1" style={{ position: "relative", minHeight: 0, overflow: "hidden" }}>
      <style>{`@keyframes briefPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>

      {/* ── Account picker overlay ── */}
      {showPicker === true && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 40,
          background: "rgba(10,5,22,0.96)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", paddingTop: 48, overflowY: "auto",
        }}>
          <div style={{ width: "100%", maxWidth: 480, padding: "0 24px" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 16 }}>
                <svg viewBox="0 0 48 48" style={{ width: 32, height: 32 }}><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "rgba(255,255,255,0.95)", margin: 0, marginBottom: 6 }}>Select a Google Ads Account</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>Your selection will be remembered for this session</p>
            </div>
            {pickerLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...Array(4)].map((_, i) => <div key={i} style={{ height: 64, borderRadius: 16, background: "rgba(255,255,255,0.06)" }} className="animate-pulse" />)}
              </div>
            ) : (() => {
              const { pinned, unpinned } = sortWithPinned(pickerCustomers, pinnedAccountIds);
              const PickerRow = ({ c, isPinned }) => (
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button
                    onClick={() => {
                      sessionStorage.setItem("gads_customer_id", c.id);
                      localStorage.setItem(SELECTED_CUSTOMER_KEY, c.id);
                      setPickerShowAll(false);
                      setShowPicker(false);
                    }}
                    style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 14, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 18px", cursor: "pointer", textAlign: "left" }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 48 48" style={{ width: 20, height: 20 }}><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0, fontSize: 14 }}>{c.name}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 2 }}>ID: {c.id}</p>
                    </div>
                  </button>
                  {isAdminUser && (
                    <button
                      onClick={() => { handleTogglePin(c.id); setPickerShowAll(true); }}
                      title={isPinned ? "Remove from main accounts (affects all users)" : "Pin to top for all users"}
                      style={{
                        flexShrink: 0, width: 64, borderRadius: 16,
                        background: isPinned ? "rgba(251,191,36,0.15)" : "rgba(255,255,255,0.06)",
                        border: isPinned ? "1px solid rgba(251,191,36,0.4)" : "1px solid rgba(255,255,255,0.08)",
                        cursor: "pointer", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 20, lineHeight: 1 }}>{isPinned ? "⭐" : "☆"}</span>
                      <span style={{ fontSize: 10, fontWeight: 700, color: isPinned ? "rgba(251,191,36,0.9)" : "rgba(255,255,255,0.3)" }}>
                        {isPinned ? "Main" : "Pin"}
                      </span>
                    </button>
                  )}
                </div>
              );
              return (
                <div>
                  {pinned.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "rgba(251,191,36,0.7)", margin: 0 }}>⭐ Main Accounts</p>
                      <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", margin: "2px 0 0" }}>Pinned by admin · visible to everyone</p>
                    </div>
                  )}
                  {pinned.map((c) => <PickerRow key={c.id} c={c} isPinned />)}
                  {unpinned.length > 0 && (
                    <>
                      {pinned.length > 0 && (
                        <>
                          <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "rgba(255,255,255,0.25)", margin: "16px 0 8px" }}>
                            All Accounts
                          </p>
                          <button onClick={() => setPickerShowAll((v) => !v)}
                            style={{ width: "100%", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.35)", background: "none", border: "none", cursor: "pointer", padding: "4px 0 10px" }}>
                            {pickerShowAll ? "▲ Show less" : `▾ Show ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
                          </button>
                        </>
                      )}
                      {pinned.length === 0 && isAdminUser && (
                        <p style={{ fontSize: 12, color: "rgba(255,255,255,0.3)", margin: "0 0 12px", textAlign: "center" }}>
                          Press <strong style={{ color: "rgba(255,255,255,0.5)" }}>Pin</strong> to set main accounts for all users
                        </p>
                      )}
                      {(pickerShowAll || pinned.length === 0) && unpinned.map((c) => <PickerRow key={c.id} c={c} isPinned={false} />)}
                    </>
                  )}
                  {pinned.length === 0 && unpinned.length === 0 && (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", padding: 32 }}>No accounts found.</div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      <DashboardToolHeader
        icon={<GoogleAdsIcon />}
        title="Google Ads"
        subtitle="Campaign Dashboard"
      >
        {selectedCustomerId && allCampaignData.length > 0 && (
          <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                const ad = allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId));
                if (ad) {
                  sessionStorage.setItem("auditAccountData", JSON.stringify(ad));
                  sessionStorage.setItem(`auditAccountData:${selectedCustomerId}`, JSON.stringify(ad));
                }
                const params = new URLSearchParams({ customerId: selectedCustomerId });
                if (selectedCampaign) params.set("campaignId", String(selectedCampaign.campaignId));
                params.set("dateRange", dateRange);
                if (dateRange === "CUSTOM" && customDateRange?.startDate && customDateRange?.endDate) {
                  params.set("startDate", customDateRange.startDate);
                  params.set("endDate", customDateRange.endDate);
                }
                router.push(`/dashboard/google/ads/audit?${params.toString()}`);
              }}
              style={{ display: "flex", alignItems: "center", gap: 6, background: "rgba(233,69,96,0.15)", border: "1px solid rgba(233,69,96,0.35)", borderRadius: 10, padding: "6px 14px", fontSize: 12, fontWeight: 700, color: "#e94560", cursor: "pointer", transition: "background 0.15s", whiteSpace: "nowrap" }}
              onMouseEnter={(e) => e.currentTarget.style.background = "rgba(233,69,96,0.25)"}
              onMouseLeave={(e) => e.currentTarget.style.background = "rgba(233,69,96,0.15)"}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
              {selectedCampaign ? "Audit Campaign" : "Audit Account"}
            </button>
            <AccountDropdown
              accounts={allCampaignData.map((d) => ({
                id: String(d.customer.customer_client.id),
                name: d.customer.customer_client.descriptive_name,
              }))}
              selectedId={String(selectedCustomerId)}
              onChange={(id) => {
                localStorage.setItem(SELECTED_CUSTOMER_KEY, id);
                sessionStorage.setItem("gads_customer_id", id);
                setSelectedCustomerId(id);
                setSelectedCampaign(null);
              }}
              pinnedAccountIds={pinnedAccountIds}
              isAdminUser={isAdminUser}
              onTogglePin={handleTogglePin}
            />
            <CampaignDropdown
              campaigns={allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId))?.campaigns || []}
              selectedCampaign={selectedCampaign}
              onChange={handleCampaignSelect}
              onClear={() => setSelectedCampaign(null)}
            />
          </div>
        )}
      </DashboardToolHeader>

      {/* Mobile filter row */}
      <div className="mobile-only" style={{ display: "flex", gap: 8, padding: "8px 16px", background: "rgba(14,8,28,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0, alignItems: "center" }}>
        <button
          onClick={() => setFilterOpen(true)}
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}
        >
          Filters <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        {selectedCustomerId && allCampaignData.length > 0 && (
          <button
            onClick={() => {
              const ad = allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId));
              if (ad) {
                sessionStorage.setItem("auditAccountData", JSON.stringify(ad));
                sessionStorage.setItem(`auditAccountData:${selectedCustomerId}`, JSON.stringify(ad));
              }
              const params = new URLSearchParams({ customerId: selectedCustomerId });
              if (selectedCampaign) params.set("campaignId", String(selectedCampaign.campaignId));
              params.set("dateRange", dateRange);
              if (dateRange === "CUSTOM" && customDateRange?.startDate && customDateRange?.endDate) {
                params.set("startDate", customDateRange.startDate);
                params.set("endDate", customDateRange.endDate);
              }
              router.push(`/dashboard/google/ads/audit?${params.toString()}`);
            }}
            style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(233,69,96,0.15)", border: "1px solid rgba(233,69,96,0.35)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 700, color: "#e94560", cursor: "pointer", flexShrink: 0 }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/></svg>
            {selectedCampaign ? "Audit campaign" : "Audit"}
          </button>
        )}
        {selectedCustomerId && (
          <span style={{ display: "flex", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>
            {allCampaignData.find(d => String(d.customer.customer_client.id) === String(selectedCustomerId))?.customer?.customer_client?.descriptive_name || ""}
          </span>
        )}
      </div>

      {/* Mobile filter sheet */}
      <MobileFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={() => setFilterOpen(false)}
      >
        {selectedCustomerId && allCampaignData.length > 0 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Account</p>
              <AccountDropdown
                accounts={allCampaignData.map((d) => ({
                  id: String(d.customer.customer_client.id),
                  name: d.customer.customer_client.descriptive_name,
                }))}
                selectedId={String(selectedCustomerId)}
                onChange={(id) => {
                  localStorage.setItem(SELECTED_CUSTOMER_KEY, id);
                  sessionStorage.setItem("gads_customer_id", id);
                  setSelectedCustomerId(id);
                  setSelectedCampaign(null);
                }}
                pinnedAccountIds={pinnedAccountIds}
                isAdminUser={isAdminUser}
                onTogglePin={handleTogglePin}
              />
            </div>
            <div style={{ marginBottom: 4 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Campaign</p>
              <CampaignDropdown
                campaigns={allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId))?.campaigns || []}
                selectedCampaign={selectedCampaign}
                onChange={handleCampaignSelect}
                onClear={() => setSelectedCampaign(null)}
              />
            </div>
          </>
        )}
      </MobileFilterSheet>

      {/* ── Date range bar ── */}
      <div className="border-b border-white/10 bg-customPurple-dark px-6 py-3">
        <div className="mx-auto max-w-7xl flex items-center gap-2 flex-wrap">
          <span className="text-xs font-medium text-gray-400 mr-1">Date range:</span>
          {DATE_RANGE_OPTIONS.filter((o) => o.value !== "CUSTOM").map((o) => (
            <button key={o.value} onClick={() => handleDateRangeChange({ target: { value: o.value } })}
              className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                dateRange === o.value ? "bg-blue-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
              }`}>
              {o.label}
            </button>
          ))}
          <button onClick={() => handleDateRangeChange({ target: { value: "CUSTOM" } })}
            className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
              dateRange === "CUSTOM" ? "bg-blue-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
            }`}>
            Custom
          </button>
          {/* Status filter pills */}
          <div className="ml-4 flex items-center gap-2">
            <span className="text-xs font-medium text-gray-400">Status:</span>
            {CAMPAIGN_STATUS_OPTIONS.map((o) => (
              <button key={o.value} onClick={() => handleCampaignStatusFilterChange(o.value)}
                className={`rounded-full px-4 py-1.5 text-xs font-semibold transition ${
                  campaignStatusFilter === o.value ? "bg-purple-600 text-white" : "bg-white/10 text-gray-300 hover:bg-white/20"
                }`}>
                {o.label}
              </button>
            ))}
          </div>
          {/* Refresh */}
          <button onClick={refreshData} title="Refresh data"
            className="ml-auto rounded-full bg-white/10 hover:bg-white/20 transition px-3 py-1.5 text-xs font-medium text-gray-300 flex items-center gap-1.5">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh
          </button>
        </div>

        {/* Custom date row */}
        {dateRange === "CUSTOM" && (
          <div className="mx-auto max-w-7xl mt-3 flex items-end gap-3 flex-wrap">
            <label className="text-xs text-gray-400">
              From
              <input type="date" value={customDateRange.startDate}
                max={customDateRange.endDate || undefined}
                onChange={(e) => handleCustomDateChange("startDate", e.target.value)}
                className="ml-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-white" />
            </label>
            <label className="text-xs text-gray-400">
              To
              <input type="date" value={customDateRange.endDate}
                min={customDateRange.startDate || undefined}
                onChange={(e) => handleCustomDateChange("endDate", e.target.value)}
                className="ml-2 rounded-lg border border-white/10 bg-white/10 px-3 py-1.5 text-sm text-white" />
            </label>
            <button onClick={applyCustomDateRange}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-1.5 text-xs font-semibold text-white transition">Apply</button>
            {customDateError && <p className="text-xs text-red-400">{customDateError}</p>}
          </div>
        )}
      </div>

      {/* ── Content ── */}
      <div className="bg-gray-50 min-h-[calc(100vh-120px)]">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {isFetching && (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Refreshing dashboard data…
            </div>
          )}
          {dateWindowLabel && (
            <p className="text-xs text-gray-400 mb-4">
              Showing data for <span className="font-medium text-gray-600">{dateWindowLabel}</span>
              {lastUpdated && <span> · Last updated {lastUpdated}</span>}
            </p>
          )}
          {(() => {
            const selectedCustomer = allCampaignData.find(
              (item) => String(item.customer.customer_client.id) === String(selectedCustomerId)
            ) ?? null;
            return selectedCustomerId && allCampaignData.length > 0 && selectedCustomer ? (
              <AccountBriefCard
                selectedCustomer={selectedCustomer}
                currentDateRange={dateRange}
              />
            ) : null;
          })()}
          <ContentArea
            customerId={selectedCustomerId}
            selectedCampaign={selectedCampaign}
            allCampaignData={allCampaignData}
            handleCampaignSelect={handleCampaignSelect}
            dateRangeLabel={DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label}
          />
        </div>
      </div>
    </div>
  );
}
