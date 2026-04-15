"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../../globals.css";
import ContentArea from "../../components/ContentArea";
import { isAdmin } from "../../../../lib/admins";
import { sortWithPinned } from "../../../../lib/googleAdsHelpers";

// Priority clients — shown first in every account list (order matters)
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

  const StarButton = ({ accountId, isPinned }) =>
    isAdminUser ? (
      <button
        onClick={(e) => { e.stopPropagation(); onTogglePin(accountId); }}
        title={isPinned ? "Unpin account" : "Pin account"}
        className="ml-2 text-base leading-none flex-shrink-0 hover:scale-110 transition-transform"
      >
        {isPinned ? "⭐" : "☆"}
      </button>
    ) : null;

  const AccountRow = ({ a, isPinned }) => (
    <button
      key={a.id}
      onClick={() => { onChange(a.id); setOpen(false); }}
      className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
        a.id === selectedId ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium truncate">{a.name}</p>
        <p className="text-xs text-gray-400 mt-0.5">ID: {a.id}</p>
      </div>
      <div className="flex items-center ml-3 flex-shrink-0">
        <StarButton accountId={a.id} isPinned={isPinned} />
        {a.id === selectedId && (
          <svg className="w-4 h-4 text-purple-600 ml-2" fill="none" viewBox="0 0 24 24">
            <path d="M5 13l4 4L19 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </div>
    </button>
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
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[240px] rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
          {pinned.map((a) => <AccountRow key={a.id} a={a} isPinned />)}

          {unpinned.length > 0 && (
            <>
              <button
                onClick={(e) => { e.stopPropagation(); setShowAll((v) => !v); }}
                className="w-full px-4 py-2 text-xs text-gray-400 text-left hover:bg-gray-50 border-t border-gray-100 flex items-center gap-1"
              >
                {showAll ? "▲ Show less" : `▾ ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
              </button>
              {showAll && unpinned.map((a) => <AccountRow key={a.id} a={a} isPinned={false} />)}
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
    const optimistic = pinnedAccountIds.includes(accountId)
      ? pinnedAccountIds.filter((id) => id !== accountId)
      : [...pinnedAccountIds, accountId];
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
      setPinnedAccountIds(pinnedAccountIds);
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

  // ── Account picker screen ──────────────────────────────────────────────────
  if (showPicker === true) {
    return (
      <div className="min-h-screen bg-customPurple-dark flex flex-col">
        <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3">
          <Link href="/dashboard" className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-sm" title="Home">←</Link>
          <img src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png" alt="Lilikoi" className="h-10 w-10 rounded-full" />
          <div>
            <p className="text-lg font-semibold text-white">Google Ads</p>
            <p className="text-sm text-gray-400">Select an account to continue</p>
          </div>
        </header>
        <div className="flex-1 flex items-start justify-center pt-16 px-6">
          <div className="w-full max-w-lg">
            <div className="text-center mb-8">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-white shadow-sm border border-gray-100 mb-4">
                <svg viewBox="0 0 48 48" className="w-8 h-8"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              </div>
              <h2 className="text-xl font-bold text-white mb-1">Select a Google Ads Account</h2>
              <p className="text-sm text-gray-400">Your selection will be remembered for this session</p>
            </div>
            {pickerLoading ? (
              <div className="space-y-3">{[...Array(4)].map((_, i) => <div key={i} className="h-16 rounded-2xl bg-white/10 animate-pulse" />)}</div>
            ) : (() => {
              const { pinned, unpinned } = sortWithPinned(pickerCustomers, pinnedAccountIds);

              const PickerRow = ({ c, isPinned }) => (
                <div key={c.id} className="relative">
                  <button
                    onClick={() => {
                      sessionStorage.setItem("gads_customer_id", c.id);
                      localStorage.setItem(SELECTED_CUSTOMER_KEY, c.id);
                      setShowPicker(false);
                    }}
                    className="w-full flex items-center gap-4 rounded-2xl bg-white/10 border border-white/10 px-5 py-4 hover:bg-white/20 hover:border-white/20 transition text-left"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 flex-shrink-0">
                      <svg viewBox="0 0 48 48" className="w-5 h-5"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {c.id}</p>
                    </div>
                    {isPinned
                      ? <span className="text-base flex-shrink-0">⭐</span>
                      : <svg className="w-5 h-5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    }
                  </button>
                  {isAdminUser && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleTogglePin(c.id); }}
                      title={isPinned ? "Unpin account" : "Pin account"}
                      className="absolute top-3 right-3 text-lg leading-none opacity-60 hover:opacity-100 transition-opacity"
                    >
                      {isPinned ? "⭐" : "☆"}
                    </button>
                  )}
                </div>
              );

              return (
                <div className="space-y-2">
                  {pinned.map((c) => <PickerRow key={c.id} c={c} isPinned />)}
                  {unpinned.length > 0 && (
                    <>
                      <button
                        onClick={() => setPickerShowAll((v) => !v)}
                        className="w-full text-center text-sm text-gray-400 hover:text-gray-300 py-2 transition"
                      >
                        {pickerShowAll ? "▲ Show less" : `▾ Show ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
                      </button>
                      {pickerShowAll && unpinned.map((c) => <PickerRow key={c.id} c={c} isPinned={false} />)}
                    </>
                  )}
                  {pinned.length === 0 && unpinned.length === 0 && (
                    <div className="rounded-2xl bg-white/10 p-8 text-center text-gray-400 text-sm">No accounts found.</div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      </div>
    );
  }

  if (showPicker === null || status === "loading" || (showPicker === false && isFetching && allCampaignData.length === 0 && !error)) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-white">
        <h2 className="text-2xl text-customPurple mb-4">
          {status === "loading" ? "Checking login..." : "Pulling Data From Google...."}
        </h2>
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          className="w-100 h-100"
        />
      </div>
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
    <div className="min-h-screen bg-customPurple-dark">

      {/* ── Header ── */}
      <header className="border-b border-white/10 bg-customPurple-dark px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-sm" title="Back to Dashboard">←</Link>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white flex-shrink-0">
              <svg viewBox="0 0 48 48" className="w-6 h-6"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Google Ads</p>
              <p className="text-sm text-gray-400">Campaign Dashboard</p>
            </div>
          </div>
          {selectedCustomerId && allCampaignData.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap">
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
        </div>
      </header>

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
