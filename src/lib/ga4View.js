// Pure view selector: turns one normalized TrafficReport into what a given
// view (organic / nonPaid / paid / all) shows. Used by the page and the download.

import { VIEWS, inView } from './ga4Channels';
import { DATA_QUALITY_WARNINGS } from './ga4Report';

const QUALITY_TEXT = new Set(Object.values(DATA_QUALITY_WARNINGS));

// Splits report.warnings for the page: the suspected-paid line only when the
// current view (selectView result) has suspected sessions; GA data-quality
// notices (sampling / (other) / thresholding) always.
export function pageNotes(report, selected) {
  const warnings = report?.warnings || [];
  return {
    paid: selected?.suspected?.sessions > 0 ? warnings.filter((w) => !QUALITY_TEXT.has(w)) : [],
    quality: warnings.filter((w) => QUALITY_TEXT.has(w)),
  };
}

const M_KEYS = ['users', 'newUsers', 'sessions', 'engagedSessions', 'engagementRate', 'keyEvents'];
const TOP_N = 25;

// Fractional change. Null when there is no usable previous value.
export function delta(cur, prev) {
  if (prev === null || prev === undefined || prev === 0) return null;
  if (!Number.isFinite(cur) || !Number.isFinite(prev)) return null;
  return (cur - prev) / prev;
}

function deltasFor(cur, prev) {
  const out = {};
  for (const k of M_KEYS) {
    if (!prev) out[k] = null;
    else if (k === 'engagementRate') out[k] = cur[k] - prev[k];
    else out[k] = delta(cur[k], prev[k]);
  }
  return out;
}

export function selectView(report, viewKey) {
  const view = VIEWS.find((v) => v.key === viewKey);
  if (!view) throw new Error(`Unknown view: ${viewKey}`);

  const totals = report.totalsByView[viewKey];
  const totalsCompare = report.totalsByViewCompare ? report.totalsByViewCompare[viewKey] : null;

  const channels = report.channels
    .filter((c) => inView(c.channel, viewKey))
    .map((c) => ({
      channel: c.channel,
      bucket: c.bucket,
      current: c.current,
      compare: c.compare,
      deltas: deltasFor(c.current, c.compare),
    }));

  const byChannel = report.series.byChannel || {};
  const datasets = channels
    .filter((c) => byChannel[c.channel])
    .map((c) => ({ channel: c.channel, data: byChannel[c.channel] }));

  const sources = report.sources.filter((s) => inView(s.channel, viewKey));

  const pageMap = new Map();
  for (const p of report.landingPages) {
    if (!inView(p.channel, viewKey)) continue;
    const e = pageMap.get(p.page) || { page: p.page, sessions: 0, users: 0, keyEvents: 0 };
    e.sessions += p.sessions;
    e.users += p.users;
    e.keyEvents += p.keyEvents;
    pageMap.set(p.page, e);
  }
  const pages = [...pageMap.values()].sort((a, b) => b.sessions - a.sessions).slice(0, TOP_N);

  const suspected = { sessions: 0, byChannel: {} };
  for (const s of sources) {
    if (!s.suspectedPaid) continue;
    suspected.sessions += s.sessions;
    suspected.byChannel[s.channel] = (suspected.byChannel[s.channel] || 0) + s.sessions;
  }

  return {
    view,
    totals,
    totalsCompare,
    deltas: deltasFor(totals, totalsCompare),
    channels,
    series: { labels: report.series.labels, datasets },
    sources: sources.slice(0, TOP_N),
    pages,
    suspected,
  };
}
