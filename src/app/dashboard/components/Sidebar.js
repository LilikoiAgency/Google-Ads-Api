"use client";

import { SignOutButton } from "../../components/AuthActions";

export default function Sidebar({
  customers,
  selectedCustomerId,
  selectedCampaign,
  handleCustomerSelect,
  handleCampaignSelect,
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

      <div className="flex-1 overflow-y-auto pr-1 sm:pr-1">
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
