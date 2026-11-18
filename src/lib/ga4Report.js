// Pure GA4 Data API request builder and response normalizer for the web
// traffic report. No I/O: ga4Client.js sends the requests built here.

import { bucketFor, channelsForView, isSuspectedPaid } from './ga4Channels';

const CHANNEL_DIM = 'sessionPrimaryChannelGroup';
// GA metric names, in request order, and the keys they map to (metric set M).
const METRICS = ['activeUsers', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'keyEvents'];
const M_KEYS = ['users', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'keyEvents'];
const VIEW_KEYS = ['organic', 'nonPaid', 'paid', 'all'];
const TIME_DIM = { day: 'date', week: 'isoYearIsoWeek', month: 'yearMonth' };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 86400000;

const metrics = (names) => names.map((name) => ({ name }));
const dims = (names) => names.map((name) => ({ name }));
const bySessionsDesc = [{ metric: { metricName: 'sessions' }, desc: true }];

export function buildReportRequests({ startDate, endDate, compareRange, granularity }) {
  const current = [{ startDate, endDate, name: 'current' }];
  const both = compareRange
    ? [...current, { startDate: compareRange.startDate, endDate: compareRange.endDate, name: 'compare' }]
    : current;
  const totals = VIEW_KEYS.map((key) => {
    const req = { dateRanges: both, metrics: metrics(METRICS) };
    const channels = channelsForView(key);
    if (channels) {
      req.dimensionFilter = { filter: { fieldName: CHANNEL_DIM, inListFilter: { values: channels } } };
    }
    return req;
  });
  return [
    { dateRanges: both, dimensions: dims([CHANNEL_DIM]), metrics: metrics(METRICS) },
    ...totals,
    {
      dateRanges: current,
      dimensions: dims([TIME_DIM[granularity] || 'date', CHANNEL_DIM]),
      metrics: metrics(['activeUsers']),
      limit: 100000,
    },
    {
      dateRanges: current,
      dimensions: dims(['sessionSourceMedium', CHANNEL_DIM]),
      metrics: metrics(['sessions', 'activeUsers']),
      orderBys: bySessionsDesc,
      limit: 1000,
    },
    {
      dateRanges: current,
      dimensions: dims(['landingPage', CHANNEL_DIM]),
      metrics: metrics(['sessions', 'activeUsers', 'keyEvents', 'engagedSessions']),
      orderBys: bySessionsDesc,
      limit: 500,
    },
  ];
}

// ── helpers ──────────────────────────────────────────────────────────────

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function zeroM() {
  return Object.fromEntries(M_KEYS.map((k) => [k, 0]));
}

function toM(metricValues) {
  return Object.fromEntries(M_KEYS.map((k, i) => [k, num(metricValues?.[i]?.value)]));
}

const rowsOf = (report) => report?.rows || [];
const dimVals = (row) => (row.dimensionValues || []).map((d) => d.value);

// With two date ranges GA appends a dateRange dimension ('current'/'compare')
// after the requested dimensions. Rows without it belong to 'current'.
function rangeOf(values, dimCount) {
  return values.length > dimCount ? values[dimCount] : 'current';
}

function totalsFrom(report) {
  const out = { current: zeroM(), compare: zeroM() };
  for (const row of rowsOf(report)) {
    out[rangeOf(dimVals(row), 0) === 'compare' ? 'compare' : 'current'] = toM(row.metricValues);
  }
  return out;
}

const parseDate = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
};
const pad = (n) => String(n).padStart(2, '0');
const dayLabel = (ms) => {
  const d = new Date(ms);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function isoWeekKey(ms) {
  const d = new Date(ms);
  const thursday = ms + (3 - ((d.getUTCDay() + 6) % 7)) * DAY_MS;
  const isoYear = new Date(thursday).getUTCFullYear();
  const week = Math.floor((thursday - Date.UTC(isoYear, 0, 1)) / DAY_MS / 7) + 1;
  return `${isoYear}${pad(week)}`;
}

function isoWeekMonday(key) {
  const isoYear = Number(key.slice(0, 4));
  const week = Number(key.slice(4));
  const jan4 = Date.UTC(isoYear, 0, 4);
  const week1Monday = jan4 - ((new Date(jan4).getUTCDay() + 6) % 7) * DAY_MS;
  return week1Monday + (week - 1) * 7 * DAY_MS;
}

// Ordered time buckets covering the range: [{ key (GA value), label }].
function timeBuckets({ startDate, endDate }, granularity) {
  const start = parseDate(startDate);
  const end = parseDate(endDate);
  const out = [];
  const seen = new Set();
  for (let ms = start; ms <= end; ms += DAY_MS) {
    const d = new Date(ms);
    let key;
    let label;
    if (granularity === 'week') {
      key = isoWeekKey(ms);
      label = `Wk of ${dayLabel(isoWeekMonday(key))}`;
    } else if (granularity === 'month') {
      key = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}`;
      label = `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    } else {
      key = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`;
      label = dayLabel(ms);
    }
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ key, label });
    }
  }
  return out;
}

function suspectedPaidWarning(sources) {
  const byChannel = new Map();
  for (const s of sources) {
    if (s.suspectedPaid) byChannel.set(s.channel, (byChannel.get(s.channel) || 0) + s.sessions);
  }
  const entries = [...byChannel].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return null;
  const total = entries.reduce((sum, [, n]) => sum + n, 0);
  const parts = entries.length === 1
    ? entries[0][0]
    : entries.map(([ch, n]) => `${ch} (${n.toLocaleString('en-US')})`).join(' / ');
  return `~${total.toLocaleString('en-US')} sessions labeled ${parts} look like paid ads with missing UTM tags`;
}

// ── normalizer ───────────────────────────────────────────────────────────

// Page-only text for GA data-quality flags (also exposed as report.dataQuality).
export const DATA_QUALITY_WARNINGS = {
  otherRow: 'GA grouped some rows into (other)',
  sampled: 'GA sampled this data',
  thresholded: 'GA hid some low numbers to protect user privacy (thresholding)',
};

export function normalizeTrafficReport(reports, { property, range, compareRange, granularity }) {
  const hasCompare = !!compareRange;
  const [channelsReport, ...rest] = reports || [];
  const totalReports = rest.slice(0, 4);
  const [seriesReport, sourcesReport, pagesReport] = rest.slice(4, 7);

  // Totals per view: always from GA's filtered requests, never summed.
  const totalsByView = {};
  const totalsByViewCompare = hasCompare ? {} : null;
  VIEW_KEYS.forEach((key, i) => {
    const t = totalsFrom(totalReports[i]);
    totalsByView[key] = t.current;
    if (hasCompare) totalsByViewCompare[key] = t.compare;
  });

  // Channels: union of channels seen in either range.
  const channelMap = new Map();
  for (const row of rowsOf(channelsReport)) {
    const values = dimVals(row);
    const channel = values[0];
    if (!channelMap.has(channel)) {
      channelMap.set(channel, { channel, bucket: bucketFor(channel), current: zeroM(), compare: hasCompare ? zeroM() : null });
    }
    const entry = channelMap.get(channel);
    if (rangeOf(values, 1) === 'compare') {
      if (hasCompare) entry.compare = toM(row.metricValues);
    } else {
      entry.current = toM(row.metricValues);
    }
  }
  const channels = [...channelMap.values()].sort((a, b) => b.current.sessions - a.current.sessions);

  // Series: users per time bucket per channel, zero-filled.
  const buckets = timeBuckets(range, granularity);
  const index = new Map(buckets.map((b, i) => [b.key, i]));
  const byChannel = {};
  for (const row of rowsOf(seriesReport)) {
    const [timeKey, channel] = dimVals(row);
    const i = index.get(timeKey);
    if (i === undefined) continue;
    if (!byChannel[channel]) byChannel[channel] = new Array(buckets.length).fill(0);
    byChannel[channel][i] += num(row.metricValues?.[0]?.value);
  }

  const sources = rowsOf(sourcesReport).map((row) => {
    const [sourceMedium, channel] = dimVals(row);
    const bucket = bucketFor(channel);
    return {
      sourceMedium, channel, bucket,
      sessions: num(row.metricValues?.[0]?.value),
      users: num(row.metricValues?.[1]?.value),
      suspectedPaid: isSuspectedPaid(sourceMedium, bucket),
    };
  });

  const landingPages = rowsOf(pagesReport).map((row) => {
    const [page, channel] = dimVals(row);
    const out = {
      page, channel, bucket: bucketFor(channel),
      sessions: num(row.metricValues?.[0]?.value),
      users: num(row.metricValues?.[1]?.value),
      keyEvents: num(row.metricValues?.[2]?.value),
    };
    // Older cached reports and fixtures predate this metric.
    if (row.metricValues?.[3] !== undefined) out.engagedSessions = num(row.metricValues[3].value);
    return out;
  });

  const warnings = [];
  const paidWarning = suspectedPaidWarning(sources);
  if (paidWarning) warnings.push(paidWarning);
  const all = reports || [];
  const dataQuality = {
    sampled: all.some((r) => r?.metadata?.samplingMetadatas?.length > 0),
    otherRow: all.some((r) => !!r?.metadata?.dataLossFromOtherRow),
    thresholded: all.some((r) => !!r?.metadata?.subjectToThresholding),
  };
  for (const key of ['otherRow', 'sampled', 'thresholded']) {
    if (dataQuality[key]) warnings.push(DATA_QUALITY_WARNINGS[key]);
  }

  return {
    property,
    range: { startDate: range.startDate, endDate: range.endDate },
    compareRange: hasCompare ? { startDate: compareRange.startDate, endDate: compareRange.endDate } : null,
    granularity,
    totalsByView,
    totalsByViewCompare,
    channels,
    series: { labels: buckets.map((b) => b.label), byChannel },
    sources,
    landingPages,
    warnings,
    dataQuality,
    fetchedAt: new Date().toISOString(),
  };
}
