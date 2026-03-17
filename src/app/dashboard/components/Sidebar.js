export default function Sidebar({
  customers,
  selectedCustomerId,
  selectedCampaign,
  handleCustomerSelect,
  handleCampaignSelect,
  lastUpdated,
  refreshData,
}) {
  const visibleCustomers = customers.filter((item) => item.campaigns?.length > 0);

  return (
    <div className="w-80 bg-customPurple-dark p-6 shadow-lg">
      <div className="mb-8 flex items-center">
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
          alt="icon"
          className="mr-3 h-10 w-10 rounded-full"
        />
        <div>
          <h2 className="mb-0 text-lg font-semibold text-white">
            Lilikoi Agency
          </h2>
          <h2 className="mb-0 text-md font-normal text-gray-300">
            Google Ads Dashboard
          </h2>
        </div>
      </div>

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

      <div className="mt-8 flex h-full flex-col">
        <div className="text-sm text-gray-400">
          Last Updated: {lastUpdated || "Not synced yet"}
        </div>
        <button
          className="mt-2 rounded-lg bg-blue-800 px-4 py-1 text-white transition-colors duration-300 hover:bg-blue-500"
          onClick={refreshData}
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}
