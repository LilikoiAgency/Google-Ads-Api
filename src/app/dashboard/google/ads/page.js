"use client";
import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../../globals.css";
import Sidebar from "../../components/Sidebar";
import ContentArea from "../../components/ContentArea";

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

function AccountDropdown({ accounts, selectedId, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = accounts.find((a) => a.id === selectedId);

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
          {accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => { onChange(a.id); setOpen(false); }}
              className={`flex items-center justify-between w-full px-4 py-3 text-sm text-left transition hover:bg-gray-50 ${
                a.id === selectedId ? "bg-purple-50 text-purple-700 font-semibold" : "text-gray-700"
              }`}
            >
              <div>
                <p className="font-medium">{a.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">ID: {a.id}</p>
              </div>
              {a.id === selectedId && (
                <svg className="w-4 h-4 text-purple-600 flex-shrink-0 ml-3" fill="none" viewBox="0 0 24 24">
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

export default function GoogleAdsDashboard() {
  const router = useRouter();
  const { status } = useSession();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
      const response = await fetch(`/api?${queryParams.toString()}`, { cache: "no-store" });
      if (response.status === 401) {
        router.replace("/?callbackUrl=/dashboard/google/ads");
        return;
      }
      if (!response.ok) throw new Error("Failed to fetch dashboard data");
      const data = await response.json();
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
    const savedId = sessionStorage.getItem("gads_customer_id");
    if (savedId) {
      setShowPicker(false); // skip picker — we remember their choice
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
    setIsSidebarOpen(false);
  };

  const handleCampaignSelect = (campaignId) => {
    const selectedCustomer = allCampaignData.find((item) => String(item.customer.customer_client.id) === String(selectedCustomerId));
    const campaign = selectedCustomer?.campaigns?.find((item) => item.campaignId === campaignId) || null;
    setSelectedCampaign(campaign);
    setIsSidebarOpen(false);
  };

  const refreshData = () => {
    localStorage.removeItem(getCampaignCacheKey(dateRange, campaignStatusFilter, customDateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange, campaignStatusFilter, customDateRange));
    fetchData({ forceRefresh: true, requestedDateRange: dateRange, requestedStatusFilter: campaignStatusFilter, requestedCustomDateRange: customDateRange });
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
            ) : pickerCustomers.length === 0 ? (
              <div className="rounded-2xl bg-white/10 p-8 text-center text-gray-400 text-sm">No accounts found.</div>
            ) : (
              <div className="space-y-2">
                {pickerCustomers.map((c) => (
                  <button key={c.id} onClick={() => {
                    sessionStorage.setItem("gads_customer_id", c.id);
                    localStorage.setItem(SELECTED_CUSTOMER_KEY, c.id);
                    setShowPicker(false);
                  }}
                    className="w-full flex items-center gap-4 rounded-2xl bg-white/10 border border-white/10 px-5 py-4 hover:bg-white/20 hover:border-white/20 transition text-left group"
                  >
                    <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-white/10 group-hover:bg-white/20 transition flex-shrink-0">
                      <svg viewBox="0 0 48 48" className="w-5 h-5"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{c.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">ID: {c.id}</p>
                    </div>
                    <svg className="w-5 h-5 text-gray-500 group-hover:text-white transition flex-shrink-0" fill="none" viewBox="0 0 24 24">
                      <path d="M9 18l6-6-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                ))}
              </div>
            )}
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
      <header className="border-b border-white/10 bg-customPurple-dark px-6 py-4">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/10 hover:bg-white/20 transition text-white text-sm" title="Back to Dashboard">
              ←
            </Link>
            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-white flex-shrink-0">
              <svg viewBox="0 0 48 48" className="w-6 h-6"><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Google Ads</p>
              <p className="text-sm text-gray-400">Campaign Dashboard</p>
            </div>
          </div>
          {/* Account dropdown */}
          {selectedCustomerId && allCampaignData.length > 0 && (
            <AccountDropdown
              accounts={allCampaignData.map(d => ({
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
            />
          )}
        </div>
      </header>

      <div className="flex flex-col sm:flex-row">
        <aside className={`w-full flex-shrink-0 bg-customPurple-dark sm:w-80 sm:min-w-[16rem] ${isSidebarOpen ? "block" : "hidden"} sm:block`}>
          <Sidebar
            currentCustomerName={allCampaignData.find(d => String(d.customer.customer_client.id) === String(selectedCustomerId))?.customer.customer_client.descriptive_name}
            campaigns={allCampaignData.find(d => String(d.customer.customer_client.id) === String(selectedCustomerId))?.campaigns || []}
            selectedCampaign={selectedCampaign}
            handleCampaignSelect={handleCampaignSelect}
            campaignStatusFilter={campaignStatusFilter}
            campaignStatusOptions={CAMPAIGN_STATUS_OPTIONS}
            onCampaignStatusFilterChange={handleCampaignStatusFilterChange}
            onClearCampaign={() => { setSelectedCampaign(null); setIsSidebarOpen(false); }}
            lastUpdated={lastUpdated}
            refreshData={refreshData}
            closeSidebar={() => setIsSidebarOpen(false)}
          />
        </aside>

        <main className="min-w-0 flex-1 bg-gray-50 p-4 sm:mr-4 sm:mt-8 sm:rounded-t-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm sm:hidden">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Account Navigation</p>
              <p className="mt-1 text-sm font-semibold text-customPurple">
                {selectedCampaign?.campaignName ||
                  allCampaignData.find((item) => item.customer.customer_client.id === selectedCustomerId)?.customer.customer_client.descriptive_name ||
                  "Select an account"}
              </p>
            </div>
            <button
              className="rounded-xl bg-customPurple px-4 py-2 text-sm font-semibold text-white hover:bg-customPurple-light"
              onClick={() => setIsSidebarOpen((v) => !v)}
              type="button"
            >
              {isSidebarOpen ? "Close" : "Campaigns"}
            </button>
          </div>

          <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">Reporting Range</p>
                <p className="mt-1 text-lg font-semibold text-customPurple">
                  {DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label}
                </p>
                <p className="mt-1 text-sm text-gray-500">{dateWindowLabel || "Fetching date window..."}</p>
              </div>
              <div className="w-full max-w-2xl">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-600">Time frame</label>
                  <select
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm"
                    onChange={handleDateRangeChange}
                    value={dateRange}
                  >
                    {DATE_RANGE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
                {dateRange === "CUSTOM" && (
                  <div className="mt-4 rounded-2xl border border-purple-100 bg-purple-50/60 p-4">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-end">
                      <label className="flex-1 text-sm text-gray-600">
                        <span className="mb-2 block font-medium text-gray-700">From</span>
                        <input
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm"
                          max={customDateRange.endDate || undefined}
                          onChange={(e) => handleCustomDateChange("startDate", e.target.value)}
                          type="date"
                          value={customDateRange.startDate}
                        />
                      </label>
                      <label className="flex-1 text-sm text-gray-600">
                        <span className="mb-2 block font-medium text-gray-700">To</span>
                        <input
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm"
                          min={customDateRange.startDate || undefined}
                          onChange={(e) => handleCustomDateChange("endDate", e.target.value)}
                          type="date"
                          value={customDateRange.endDate}
                        />
                      </label>
                      <button
                        className="rounded-xl bg-customPurple px-5 py-3 text-sm font-semibold text-white hover:bg-customPurple-light"
                        onClick={applyCustomDateRange}
                        type="button"
                      >
                        Apply dates
                      </button>
                    </div>
                    {customDateError && <p className="mt-3 text-sm text-red-600">{customDateError}</p>}
                  </div>
                )}
              </div>
            </div>
          </div>

          {isFetching && (
            <div className="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
              Refreshing dashboard data for this date range...
            </div>
          )}

          <ContentArea
            customerId={selectedCustomerId}
            selectedCampaign={selectedCampaign}
            allCampaignData={allCampaignData}
            handleCampaignSelect={handleCampaignSelect}
            dateRangeLabel={DATE_RANGE_OPTIONS.find((o) => o.value === dateRange)?.label}
          />
        </main>
      </div>
    </div>
  );
}
