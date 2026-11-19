// Overview numbers for a v2 audit result, shared by the dashboard view and the
// downloaded report so both always agree. Pure: safe in client and server code.

export const AREA_LABELS = { content: 'Content', local: 'Local', aeo: 'Answers', technical: 'Technical', conversion: 'Conversion' };
export const OPPORTUNITY_ROWS = 8;

// High impact = 4 or 5; low effort = 1 or 2. A quick win is both.
export const isHighImpact = (t) => t.impact >= 4;
export const isLowEffort = (t) => t.effort <= 2;
export const isQuickWin = (t) => isHighImpact(t) && isLowEffort(t);
export const effortLabel = (n) => (n <= 2 ? 'Quick' : n === 3 ? 'Moderate' : 'Major');

const num = (v) => (Number.isFinite(v) ? v : null);

// Search Console + URL Inspection numbers kept on the result (built when the audit
// finishes). gsc: the gathered Search Console summary; inspection: URL Inspection rows.
export function buildSearchSummary(gsc, inspection) {
  const out = {};
  const t = gsc?.totals;
  if (t) {
    out.search = {
      range: gsc.range || null,
      compare_range: gsc.compare_range || null,
      clicks: num(t.clicks),
      impressions: num(t.impressions),
      ctr: num(t.ctr),
      avg_position: num(t.avg_position),
      avg_position_prev: num(t.avg_position_prev),
      clicks_change_pct: num(t.clicks_change_pct),
      impressions_change_pct: num(t.impressions_change_pct),
      branded_click_share: num(gsc.branded_split?.branded_click_share),
      nonbranded_clicks: num(gsc.branded_split?.nonbranded_clicks),
      opportunities: (gsc.striking_distance || []).slice(0, OPPORTUNITY_ROWS).map((q) => ({
        query: q.query, clicks: num(q.clicks), impressions: num(q.impressions), position: num(q.position),
      })),
    };
  }
  if (Array.isArray(inspection) && inspection.length) {
    out.index = { checked: inspection.length, indexed: inspection.filter((r) => r?.verdict === 'PASS').length };
  }
  return out;
}

// -> { areas: [{ key, label, count }], matrix: { quick, big, fill, later }, quickWins, total }
export function planStats(plan) {
  const tasks = plan || [];
  const counts = new Map();
  for (const t of tasks) counts.set(t.category, (counts.get(t.category) || 0) + 1);
  const areas = [...counts.entries()]
    .map(([key, count]) => ({ key, label: AREA_LABELS[key] || key, count }))
    .sort((a, b) => b.count - a.count);
  const matrix = { quick: 0, big: 0, fill: 0, later: 0 };
  for (const t of tasks) {
    const hi = isHighImpact(t);
    const easy = isLowEffort(t);
    matrix[hi && easy ? 'quick' : hi ? 'big' : easy ? 'fill' : 'later'] += 1;
  }
  return { areas, matrix, quickWins: matrix.quick, total: tasks.length };
}

const fmt = (n) => Number(n).toLocaleString('en-US');
export const compact = (n) => (n >= 10000 ? `${fmt(Math.round(n / 1000))}K` : fmt(n));

// Headline cards. Each: { key, label, value, sub?, unit?, tone: 'up'|'down'|'muted' }.
// Cards whose data is missing (older audits, no Search Console) are left out.
export function kpiCards(result) {
  const s = result?.search;
  const idx = result?.index;
  const cards = [];
  const change = (pct, label) => {
    if (!Number.isFinite(pct)) return { sub: null, tone: 'muted' };
    if (pct === 0) return { sub: `No change vs ${label}`, tone: 'muted' };
    return { sub: `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}% vs ${label}`, tone: pct > 0 ? 'up' : 'down' };
  };
  if (s && Number.isFinite(s.clicks)) cards.push({ key: 'clicks', label: 'Search clicks · 90 days', value: fmt(s.clicks), ...change(s.clicks_change_pct, 'prior 90 days') });
  if (s && Number.isFinite(s.impressions)) cards.push({ key: 'impressions', label: 'Impressions', value: compact(s.impressions), ...change(s.impressions_change_pct, 'prior 90 days') });
  if (s && Number.isFinite(s.avg_position)) {
    const prev = s.avg_position_prev;
    const worse = Number.isFinite(prev) && s.avg_position > prev;
    const better = Number.isFinite(prev) && s.avg_position < prev;
    cards.push({
      key: 'position', label: 'Avg. position', value: String(s.avg_position),
      sub: Number.isFinite(prev) ? `${worse ? '▼ Down' : better ? '▲ Up' : 'Same'} from ${prev}` : null,
      tone: worse ? 'down' : better ? 'up' : 'muted',
    });
  }
  if (s && Number.isFinite(s.branded_click_share)) {
    cards.push({
      key: 'brand', label: 'Clicks from brand searches', value: `${Math.round(s.branded_click_share * 100)}%`,
      sub: Number.isFinite(s.nonbranded_clicks) ? `${fmt(s.nonbranded_clicks)} non-brand clicks` : null, tone: 'muted',
    });
  }
  if (idx?.checked) {
    const missing = idx.checked - idx.indexed;
    cards.push({
      key: 'index', label: 'Pages indexed', value: String(idx.indexed), unit: `/${idx.checked}`,
      sub: missing > 0 ? `${missing} checked page${missing === 1 ? '' : 's'} not indexed` : 'Every checked page is indexed',
      tone: missing > 0 ? 'down' : 'up',
    });
  }
  const { total, quickWins } = planStats(result?.action_plan);
  cards.push({ key: 'plan', label: 'Action plan', value: fmt(total), sub: `${quickWins} quick win${quickWins === 1 ? '' : 's'}`, tone: quickWins > 0 ? 'up' : 'muted' });
  return cards;
}
