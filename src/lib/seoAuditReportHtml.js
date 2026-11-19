// Standalone HTML downloads of a v2 SEO audit, to email. Same dashboard as the
// app (headline numbers, searches you almost win, scores, top moves, plan by
// area, impact vs effort), built from the same overview numbers. Dark on screen
// like the control room; prints on white.
//  - client: the overview plus the top 10 tasks in plain terms. No evidence,
//    exact text or "[confirm: …]" notes.
//  - full: the overview plus every task with its exact change, evidence and
//    per-page items, and the data gaps.
// Pure string building (safe in client components); only downloadSeoReport
// touches document/Blob, and only when called. No scripts in the file.

import { kpiCards, planStats, effortLabel, isQuickWin, AREA_LABELS } from './seoAuditV2/overview';

export const REPORT_KINDS = [
  { key: 'client', label: 'Client report', hint: 'The overview and the top 10 tasks in plain terms. No technical evidence.' },
  { key: 'full', label: 'Full action plan', hint: 'The overview plus every task with the exact change, evidence and each page, for whoever does the work.' },
];

export const CLIENT_TOP = 10;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap';

const SCORE_LABELS = [
  ['seo', 'Search visibility', 'SEO'],
  ['geo', 'AI search readiness', 'GEO'],
  ['aeo', 'Answer readiness', 'AEO'],
];

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Client copy never shows the analyst's "[confirm: …]" notes.
export function stripConfirm(s) {
  return String(s ?? '').replace(/\s*\[confirm:[^\]]*\]/gi, '').replace(/\s{2,}/g, ' ').trim();
}

// The first sentence leads; the rest follows (same rule as the app).
function splitSummary(text) {
  const t = String(text || '').trim();
  const m = t.match(/^(.+?[.!?])\s+(?=[A-Z0-9"'“‘(])/s);
  if (!m || m[1].length < 40) return { headline: t, rest: '' };
  return { headline: m[1], rest: t.slice(m[0].length).trim() };
}

function formatDate(iso) {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

const path = (page) => {
  const s = String(page || '');
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    return new URL(s).pathname || '/';
  } catch {
    return s;
  }
};
const children = (t) => [...(t.items || []), ...(t.follow_ups || [])];
const where = (t) => (t.group ? `${t.items?.length || 0} pages` : path(t.page));
const fmt = (n) => (Number.isFinite(n) ? n.toLocaleString('en-US') : '–');
const pct = (part, whole) => Math.round((part / Math.max(1, whole)) * 100);

export function seoReportFilename(result, { kind = 'client' } = {}) {
  const what = kind === 'full' ? 'SEO Action Plan' : 'SEO Audit';
  const name = `${result?.domain || 'site'} ${what} - ${result?.audit_date || new Date().toISOString().slice(0, 10)}.html`;
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function kpisHtml(r) {
  const cards = kpiCards(r);
  return `<div class="kpis k${cards.length}">${cards.map((c) => `<div class="card"><p class="kl">${esc(c.label)}</p><p class="kv">${esc(c.value)}${c.unit ? `<small>${esc(c.unit)}</small>` : ''}</p>${c.sub ? `<p class="kd ${c.tone}">${esc(c.sub)}</p>` : ''}</div>`).join('')}</div>`;
}

function opportunitiesHtml(search) {
  const rows = search?.opportunities || [];
  if (!rows.length) return '';
  const max = Math.max(1, ...rows.map((x) => x.impressions || 0));
  return `<div class="card"><div class="ch"><p class="ct">Biggest opportunities: searches you almost win</p><span class="cs">Positions 4–20, Search Console</span></div>
<table class="opp"><thead><tr><th>Search</th><th class="r">Impressions</th><th></th><th class="r">Clicks</th><th class="r">Position</th></tr></thead><tbody>
${rows.map((x) => `<tr><td class="q">${esc(x.query)}</td><td class="r">${fmt(x.impressions)}</td><td class="bw"><div class="bar"><i style="width:${pct(x.impressions || 0, max)}%"></i></div></td><td class="r">${fmt(x.clicks)}</td><td class="r"><span class="pos">${esc(x.position)}</span></td></tr>`).join('')}
</tbody></table></div>`;
}

function scoresHtml(scores, headline, rest, { reasons }) {
  const shown = SCORE_LABELS.filter(([k]) => Number.isFinite(scores?.[k]?.score));
  const why = reasons ? shown.filter(([k]) => scores[k].reason) : [];
  return `<div class="card"><div class="ch"><p class="ct">Scores</p><span class="cs">out of 10</span></div>
${shown.map(([k, label, abbr]) => `<div class="score"><b title="${esc(label)}">${abbr}</b><div class="bar" role="img" aria-label="${esc(label)}: ${esc(scores[k].score)} out of 10"><i style="width:${Math.max(0, Math.min(10, scores[k].score)) * 10}%"></i></div><span>${esc(scores[k].score)}</span></div>`).join('')}
${headline ? `<p class="lead">${esc(headline)}</p>` : ''}${rest ? `<p class="rest">${esc(rest)}</p>` : ''}
${why.length ? `<ul class="why">${why.map(([k, , abbr]) => `<li><b>${abbr}:</b> ${esc(scores[k].reason)}</li>`).join('')}</ul>` : ''}</div>`;
}

function movesHtml(moves, clean) {
  if (!moves?.length) return '';
  return `<div class="grid3">${moves.map((m, i) => `<div class="card move"><span class="mn">${i + 1}</span><div><p class="mt">${esc(clean(m.headline))}</p>${m.task ? `<p class="mp">${esc(where(m.task))}</p>` : ''}</div></div>`).join('')}</div>`;
}

function breakdownHtml(plan) {
  const { areas, matrix, total } = planStats(plan);
  if (!total) return '';
  return `<div class="grid"><div class="card"><div class="ch"><p class="ct">Action plan by area</p><span class="cs">${total} tasks</span></div>
${areas.map((a) => `<div class="hb"><span>${esc(a.label)}</span><div class="bar"><i style="width:${pct(a.count, total)}%"></i></div><span class="r">${a.count}</span></div>`).join('')}</div>
<div class="card"><div class="ch"><p class="ct">Impact vs effort</p></div><div class="matrix">
<div class="mq hot"><b>${matrix.quick}</b><span>Quick wins: high impact, low effort</span></div>
<div class="mq"><b>${matrix.big}</b><span>Big bets: high impact, more work</span></div>
<div class="mq"><b>${matrix.fill}</b><span>Fill-ins: easy, smaller impact</span></div>
<div class="mq"><b>${matrix.later}</b><span>Later: more work, smaller impact</span></div></div></div></div>`;
}

// Reputation section: mirrors the in-app Reputation tab (Reputation.jsx).
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function repStats(loc) {
  const st = loc.stats || {};
  const parts = [];
  if (typeof st.rating === 'number') parts.push(`${st.rating.toFixed(1)} ★`);
  if (typeof st.count === 'number') parts.push(plural(st.count, 'review'));
  if (loc.coverage === 'sample') {
    parts.push('(5 sample reviews)');
  } else {
    if (typeof st.per_month === 'number') parts.push(`≈${Math.round(st.per_month)}/month`);
    if (typeof st.reply_rate === 'number') parts.push(`replies ${Math.round(st.reply_rate * 100)}%`);
    if (typeof st.days_since_newest === 'number') {
      const d = st.days_since_newest;
      parts.push(d === 0 ? 'newest today' : d === 1 ? 'newest 1 day ago' : `newest ${d} days ago`);
    }
  }
  return parts;
}

function repThemes(title, mark, items, showLocation) {
  if (!items.length) return '';
  return `<p class="lbl">${title}</p><ul class="rl">${items.map((t) => `<li><b>${mark} ${esc(t.theme)} (${esc(t.count)})</b>${showLocation && t.location ? ` <span class="mutd">· ${esc(t.location)}</span>` : ''}${t.quotes?.[0] ? `<p class="rq">“${esc(t.quotes[0])}”</p>` : ''}</li>`).join('')}</ul>`;
}

function reputationHtml(rep) {
  if (!rep) return '';
  const { locations = [], themes = [], search, attribution } = rep;
  const multi = locations.length > 1;
  const locs = locations.map((loc) => `<li class="rloc"><div><p class="pt">${esc(loc.name)}${loc.city ? ` <span class="mutd">· ${esc(loc.city)}</span>` : ''}</p><p class="pp">${esc(repStats(loc).join(' · '))}</p></div><span class="chip">${loc.coverage === 'sample' ? 'Public data' : 'Managed'}</span></li>`).join('');
  const says = themes.length
    ? `<p class="ct rsub">What customers say</p>${repThemes('Praise', '+', themes.filter((t) => t.kind === 'praise'), multi)}${repThemes('Complaints', '−', themes.filter((t) => t.kind === 'complaint'), multi)}`
    : '';
  const web = search
    ? `<p class="ct rsub">What a web search finds</p><p class="cs">A web search run during this audit, not Google rankings.</p>${search.total > 0 ? `<p class="pt">You appear in ${esc(search.appear_count)} of ${esc(search.total)} searches</p>` : ''}${search.summary ? `<p class="body">${esc(search.summary)}</p>` : ''}<ul class="rl">${(search.queries || []).map((q) => (q.error
      ? `<li class="rsq"><span></span><span class="rqy">${esc(q.query)}</span><span class="mutd">couldn't check</span></li>`
      : `<li class="rsq"><span class="${q.you_appear ? 'up' : 'muted'}" role="img" aria-label="${q.you_appear ? 'appears' : 'does not appear'}">${q.you_appear ? '✓' : '✗'}</span><span class="rqy">${esc(q.query)}</span>${!q.you_appear && q.others?.length ? `<span class="mutd">${esc(q.others.join(', '))}</span>` : ''}</li>`)).join('')}</ul>`
    : '';
  return `<h2>Reputation</h2><div class="card"><ul class="rl rtop">${locs}</ul>${says}${web}${attribution ? `<p class="note">${esc(attribution)}</p>` : ''}</div>`;
}

const impactBars = (n) => `<span class="imp" role="img" aria-label="Impact ${n} of 5">${[1, 2, 3, 4, 5].map((i) => `<i${i <= n ? ' class="on"' : ''}></i>`).join('')}</span>`;

function clientTasks(plan) {
  const top = plan.slice(0, CLIENT_TOP);
  if (!top.length) return '';
  const rest = plan.length - top.length;
  return `<h2>What we'll work on first</h2>
<div class="card tight"><table class="plan"><thead><tr><th>#</th><th>Task</th><th>Area</th><th>Impact</th><th>Effort</th></tr></thead><tbody>
${top.map((t, i) => `<tr><td class="rk">${i + 1}</td><td><p class="pt">${esc(stripConfirm(t.title))}${isQuickWin(t) ? '<span class="qw">Quick win</span>' : ''}</p><p class="pp">${esc(where(t))}</p>${t.why ? `<p class="pw">${esc(stripConfirm(t.why))}</p>` : ''}</td><td class="nw">${esc(AREA_LABELS[t.category] || t.category)}</td><td>${impactBars(t.impact)}</td><td class="nw mutd">${esc(effortLabel(t.effort))}</td></tr>`).join('')}
</tbody></table></div>
${rest > 0 ? `<p class="note">Plus ${rest} more improvement${rest === 1 ? '' : 's'} in the full action plan.</p>` : ''}`;
}

function taskCard(t, { nested = false } = {}) {
  const meta = nested ? '' : `<p class="meta"><span class="chip">${esc(AREA_LABELS[t.category] || t.category)}</span><span class="chip">Impact ${esc(t.impact)}/5</span><span class="chip">${esc(effortLabel(t.effort))}</span><span class="chip">${esc(t.confidence)} confidence</span></p>`;
  const kids = children(t);
  const kidsLabel = t.group ? `Each page (${kids.length})` : 'Do together with this task';
  return `<article class="${nested ? 'task sub' : 'card task'}">
<div class="th"><p class="tt"><span class="id">${esc(t.id)}</span> ${esc(t.title)}</p><p class="pg">${esc(where(t))}</p></div>
${meta}
${t.group ? '' : `<p class="lbl">Exact change</p><pre class="chg">${esc(t.change)}</pre>`}
${t.why ? `<p class="lbl">Why it matters</p><p class="body">${esc(t.why)}</p>` : ''}
${!t.group && t.evidence?.length ? `<p class="lbl">Evidence</p><ul class="ev">${t.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${kids.length ? `<p class="lbl">${esc(kidsLabel)}</p>${kids.map((c) => taskCard(c, { nested: true })).join('')}` : ''}
</article>`;
}

const DARK = '--bg:#0c0618;--bg2:radial-gradient(ellipse at 20% 0%,#2a1055 0%,#140a2b 40%,#0c0618 100%);--panel:rgba(255,255,255,.035);--panel2:rgba(255,255,255,.06);--line:rgba(255,255,255,.08);--ink:#f4f2fa;--ink2:#d6d1e3;--muted:#9a94ad;--dim:#6b6580;--acc:#a78bfa;--accInk:#c4b5fd;--accSoft:rgba(124,58,237,.25);--track:rgba(255,255,255,.07);--up:#34d399;--upSoft:rgba(52,211,153,.1);--down:#fb7185;--amber:#fbbf24;--warnbg:rgba(251,191,36,.08)';
const LIGHT = '--bg:#ffffff;--bg2:#ffffff;--panel:#ffffff;--panel2:#f4f4f5;--line:#e4e4e7;--ink:#09090b;--ink2:#3f3f46;--muted:#71717a;--dim:#a1a1aa;--acc:#7c3aed;--accInk:#6d28d9;--accSoft:rgba(124,58,237,.1);--track:#f1f1f4;--up:#16a34a;--upSoft:rgba(22,163,74,.08);--down:#dc2626;--amber:#b45309;--warnbg:#fffbeb';

export function generateSeoReportHtml(result, { kind = 'client' } = {}) {
  const r = result || {};
  const full = kind === 'full';
  const plan = r.action_plan || [];
  const domain = r.domain || '';
  const title = `${domain}: ${full ? 'SEO Action Plan' : 'SEO Audit'}`;
  const pages = r.data_sources?.crawl?.pages;
  const meta = [
    formatDate(r.audit_date),
    pages ? `${pages} pages reviewed` : null,
    r.search?.range ? `Search Console ${r.search.range.startDate} to ${r.search.range.endDate}` : null,
  ].filter(Boolean).join(' · ');
  const clean = full ? (s) => String(s ?? '') : stripConfirm;
  const { headline, rest } = splitSummary(clean(r.client_summary));
  const opp = opportunitiesHtml(r.search);
  const scoresCard = scoresHtml(r.scores, headline, rest, { reasons: full });

  const body = full
    ? `${r.data_gaps?.length ? `<div class="gaps"><p><b>Data gaps</b></p><ul>${r.data_gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
<h2>Action plan · ${plan.length} task${plan.length === 1 ? '' : 's'}, highest value first</h2>
${plan.map((t) => taskCard(t)).join('')}`
    : clientTasks(plan);

  const sources = ['a crawl of the site'];
  if (r.data_sources?.search_console?.status === 'ok') sources.push('Google Search Console');
  if (r.data_sources?.ga4?.status === 'ok') sources.push('Google Analytics');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="dark light">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<style>
:root{${DARK};box-sizing:border-box}
:root[data-theme="light"]{${LIGHT}}
*,*::before,*::after{box-sizing:inherit}
html{background:var(--bg);-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg2);color:var(--ink);font-family:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;font-feature-settings:"tnum" 1}
main{max-width:1440px;margin:0 auto;padding:32px 28px 48px}
.top{margin-bottom:20px}
.crumb{font-size:12.5px;color:var(--dim);margin:0 0 6px}
h1{font-size:28px;font-weight:650;letter-spacing:-.02em;line-height:1.15;margin:0;display:flex;align-items:center;gap:12px;flex-wrap:wrap;overflow-wrap:anywhere}
.pill{font-size:12px;font-weight:500;letter-spacing:0;color:var(--accInk);background:var(--accSoft);border-radius:99px;padding:3px 10px}
.metaLine{color:var(--muted);font-size:13.5px;margin:6px 0 0}
h2{font-size:16px;font-weight:600;margin:26px 0 12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;min-width:0;break-inside:avoid}
.card.tight{padding:6px 10px}
.kpis{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}
.kpis.k5{grid-template-columns:repeat(5,minmax(0,1fr))}.kpis.k4{grid-template-columns:repeat(4,minmax(0,1fr))}.kpis.k3{grid-template-columns:repeat(3,minmax(0,1fr))}.kpis.k2{grid-template-columns:repeat(2,minmax(0,1fr))}.kpis.k1{grid-template-columns:minmax(0,1fr)}
.kl{font-size:12.5px;color:var(--muted);margin:0}
.kv{font-size:28px;font-weight:650;letter-spacing:-.03em;line-height:1.15;margin:8px 0 4px}
.kv small{font-size:16px;font-weight:500;color:var(--dim);letter-spacing:0}
.kd{font-size:12.5px;font-weight:500;margin:0}
.up{color:var(--up)}.down{color:var(--down)}.muted{color:var(--dim)}
.grid{display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr);gap:12px;margin-top:12px}
.grid.one{grid-template-columns:minmax(0,1fr)}
.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin-top:12px}
.ch{display:flex;justify-content:space-between;align-items:baseline;gap:10px;margin-bottom:14px}
.ct{font-size:14.5px;font-weight:600;margin:0}.cs{font-size:12.5px;color:var(--dim)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-weight:500;color:var(--dim);font-size:12px;padding:0 8px 8px;border-bottom:1px solid var(--line)}
td{padding:10px 8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:last-child td{border-bottom:0}
.r{text-align:right}.q{font-weight:500}.bw{width:28%;vertical-align:middle}.nw{white-space:nowrap}.mutd{color:var(--muted)}
.pos{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px;color:var(--amber)}
.bar{height:6px;border-radius:99px;background:var(--track);overflow:hidden;min-width:50px}
.bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#7c3aed,#a78bfa);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.score{display:grid;grid-template-columns:42px minmax(0,1fr) 28px;align-items:center;gap:10px;margin:11px 0}
.score b{font-size:12.5px;color:var(--muted);font-weight:600}.score span{font-weight:650;text-align:right}
.lead{font-size:14px;line-height:1.55;color:var(--ink2);margin:16px 0 0;padding-top:14px;border-top:1px solid var(--line)}
.rest{font-size:13.5px;line-height:1.6;color:var(--muted);margin:8px 0 0}
ul.why{list-style:none;margin:12px 0 0;padding:10px 0 0;border-top:1px solid var(--line);display:grid;gap:6px;font-size:13px;color:var(--muted)}
ul.why b{color:var(--ink2)}
.move{display:flex;gap:12px}
.mn{flex:0 0 28px;height:28px;border-radius:8px;background:var(--accSoft);color:var(--accInk);font-weight:650;font-size:13px;display:flex;align-items:center;justify-content:center}
.mt{font-size:14px;line-height:1.5;margin:0;font-weight:500}.mp{font-size:12px;color:var(--dim);margin:8px 0 0;overflow-wrap:anywhere}
.hb{display:grid;grid-template-columns:96px minmax(0,1fr) 32px;gap:10px;align-items:center;font-size:13px;margin:9px 0}.hb .bar{height:8px}
.matrix{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.mq{border-radius:10px;padding:12px;background:var(--panel2);border:1px solid var(--line)}
.mq b{font-size:22px;font-weight:650;display:block}.mq span{font-size:12px;color:var(--muted)}
.mq.hot{background:var(--upSoft);border-color:var(--up)}.mq.hot b{color:var(--up)}
.rk{color:var(--dim);font-weight:600;font-size:12.5px;width:32px}
.pt{font-weight:600;font-size:14px;line-height:1.45;margin:0}
.pp{font-size:12px;color:var(--dim);margin:2px 0 0;overflow-wrap:anywhere}
.pw{font-size:13px;color:var(--muted);margin:6px 0 0;max-width:80ch}
.qw{font-size:11px;font-weight:600;color:var(--accInk);background:var(--accSoft);padding:1px 6px;border-radius:5px;margin-left:8px;white-space:nowrap}
.imp{display:inline-flex;gap:2px;padding-top:4px}.imp i{width:5px;height:12px;border-radius:1px;background:var(--track)}.imp i.on{background:var(--acc);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.note{color:var(--muted);font-size:13.5px;margin-top:14px}
.task{margin-top:12px}
.task.sub{background:var(--panel2);border:1px solid var(--line);border-radius:10px;margin-top:8px;padding:12px 14px}
.th{display:flex;justify-content:space-between;gap:4px 14px;flex-wrap:wrap;align-items:baseline}
.tt{font-weight:600;font-size:14.5px;margin:0;min-width:0;overflow-wrap:anywhere}
.pg{color:var(--dim);font-size:12.5px;margin:0;overflow-wrap:anywhere}
.id{color:var(--accInk);margin-right:4px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.chip{font-size:12px;font-weight:500;color:var(--ink2);background:var(--panel2);border:1px solid var(--line);border-radius:6px;padding:1px 8px;text-transform:capitalize}
.lbl{font-size:12.5px;font-weight:600;color:var(--muted);margin:14px 0 4px}
.body{margin:0;color:var(--ink2);font-size:13.5px}
pre.chg{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13.5px;margin:0;color:var(--ink);background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
ul.ev{margin:0;padding-left:1.2em;color:var(--muted);font-size:13px}
.gaps{margin-top:16px;padding:12px 16px;border-radius:12px;background:var(--warnbg);color:var(--amber);font-size:13.5px;border:1px solid var(--line)}
.gaps p{margin:0}.gaps ul{margin:6px 0 0;padding-left:1.2em}
.rl{list-style:none;margin:0;padding:0}.rtop{border-top:1px solid var(--line)}
.rloc{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--line)}
.rsub{margin:20px 0 6px}.rl li{margin:0 0 8px}.rq{font-size:13px;font-style:italic;color:var(--muted);margin:2px 0 0}
.rsq{display:flex;gap:10px;padding:6px 0;border-bottom:1px solid var(--line);font-size:13px;margin:0!important}.rsq>span:first-child{font-weight:700;width:14px}.rqy{flex:0 1 45%}
footer{color:var(--dim);font-size:12.5px;margin-top:28px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:1100px){.kpis,.kpis.k5,.kpis.k4{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:860px){.grid,.grid3{grid-template-columns:1fr}}
@media (max-width:560px){main{padding:22px 14px 36px}.kpis,.kpis.k5,.kpis.k4,.kpis.k3{grid-template-columns:repeat(2,minmax(0,1fr))}.kv{font-size:23px}h1{font-size:23px}.bw{display:none}table.plan th:nth-child(3),table.plan td:nth-child(3),table.plan th:nth-child(5),table.plan td:nth-child(5){display:none}}
@media print{:root{${LIGHT}}html,body{background:#fff}main{padding:0;max-width:none}}
</style></head><body><main>
<div class="top"><p class="crumb">SEO audit</p><h1>${esc(domain)} <span class="pill">${r.audit_type === 'quick' ? 'Quick audit' : 'Full audit'}</span></h1><p class="metaLine">${esc(meta)}</p></div>
${kpisHtml(r)}
<div class="${opp ? 'grid' : 'grid one'}">${opp}${scoresCard}</div>
${movesHtml(r.top_moves, clean)}
${breakdownHtml(plan)}
${reputationHtml(r.reputation)}
${body}
<footer>Based on ${esc(sources.join(', '))}${r.audit_date ? `, ${esc(formatDate(r.audit_date))}` : ''}.</footer>
</main></body></html>`;
}

export function downloadSeoReport(result, { kind = 'client' } = {}) {
  const html = generateSeoReportHtml(result, { kind });
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = seoReportFilename(result, { kind });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
