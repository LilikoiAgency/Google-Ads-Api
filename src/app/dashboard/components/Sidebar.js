// components/Sidebar.js
export default function Sidebar({
  customers,
  selectedCustomer,
  selectedCampaign,
  handleCustomerSelect,
  handleCampaignSelect,
  lastUpdated,
  refreshData,
}) {
  return (
    <div className="w-80 bg-customPurple-dark  p-6 shadow-lg">
      <div className="flex items-center mb-8">
        {/* Icon */}
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
          alt="icon"
          className="w-10 h-10 mr-3 rounded-full"
        />
        <div>
          <h2 className="text-lg font-semibold mb-0 text-white">
            Lilikoi Agency
          </h2>
          <h2 className="text-md font-regular mb-0 text-gray-300">
            Google Ads Dashboard
          </h2>
        </div>
      </div>
      <ul>
        {customers.map(
          (item, idx) =>
            item.campaigns?.length > 0 &&
            item.campaigns.some((campaign) => campaign.ads?.length > 0) && (
              <li key={idx} className="mb-4">
                <button
                  className={`w-full text-left py-2 px-4 rounded-xl text-gray-300 ${
                    selectedCustomer ===
                    item.customer.customer_client.descriptive_name
                      ? "bg-customPurple-light text-white"
                      : "hover:bg-customPurple hover:text-white"
                  }`}
                  onClick={() =>
                    handleCustomerSelect(
                      item.customer.customer_client.descriptive_name
                    )
                  }
                >
                  {item.customer.customer_client.descriptive_name}
                </button>
                {selectedCustomer ===
                  item.customer.customer_client.descriptive_name &&
                  item.campaigns?.length > 0 && (
                    <ul className="mt-2">
                      {item.campaigns
                        .slice()
                        .sort(
                          (a, b) => (b.conversions || 0) - (a.conversions || 0)
                        ) // sort by conversions
                        .map((campaign, index) => {
                          const medal =
                            index === 0
                              ? "🥇 "
                              : index === 1
                              ? "🥈 "
                              : index === 2
                              ? "🥉 "
                              : "";

                          return (
                            <li key={campaign.campaignId} className="ml-4">
                              <button
                                id={`campaign-${campaign.campaignId}`}
                                className={`w-full text-left py-2 px-4 rounded-xl text-gray-300 ${
                                  selectedCampaign?.campaignName ===
                                  campaign.campaignName
                                    ? "bg-customPurple-light text-white"
                                    : "hover:bg-customPurple hover:text-white"
                                }`}
                                onClick={() =>
                                  handleCampaignSelect(campaign.campaignId)
                                }
                              >
                                {medal}
                                {campaign.campaignName}
                              </button>
                            </li>
                          );
                        })}
                    </ul>
                  )}
              </li>
            )
        )}
      </ul>

      <div className="h-full mt-8 flex flex-col">
        <div className="text-sm text-gray-400">Last Updated: {lastUpdated}</div>
        <button
          className="mt-2 bg-blue-800 text-white py-1 px-4 rounded-lg hover:bg-blue-500 transition-colors duration-300"
          onClick={refreshData}
        >
          Refresh Data
        </button>
      </div>
    </div>
  );
}
