"use client";

import Link from "next/link";
import { SignOutButton } from "../../components/AuthActions";

export default function Sidebar({
  customers,
  selectedCustomerId,
  selectedCampaign,
  handleCustomerSelect,
  handleCampaignSelect,
  campaignStatusFilter,
  campaignStatusOptions,
  onCampaignStatusFilterChange,
  lastUpdated,
  refreshData,
  closeSidebar,
}) {
  const visibleCustomers = customers.filter((item) => item.campaigns?.length > 0);

  return (
    <div className="flex h-auto w-full flex-col bg-customPurple-dark p-4 shadow-lg sm:h-screen sm:w-80 sm:p-6">
      <div className="mb-4 flex items-center justify-end sm:mb-6">
        <button
          className="rounded-lg border border-white/20 px-3 py-2 text-sm font-medium text-white hover:bg-white/10 sm:hidden"
          onClick={closeSidebar}
          type="button"
        >
          Close
        </button>
      </div>

      <div className="mb-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <label className="block text-xs font-medium uppercase tracking-[0.24em] text-gray-400">
          Status
        </label>
        <div className="relative mt-3">
          <select
            className="w-full appearance-none rounded-xl border border-white/10 bg-white/10 px-4 py-3 pr-10 text-sm font-semibold text-white outline-none transition hover:bg-white/15 focus:border-white/30 focus:bg-white/15"
            onChange={(event) => onCampaignStatusFilterChange(event.target.value)}
            value={campaignStatusFilter}
          >
            {campaignStatusOptions.map((option) => (
              <option key={option.value} value={option.value} className="text-slate-900">
                {option.label}
              </option>
            ))}
          </select>
          <svg
            aria-hidden="true"
            className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M6 9l6 6 6-6"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.8"
            />
          </svg>
        </div>
      </div>

      <div className="sidebar-scrollbar flex-1 overflow-y-auto pr-1 sm:pr-1">
        {visibleCustomers.length === 0 ? (
          <div className="rounded-xl bg-customPurple p-4 text-sm text-gray-200">
            No campaign data is available yet for the connected accounts.
          </div>
        ) : (
          <ul>
            {visibleCustomers.map((item) => {
              const customerId = item.customer.customer_client.id;
              const customerName = item.customer.customer_client.descriptive_name;
              const sortedCampaigns = item.campaigns
                .slice()
                .sort((a, b) => (b.conversions || 0) - (a.conversions || 0));

              return (
                <li key={customerId} className="mb-4">
                  <button
                    className={`w-full rounded-xl px-4 py-2 text-left text-gray-300 ${
                      selectedCustomerId === customerId
                        ? "bg-customPurple-light text-white"
                        : "hover:bg-customPurple hover:text-white"
                    }`}
                    onClick={() => handleCustomerSelect(customerId)}
                  >
                    <div className="font-medium">{customerName}</div>
                    <div className="text-xs text-gray-400">
                      {item.campaigns.length} campaigns
                    </div>
                  </button>

                  {selectedCustomerId === customerId && sortedCampaigns.length > 0 && (
                    <ul className="mt-2">
                      {sortedCampaigns.map((campaign, index) => (
                        <li key={campaign.campaignId} className="ml-4">
                          <button
                            id={`campaign-${campaign.campaignId}`}
                            className={`w-full rounded-xl px-4 py-2 text-left text-gray-300 ${
                              selectedCampaign?.campaignId === campaign.campaignId
                                ? "bg-customPurple-light text-white"
                                : "hover:bg-customPurple hover:text-white"
                            }`}
                            onClick={() => handleCampaignSelect(campaign.campaignId)}
                          >
                            <span className="mr-2 text-xs text-gray-400">
                              #{index + 1}
                            </span>
                            {campaign.campaignName}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mt-8 border-t border-white/10 pt-5">
        <Link
          href="/report"
          className="mb-4 flex w-full items-center gap-2 rounded-xl bg-white/10 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/20"
        >
          <span>📊</span>
          <span>Paid vs. Organic Report</span>
        </Link>
        <div className="text-sm text-gray-400">
          Last Updated: {lastUpdated || "Not synced yet"}
        </div>
        <button
          className="mt-2 w-full rounded-lg bg-blue-800 px-4 py-2 text-white transition-colors duration-300 hover:bg-blue-500 sm:w-auto"
          onClick={refreshData}
        >
          Refresh Data
        </button>
        <div className="mt-4">
          <SignOutButton />
        </div>
      </div>
    </div>
  );
}
