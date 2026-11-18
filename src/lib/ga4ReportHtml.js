// Client-facing, standalone HTML web traffic report built from a normalized
// TrafficReport. Pure string building, safe to import in client components:
// only downloadTrafficReport touches document/Blob, and only when called.
// Internal-only data (report.warnings, suspected paid) is never included.

import { VIEWS, CHANNEL_DEFINITIONS, CHANNEL_COLORS, inView } from './ga4Channels';
import { selectView } from './ga4View';
import { rangeLabel } from './ga4Dates';

const CHART_JS = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js';
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&display=swap';
const TOP_N = 15;

const VIEW_SUBS = {
  organic: (r) => `Visitors who came from unpaid search engine results (Google, Bing and others), ${r}.`,
  nonPaid: (r) => `Visitors from every unpaid channel, ${r}. Paid ads and unassigned traffic are excluded.`,
  paid: (r) => `Visitors who clicked a paid ad (search, social, display, video and others), ${r}.`,
  all: (r) => `Every visitor to the site, from every channel, ${r}.`,
};

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function int(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString('en-US') : '0';
}

function rate(r) {
  return Number.isFinite(r) ? `${(r * 100).toFixed(1)}%` : '0.0%';
}

// '▲ 12% vs Sep 2026', '▼ 3%', '▼ 1.1 pts' (pts: d is a rate difference), null -> '—'.
export function formatDelta(d, { pts = false, vs = null } = {}) {
  if (d === null || d === undefined || !Number.isFinite(d)) return '—';
  let mag;
  let zero;
  if (pts) {
    mag = `${Math.abs(d * 100).toFixed(1)} pts`;
    zero = mag === '0.0 pts';
  } else {
    const p = Math.round(Math.abs(d) * 100);
    mag = `${p.toLocaleString('en-US')}%`;
    zero = p === 0;
  }
  const arrow = zero ? '' : d > 0 ? '▲ ' : '▼ ';
  return `${arrow}${mag}${vs ? ` vs ${vs}` : ''}`;
}

function dirOf(text) {
  if (text.startsWith('▲')) return 'up';
  if (text.startsWith('▼')) return 'dn';
  return 'flat';
}

function cellDelta(d, hasCompare) {
  if (!hasCompare) return null;
  const t = formatDelta(d);
  return { t, dir: dirOf(t) };
}

function buildViewData(report, viewKey, { hasCompare, compareLabel, range, showKeyEvents }) {
  const v = selectView(report, viewKey);
  const t = v.totals;
  const tc = v.totalsCompare;
  // A rate change against a period with no sessions means nothing.
  const rateDelta = tc && tc.sessions > 0 ? v.deltas.engagementRate : null;

  const kpiDefs = [
    { label: 'Users', value: int(t.users), d: v.deltas.users },
    { label: 'Sessions', value: int(t.sessions), d: v.deltas.sessions },
    { label: 'New users', value: int(t.newUsers), d: v.deltas.newUsers },
    { label: 'Engagement rate', value: rate(t.engagementRate), d: rateDelta, pts: true },
  ];
  if (showKeyEvents) kpiDefs.push({ label: 'Key events', value: int(t.keyEvents), d: v.deltas.keyEvents });
  const kpis = kpiDefs.map((k) => {
    if (!hasCompare) return { label: k.label, value: k.value, delta: null, dir: null };
    const delta = formatDelta(k.d, { pts: k.pts, vs: compareLabel });
    return { label: k.label, value: k.value, delta, dir: dirOf(delta) };
  });

  const rows = v.channels.map((c) => ({
    channel: c.channel,
    color: CHANNEL_COLORS[c.channel] || CHANNEL_COLORS.fallback,
    users: int(c.current.users),
    dUsers: cellDelta(c.deltas.users, hasCompare),
    sessions: int(c.current.sessions),
    dSessions: cellDelta(c.deltas.sessions, hasCompare),
    rate: rate(c.current.engagementRate),
    keyEvents: int(c.current.keyEvents),
  }));

  return {
    label: v.view.label,
    sub: VIEW_SUBS[viewKey](range),
    kpis,
    showKeyEvents,
    rows,
    total: {
      label: 'Total (unique users)',
      users: int(t.users),
      dUsers: cellDelta(v.deltas.users, hasCompare),
      sessions: int(t.sessions),
      dSessions: cellDelta(v.deltas.sessions, hasCompare),
      rate: rate(t.engagementRate),
      keyEvents: int(t.keyEvents),
    },
    datasets: v.series.datasets.map((d) => ({
      label: d.channel,
      color: CHANNEL_COLORS[d.channel] || CHANNEL_COLORS.fallback,
      data: d.data.map((x) => (Number.isFinite(x) ? x : 0)),
    })),
    sources: v.sources.slice(0, TOP_N).map((s) => ({
      sourceMedium: s.sourceMedium, channel: s.channel, sessions: int(s.sessions), users: int(s.users),
    })),
    pages: v.pages.slice(0, TOP_N).map((p) => ({
      page: p.page, sessions: int(p.sessions), users: int(p.users), keyEvents: int(p.keyEvents),
    })),
    defs: CHANNEL_DEFINITIONS
      .filter((d) => d.name.split(' / ').some((n) => inView(n, viewKey)))
      .map((d) => ({ name: d.name, text: d.text })),
  };
}

// The views that go into the file: the requested list (defaults to just `view`),
// always including `view` itself, in the standard VIEWS order. Views left out are
// not in the file at all — their numbers are never inlined.
export function resolveReportViews(view, views) {
  const known = new Set(VIEWS.map((v) => v.key));
  if (!known.has(view)) throw new Error(`Unknown view: ${view}`);
  const wanted = new Set(views && views.length ? views : [view]);
  for (const k of wanted) if (!known.has(k)) throw new Error(`Unknown view: ${k}`);
  wanted.add(view);
  return VIEWS.filter((v) => wanted.has(v.key)).map((v) => v.key);
}

// "(Organic search)" for a file holding one view other than Everything; '' otherwise.
function viewSuffix(views) {
  if (!views || views.length !== 1 || views[0] === 'all') return '';
  const v = VIEWS.find((x) => x.key === views[0]);
  return v ? ` (${v.label})` : '';
}

export function reportFilename(report, { views } = {}) {
  const name = `${report.property.name} Web Traffic${viewSuffix(views)} - ${rangeLabel(report.range)}.html`;
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s{2,}/g, ' ').trim();
}

export function generateTrafficReportHtml(report, { view, views } = {}) {
  const included = resolveReportViews(view, views);

  const range = rangeLabel(report.range);
  const hasCompare = !!(report.compareRange && report.totalsByViewCompare);
  const compareLabel = hasCompare ? rangeLabel(report.compareRange) : null;
  const title = `${report.property.name}: Web Traffic${viewSuffix(included)}, ${range}`;
  const unit = { day: 'day', week: 'week', month: 'month' }[report.granularity] || 'day';
  // Same rule as the page: key events column only when the whole property had any.
  const showKeyEvents = (report.totalsByView?.all?.keyEvents || 0) > 0
    || (report.totalsByViewCompare?.all?.keyEvents || 0) > 0;

  const data = {
    labels: report.series.labels,
    compareLabel,
    views: Object.fromEntries(included.map((k) => [k, buildViewData(report, k, { hasCompare, compareLabel, range, showKeyEvents })])),
  };
  // U+2028/2029 are legal in JS string literals since ES2019; only '<' needs escaping.
  const json = JSON.stringify(data).replace(/</g, '\\' + 'u003c');

  const dq = report.dataQuality || {};
  const note = `Source: Google Analytics 4, Session primary channel group, ${range}.`
    + (hasCompare ? ` Compared with ${compareLabel}.` : '')
    + ` Users are unique visitors for the whole period; the chart counts users per ${unit}, so someone who visits in several periods appears in each.`
    + ' Landing-page users are added up across channels, so someone who arrived through two channels counts twice there.'
    + (dq.sampled || dq.otherRow || dq.thresholded
      ? ' Google Analytics sampled or grouped some of this data, so small numbers may be approximate.'
      : '');

  // The view toggle only appears when the file holds more than one view.
  const toggle = included.length > 1
    ? `<div class="toggle" role="group" aria-label="Channels shown">${VIEWS.filter((v) => included.includes(v.key)).map((v) =>
      `<button type="button" data-v="${v.key}" aria-pressed="${v.key === view}">${esc(v.label)}</button>`).join('')}</div>`
    : '';

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<script src="${CHART_JS}"></script>
<style>
:root{--bg:#ffffff;--ink:#17231a;--muted:#5d6b60;--line:#dfe6e0;--soft:#f3f6f3;--c1:#2f7d32;--c3:#c9a227;--up:#2f7d32;--dn:#b3261e;--on:#ffffff;
box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141a15;--ink:#e8eee9;--muted:#9aa89d;--line:#2b352d;--soft:#1b231c;--c1:#5cb85f;--c3:#e0bb45;--up:#6cc46f;--dn:#f2867d;--on:#0f1610}}
:root[data-theme="dark"]{--bg:#141a15;--ink:#e8eee9;--muted:#9aa89d;--line:#2b352d;--soft:#1b231c;--c1:#5cb85f;--c3:#e0bb45;--up:#6cc46f;--dn:#f2867d;--on:#0f1610}
*,*::before,*::after{box-sizing:inherit}
html{scroll-padding-top:env(safe-area-inset-top,0px);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5}
main{max-width:1040px;margin:0 auto;padding:40px 20px 56px}
h1{font-size:clamp(1.6rem,3.5vw,2.4rem);font-weight:800;line-height:1.15;margin:0 0 8px;letter-spacing:-.01em;overflow-wrap:anywhere}
h2{font-size:1.15rem;font-weight:800;margin:48px 0 0;letter-spacing:-.005em}
.sub{color:var(--muted);margin:0 0 28px;max-width:70ch}
.kpi{display:flex;flex-wrap:wrap;gap:24px 40px;margin:0 0 28px}
.kpi div{min-width:0}
.kpi div b{display:block;font-size:1.8rem;font-weight:800;line-height:1.2;font-variant-numeric:tabular-nums}
.kpi div span{display:block;color:var(--muted);font-size:.9rem}
.kpi div em{display:block;font-style:normal;font-size:.82rem;font-weight:600;margin-top:2px}
.up{color:var(--up)}.dn{color:var(--dn)}.flat{color:var(--muted)}
.toggle{display:inline-flex;max-width:100%;border:1px solid var(--line);border-radius:6px;overflow:hidden;margin-bottom:16px}
.toggle button{font:inherit;font-size:.9rem;background:none;color:var(--ink);border:0;padding:8px 14px;cursor:pointer;white-space:nowrap}
.toggle button+button{border-left:1px solid var(--line)}
.toggle button:hover{background:var(--soft)}
.toggle button[aria-pressed="true"]{background:var(--c1);color:var(--on);font-weight:600}
.toggle button:focus-visible{outline:2px solid var(--c3);outline-offset:-2px}
.chart{position:relative;height:420px}
.chart .empty{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;margin:0;color:var(--muted);text-align:center;padding:0 16px}
.chart .empty[hidden]{display:none}
.nochart{height:auto;padding:28px 16px;border:1px dashed var(--line);border-radius:6px;color:var(--muted);text-align:center}
.tw{overflow-x:auto;-webkit-overflow-scrolling:touch;margin-top:16px}
.tw.first{margin-top:36px}
table{border-collapse:collapse;width:100%;font-size:.9rem;font-variant-numeric:tabular-nums}
#tbl{min-width:640px}#tbl.nc{min-width:480px}#src{min-width:440px}#pg{min-width:0}
th,td{padding:8px 10px;text-align:right;border-bottom:1px solid var(--line)}
th:first-child,td:first-child{text-align:left}
th{font-weight:600;color:var(--muted);white-space:nowrap}
td.d{font-size:.82rem;font-weight:600;white-space:nowrap}
td.l{text-align:left}
td.pg{max-width:420px;overflow-wrap:anywhere;word-break:break-word}
td.none{text-align:left;color:var(--muted)}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:8px;vertical-align:baseline}
.sum td{font-weight:800;border-top:2px solid var(--ink)}
.note{color:var(--muted);font-size:.85rem;margin-top:24px;max-width:75ch}
.defs{margin-top:36px}
@media (max-width:520px){
main{padding:28px 16px 44px}
.kpi{gap:18px 28px}
.kpi div b{font-size:1.5rem}
.toggle{display:flex}
.toggle button{flex:1 1 auto;padding:8px 6px;font-size:.8rem}
.chart{height:340px}
}
@media print{.toggle{display:none}main{padding:0}.chart{break-inside:avoid}}
</style></head><body><main>
<h1>${esc(title)}</h1>
<p class="sub" id="sub"></p>
<div class="kpi" id="kpi"></div>
${toggle}
<div class="chart" id="cbox"><canvas id="c" role="img" aria-label="Users per ${unit} by channel"></canvas><p class="empty" id="cempty" hidden>No visits from these channels in this period.</p></div>
<div class="tw first"><table id="tbl"></table></div>
<h2>Top sources</h2>
<div class="tw"><table id="src"></table></div>
<h2>Top landing pages</h2>
<div class="tw"><table id="pg"></table></div>
<p class="note defs" id="defs"></p>
<p class="note">${esc(note)}</p>
</main>
<script>
const D=${json};
const $=id=>document.getElementById(id);
const css=n=>getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let mode='${view}',chart;
const cmp=D.compareLabel!==null;
const hasChart=!!window.Chart;
const dc=d=>d?'<td class="d '+d.dir+'">'+esc(d.t)+'</td>':'';
const dh=cmp?'<th title="Change vs '+esc(D.compareLabel)+'">Δ</th>':'';
function render(){
 const v=D.views[mode],ke=v.showKeyEvents;
 $('sub').textContent=v.sub;
 $('kpi').innerHTML=v.kpis.map(k=>'<div><b>'+esc(k.value)+'</b><span>'+esc(k.label)+'</span>'+(k.delta===null?'':'<em class="'+k.dir+'">'+esc(k.delta)+'</em>')+'</div>').join('');
 const cols=4+(cmp?2:0)+(ke?1:0);
 let t='<thead><tr><th>Channel</th><th>Users</th>'+dh+'<th>Sessions</th>'+dh+'<th>Engagement rate</th>'+(ke?'<th>Key events</th>':'')+'</tr></thead><tbody>';
 if(!v.rows.length)t+='<tr><td class="none" colspan="'+cols+'">No visits from these channels in this period.</td></tr>';
 v.rows.forEach(r=>{t+='<tr><td><i class="sw" style="background:'+esc(r.color)+'"></i>'+esc(r.channel)+'</td><td>'+esc(r.users)+'</td>'+dc(r.dUsers)+'<td>'+esc(r.sessions)+'</td>'+dc(r.dSessions)+'<td>'+esc(r.rate)+'</td>'+(ke?'<td>'+esc(r.keyEvents)+'</td>':'')+'</tr>';});
 const s=v.total;
 t+='<tr class="sum"><td>'+esc(s.label)+'</td><td>'+esc(s.users)+'</td>'+dc(s.dUsers)+'<td>'+esc(s.sessions)+'</td>'+dc(s.dSessions)+'<td>'+esc(s.rate)+'</td>'+(ke?'<td>'+esc(s.keyEvents)+'</td>':'')+'</tr>';
 $('tbl').innerHTML=t+'</tbody>';$('tbl').classList.toggle('nc',!cmp);
 let u='<thead><tr><th>Source / medium</th><th class="l">Channel</th><th>Sessions</th><th>Users</th></tr></thead><tbody>';
 if(!v.sources.length)u+='<tr><td class="none" colspan="4">No sources for these channels in this period.</td></tr>';
 v.sources.forEach(r=>{u+='<tr><td>'+esc(r.sourceMedium)+'</td><td class="l">'+esc(r.channel)+'</td><td>'+esc(r.sessions)+'</td><td>'+esc(r.users)+'</td></tr>';});
 $('src').innerHTML=u+'</tbody>';
 let p='<thead><tr><th>Landing page</th><th>Sessions</th><th>Users (approx.)</th>'+(ke?'<th>Key events</th>':'')+'</tr></thead><tbody>';
 if(!v.pages.length)p+='<tr><td class="none" colspan="'+(ke?4:3)+'">No landing pages for these channels in this period.</td></tr>';
 v.pages.forEach(r=>{p+='<tr><td class="pg">'+esc(r.page)+'</td><td>'+esc(r.sessions)+'</td><td>'+esc(r.users)+'</td>'+(ke?'<td>'+esc(r.keyEvents)+'</td>':'')+'</tr>';});
 $('pg').innerHTML=p+'</tbody>';
 $('defs').innerHTML='<strong>What each channel means</strong><br>'+v.defs.map(d=>'<strong>'+esc(d.name)+':</strong> '+esc(d.text)).join('<br>');
}
function build(){
 if(!hasChart)return;
 const v=D.views[mode];
 if(chart)chart.destroy();
 $('cempty').hidden=v.datasets.some(d=>d.data.some(x=>x>0));
 Chart.defaults.font.family="Archivo,system-ui,sans-serif";
 Chart.defaults.color=css('--muted');
 const multi=v.datasets.length>1;
 chart=new Chart($('c'),{type:'bar',data:{labels:D.labels,datasets:v.datasets.map(d=>({label:d.label,data:d.data,backgroundColor:d.color,borderRadius:2,stack:'s'}))},
 options:{maintainAspectRatio:false,animation:false,interaction:{mode:'index',intersect:false},
 plugins:{legend:{position:'bottom',labels:{boxWidth:12,boxHeight:12}},
 tooltip:{callbacks:{label:it=>' '+it.dataset.label+': '+it.parsed.y.toLocaleString(),footer:it=>multi&&it.length?'Total: '+v.datasets.reduce((s,d)=>s+d.data[it[0].dataIndex],0).toLocaleString():''}}},
 scales:{x:{stacked:true,grid:{display:false},ticks:{maxRotation:0,autoSkipPadding:8}},y:{stacked:true,beginAtZero:true,grid:{color:css('--line')},ticks:{precision:0,callback:x=>x.toLocaleString()}}}}});
}
function set(m){mode=m;document.querySelectorAll('.toggle button').forEach(b=>b.setAttribute('aria-pressed',b.dataset.v===m));render();build();}
document.querySelectorAll('.toggle button').forEach(b=>b.onclick=()=>set(b.dataset.v));
if(!hasChart){const box=$('cbox');box.className='nochart';box.textContent='Chart needs an internet connection; all figures are in the tables below.';}
else{matchMedia('(prefers-color-scheme: dark)').addEventListener('change',build);new MutationObserver(build).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});}
render();build();
</script></body></html>`;
}

export function downloadTrafficReport(report, { view, views } = {}) {
  const html = generateTrafficReportHtml(report, { view, views });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = reportFilename(report, { views: resolveReportViews(view, views) });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
