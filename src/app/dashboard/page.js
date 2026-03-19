"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import "../globals.css";
import Sidebar from "./components/Sidebar";
import ContentArea from "./components/ContentArea";

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
    return `${dateRange}:${customDateRange?.startDate || "unset"}:${
      customDateRange?.endDate || "unset"
    }`;
  }

  return dateRange;
}

function getCampaignCacheKey(dateRange, statusFilter, customDateRange) {
  return `campaignData:${CACHE_VERSION}:${getDateSelectionKey(
    dateRange,
    customDateRange
  )}:${statusFilter}`;
}

function getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange) {
  return `campaignDataFetchedAt:${CACHE_VERSION}:${getDateSelectionKey(
    dateRange,
    customDateRange
  )}:${statusFilter}`;
}

function getLastUpdatedKey(dateRange, statusFilter, customDateRange) {
  return `${LAST_UPDATED_KEY}:${getDateSelectionKey(dateRange, customDateRange)}:${statusFilter}`;
}

function formatDateWindow(dateWindow) {
  if (!dateWindow?.startDate || !dateWindow?.endDate) {
    return null;
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `${formatter.format(new Date(dateWindow.startDate))} - ${formatter.format(
    new Date(dateWindow.endDate)
  )}`;
}

function getStoredCampaignData(dateRange, statusFilter, customDateRange) {
  const storedData = localStorage.getItem(
    getCampaignCacheKey(dateRange, statusFilter, customDateRange)
  );
  const storedFetchedAt = localStorage.getItem(
    getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange)
  );

  if (!storedData || !storedFetchedAt) {
    return null;
  }

  if (Date.now() - Number(storedFetchedAt) > CACHE_TTL_MS) {
    localStorage.removeItem(getCampaignCacheKey(dateRange, statusFilter, customDateRange));
    localStorage.removeItem(
      getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange)
    );
    return null;
  }

  try {
    const parsedData = JSON.parse(storedData);
    return Array.isArray(parsedData?.validCampaignsData) ? parsedData : null;
  } catch {
    localStorage.removeItem(getCampaignCacheKey(dateRange, statusFilter, customDateRange));
    localStorage.removeItem(
      getCampaignCacheTimeKey(dateRange, statusFilter, customDateRange)
    );
    return null;
  }
}

function resolveSelectedCampaign(campaignData, customerId, campaignSelection) {
  if (!customerId || !campaignSelection?.campaignId) {
    return null;
  }

  const selectedCustomer = campaignData.find(
    (item) => item.customer.customer_client.id === customerId
  );

  if (!selectedCustomer) {
    return null;
  }

  return (
    selectedCustomer.campaigns?.find(
      (campaign) => campaign.campaignId === campaignSelection.campaignId
    ) || null
  );
}

export default function Dashboard() {
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

  const updateLastUpdated = (
    date = new Date(),
    currentDateRange = dateRange,
    currentStatusFilter = campaignStatusFilter,
    currentCustomDateRange = customDateRange
  ) => {
    const formattedDate = date.toLocaleString();
    setLastUpdated(formattedDate);
    localStorage.setItem(
      getLastUpdatedKey(
        currentDateRange,
        currentStatusFilter,
        currentCustomDateRange
      ),
      formattedDate
    );
  };

  const applyCampaignData = (campaignData) => {
    const storedCustomerId = localStorage.getItem(SELECTED_CUSTOMER_KEY);
    const storedCampaignSelection = localStorage.getItem(SELECTED_CAMPAIGN_KEY);
    let parsedCampaignSelection = null;

    if (storedCampaignSelection) {
      try {
        parsedCampaignSelection = JSON.parse(storedCampaignSelection);
      } catch {
        localStorage.removeItem(SELECTED_CAMPAIGN_KEY);
      }
    }

    const nextSelectedCustomerId =
      storedCustomerId &&
      campaignData.some((item) => item.customer.customer_client.id === storedCustomerId)
        ? storedCustomerId
        : campaignData[0]?.customer.customer_client.id || null;

    const nextSelectedCampaign = resolveSelectedCampaign(
      campaignData,
      nextSelectedCustomerId,
      parsedCampaignSelection
    );

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
    if (status !== "authenticated") {
      return;
    }

    setIsFetching(true);
    setError(null);

    if (!forceRefresh) {
      const cachedData = getStoredCampaignData(
        requestedDateRange,
        requestedStatusFilter,
        requestedCustomDateRange
      );
      if (cachedData) {
        applyCampaignData(cachedData.validCampaignsData);
        setDateWindowLabel(formatDateWindow(cachedData.dateWindow));
        setLastUpdated(
          localStorage.getItem(
            getLastUpdatedKey(
              requestedDateRange,
              requestedStatusFilter,
              requestedCustomDateRange
            )
          )
        );
        setIsFetching(false);
        return;
      }
    }

    try {
      const queryParams = new URLSearchParams({
        dateRange: requestedDateRange,
        statusFilter: requestedStatusFilter,
      });

      if (requestedDateRange === "CUSTOM") {
        queryParams.set("startDate", requestedCustomDateRange.startDate);
        queryParams.set("endDate", requestedCustomDateRange.endDate);
      }

      const response = await fetch(`/api?${queryParams.toString()}`, {
        cache: "no-store",
      });
      if (response.status === 401) {
        router.replace("/?callbackUrl=/dashboard");
        return;
      }
      if (!response.ok) {
        throw new Error("Failed to fetch dashboard data");
      }

      const data = await response.json();
      const validCampaignsData = data.validCampaignsData || [];
      const cachedPayload = {
        validCampaignsData,
        dateWindow: data.dateWindow || null,
      };
      localStorage.setItem(
        getCampaignCacheKey(
          requestedDateRange,
          requestedStatusFilter,
          requestedCustomDateRange
        ),
        JSON.stringify(cachedPayload)
      );
      localStorage.setItem(
        getCampaignCacheTimeKey(
          requestedDateRange,
          requestedStatusFilter,
          requestedCustomDateRange
        ),
        String(Date.now())
      );
      updateLastUpdated(
        new Date(),
        requestedDateRange,
        requestedStatusFilter,
        requestedCustomDateRange
      );
      applyCampaignData(validCampaignsData);
      setDateWindowLabel(formatDateWindow(data.dateWindow));
    } catch (err) {
      setError(err.message || "Failed to fetch dashboard data");
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
      return;
    }

    if (status !== "authenticated") {
      return;
    }

    const storedDateRange = localStorage.getItem(SELECTED_DATE_RANGE_KEY);
    const nextDateRange = DATE_RANGE_OPTIONS.some(
      (option) => option.value === storedDateRange
    )
      ? storedDateRange
      : "LAST_7_DAYS";
    const storedStatusFilter = localStorage.getItem(SELECTED_STATUS_FILTER_KEY);
    const nextStatusFilter = CAMPAIGN_STATUS_OPTIONS.some(
      (option) => option.value === storedStatusFilter
    )
      ? storedStatusFilter
      : "ACTIVE";
    let nextCustomDateRange = getDefaultCustomDateRange();
    const storedCustomDateRange = localStorage.getItem(CUSTOM_DATE_RANGE_KEY);
    if (storedCustomDateRange) {
      try {
        const parsedCustomDateRange = JSON.parse(storedCustomDateRange);
        if (parsedCustomDateRange?.startDate && parsedCustomDateRange?.endDate) {
          nextCustomDateRange = parsedCustomDateRange;
        }
      } catch {
        localStorage.removeItem(CUSTOM_DATE_RANGE_KEY);
      }
    }
    const storedLastUpdated = localStorage.getItem(
      getLastUpdatedKey(nextDateRange, nextStatusFilter, nextCustomDateRange)
    );
    setDateRange(nextDateRange);
    setCampaignStatusFilter(nextStatusFilter);
    setCustomDateRange(nextCustomDateRange);
    if (storedLastUpdated) {
      setLastUpdated(storedLastUpdated);
    }
    fetchData({
      requestedDateRange: nextDateRange,
      requestedStatusFilter: nextStatusFilter,
      requestedCustomDateRange: nextCustomDateRange,
    });
  }, [router, status]);

  useEffect(() => {
    if (selectedCustomerId) {
      localStorage.setItem(SELECTED_CUSTOMER_KEY, selectedCustomerId);
    } else {
      localStorage.removeItem(SELECTED_CUSTOMER_KEY);
    }
  }, [selectedCustomerId]);

  useEffect(() => {
    if (selectedCampaign && selectedCustomerId) {
      localStorage.setItem(
        SELECTED_CAMPAIGN_KEY,
        JSON.stringify({
          customerId: selectedCustomerId,
          campaignId: selectedCampaign.campaignId,
        })
      );
    } else {
      localStorage.removeItem(SELECTED_CAMPAIGN_KEY);
    }
  }, [selectedCampaign, selectedCustomerId]);

  useEffect(() => {
    localStorage.setItem(SELECTED_DATE_RANGE_KEY, dateRange);
  }, [dateRange]);

  useEffect(() => {
    localStorage.setItem(SELECTED_STATUS_FILTER_KEY, campaignStatusFilter);
  }, [campaignStatusFilter]);

  useEffect(() => {
    localStorage.setItem(CUSTOM_DATE_RANGE_KEY, JSON.stringify(customDateRange));
  }, [customDateRange]);

  const handleCustomerSelect = (customerId) => {
    setSelectedCustomerId(customerId);
    setSelectedCampaign(null);
    setIsSidebarOpen(false);
  };

  const handleCampaignSelect = (campaignId) => {
    const selectedCustomer = allCampaignData.find(
      (item) => item.customer.customer_client.id === selectedCustomerId
    );
    const campaign =
      selectedCustomer?.campaigns?.find(
        (item) => item.campaignId === campaignId
      ) || null;
    setSelectedCampaign(campaign);
    setIsSidebarOpen(false);
  };

  const refreshData = () => {
    localStorage.removeItem(
      getCampaignCacheKey(dateRange, campaignStatusFilter, customDateRange)
    );
    localStorage.removeItem(
      getCampaignCacheTimeKey(dateRange, campaignStatusFilter, customDateRange)
    );
    fetchData({
      forceRefresh: true,
      requestedDateRange: dateRange,
      requestedStatusFilter: campaignStatusFilter,
      requestedCustomDateRange: customDateRange,
    });
  };

  const handleDateRangeChange = (event) => {
    const nextDateRange = event.target.value;
    setCustomDateError(null);
    setDateRange(nextDateRange);
    setSelectedCampaign(null);
    const storedLastUpdated = localStorage.getItem(
      getLastUpdatedKey(nextDateRange, campaignStatusFilter, customDateRange)
    );
    setLastUpdated(storedLastUpdated);
    setDateWindowLabel(null);
    if (nextDateRange !== "CUSTOM") {
      fetchData({
        requestedDateRange: nextDateRange,
        requestedStatusFilter: campaignStatusFilter,
        requestedCustomDateRange: customDateRange,
      });
    }
  };

  const handleCampaignStatusFilterChange = (nextStatusFilter) => {
    setCustomDateError(null);
    setCampaignStatusFilter(nextStatusFilter);
    setSelectedCampaign(null);
    const storedLastUpdated = localStorage.getItem(
      getLastUpdatedKey(dateRange, nextStatusFilter)
    );
    setLastUpdated(storedLastUpdated);
    setDateWindowLabel(null);
    fetchData({
      requestedDateRange: dateRange,
      requestedStatusFilter: nextStatusFilter,
      requestedCustomDateRange: customDateRange,
    });
  };

  const handleCustomDateChange = (field, value) => {
    setCustomDateError(null);
    setCustomDateRange((currentValue) => ({
      ...currentValue,
      [field]: value,
    }));
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
    const storedLastUpdated = localStorage.getItem(
      getLastUpdatedKey("CUSTOM", campaignStatusFilter, customDateRange)
    );
    setLastUpdated(storedLastUpdated);
    setDateWindowLabel(null);
    fetchData({
      requestedDateRange: "CUSTOM",
      requestedStatusFilter: campaignStatusFilter,
      requestedCustomDateRange: customDateRange,
    });
  };

  if (status === "loading" || (isFetching && allCampaignData.length === 0 && !error)) {
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
          <h2 className="text-xl font-semibold text-customPurple">
            Dashboard unavailable
          </h2>
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
      <header className="border-b border-white/10 bg-customPurple-dark px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
              alt="Lilikoi Agency"
              className="h-10 w-10 rounded-full"
            />
            <div>
              <p className="text-lg font-semibold text-white">Lilikoi Agency</p>
              <p className="text-sm text-gray-300">Google Ads Dashboard</p>
            </div>
          </div>
          <div className="hidden rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs font-medium uppercase tracking-[0.22em] text-gray-300 sm:block">
            Internal reporting
          </div>
        </div>
      </header>

      <div className="flex flex-col sm:flex-row">
        <aside
          className={`w-full flex-shrink-0 bg-customPurple-dark sm:w-80 sm:min-w-[16rem] ${
            isSidebarOpen ? "block" : "hidden"
          } sm:block`}
        >
          <Sidebar
            customers={allCampaignData}
            selectedCustomerId={selectedCustomerId}
            selectedCampaign={selectedCampaign}
            handleCustomerSelect={handleCustomerSelect}
            handleCampaignSelect={handleCampaignSelect}
            campaignStatusFilter={campaignStatusFilter}
            campaignStatusOptions={CAMPAIGN_STATUS_OPTIONS}
            onCampaignStatusFilterChange={handleCampaignStatusFilterChange}
            lastUpdated={lastUpdated}
            refreshData={refreshData}
            closeSidebar={() => setIsSidebarOpen(false)}
          />
        </aside>

        <main className="min-w-0 flex-1 bg-gray-50 p-4 sm:mr-4 sm:mt-8 sm:rounded-t-2xl sm:p-6">
          <div className="mb-4 flex items-center justify-between rounded-2xl bg-white p-4 shadow-sm sm:hidden">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Account Navigation
              </p>
              <p className="mt-1 text-sm font-semibold text-customPurple">
                {selectedCampaign?.campaignName ||
                  allCampaignData.find(
                    (item) => item.customer.customer_client.id === selectedCustomerId
                  )?.customer.customer_client.descriptive_name ||
                  "Select an account"}
              </p>
            </div>
            <button
              className="rounded-xl bg-customPurple px-4 py-2 text-sm font-semibold text-white hover:bg-customPurple-light"
              onClick={() => setIsSidebarOpen((currentValue) => !currentValue)}
              type="button"
            >
              {isSidebarOpen ? "Close" : "Accounts"}
            </button>
          </div>
          <div className="mb-6 rounded-2xl bg-white p-4 shadow-sm sm:p-5">
            <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
                  Reporting Range
                </p>
                <p className="mt-1 text-lg font-semibold text-customPurple">
                  {DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label}
                </p>
                <p className="mt-1 text-sm text-gray-500">
                  {dateWindowLabel || "Fetching date window..."}
                </p>
              </div>

              <div className="w-full max-w-2xl">
                <div className="flex flex-col gap-2">
                  <label className="text-sm font-medium text-gray-600">
                    Time frame
                  </label>
                  <select
                    className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm"
                    onChange={handleDateRangeChange}
                    value={dateRange}
                  >
                    {DATE_RANGE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
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
                          onChange={(event) =>
                            handleCustomDateChange("startDate", event.target.value)
                          }
                          type="date"
                          value={customDateRange.startDate}
                        />
                      </label>
                      <label className="flex-1 text-sm text-gray-600">
                        <span className="mb-2 block font-medium text-gray-700">To</span>
                        <input
                          className="w-full rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm text-gray-800 shadow-sm"
                          min={customDateRange.startDate || undefined}
                          onChange={(event) =>
                            handleCustomDateChange("endDate", event.target.value)
                          }
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
                    {customDateError && (
                      <p className="mt-3 text-sm text-red-600">{customDateError}</p>
                    )}
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
            dateRangeLabel={
              DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label
            }
          />
        </main>
      </div>
    </div>
  );
}
