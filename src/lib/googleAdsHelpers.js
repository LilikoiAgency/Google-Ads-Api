// src/lib/googleAdsHelpers.js

export const ALLOWED_DATE_RANGES = new Set([
  'LAST_7_DAYS', 'LAST_30_DAYS', 'LAST_90_DAYS', 'THIS_MONTH', 'CUSTOM',
]);

export const ALLOWED_CAMPAIGN_STATUS_FILTERS = new Set([
  'ACTIVE', 'INACTIVE', 'ALL',
]);

export const USER_LIST_TYPE = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'REMARKETING', 3: 'LOGICAL',
  4: 'EXTERNAL_REMARKETING', 5: 'RULE_BASED', 6: 'SIMILAR', 7: 'CRM_BASED',
};

export const JOB_STATUS = {
  0: 'UNSPECIFIED', 1: 'UNKNOWN', 2: 'PENDING', 3: 'RUNNING',
  4: 'SUCCESS', 5: 'FAILED',
};

export function formatDateLiteral(date) {
  return date.toISOString().slice(0, 10);
}

export function isValidDateLiteral(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

export function getDateWindow(dateRange) {
  const endDate = new Date();
  const startDate = new Date(endDate);
  switch (dateRange) {
    case 'LAST_7_DAYS':   startDate.setDate(endDate.getDate() - 6); break;
    case 'LAST_30_DAYS':  startDate.setDate(endDate.getDate() - 29); break;
    case 'LAST_90_DAYS':  startDate.setDate(endDate.getDate() - 89); break;
    case 'THIS_MONTH':    startDate.setDate(1); break;
    default:              startDate.setDate(endDate.getDate() - 6);
  }
  return { startDate: formatDateLiteral(startDate), endDate: formatDateLiteral(endDate) };
}

export function buildDateFilter(dateRange, customStartDate, customEndDate) {
  let dateWindow;
  if (dateRange === 'CUSTOM') {
    if (!isValidDateLiteral(customStartDate) || !isValidDateLiteral(customEndDate)) {
      throw new Error('Invalid custom date range');
    }
    if (customStartDate > customEndDate) {
      throw new Error('Custom start date must be on or before the end date');
    }
    dateWindow = { startDate: customStartDate, endDate: customEndDate };
  } else {
    dateWindow = getDateWindow(dateRange);
  }
  const { startDate, endDate } = dateWindow;
  return {
    dateFilter: `segments.date BETWEEN '${startDate}' AND '${endDate}'`,
    dateWindow,
  };
}

export function getCampaignStatusCondition(statusFilter, { includeServingStatus = true } = {}) {
  switch (statusFilter) {
    case 'INACTIVE': return "campaign.status IN ('PAUSED', 'REMOVED')";
    case 'ALL':      return 'campaign.id IS NOT NULL';
    case 'ACTIVE':
    default:
      return includeServingStatus
        ? "campaign.status = 'ENABLED' AND campaign.serving_status = 'SERVING'"
        : "campaign.status = 'ENABLED'";
  }
}

export function normalizeLandingPageUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    url.search = '';
    url.hash = '';
    if (url.pathname !== '/' && url.pathname.endsWith('/')) {
      url.pathname = url.pathname.slice(0, -1);
    }
    return url.toString();
  } catch {
    return String(value).trim() || null;
  }
}

export function sortPerformanceRows(a, b) {
  if ((b.conversions || 0) !== (a.conversions || 0)) return (b.conversions || 0) - (a.conversions || 0);
  if ((b.clicks || 0) !== (a.clicks || 0)) return (b.clicks || 0) - (a.clicks || 0);
  return (b.impressions || 0) - (a.impressions || 0);
}

export function sortDeviceRows(a, b) {
  if ((b.conversions || 0) !== (a.conversions || 0)) return (b.conversions || 0) - (a.conversions || 0);
  if ((b.clicks || 0) !== (a.clicks || 0)) return (b.clicks || 0) - (a.clicks || 0);
  return (b.cost || 0) - (a.cost || 0);
}

export function mapUserListType(v) {
  return typeof v === 'number' ? USER_LIST_TYPE[v] || String(v) : v;
}

export function mapJobStatus(v) {
  return typeof v === 'number' ? JOB_STATUS[v] || String(v) : v;
}

/**
 * Splits an account list into pinned (in pin order) and unpinned (alphabetical).
 * @param {Array<{id: string, name: string}>} accounts
 * @param {string[]} pinnedIds - ordered array of pinned account IDs
 * @returns {{ pinned: Array, unpinned: Array }}
 */
export function sortWithPinned(accounts, pinnedIds) {
  const pinnedSet = new Set(pinnedIds.map(String));
  const pinned = pinnedIds
    .map((id) => accounts.find((a) => String(a.id) === String(id)))
    .filter(Boolean);
  const unpinned = accounts
    .filter((a) => !pinnedSet.has(String(a.id)))
    .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  return { pinned, unpinned };
}
