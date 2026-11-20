// Client-facing, standalone HTML organic search report built from a normalized
// search report. Pure string building; only downloadSearchReport touches the DOM.
// Internal-only lists (low CTR, cannibalization, index checks) are not included.

import { rangeLabel } from './ga4Dates';
import { change, expectedCtrModel, strikingDistance, isBranded, rollupTrend } from './gscInsights';
import { countryName } from './gscCountries';
import { SEARCH_TYPES } from './gscReport';

const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap';
const TOP_N = 25;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const int = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0');
const pct = (r) => (Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : '0.0%');
const pos = (p) => (p > 0 ? p.toFixed(1) : '—');

function delta(d) {
  if (d === null || d === undefined || !Number.isFinite(d)) return { t: '—', c: 'flat' };
  const p = Math.round(Math.abs(d) * 100);
  if (p === 0) return { t: '0%', c: 'flat' };
  return { t: `${d > 0 ? '▲' : '▼'} ${p.toLocaleString('en-US')}%`, c: d > 0 ? 'up' : 'dn' };
}
function ptsDelta(d) {
  if (d === null || !Number.isFinite(d)) return { t: '—', c: 'flat' };
  const t = Math.abs(d * 100).toFixed(1);
  if (t === '0.0') return { t: '0.0 pts', c: 'flat' };
  return { t: `${d > 0 ? '▲' : '▼'} ${t} pts`, c: d > 0 ? 'up' : 'dn' };
}
function posDelta(cur, prev) {
  if (!(cur > 0) || !(prev > 0)) return { t: '—', c: 'flat' };
  const diff = prev - cur;
  const t = Math.abs(diff).toFixed(1);
  if (t === '0.0') return { t: 'no change', c: 'flat' };
  return { t: `${diff > 0 ? '▲' : '▼'} ${t}`, c: diff > 0 ? 'up' : 'dn' };
}

function path(url, keepHost) {
  try {
    const u = new URL(url);
    const p = `${u.pathname}${u.search}` || '/';
    return keepHost ? `${u.hostname.replace(/^www\./, '')}${p}` : p;
  } catch {
    return String(url || '');
  }
}

function siteName(site) {
  return String(site || '').replace(/^sc-domain:/, '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');
}

function table(head, rows, empty, cls = '') {
  const body = rows.length
    ? rows.map((r) => `<tr>${r.map((c, i) => `<td${i === 0 ? ' class="l"' : ''}>${c}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="none" colspan="${head.length}">${esc(empty)}</td></tr>`;
  return `<div class="tw"><table class="${cls}"><thead><tr>${head.map((h, i) => `<th${i === 0 ? ' class="l"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

const deltaCell = (d) => `<span class="${d.c}">${esc(d.t)}</span>`;

// 'nonbrand' / 'brand' views of the report (see segmentReport) get labeled everywhere.
const SEGMENT_TEXT = { nonbrand: 'non-branded searches', brand: 'branded searches' };
const SEGMENT_FILE = { nonbrand: ' (Non-branded)', brand: ' (Branded)' };

export function searchReportFilename(report) {
  const type = report.type && report.type !== 'web' ? ` ${SEARCH_TYPES.find((t) => t.key === report.type)?.label || report.type}` : '';
  return `${siteName(report.site)} Organic Search${type}${SEGMENT_FILE[report.segment] || ''} - ${rangeLabel(report.range)}.html`
    .replace(/[\\/:*?"<>|]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function generateSearchReportHtml(report, { brandTerms = [], granularity = 'day' } = {}) {
  const range = rangeLabel(report.range);
  const hasCompare = !!(report.compareRange && report.totalsCompare);
  const cmpLabel = hasCompare ? rangeLabel(report.compareRange) : null;
  const typeLabel = SEARCH_TYPES.find((t) => t.key === report.type)?.label || 'Web';
  const name = siteName(report.site);
  const segText = SEGMENT_TEXT[report.segment] || null;
  const title = `${name}: Google organic search${report.type !== 'web' ? ` (${typeLabel})` : ''}${segText ? `, ${segText}` : ''}, ${range}`;
  const t = report.totals;
  const p = report.totalsCompare;
  const q = report.hasQueries;
  const multiHost = new Set(report.pages.map((x) => { try { return new URL(x.page).hostname.replace(/^www\./, ''); } catch { return ''; } })).size > 1;

  const kpis = [
    ['Clicks', int(t.clicks), hasCompare ? delta(change(t.clicks, p.clicks)) : null],
    ['Impressions', int(t.impressions), hasCompare ? delta(change(t.impressions, p.impressions)) : null],
    ['Click-through rate', pct(t.ctr), hasCompare ? ptsDelta(p.impressions > 0 ? t.ctr - p.ctr : null) : null],
  ];
  if (q) kpis.push(['Average position', pos(t.position), hasCompare ? posDelta(t.position, p.position) : null]);
  const kpiHtml = kpis.map(([l, v, d]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span>${d ? `<em class="${d.c}">${esc(d.t)}${cmpLabel ? ` vs ${esc(cmpLabel)}` : ''}</em>` : ''}</div>`).join('');

  // Chart data
  const cur = rollupTrend(report.trend, granularity);
  const prev = report.trendCompare ? rollupTrend(report.trendCompare, granularity) : null;
  const chart = {
    labels: cur.map((x) => x.date),
    clicks: cur.map((x) => x.clicks),
    impressions: cur.map((x) => x.impressions),
    prevClicks: prev ? cur.map((_, i) => prev[i]?.clicks ?? null) : null,
  };
  const json = JSON.stringify(chart).replace(/</g, '\\u003c');

  // Brand split
  let brandHtml = '';
  if (report.brand) {
    const b = report.brand.current;
    const bc = report.brand.compare;
    const total = t.clicks || 0;
    const row = (label, x, y, note) => [
      `${esc(label)}${note ? `<br><span class="m">${esc(note)}</span>` : ''}`,
      int(x.clicks),
      hasCompare && y ? deltaCell(delta(change(x.clicks, y.clicks))) : '',
      total ? pct(x.clicks / total) : '—',
      int(x.impressions),
    ].filter((c, i) => hasCompare || i !== 2);
    const head = hasCompare ? ['', 'Clicks', 'Change', 'Share', 'Impressions'] : ['', 'Clicks', 'Share', 'Impressions'];
    brandHtml = `<h2>Branded vs non-branded searches</h2>
<p class="sub2">Non-branded searches are people finding ${esc(name)} without typing the company name, the clearest measure of SEO growth.</p>
${table(head, [
      row('Non-branded', b.nonBranded, bc?.nonBranded),
      row('Branded', b.branded, bc?.branded, `Searches containing: ${report.brand.terms.join(', ')}`),
      row('Private / anonymized', b.anonymized, bc?.anonymized, 'Rare searches Google hides for privacy'),
    ], '')}`;
  }

  // Tables
  const qHead = hasCompare ? ['Search query', 'Clicks', 'Change', 'Impressions', 'CTR', 'Position'] : ['Search query', 'Clicks', 'Impressions', 'CTR', 'Position'];
  const qRows = [...report.queries].sort((a, b) => b.clicks - a.clicks).slice(0, TOP_N).map((r) => [
    `${esc(r.query)}${brandTerms.length && isBranded(r.query, brandTerms) ? ' <span class="tag">brand</span>' : ''}`,
    int(r.clicks),
    ...(hasCompare ? [deltaCell(delta(r.prev ? change(r.clicks, r.prev.clicks) : null))] : []),
    int(r.impressions), pct(r.ctr), pos(r.position),
  ]);
  const pHead = (hasCompare ? ['Page', 'Clicks', 'Change', 'Impressions', 'CTR'] : ['Page', 'Clicks', 'Impressions', 'CTR']).concat(q ? ['Position'] : []);
  const pRows = [...report.pages].sort((a, b) => b.clicks - a.clicks).slice(0, TOP_N).map((r) => [
    `<span class="url">${esc(path(r.page, multiHost))}</span>`,
    int(r.clicks),
    ...(hasCompare ? [deltaCell(delta(r.prev ? change(r.clicks, r.prev.clicks) : null))] : []),
    int(r.impressions), pct(r.ctr), ...(q ? [pos(r.position)] : []),
  ]);

  let oppHtml = '';
  if (q) {
    const nonBrand = brandTerms.length ? report.queries.filter((x) => !isBranded(x.query, brandTerms)) : report.queries;
    const opp = strikingDistance(nonBrand, expectedCtrModel(report.queries)).slice(0, 15);
    if (opp.length) {
      oppHtml = `<h2>Opportunities: searches close to the top</h2>
<p class="sub2">These searches already show ${esc(name)} in positions 4–15. Moving them into the top 3 is the fastest way to grow clicks.</p>
${table(['Search query', 'Position', 'Impressions', 'Clicks now', 'Est. extra clicks at #3'], opp.map((r) => [esc(r.query), pos(r.position), int(r.impressions), int(r.clicks), `<b class="up">+${int(r.potential)}</b>`]), '')}`;
    }
  }

  const total = t.clicks || 0;
  const devHtml = report.devices.length
    ? `<h2>Devices</h2>${table(['Device', 'Clicks', 'Share', 'Impressions', 'CTR'], report.devices.map((d) => [esc(d.device), int(d.clicks), total ? pct(d.clicks / total) : '—', int(d.impressions), pct(d.ctr)]), '')}`
    : '';
  const ctyHtml = `<h2>Countries</h2>${table(['Country', 'Clicks', 'Share', 'Impressions'], report.countries.slice(0, 10).map((c) => [esc(countryName(c.country)), int(c.clicks), total ? pct(c.clicks / total) : '—', int(c.impressions)]), 'No country data.')}`;

  const note = `Source: Google Search Console, ${typeLabel.toLowerCase()} search results for ${name}, ${range}.`
    + (hasCompare ? ` Compared with ${cmpLabel}.` : '')
    + (segText
      ? ` Figures cover ${segText} only: searches ${report.segment === 'brand' ? 'containing' : 'not containing'} ${(report.brand?.terms || []).map((t) => `"${t}"`).join(', ')}. Searches Google keeps private are not included. Devices and countries cover all searches.`
      : ' Totals include searches Google keeps private, so the query table adds up to less than the totals.')
    + (report.firstIncompleteDate && report.firstIncompleteDate <= report.range.endDate ? ' The most recent days are preliminary and may still rise.' : '');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<script src="${CHART_JS}"></script>
<style>
:root{--bg:#ffffff;--ink:#111827;--muted:#6b7280;--line:#e5e7eb;--soft:#f9fafb;--accent:#7c3aed;--accent2:#a855f7;--up:#15803d;--dn:#b91c1c}
@media (prefers-color-scheme:dark){:root{--bg:#0b0b10;--ink:#f3f4f6;--muted:#9ca3af;--line:#26262f;--soft:#14141b;--accent:#c084fc;--accent2:#e9d5ff;--up:#4ade80;--dn:#f87171}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Geist,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;-webkit-text-size-adjust:100%}
main{max-width:1040px;margin:0 auto;padding:40px 20px 56px}
.eyebrow{color:var(--accent);font-weight:600;font-size:.8rem;letter-spacing:.08em;text-transform:uppercase;margin:0 0 6px}
h1{font-size:clamp(1.5rem,3.2vw,2.1rem);font-weight:700;line-height:1.2;margin:0 0 6px;letter-spacing:-.02em;overflow-wrap:anywhere}
h2{font-size:1.1rem;font-weight:600;margin:44px 0 4px;letter-spacing:-.01em}
.sub{color:var(--muted);margin:0 0 28px}
.sub2{color:var(--muted);margin:0 0 12px;font-size:.92rem;max-width:72ch}
.kpi{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 24px}
.kpi div{border:1px solid var(--line);border-radius:14px;padding:16px 18px}
.kpi b{display:block;font-size:1.7rem;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.kpi span{display:block;color:var(--muted);font-size:.85rem}
.kpi em{display:block;font-style:normal;font-size:.8rem;font-weight:600;margin-top:4px}
.up{color:var(--up)}.dn{color:var(--dn)}.flat{color:var(--muted)}
.card{border:1px solid var(--line);border-radius:14px;padding:16px}
.chart{position:relative;height:320px}
.nochart{padding:28px 16px;color:var(--muted);text-align:center}
.legend{display:flex;gap:16px;flex-wrap:wrap;color:var(--muted);font-size:.82rem;margin-top:8px}
.legend i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:6px;vertical-align:-1px}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;border:1px solid var(--line);border-radius:14px}
table{border-collapse:collapse;width:100%;font-size:.88rem;font-variant-numeric:tabular-nums}
th,td{padding:9px 12px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
tr:last-child td{border-bottom:0}
th{font-weight:600;color:var(--muted);font-size:.78rem;text-transform:uppercase;letter-spacing:.04em;background:var(--soft)}
.l{text-align:left;white-space:normal}
td.l{max-width:440px;overflow-wrap:anywhere}
.url{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82rem}
td.none{text-align:left;color:var(--muted)}
.m{color:var(--muted);font-size:.8rem}
.tag{display:inline-block;font-size:.7rem;font-weight:600;color:var(--accent);border:1px solid var(--line);border-radius:999px;padding:0 7px;margin-left:6px;vertical-align:1px}
.note{color:var(--muted);font-size:.82rem;margin-top:36px;max-width:78ch}
@media (max-width:520px){main{padding:28px 16px 44px}.chart{height:260px}}
@media print{.chart{break-inside:avoid}h2{break-after:avoid}}
</style></head><body><main>
<p class="eyebrow">Organic search report</p>
<h1>${esc(title)}</h1>
<p class="sub">How ${esc(name)} performed in Google&rsquo;s unpaid search results${hasCompare ? `, compared with ${esc(cmpLabel)}` : ''}.</p>
<div class="kpi">${kpiHtml}</div>
<div class="card"><div class="chart" id="cbox"><canvas id="c" role="img" aria-label="Clicks and impressions per ${esc(granularity)}"></canvas></div>
<div class="legend"><span><i style="background:#7c3aed"></i>Clicks (left axis)</span><span><i style="background:#c4b5fd"></i>Impressions (right axis)</span>${chart.prevClicks ? '<span><i style="background:#d1d5db"></i>Clicks, comparison period</span>' : ''}</div></div>
${brandHtml}
${q ? `<h2>Top search queries</h2><p class="sub2">What people typed into Google before clicking through.</p>${table(qHead, qRows, 'No queries in this period.')}` : ''}
<h2>Top pages</h2>
${table(pHead, pRows, 'No pages in this period.')}
${oppHtml}
${devHtml}
${ctyHtml}
<p class="note">${esc(note)}</p>
</main>
<script>
const D=${json};
const box=document.getElementById('cbox');
if(!window.Chart){box.className='nochart';box.textContent='The chart needs an internet connection; all figures are in the tables.';}
else{
 const dark=matchMedia('(prefers-color-scheme: dark)').matches;
 const grid=dark?'#26262f':'#e5e7eb',muted=dark?'#9ca3af':'#6b7280';
 Chart.defaults.font.family='Geist,system-ui,sans-serif';Chart.defaults.color=muted;
 const ds=[{label:'Clicks',data:D.clicks,borderColor:'#7c3aed',backgroundColor:'#7c3aed',yAxisID:'y',tension:.3,pointRadius:0,borderWidth:2},
  {label:'Impressions',data:D.impressions,borderColor:'#c4b5fd',backgroundColor:'#c4b5fd',yAxisID:'y1',tension:.3,pointRadius:0,borderWidth:2}];
 if(D.prevClicks)ds.push({label:'Clicks (comparison)',data:D.prevClicks,borderColor:'#d1d5db',borderDash:[5,4],yAxisID:'y',tension:.3,pointRadius:0,borderWidth:1.5});
 new Chart(document.getElementById('c'),{type:'line',data:{labels:D.labels,datasets:ds},options:{maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
  plugins:{legend:{display:false},tooltip:{callbacks:{label:i=>' '+i.dataset.label+': '+(i.parsed.y==null?'—':i.parsed.y.toLocaleString())}}},
  scales:{x:{grid:{display:false},ticks:{maxRotation:0,autoSkipPadding:12}},y:{beginAtZero:true,grid:{color:grid},ticks:{precision:0}},y1:{position:'right',beginAtZero:true,grid:{display:false},ticks:{precision:0}}}}});
}
</script></body></html>`;
}

export function downloadSearchReport(report, opts) {
  const html = generateSearchReportHtml(report, opts);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = searchReportFilename(report);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
