export default function ContentArea({
  customerName,
  selectedCampaign,
  allCampaignData,
  handleCampaignSelect,
}) {
  const customerData = allCampaignData.find(
    (item) => item.customer.customer_client.descriptive_name === customerName
  );

  return (
    <div className="space-y-6">
      {selectedCampaign ? (
        <div className="p-6 rounded-lg text-black">
          <h2 className="text-2xl font-semibold text-customPurple mb-4">
            Customer: {customerName}
          </h2>
          <h3 className="text-lg font-semibold text-customPurple mb-8">
            {" "}
            Selected Campaign: {selectedCampaign.campaignName}{" "}
          </h3>
          <div className="p-6 bg-white rounded-3xl shadow-lg mb-8 max-w-md">
            <div className="flex justify-between mb-4">
              <h3 className="text-lg font-bold text-customPurple">
                Performance Insights
              </h3>
              <span className="text-sm text-gray-500 font-light">
                Last 7 days
              </span>
            </div>

            <div className="grid grid-cols-2 gap-y-4 gap-x-4">
              <div>
                <p className="text-xs text-gray-500 font-medium">Conversions</p>
                <p className="text-green-600 text-xl font-semibold">
                  {Math.ceil(selectedCampaign.conversions)}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">Clicks</p>
                <p className="text-blue-600 text-xl font-semibold">
                  {selectedCampaign.clicks}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">
                  Cost per Click (CPC)
                </p>
                <p className="text-yellow-600 text-xl font-semibold">
                  {selectedCampaign.clicks > 0
                    ? `$${(
                        selectedCampaign.cost /
                        selectedCampaign.clicks /
                        1_000_000
                      ).toFixed(2)}`
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-500 font-medium">
                  Cost per Conversion (CPA)
                </p>
                <p className="text-orange-600 text-xl font-semibold">
                  {selectedCampaign.conversions > 0
                    ? `$${(
                        selectedCampaign.cost /
                        selectedCampaign.conversions /
                        1_000_000
                      ).toFixed(2)}`
                    : "—"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs text-gray-500 font-medium">Total Spend</p>
                <p className="text-red-600 text-2xl font-bold">
                  ${((selectedCampaign.cost || 0) / 1_000_000).toFixed(2)}
                </p>
              </div>
            </div>
          </div>
          <ul className="mt-4 space-y-4">
            {selectedCampaign.ads.map((ad, index) => (
              <li
                key={ad.resource_name}
                className="mb-8 p-5 bg-white shadow-md rounded-xl"
              >
                <strong>Ad {index + 1}:</strong>
                <ul className="mt-2">
                  <li>
                    <strong className="font-semibold text-lg">
                      Headlines:
                    </strong>
                    <ul className="list-disc pl-5">
                      {ad.headlines.map((headline, index) => (
                        <li key={index} className="text-gray-700">
                          {headline}
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li>
                    <strong className="font-semibold text-lg">
                      Descriptions:
                    </strong>
                    <ul className="list-disc pl-5">
                      {ad.descriptions.map((description, index) => (
                        <li key={index} className="text-gray-700">
                          {description}
                        </li>
                      ))}
                    </ul>
                  </li>
                  <li>
                    Final URL:{" "}
                    <a
                      href={ad.final_urls[0]}
                      className="text-blue-500 hover:text-blue-700 underline"
                    >
                      {ad.final_urls[0]}
                    </a>
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="p-6 bg-white rounded-lg shadow-md">
          <h2 className="text-xl font-semibold text-customPurple">
            Campaigns for {customerName}
          </h2>
          <ul className="mt-4 space-y-4">
            {customerData?.campaigns.map((campaign) => (
              <li key={campaign.campaignId}>
                <button
                  className="w-full bg-customPurple text-white py-2 px-4 rounded-md hover:bg-customPurple-light"
                  onClick={() => handleCampaignSelect(campaign.campaignId)}
                >
                  {campaign.campaignName}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
