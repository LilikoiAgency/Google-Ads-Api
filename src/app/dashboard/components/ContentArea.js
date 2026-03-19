import { useState } from "react";

function formatCurrency(amount) {
  return `$${amount.toFixed(2)}`;
}

const RECOMMENDATION_TYPE_LABELS = {
  2: "Increase campaign budget",
  3: "Add keywords",
  4: "Improve ad copy",
  8: "Enable search partners",
  18: "Add responsive search ads",
  21: "Improve responsive search ad assets",
  23: "Improve ad strength",
  28: "Add callout assets",
  29: "Add sitelinks",
  30: "Add call assets",
  46: "Adopt Performance Max",
  47: "Improve Performance Max ad strength",
  53: "Improve Google tag coverage",
};

const RECOMMENDATION_TYPE_EXPLANATIONS = {
  2: "Google thinks these campaigns are budget constrained and could capture more volume with a higher budget.",
  3: "Google found additional keyword opportunities that may expand relevant search coverage.",
  4: "Google is suggesting ad copy updates that may improve relevance or click-through rate.",
  8: "Google suggests enabling search partners to widen reach beyond Google Search.",
  18: "Google recommends adding responsive search ads to improve coverage and testing.",
  21: "Google has identified missing or weak RSA assets that may limit ad strength.",
  23: "Google believes the ad could perform better with stronger asset variety or relevance.",
  28: "Additional callout assets may improve ad visibility and messaging coverage.",
  29: "Adding sitelinks can improve CTR and give users more navigation options.",
  30: "Adding call assets can make it easier for prospects to call directly from the ad.",
  46: "Google is recommending a move into Performance Max for broader automated coverage.",
  47: "Google sees room to improve Performance Max asset quality and ad strength.",
  53: "Tracking coverage may be incomplete, which can limit optimization and reporting quality.",
};

const SORT_OPTIONS = [
  { value: "conversions", label: "Best performance" },
  { value: "optimization", label: "Optimization score" },
  { value: "recommendations", label: "Recommendation count" },
  { value: "spend", label: "Highest spend" },
  { value: "cpa", label: "Lowest CPA" },
];

function formatRecommendationType(type) {
  if (typeof type === "number" && RECOMMENDATION_TYPE_LABELS[type]) {
    return RECOMMENDATION_TYPE_LABELS[type];
  }

  if (typeof type === "string" && type.length > 0) {
    return type.replaceAll("_", " ");
  }

  if (typeof type === "number") {
    return `TYPE ${type}`;
  }

  return "UNSPECIFIED";
}

function getRecommendationExplanation(type) {
  if (typeof type === "number" && RECOMMENDATION_TYPE_EXPLANATIONS[type]) {
    return RECOMMENDATION_TYPE_EXPLANATIONS[type];
  }

  return "Google has flagged an optimization opportunity for this campaign or account.";
}

function formatCompactDate(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function buildTrendPath(data, accessor, height) {
  if (!data.length) {
    return "";
  }

  const values = data.map(accessor);
  const maxValue = Math.max(...values, 1);
  const width = 100;

  return data
    .map((item, index) => {
      const x = data.length === 1 ? width / 2 : (index / (data.length - 1)) * width;
      const y = height - (accessor(item) / maxValue) * height;
      return `${index === 0 ? "M" : "L"} ${x} ${y}`;
    })
    .join(" ");
}

function buildTrendAreaPath(data, accessor, height) {
  const linePath = buildTrendPath(data, accessor, height);

  if (!linePath) {
    return "";
  }

  const width = 100;
  const baseline = height;

  if (data.length === 1) {
    return `${linePath} L 50 ${baseline} L 50 ${baseline} Z`;
  }

  return `${linePath} L ${width} ${baseline} L 0 ${baseline} Z`;
}

function formatChannelType(value) {
  const channelTypeMap = {
    0: "Unspecified",
    2: "Search",
    3: "Display",
    4: "Shopping",
    5: "Hotel",
    6: "Video",
    7: "Multichannel",
    8: "Local",
    9: "Smart",
    10: "Performance Max",
    11: "Local Services",
    12: "Demand Gen",
    13: "Travel",
  };

  const normalizedValue = String(value || "UNKNOWN");

  if (channelTypeMap[normalizedValue]) {
    return channelTypeMap[normalizedValue];
  }

  return String(value || "UNKNOWN")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatStatus(value) {
  const statusMap = {
    0: "Unspecified",
    1: "Unknown",
    2: "Enabled",
    3: "Paused",
    4: "Removed",
  };

  const normalizedValue = String(value || "UNKNOWN");

  if (statusMap[normalizedValue]) {
    return statusMap[normalizedValue];
  }

  return String(value || "UNKNOWN")
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) {
    return "-";
  }

  return `${(Number(value) * 100).toFixed(digits)}%`;
}

function formatDevice(value) {
  const deviceMap = {
    0: "Unspecified",
    1: "Unknown",
    2: "Mobile",
    3: "Tablet",
    4: "Desktop",
    5: "Connected TV",
    6: "Other",
  };

  const normalizedValue = String(value || "UNSPECIFIED");

  if (deviceMap[normalizedValue]) {
    return deviceMap[normalizedValue];
  }

  return normalizedValue
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function InfoBadge({ title }) {
  return (
    <span
      className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-gray-500 ring-1 ring-gray-300"
      title={title}
    >
      i
    </span>
  );
}

function calculateTrendDelta(data, accessor) {
  if (!data?.length || data.length < 2) {
    return null;
  }

  const midpoint = Math.ceil(data.length / 2);
  const firstHalf = data.slice(0, midpoint);
  const secondHalf = data.slice(midpoint);

  if (!firstHalf.length || !secondHalf.length) {
    return null;
  }

  const firstHalfAverage =
    firstHalf.reduce((sum, item) => sum + accessor(item), 0) / firstHalf.length;
  const secondHalfAverage =
    secondHalf.reduce((sum, item) => sum + accessor(item), 0) / secondHalf.length;

  if (firstHalfAverage === 0) {
    return secondHalfAverage === 0 ? 0 : null;
  }

  return ((secondHalfAverage - firstHalfAverage) / firstHalfAverage) * 100;
}

function TrendChart({ data, accessor, color, label, formatter }) {
  if (!data?.length) {
    return (
      <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          {label}
        </p>
        <p className="mt-2 text-sm text-gray-500">No trend data available.</p>
      </div>
    );
  }

  const latestValue = accessor(data[data.length - 1]);
  const path = buildTrendPath(data, accessor, 48);
  const areaPath = buildTrendAreaPath(data, accessor, 48);
  const delta = calculateTrendDelta(data, accessor);
  const deltaColor =
    delta === null ? "text-gray-400" : delta >= 0 ? "text-green-600" : "text-red-600";
  const gradientId = `trend-gradient-${label.replaceAll(" ", "-").toLowerCase()}`;

  return (
    <div className="rounded-3xl border border-gray-200 bg-gradient-to-br from-white to-gray-50 p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            {label}
          </p>
          <p className="mt-2 text-xl font-semibold" style={{ color }}>
            {formatter(latestValue)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs text-gray-400">
            {formatCompactDate(data[0].date)} -{" "}
            {formatCompactDate(data[data.length - 1].date)}
          </p>
          <p className={`mt-1 text-xs font-medium ${deltaColor}`}>
            {delta === null
              ? "Not enough data"
              : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}% recent vs earlier average`}
            {delta !== null && (
              <span
                className="ml-2 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white text-[10px] font-bold text-gray-500 ring-1 ring-gray-300"
                title="Compares the average daily value in the second half of the selected date range against the first half. Negative means the recent half was lower; positive means it was higher."
              >
                i
              </span>
            )}
          </p>
        </div>
      </div>
      <svg
        className="mt-4 h-20 w-full overflow-visible"
        preserveAspectRatio="none"
        viewBox="0 0 100 56"
      >
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.28" />
            <stop offset="100%" stopColor={color} stopOpacity="0.03" />
          </linearGradient>
        </defs>
        <path
          d="M 0 48 L 100 48"
          fill="none"
          stroke="#e5e7eb"
          strokeDasharray="3 3"
          strokeWidth="1"
        />
        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={color}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="3"
        />
        <circle cx="100" cy={path ? Number(path.trim().split(" ").slice(-1)[0]) : 48} r="0" />
      </svg>
    </div>
  );
}

export default function ContentArea({
  customerId,
  selectedCampaign,
  allCampaignData,
  handleCampaignSelect,
  dateRangeLabel,
}) {
  const [showAccountRecommendations, setShowAccountRecommendations] = useState(false);
  const [showCampaignRecommendations, setShowCampaignRecommendations] = useState(false);
  const [showAllAccountSearchTerms, setShowAllAccountSearchTerms] = useState(false);
  const [showAllCampaignSearchTerms, setShowAllCampaignSearchTerms] = useState(false);
  const [showAllAccountLandingPages, setShowAllAccountLandingPages] = useState(false);
  const [showAllCampaignLandingPages, setShowAllCampaignLandingPages] = useState(false);
  const [campaignSort, setCampaignSort] = useState("conversions");
  const customerData = allCampaignData.find(
    (item) => item.customer.customer_client.id === customerId
  );
  const customerName = customerData?.customer.customer_client.descriptive_name;
  const accountOptimizationScore =
    customerData?.optimizationScore !== null &&
    customerData?.optimizationScore !== undefined
      ? Number(customerData.optimizationScore) * 100
      : null;
  const accountSearchImpressionShareAverage =
    customerData?.accountSearchImpressionShareAverage !== null &&
    customerData?.accountSearchImpressionShareAverage !== undefined
      ? Number(customerData.accountSearchImpressionShareAverage)
      : null;
  const recommendations = customerData?.recommendations || [];
  const groupedRecommendations = Object.values(
    recommendations.reduce((groups, recommendation) => {
      const label = formatRecommendationType(recommendation.type);
      if (!groups[label]) {
        groups[label] = {
          label,
          recommendations: [],
        };
      }

      groups[label].recommendations.push(recommendation);
      return groups;
    }, {})
  ).sort((a, b) => b.recommendations.length - a.recommendations.length);
  const customerCampaigns = (customerData?.campaigns || []).slice().sort((a, b) => {
    const recommendationCountA = recommendations.filter(
      (recommendation) => recommendation.campaign_resource_name === a.resourceName
    ).length;
    const recommendationCountB = recommendations.filter(
      (recommendation) => recommendation.campaign_resource_name === b.resourceName
    ).length;
    const cpaA =
      Number(a.conversions || 0) > 0
        ? (a.cost || 0) / 1_000_000 / Number(a.conversions || 0)
        : Number.POSITIVE_INFINITY;
    const cpaB =
      Number(b.conversions || 0) > 0
        ? (b.cost || 0) / 1_000_000 / Number(b.conversions || 0)
        : Number.POSITIVE_INFINITY;

    switch (campaignSort) {
      case "optimization":
        return (
          Number(b.optimizationScore || 0) - Number(a.optimizationScore || 0)
        );
      case "recommendations":
        return recommendationCountB - recommendationCountA;
      case "spend":
        return (b.cost || 0) - (a.cost || 0);
      case "cpa":
        return cpaA - cpaB;
      case "conversions":
      default:
        if ((b.conversions || 0) !== (a.conversions || 0)) {
          return (b.conversions || 0) - (a.conversions || 0);
        }
        if ((b.clicks || 0) !== (a.clicks || 0)) {
          return (b.clicks || 0) - (a.clicks || 0);
        }
        return (b.cost || 0) - (a.cost || 0);
    }
  });
  const customerTrend = customerData?.trend || [];
  const accountSearchTerms = customerData?.searchTerms || [];
  const accountLandingPages = customerData?.landingPages || [];
  const accountDevices = customerData?.devices || [];
  const spend = (selectedCampaign?.cost || 0) / 1_000_000;
  const clicks = selectedCampaign?.clicks || 0;
  const conversions = Number(selectedCampaign?.conversions || 0);
  const campaignOptimizationScore =
    selectedCampaign?.optimizationScore !== null &&
    selectedCampaign?.optimizationScore !== undefined
      ? Number(selectedCampaign.optimizationScore) * 100
      : null;
  const campaignSearchImpressionShare =
    selectedCampaign?.searchImpressionShare !== null &&
    selectedCampaign?.searchImpressionShare !== undefined
      ? Number(selectedCampaign.searchImpressionShare)
      : null;
  const campaignRecommendations = recommendations.filter(
    (recommendation) =>
      recommendation.campaign_resource_name &&
      recommendation.campaign_resource_name === selectedCampaign?.resourceName
  );
  const groupedCampaignRecommendations = Object.values(
    campaignRecommendations.reduce((groups, recommendation) => {
      const label = formatRecommendationType(recommendation.type);
      if (!groups[label]) {
        groups[label] = {
          label,
          recommendations: [],
        };
      }

      groups[label].recommendations.push(recommendation);
      return groups;
    }, {})
  ).sort((a, b) => b.recommendations.length - a.recommendations.length);
  const cpc = clicks > 0 ? spend / clicks : null;
  const cpa = conversions > 0 ? spend / conversions : null;
  const totalSpend =
    customerCampaigns.reduce((sum, campaign) => sum + (campaign.cost || 0), 0) /
    1_000_000;
  const totalClicks = customerCampaigns.reduce(
    (sum, campaign) => sum + (campaign.clicks || 0),
    0
  );
  const totalConversions = customerCampaigns.reduce(
    (sum, campaign) => sum + Number(campaign.conversions || 0),
    0
  );
  const averageCpc = totalClicks > 0 ? totalSpend / totalClicks : null;
  const averageCpa =
    totalConversions > 0 ? totalSpend / totalConversions : null;
  const campaignTrend = selectedCampaign?.trend || [];
  const campaignSearchTerms = selectedCampaign?.searchTerms || [];
  const campaignLandingPages = selectedCampaign?.landingPages || [];
  const campaignDevices = selectedCampaign?.devices || [];
  const visibleAccountSearchTerms = showAllAccountSearchTerms
    ? accountSearchTerms
    : accountSearchTerms.slice(0, 5);
  const visibleCampaignSearchTerms = showAllCampaignSearchTerms
    ? campaignSearchTerms
    : campaignSearchTerms.slice(0, 5);
  const visibleAccountLandingPages = showAllAccountLandingPages
    ? accountLandingPages
    : accountLandingPages.slice(0, 5);
  const visibleCampaignLandingPages = showAllCampaignLandingPages
    ? campaignLandingPages
    : campaignLandingPages.slice(0, 5);

  if (!customerData) {
    return (
      <div className="rounded-lg bg-white p-6 shadow-md">
        <h2 className="text-xl font-semibold text-customPurple">
          No customer selected
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          Pick an account from the sidebar to review campaigns and ads.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {selectedCampaign ? (
        <div className="rounded-lg p-6 text-black">
          <h2 className="mb-4 text-2xl font-semibold text-customPurple">
            Customer: {customerName}
          </h2>
          <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="text-lg font-semibold text-customPurple">
              Selected Campaign: {selectedCampaign.campaignName}
            </h3>
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                {formatStatus(selectedCampaign.status)}
              </span>
              <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                {formatChannelType(selectedCampaign.channelType)}
              </span>
            </div>
          </div>
          <div className="mb-8 max-w-md rounded-3xl bg-white p-6 shadow-lg">
            <div className="mb-4 flex justify-between">
              <h3 className="text-lg font-bold text-customPurple">
                Performance Insights
              </h3>
              <span className="text-sm font-light text-gray-500">
                {dateRangeLabel}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <div>
                <p className="text-xs font-medium text-gray-500">Status</p>
                <p className="text-xl font-semibold text-gray-700">
                  {formatStatus(selectedCampaign.status)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Conversions</p>
                <p className="text-xl font-semibold text-green-600">
                  {conversions.toFixed(1)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">Clicks</p>
                <p className="text-xl font-semibold text-blue-600">{clicks}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Optimization Score
                </p>
                <p className="text-xl font-semibold text-customPurple">
                  {campaignOptimizationScore !== null
                    ? `${campaignOptimizationScore.toFixed(1)}%`
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Search Impression Share
                  <InfoBadge title="The percentage of eligible search impressions this campaign actually received." />
                </p>
                <p className="text-xl font-semibold text-sky-600">
                  {campaignSearchImpressionShare !== null
                    ? formatPercent(campaignSearchImpressionShare)
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Cost per Click (CPC)
                </p>
                <p className="text-xl font-semibold text-yellow-600">
                  {cpc !== null ? formatCurrency(cpc) : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Cost per Conversion (CPA)
                </p>
                <p className="text-xl font-semibold text-orange-600">
                  {cpa !== null ? formatCurrency(cpa) : "-"}
                </p>
              </div>
              <div className="col-span-2">
                <p className="text-xs font-medium text-gray-500">Total Spend</p>
                <p className="text-2xl font-bold text-red-600">
                  {formatCurrency(spend)}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Lost IS (Budget)
                  <InfoBadge title="The share of eligible search impressions this campaign missed because budget was too limited." />
                </p>
                <p className="text-lg font-semibold text-amber-600">
                  {selectedCampaign?.searchBudgetLostImpressionShare !== null &&
                  selectedCampaign?.searchBudgetLostImpressionShare !== undefined
                    ? formatPercent(selectedCampaign.searchBudgetLostImpressionShare)
                    : "-"}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500">
                  Lost IS (Rank)
                  <InfoBadge title="The share of eligible search impressions this campaign missed because ad rank was not competitive enough." />
                </p>
                <p className="text-lg font-semibold text-rose-600">
                  {selectedCampaign?.searchRankLostImpressionShare !== null &&
                  selectedCampaign?.searchRankLostImpressionShare !== undefined
                    ? formatPercent(selectedCampaign.searchRankLostImpressionShare)
                    : "-"}
                </p>
              </div>
              {selectedCampaign?.optimizationScoreUrl && (
                <div className="col-span-2">
                  <a
                    className="text-sm font-medium text-blue-600 underline hover:text-blue-800"
                    href={selectedCampaign.optimizationScoreUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    View optimization details in Google Ads
                  </a>
                </div>
              )}
            </div>
          </div>
          <div className="mb-8 grid gap-4 lg:grid-cols-3">
            <TrendChart
              accessor={(point) => (point.cost || 0) / 1_000_000}
              color="#dc2626"
              data={campaignTrend}
              formatter={(value) => formatCurrency(value)}
              label="Spend Trend"
            />
            <TrendChart
              accessor={(point) => point.clicks || 0}
              color="#2563eb"
              data={campaignTrend}
              formatter={(value) => `${value}`}
              label="Clicks Trend"
            />
            <TrendChart
              accessor={(point) => Number(point.conversions || 0)}
              color="#16a34a"
              data={campaignTrend}
              formatter={(value) => Number(value).toFixed(1)}
              label="Conversions Trend"
            />
          </div>
          <div className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Device Breakdown
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Clicks, conversions, and spend by device for this campaign
                </p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                {campaignDevices.length} devices
              </span>
            </div>
            {campaignDevices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="pb-3 pr-4 font-medium">Device</th>
                      <th className="pb-3 pr-4 font-medium">Clicks</th>
                      <th className="pb-3 pr-4 font-medium">Conversions</th>
                      <th className="pb-3 pr-4 font-medium">CTR</th>
                      <th className="pb-3 pr-4 font-medium">Spend</th>
                      <th className="pb-3 font-medium">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {campaignDevices.map((device) => (
                      <tr
                        key={device.device}
                        className="border-b border-gray-100 align-top last:border-b-0"
                      >
                        <td className="py-3 pr-4 font-medium text-gray-900">
                          {formatDevice(device.device)}
                        </td>
                        <td className="py-3 pr-4 text-blue-600">{device.clicks || 0}</td>
                        <td className="py-3 pr-4 text-green-600">
                          {Number(device.conversions || 0).toFixed(1)}
                        </td>
                        <td className="py-3 pr-4 text-gray-700">
                          {formatPercent(device.ctr)}
                        </td>
                        <td className="py-3 pr-4 text-red-600">
                          {formatCurrency((device.cost || 0) / 1_000_000)}
                        </td>
                        <td className="py-3 text-orange-600">
                          {Number(device.conversions || 0) > 0
                            ? formatCurrency(
                                (device.cost || 0) /
                                  1_000_000 /
                                  Number(device.conversions || 0)
                              )
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No device breakdown was returned for this campaign.
              </p>
            )}
          </div>
          <div className="mb-8 rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <button
              className="flex w-full items-center justify-between gap-4 text-left"
              onClick={() =>
                setShowCampaignRecommendations((currentValue) => !currentValue)
              }
              type="button"
            >
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Campaign Recommendations
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {campaignRecommendations.length} recommendation
                  {campaignRecommendations.length === 1 ? "" : "s"} for this campaign
                </p>
              </div>
              <span className="text-sm font-medium text-blue-700">
                {showCampaignRecommendations ? "Hide" : "Show"}
              </span>
            </button>
            {showCampaignRecommendations &&
              (groupedCampaignRecommendations.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {groupedCampaignRecommendations.map((group, index) => (
                    <li
                      key={`${group.label}-${index}`}
                      className="rounded-xl bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-customPurple">
                          {group.label}
                        </p>
                        <p className="mt-1 text-sm text-gray-600">
                          {group.recommendations.length} recommendation
                          {group.recommendations.length === 1 ? "" : "s"}
                        </p>
                        <p className="mt-2 text-sm text-gray-500">
                          {getRecommendationExplanation(
                            group.recommendations[0]?.type
                          )}
                        </p>
                      </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-blue-700">
                          #{index + 1}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-gray-600">
                  No Google recommendations were returned for this campaign.
                </p>
              ))}
          </div>
          <div className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Top Search Terms
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Query-level performance for this campaign over{" "}
                  {dateRangeLabel.toLowerCase()}
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {campaignSearchTerms.length} terms
              </span>
            </div>
            {campaignSearchTerms.length > 0 ? (
              <div>
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-3 pr-4 font-medium">Search Term</th>
                        <th className="pb-3 pr-4 font-medium">Ad Group</th>
                        <th className="pb-3 pr-4 font-medium">Clicks</th>
                        <th className="pb-3 pr-4 font-medium">Conv.</th>
                        <th className="pb-3 pr-4 font-medium">CTR</th>
                        <th className="pb-3 pr-4 font-medium">Spend</th>
                        <th className="pb-3 font-medium">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCampaignSearchTerms.map((term, index) => (
                        <tr
                          key={`${term.term}-${term.adGroupId || index}`}
                          className="border-b border-gray-100 align-top last:border-b-0"
                        >
                          <td className="py-3 pr-4 font-medium text-gray-900">
                            {term.term || "Unknown query"}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {term.adGroupName || "-"}
                          </td>
                          <td className="py-3 pr-4 text-blue-600">
                            {term.clicks || 0}
                          </td>
                          <td className="py-3 pr-4 text-green-600">
                            {Number(term.conversions || 0).toFixed(1)}
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {formatPercent(term.ctr)}
                          </td>
                          <td className="py-3 pr-4 text-red-600">
                            {formatCurrency((term.cost || 0) / 1_000_000)}
                          </td>
                          <td className="py-3 text-orange-600">
                            {Number(term.conversions || 0) > 0
                              ? formatCurrency(
                                  (term.cost || 0) /
                                    1_000_000 /
                                    Number(term.conversions || 0)
                                )
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!showAllCampaignSearchTerms && campaignSearchTerms.length > 5 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/95 to-transparent" />
                  )}
                </div>
                {campaignSearchTerms.length > 5 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
                      onClick={() =>
                        setShowAllCampaignSearchTerms((currentValue) => !currentValue)
                      }
                      type="button"
                    >
                      {showAllCampaignSearchTerms
                        ? "Collapse search terms"
                        : `View all ${campaignSearchTerms.length} search terms`}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No search terms were returned for this campaign in the selected
                range.
              </p>
            )}
          </div>
          <div className="mb-8 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Top Landing Pages
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Best-performing destination pages for this campaign over{" "}
                  {dateRangeLabel.toLowerCase()}
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {campaignLandingPages.length} pages
              </span>
            </div>
            {campaignLandingPages.length > 0 ? (
              <div>
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-3 pr-4 font-medium">Landing Page</th>
                        <th className="pb-3 pr-4 font-medium">Ad Group</th>
                        <th className="pb-3 pr-4 font-medium">Clicks</th>
                        <th className="pb-3 pr-4 font-medium">Conv.</th>
                        <th className="pb-3 pr-4 font-medium">CTR</th>
                        <th className="pb-3 pr-4 font-medium">Spend</th>
                        <th className="pb-3 font-medium">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleCampaignLandingPages.map((page, index) => (
                        <tr
                          key={`${page.url}-${page.adGroupId || index}`}
                          className="border-b border-gray-100 align-top last:border-b-0"
                        >
                          <td className="py-3 pr-4 font-medium text-gray-900">
                            <a
                              className="break-all text-blue-700 underline hover:text-blue-900"
                              href={page.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {page.url}
                            </a>
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {page.adGroupName || "-"}
                          </td>
                          <td className="py-3 pr-4 text-blue-600">{page.clicks || 0}</td>
                          <td className="py-3 pr-4 text-green-600">
                            {Number(page.conversions || 0).toFixed(1)}
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {formatPercent(page.ctr)}
                          </td>
                          <td className="py-3 pr-4 text-red-600">
                            {formatCurrency((page.cost || 0) / 1_000_000)}
                          </td>
                          <td className="py-3 text-orange-600">
                            {Number(page.conversions || 0) > 0
                              ? formatCurrency(
                                  (page.cost || 0) /
                                    1_000_000 /
                                    Number(page.conversions || 0)
                                )
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!showAllCampaignLandingPages && campaignLandingPages.length > 5 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/95 to-transparent" />
                  )}
                </div>
                {campaignLandingPages.length > 5 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                      onClick={() =>
                        setShowAllCampaignLandingPages((currentValue) => !currentValue)
                      }
                      type="button"
                    >
                      {showAllCampaignLandingPages
                        ? "Collapse landing pages"
                        : `View all ${campaignLandingPages.length} landing pages`}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No landing page performance rows were returned for this campaign.
              </p>
            )}
          </div>
          <ul className="mt-4 space-y-4">
            {(selectedCampaign.ads || []).length === 0 && (
              <li className="rounded-xl bg-white p-5 text-sm text-gray-600 shadow-md">
                No ad creatives were returned for this campaign.
              </li>
            )}
            {(selectedCampaign.ads || []).map((ad, index) => (
              <li
                key={ad.resource_name || `${selectedCampaign.campaignId}-${index}`}
                className="mb-8 rounded-xl bg-white p-5 shadow-md"
              >
                <strong>Ad {index + 1}:</strong>
                <ul className="mt-2">
                  <li>
                    <strong className="text-lg font-semibold">Headlines:</strong>
                    <ul className="list-disc pl-5">
                      {(ad.headlines || []).map((headline, itemIndex) => (
                        <li key={itemIndex} className="text-gray-700">
                          {headline}
                        </li>
                      ))}
                      {(ad.headlines || []).length === 0 && (
                        <li className="text-gray-500">No headlines available</li>
                      )}
                    </ul>
                  </li>
                  <li>
                    <strong className="text-lg font-semibold">
                      Descriptions:
                    </strong>
                    <ul className="list-disc pl-5">
                      {(ad.descriptions || []).map((description, itemIndex) => (
                        <li key={itemIndex} className="text-gray-700">
                          {description}
                        </li>
                      ))}
                      {(ad.descriptions || []).length === 0 && (
                        <li className="text-gray-500">
                          No descriptions available
                        </li>
                      )}
                    </ul>
                  </li>
                  <li>
                    Final URL:{" "}
                    {ad.final_urls?.[0] ? (
                      <a
                        href={ad.final_urls[0]}
                        className="text-blue-500 underline hover:text-blue-700"
                        rel="noreferrer"
                        target="_blank"
                      >
                        {ad.final_urls[0]}
                      </a>
                    ) : (
                      <span className="text-gray-500">No URL available</span>
                    )}
                  </li>
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="rounded-lg bg-white p-6 shadow-md">
          <h2 className="text-xl font-semibold text-customPurple">
            Campaigns for {customerName}
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Account Optimization Score
              </p>
              <p className="mt-2 text-2xl font-bold text-customPurple">
                {accountOptimizationScore !== null
                  ? `${accountOptimizationScore.toFixed(1)}%`
                  : "-"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Avg. Search IS
                <InfoBadge title="Average search impression share across campaigns in this account. Higher means your ads captured more of the impressions they were eligible for." />
              </p>
              <p className="mt-2 text-2xl font-bold text-sky-600">
                {accountSearchImpressionShareAverage !== null
                  ? formatPercent(accountSearchImpressionShareAverage)
                  : "-"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total Spend
              </p>
              <p className="mt-2 text-2xl font-bold text-red-600">
                {formatCurrency(totalSpend)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total Clicks
              </p>
              <p className="mt-2 text-2xl font-bold text-blue-600">
                {totalClicks}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Total Conversions
              </p>
              <p className="mt-2 text-2xl font-bold text-green-600">
                {totalConversions.toFixed(1)}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Avg. CPA
              </p>
              <p className="mt-2 text-2xl font-bold text-orange-600">
                {averageCpa !== null ? formatCurrency(averageCpa) : "-"}
              </p>
            </div>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Avg. CPC
              </p>
              <p className="mt-2 text-xl font-semibold text-yellow-600">
                {averageCpc !== null ? formatCurrency(averageCpc) : "-"}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Active Campaigns
              </p>
              <p className="mt-2 text-xl font-semibold text-customPurple">
                {customerCampaigns.length}
              </p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Recommendations
              </p>
              <p className="mt-2 text-xl font-semibold text-blue-600">
                {recommendations.length}
              </p>
            </div>
          </div>
          <div className="mt-6 grid gap-4 lg:grid-cols-3">
            <TrendChart
              accessor={(point) => (point.cost || 0) / 1_000_000}
              color="#dc2626"
              data={customerTrend}
              formatter={(value) => formatCurrency(value)}
              label="Spend Trend"
            />
            <TrendChart
              accessor={(point) => point.clicks || 0}
              color="#2563eb"
              data={customerTrend}
              formatter={(value) => `${value}`}
              label="Clicks Trend"
            />
            <TrendChart
              accessor={(point) => Number(point.conversions || 0)}
              color="#16a34a"
              data={customerTrend}
              formatter={(value) => Number(value).toFixed(1)}
              label="Conversions Trend"
            />
          </div>
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Device Breakdown
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Conversions, clicks, and spend by device across this account
                </p>
              </div>
              <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                {accountDevices.length} devices
              </span>
            </div>
            {accountDevices.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                      <th className="pb-3 pr-4 font-medium">Device</th>
                      <th className="pb-3 pr-4 font-medium">Clicks</th>
                      <th className="pb-3 pr-4 font-medium">Conversions</th>
                      <th className="pb-3 pr-4 font-medium">CTR</th>
                      <th className="pb-3 pr-4 font-medium">Spend</th>
                      <th className="pb-3 font-medium">CPA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {accountDevices.map((device) => (
                      <tr
                        key={device.device}
                        className="border-b border-gray-100 align-top last:border-b-0"
                      >
                        <td className="py-3 pr-4 font-medium text-gray-900">
                          {formatDevice(device.device)}
                        </td>
                        <td className="py-3 pr-4 text-blue-600">{device.clicks || 0}</td>
                        <td className="py-3 pr-4 text-green-600">
                          {Number(device.conversions || 0).toFixed(1)}
                        </td>
                        <td className="py-3 pr-4 text-gray-700">
                          {formatPercent(device.ctr)}
                        </td>
                        <td className="py-3 pr-4 text-red-600">
                          {formatCurrency((device.cost || 0) / 1_000_000)}
                        </td>
                        <td className="py-3 text-orange-600">
                          {Number(device.conversions || 0) > 0
                            ? formatCurrency(
                                (device.cost || 0) /
                                  1_000_000 /
                                  Number(device.conversions || 0)
                              )
                            : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No device breakdown was returned for this account.
              </p>
            )}
          </div>
          <div className="mt-6 rounded-2xl border border-gray-100 bg-gray-50 p-4">
            <button
              className="flex w-full items-center justify-between gap-4 text-left"
              onClick={() =>
                setShowAccountRecommendations((currentValue) => !currentValue)
              }
              type="button"
            >
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Google Recommendations
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  {recommendations.length} recommendation
                  {recommendations.length === 1 ? "" : "s"} across{" "}
                  {groupedRecommendations.length} type
                  {groupedRecommendations.length === 1 ? "" : "s"}
                </p>
              </div>
              <span className="text-sm font-medium text-blue-700">
                {showAccountRecommendations ? "Hide" : "Show"}
              </span>
            </button>
            {showAccountRecommendations &&
              (recommendations.length > 0 ? (
                <ul className="mt-4 space-y-3">
                  {groupedRecommendations.map((group, index) => (
                    <li
                      key={`${group.label}-${index}`}
                      className="rounded-xl bg-white px-4 py-3 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-customPurple">
                            {group.label}
                          </p>
                          <p className="mt-1 text-sm text-gray-600">
                            {group.recommendations.length} campaign
                            {group.recommendations.length === 1 ? "" : "s"} affected
                          </p>
                          <p className="mt-2 text-sm text-gray-500">
                            {getRecommendationExplanation(
                              group.recommendations[0]?.type
                            )}
                          </p>
                        </div>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium uppercase tracking-wide text-blue-700">
                          #{index + 1}
                        </span>
                      </div>
                      <ul className="mt-3 grid gap-2 md:grid-cols-2">
                        {group.recommendations.map((recommendation, itemIndex) => (
                          <li
                            key={
                              recommendation.resource_name ||
                              `${group.label}-${recommendation.campaignName}-${itemIndex}`
                            }
                            className="rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-700"
                          >
                            {recommendation.campaignName || "Account-level recommendation"}
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-gray-600">
                  No recommendations were returned for this account.
                </p>
              ))}
          </div>
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Top Search Terms
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Highest-performing queries across this account for{" "}
                  {dateRangeLabel.toLowerCase()}
                </p>
              </div>
              <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                {accountSearchTerms.length} terms
              </span>
            </div>
            {accountSearchTerms.length > 0 ? (
              <div>
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-3 pr-4 font-medium">Search Term</th>
                        <th className="pb-3 pr-4 font-medium">Campaign</th>
                        <th className="pb-3 pr-4 font-medium">Ad Group</th>
                        <th className="pb-3 pr-4 font-medium">Clicks</th>
                        <th className="pb-3 pr-4 font-medium">Conv.</th>
                        <th className="pb-3 pr-4 font-medium">CTR</th>
                        <th className="pb-3 pr-4 font-medium">Spend</th>
                        <th className="pb-3 font-medium">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAccountSearchTerms.map((term, index) => (
                        <tr
                          key={`${term.term}-${term.campaignId}-${term.adGroupId || index}`}
                          className="border-b border-gray-100 align-top last:border-b-0"
                        >
                          <td className="py-3 pr-4 font-medium text-gray-900">
                            {term.term || "Unknown query"}
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {term.campaignName || "-"}
                          </td>
                          <td className="py-3 pr-4 text-gray-600">
                            {term.adGroupName || "-"}
                          </td>
                          <td className="py-3 pr-4 text-blue-600">
                            {term.clicks || 0}
                          </td>
                          <td className="py-3 pr-4 text-green-600">
                            {Number(term.conversions || 0).toFixed(1)}
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {formatPercent(term.ctr)}
                          </td>
                          <td className="py-3 pr-4 text-red-600">
                            {formatCurrency((term.cost || 0) / 1_000_000)}
                          </td>
                          <td className="py-3 text-orange-600">
                            {Number(term.conversions || 0) > 0
                              ? formatCurrency(
                                  (term.cost || 0) /
                                    1_000_000 /
                                    Number(term.conversions || 0)
                                )
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!showAllAccountSearchTerms && accountSearchTerms.length > 5 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/95 to-transparent" />
                  )}
                </div>
                {accountSearchTerms.length > 5 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      className="rounded-full border border-blue-200 bg-blue-50 px-4 py-2 text-sm font-medium text-blue-700 transition hover:bg-blue-100"
                      onClick={() =>
                        setShowAllAccountSearchTerms((currentValue) => !currentValue)
                      }
                      type="button"
                    >
                      {showAllAccountSearchTerms
                        ? "Collapse search terms"
                        : `View all ${accountSearchTerms.length} search terms`}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No search terms were returned for this account in the selected
                range.
              </p>
            )}
          </div>
          <div className="mt-6 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center justify-between gap-4">
              <div>
                <h3 className="text-lg font-semibold text-customPurple">
                  Top Landing Pages
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  Best-performing destination pages across this account for{" "}
                  {dateRangeLabel.toLowerCase()}
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {accountLandingPages.length} pages
              </span>
            </div>
            {accountLandingPages.length > 0 ? (
              <div>
                <div className="relative overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-gray-500">
                        <th className="pb-3 pr-4 font-medium">Landing Page</th>
                        <th className="pb-3 pr-4 font-medium">Campaign</th>
                        <th className="pb-3 pr-4 font-medium">Clicks</th>
                        <th className="pb-3 pr-4 font-medium">Conv.</th>
                        <th className="pb-3 pr-4 font-medium">CTR</th>
                        <th className="pb-3 pr-4 font-medium">Spend</th>
                        <th className="pb-3 font-medium">CPA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleAccountLandingPages.map((page, index) => (
                        <tr
                          key={`${page.url}-${index}`}
                          className="border-b border-gray-100 align-top last:border-b-0"
                        >
                          <td className="py-3 pr-4 font-medium text-gray-900">
                            <a
                              className="break-all text-blue-700 underline hover:text-blue-900"
                              href={page.url}
                              rel="noreferrer"
                              target="_blank"
                            >
                              {page.url}
                            </a>
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {page.campaignName || "-"}
                          </td>
                          <td className="py-3 pr-4 text-blue-600">{page.clicks || 0}</td>
                          <td className="py-3 pr-4 text-green-600">
                            {Number(page.conversions || 0).toFixed(1)}
                          </td>
                          <td className="py-3 pr-4 text-gray-700">
                            {formatPercent(page.ctr)}
                          </td>
                          <td className="py-3 pr-4 text-red-600">
                            {formatCurrency((page.cost || 0) / 1_000_000)}
                          </td>
                          <td className="py-3 text-orange-600">
                            {Number(page.conversions || 0) > 0
                              ? formatCurrency(
                                  (page.cost || 0) /
                                    1_000_000 /
                                    Number(page.conversions || 0)
                                )
                              : "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!showAllAccountLandingPages && accountLandingPages.length > 5 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-white via-white/95 to-transparent" />
                  )}
                </div>
                {accountLandingPages.length > 5 && (
                  <div className="mt-4 flex justify-center">
                    <button
                      className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700 transition hover:bg-emerald-100"
                      onClick={() =>
                        setShowAllAccountLandingPages((currentValue) => !currentValue)
                      }
                      type="button"
                    >
                      {showAllAccountLandingPages
                        ? "Collapse landing pages"
                        : `View all ${accountLandingPages.length} landing pages`}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-600">
                No landing page performance rows were returned for this account.
              </p>
            )}
          </div>
          <div className="mt-6 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-customPurple">
                Ranked Campaigns
              </h3>
              <p className="text-sm text-gray-500">
                {dateRangeLabel} sorted by{" "}
                {SORT_OPTIONS.find((option) => option.value === campaignSort)?.label.toLowerCase()}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <span>Sort by</span>
              <select
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-800"
                onChange={(event) => setCampaignSort(event.target.value)}
                value={campaignSort}
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <ul className="mt-4 space-y-4">
            {customerCampaigns.map((campaign, index) => (
              <li key={campaign.campaignId}>
                <button
                  className="w-full rounded-xl border border-gray-200 bg-white px-4 py-4 text-left shadow-sm transition hover:border-customPurple-light hover:bg-purple-50"
                  onClick={() => handleCampaignSelect(campaign.campaignId)}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                        Rank #{index + 1}
                      </p>
                      <p className="mt-1 text-lg font-semibold text-customPurple">
                        {campaign.campaignName}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <span className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-700">
                          {formatStatus(campaign.status)}
                        </span>
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
                          {formatChannelType(campaign.channelType)}
                        </span>
                        <span className="rounded-full bg-purple-50 px-3 py-1 text-xs font-medium text-customPurple">
                          {campaign.optimizationScore !== null &&
                          campaign.optimizationScore !== undefined
                            ? `${(Number(campaign.optimizationScore) * 100).toFixed(1)}% optimization`
                            : "No optimization score"}
                        </span>
                        <span className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                          {
                            recommendations.filter(
                              (recommendation) =>
                                recommendation.campaign_resource_name === campaign.resourceName
                            ).length
                          }{" "}
                          rec
                        </span>
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-medium text-sky-700">
                          {campaign.searchImpressionShare !== null &&
                          campaign.searchImpressionShare !== undefined
                            ? `${formatPercent(campaign.searchImpressionShare)} IS`
                            : "No IS"}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-gray-500">Optimization</p>
                      <p className="text-lg font-bold text-customPurple">
                        {campaign.optimizationScore !== null &&
                        campaign.optimizationScore !== undefined
                          ? `${(Number(campaign.optimizationScore) * 100).toFixed(1)}%`
                          : "-"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 grid gap-3 text-sm text-gray-600 md:grid-cols-3 xl:grid-cols-6">
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        Conversions
                      </span>
                      <span className="font-semibold text-green-600">
                        {Number(campaign.conversions || 0).toFixed(1)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        Clicks
                      </span>
                      <span className="font-semibold text-blue-600">
                        {campaign.clicks || 0}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        Spend
                      </span>
                      <span className="font-semibold text-red-600">
                        {formatCurrency((campaign.cost || 0) / 1_000_000)}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        CPA
                      </span>
                      <span className="font-semibold text-orange-600">
                        {Number(campaign.conversions || 0) > 0
                          ? formatCurrency(
                              (campaign.cost || 0) /
                                1_000_000 /
                                Number(campaign.conversions || 0)
                            )
                          : "-"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        Lost IS (Budget)
                      </span>
                      <span className="font-semibold text-amber-600">
                        {campaign.searchBudgetLostImpressionShare !== null &&
                        campaign.searchBudgetLostImpressionShare !== undefined
                          ? formatPercent(campaign.searchBudgetLostImpressionShare)
                          : "-"}
                      </span>
                    </div>
                    <div>
                      <span className="block text-xs uppercase tracking-wide text-gray-400">
                        Lost IS (Rank)
                      </span>
                      <span className="font-semibold text-rose-600">
                        {campaign.searchRankLostImpressionShare !== null &&
                        campaign.searchRankLostImpressionShare !== undefined
                          ? formatPercent(campaign.searchRankLostImpressionShare)
                          : "-"}
                      </span>
                    </div>
                  </div>
                </button>
              </li>
            ))}
            {customerCampaigns.length === 0 && (
              <li className="text-sm text-gray-600">
                No active campaigns were returned for this customer.
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}
