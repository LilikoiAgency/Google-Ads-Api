"use client";
import { useEffect, useState } from "react";
import "../globals.css";
import Sidebar from "./components/Sidebar";
import ContentArea from "./components/ContentArea";

const DATE_RANGE_OPTIONS = [
  { value: "LAST_7_DAYS", label: "Last 7 days" },
  { value: "LAST_30_DAYS", label: "Last 30 days" },
  { value: "LAST_90_DAYS", label: "Last 90 days" },
  { value: "THIS_MONTH", label: "This month" },
];

const CACHE_VERSION = "v2";
const LAST_UPDATED_KEY = "lastUpdated";
const SELECTED_CUSTOMER_KEY = "selectedCustomerId";
const SELECTED_CAMPAIGN_KEY = "selectedCampaignSelection";
const SELECTED_DATE_RANGE_KEY = "selectedDateRange";
const CACHE_TTL_MS = 60 * 60 * 1000;

function getCampaignCacheKey(dateRange) {
  return `campaignData:${CACHE_VERSION}:${dateRange}`;
}

function getCampaignCacheTimeKey(dateRange) {
  return `campaignDataFetchedAt:${CACHE_VERSION}:${dateRange}`;
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

function getStoredCampaignData(dateRange) {
  const storedData = localStorage.getItem(getCampaignCacheKey(dateRange));
  const storedFetchedAt = localStorage.getItem(getCampaignCacheTimeKey(dateRange));

  if (!storedData || !storedFetchedAt) {
    return null;
  }

  if (Date.now() - Number(storedFetchedAt) > CACHE_TTL_MS) {
    localStorage.removeItem(getCampaignCacheKey(dateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange));
    return null;
  }

  try {
    const parsedData = JSON.parse(storedData);
    return Array.isArray(parsedData?.validCampaignsData) ? parsedData : null;
  } catch {
    localStorage.removeItem(getCampaignCacheKey(dateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange));
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
  const [allCampaignData, setAllCampaignData] = useState([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState(null);
  const [selectedCampaign, setSelectedCampaign] = useState(null);
  const [dateRange, setDateRange] = useState("LAST_7_DAYS");
  const [dateWindowLabel, setDateWindowLabel] = useState(null);
  const [isFetching, setIsFetching] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const updateLastUpdated = (date = new Date(), currentDateRange = dateRange) => {
    const formattedDate = date.toLocaleString();
    setLastUpdated(formattedDate);
    localStorage.setItem(`${LAST_UPDATED_KEY}:${currentDateRange}`, formattedDate);
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
  } = {}) => {
    setIsFetching(true);
    setError(null);

    if (!forceRefresh) {
      const cachedData = getStoredCampaignData(requestedDateRange);
      if (cachedData) {
        applyCampaignData(cachedData.validCampaignsData);
        setDateWindowLabel(formatDateWindow(cachedData.dateWindow));
        setLastUpdated(localStorage.getItem(`${LAST_UPDATED_KEY}:${requestedDateRange}`));
        setIsFetching(false);
        return;
      }
    }

    try {
      const response = await fetch(`/api?dateRange=${requestedDateRange}`, {
        cache: "no-store",
      });
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
        getCampaignCacheKey(requestedDateRange),
        JSON.stringify(cachedPayload)
      );
      localStorage.setItem(
        getCampaignCacheTimeKey(requestedDateRange),
        String(Date.now())
      );
      updateLastUpdated(new Date(), requestedDateRange);
      applyCampaignData(validCampaignsData);
      setDateWindowLabel(formatDateWindow(data.dateWindow));
    } catch (err) {
      setError(err.message || "Failed to fetch dashboard data");
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    const storedDateRange = localStorage.getItem(SELECTED_DATE_RANGE_KEY);
    const nextDateRange = DATE_RANGE_OPTIONS.some(
      (option) => option.value === storedDateRange
    )
      ? storedDateRange
      : "LAST_7_DAYS";
    const storedLastUpdated = localStorage.getItem(`${LAST_UPDATED_KEY}:${nextDateRange}`);
    setDateRange(nextDateRange);
    if (storedLastUpdated) {
      setLastUpdated(storedLastUpdated);
    }
    fetchData({ requestedDateRange: nextDateRange });
  }, []);

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

  const handleCustomerSelect = (customerId) => {
    setSelectedCustomerId(customerId);
    setSelectedCampaign(null);
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
  };

  const refreshData = () => {
    localStorage.removeItem(getCampaignCacheKey(dateRange));
    localStorage.removeItem(getCampaignCacheTimeKey(dateRange));
    fetchData({ forceRefresh: true, requestedDateRange: dateRange });
  };

  const handleDateRangeChange = (event) => {
    const nextDateRange = event.target.value;
    setDateRange(nextDateRange);
    setSelectedCampaign(null);
    const storedLastUpdated = localStorage.getItem(`${LAST_UPDATED_KEY}:${nextDateRange}`);
    setLastUpdated(storedLastUpdated);
    setDateWindowLabel(null);
    fetchData({ requestedDateRange: nextDateRange });
  };

  if (isFetching && allCampaignData.length === 0 && !error) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-white">
        <h2 className="text-2xl text-customPurple mb-4">
          Pulling Data From Google....
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
    <div className="flex min-h-screen flex-col bg-customPurple-dark sm:flex-row">
      <aside className="w-full flex-shrink-0 bg-customPurple-dark sm:w-80 sm:min-w-[16rem]">
        <Sidebar
          customers={allCampaignData}
          selectedCustomerId={selectedCustomerId}
          selectedCampaign={selectedCampaign}
          handleCustomerSelect={handleCustomerSelect}
          handleCampaignSelect={handleCampaignSelect}
          lastUpdated={lastUpdated}
          refreshData={refreshData}
        />
      </aside>

      <main className="mt-4 flex-1 min-w-0 bg-gray-50 p-4 sm:mr-4 sm:mt-8 sm:rounded-t-2xl sm:p-6">
        <div className="mb-6 flex flex-col gap-3 rounded-2xl bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-wide text-gray-500">
              Reporting Range
            </p>
            <p className="text-lg font-semibold text-customPurple">
              {DATE_RANGE_OPTIONS.find((option) => option.value === dateRange)?.label}
            </p>
            <p className="mt-1 text-sm text-gray-500">
              {dateWindowLabel || "Fetching date window..."}
            </p>
          </div>
          <label className="flex items-center gap-3 text-sm text-gray-600">
            <span>Date range</span>
            <select
              className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
              onChange={handleDateRangeChange}
              value={dateRange}
            >
              {DATE_RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
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
  );
}
