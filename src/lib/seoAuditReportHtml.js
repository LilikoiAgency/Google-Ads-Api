// Standalone HTML downloads of a v2 SEO audit, to email. Same look as the
// in-app report: a pine cover with the main finding, then a white sheet.
//  - client: summary, scores, top 3 moves and the top 10 tasks in plain terms.
//    No evidence, exact text or "[confirm: …]" notes.
//  - full: the whole action plan for whoever does the work: every task with its
//    exact change, evidence and per-page items, plus the data gaps.
// Pure string building (safe in client components); only downloadSeoReport
// touches document/Blob, and only when called. No scripts in the file.

export const REPORT_KINDS = [
  { key: 'client', label: 'Client report', hint: 'Summary, scores, top 3 moves and the top 10 tasks in plain terms. No technical evidence.' },
  { key: 'full', label: 'Full action plan', hint: 'Every task with the exact change, evidence and each page, for whoever does the work.' },
];

export const CLIENT_TOP = 10;
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&family=Public+Sans:wght@400;600;700&display=swap';

const SCORE_LABELS = [
  ['seo', 'Search visibility', 'SEO'],
  ['geo', 'AI search readiness', 'GEO'],
  ['aeo', 'Answer readiness', 'AEO'],
];

const CATEGORY = { technical: 'Technical', content: 'Content', local: 'Local', aeo: 'Answers', conversion: 'Conversion' };
const EFFORT = (n) => (n <= 2 ? 'Quick' : n === 3 ? 'Moderate' : 'Major');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Client copy never shows the analyst's "[confirm: …]" notes.
export function stripConfirm(s) {
  return String(s ?? '').replace(/\s*\[confirm:[^\]]*\]/gi, '').replace(/\s{2,}/g, ' ').trim();
}

// The first sentence leads as the headline; the rest follows (same rule as the app).
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

export function seoReportFilename(result, { kind = 'client' } = {}) {
  const what = kind === 'full' ? 'SEO Action Plan' : 'SEO Audit';
  const name = `${result?.domain || 'site'} ${what} - ${result?.audit_date || new Date().toISOString().slice(0, 10)}.html`;
  return name.replace(/[\\/:*?"<>|]/g, '').replace(/\s{2,}/g, ' ').trim();
}

function scoresHtml(scores) {
  const cells = SCORE_LABELS.filter(([k]) => Number.isFinite(scores?.[k]?.score)).map(([k, label, abbr]) => {
    const { score, reason } = scores[k];
    const bars = Array.from({ length: 10 }, (_, i) => `<i${i < score ? ' class="on"' : ''}></i>`).join('');
    return `<div class="score"><p class="sn"><b>${esc(score)}</b> out of 10</p><p class="sl">${esc(label)} <abbr>(${abbr})</abbr></p><div class="scale" role="img" aria-label="${esc(label)}: ${esc(score)} out of 10">${bars}</div>${reason ? `<p class="sw">${esc(reason)}</p>` : ''}</div>`;
  });
  return cells.length ? `<div class="scores">${cells.join('')}</div>` : '';
}

function movesHtml(moves, clean) {
  if (!moves?.length) return '';
  return `<h2>The moves that matter most</h2><ol class="moves">${moves.map((m, i) => `<li><span class="mn" aria-hidden="true">${i + 1}</span><p class="mt">${esc(clean(m.headline))}</p>${m.task ? `<p class="mp">${esc(where(m.task))}</p>` : ''}</li>`).join('')}</ol>`;
}

function clientTasks(plan) {
  const top = plan.slice(0, CLIENT_TOP);
  if (!top.length) return '';
  const rest = plan.length - top.length;
  return `<h2>What we'll work on first</h2>
<ol class="plan">${top.map((t, i) => `<li><span class="rk">${i + 1}</span><div><p class="pt">${esc(stripConfirm(t.title))}</p><p class="pp">${esc(where(t))}</p>${t.why ? `<p class="pw">${esc(stripConfirm(t.why))}</p>` : ''}</div></li>`).join('')}</ol>
${rest > 0 ? `<p class="note">Plus ${rest} more improvement${rest === 1 ? '' : 's'} in the full action plan.</p>` : ''}`;
}

function taskCard(t, { nested = false } = {}) {
  const meta = nested ? '' : `<p class="meta">${esc(CATEGORY[t.category] || t.category)}, impact ${esc(t.impact)} of 5, ${esc(EFFORT(t.effort).toLowerCase())} effort, ${esc(t.confidence)} confidence</p>`;
  const kids = children(t);
  const kidsLabel = t.group ? `Each page (${kids.length})` : 'Do together with this task';
  return `<article class="${nested ? 'task sub' : 'task'}">
<div class="th"><p class="tt"><span class="id">${esc(t.id)}</span> ${esc(t.title)}</p><p class="pg">${esc(where(t))}</p></div>
${meta}
${t.group ? '' : `<p class="lbl">Exact change</p><pre class="chg">${esc(t.change)}</pre>`}
${t.why ? `<p class="lbl">Why it matters</p><p>${esc(t.why)}</p>` : ''}
${!t.group && t.evidence?.length ? `<p class="lbl">Evidence</p><ul class="ev">${t.evidence.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>` : ''}
${kids.length ? `<p class="lbl">${esc(kidsLabel)}</p>${kids.map((c) => taskCard(c, { nested: true })).join('')}` : ''}
</article>`;
}

export function generateSeoReportHtml(result, { kind = 'client' } = {}) {
  const r = result || {};
  const full = kind === 'full';
  const plan = r.action_plan || [];
  const domain = r.domain || '';
  const title = `${domain}: ${full ? 'SEO Action Plan' : 'SEO Audit'}`;
  const pages = r.data_sources?.crawl?.pages;
  const meta = [
    `${r.audit_type === 'quick' ? 'Quick' : 'Full'} SEO ${full ? 'action plan' : 'audit'}`,
    formatDate(r.audit_date),
    pages ? `${pages} pages reviewed` : null,
  ].filter(Boolean).join(', ');
  const clean = full ? (s) => String(s ?? '') : stripConfirm;
  const { headline, rest } = splitSummary(clean(r.client_summary));

  const body = full
    ? `${r.data_gaps?.length ? `<div class="gaps"><p><b>Data gaps</b></p><ul>${r.data_gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
<h2>Action plan, ${plan.length} task${plan.length === 1 ? '' : 's'}, highest value first</h2>
${plan.map((t) => taskCard(t)).join('')}`
    : clientTasks(plan);

  const sources = ['a crawl of the site'];
  if (r.data_sources?.search_console?.status === 'ok') sources.push('Google Search Console');
  if (r.data_sources?.ga4?.status === 'ok') sources.push('Google Analytics');

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<style>
:root{--pine:#1f4a46;--pine2:#285a56;--cream:#fbf7ec;--creamm:rgba(251,247,236,.74);--lilac:#bab0d3;--lilacInk:#5f4f95;
--bg:#ffffff;--ink:#16211f;--muted:#5c6b68;--line:#e3e8e6;--soft:#f4f7f6;--warn:#7a5200;--warnbg:#fdf4e1;
box-sizing:border-box}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#131a19;--ink:#e6ecea;--muted:#9eaba8;--line:#2a3533;--soft:#1a2321;--pine2:#6fb3a9;--lilacInk:#c3b8e6;--warn:#e7c46a;--warnbg:#2a2516}}
:root[data-theme="dark"]{--bg:#131a19;--ink:#e6ecea;--muted:#9eaba8;--line:#2a3533;--soft:#1a2321;--pine2:#6fb3a9;--lilacInk:#c3b8e6;--warn:#e7c46a;--warnbg:#2a2516}
*,*::before,*::after{box-sizing:inherit}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Public Sans",system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55}
.serif,h2,.headline,.sn b,.mn,.mt{font-family:Newsreader,Georgia,serif}
.cover{background:var(--pine);color:var(--cream);padding:44px 20px 48px}
.wrap{max-width:880px;margin:0 auto}
.domain{font-weight:700;font-size:15px;margin:0;overflow-wrap:anywhere}
.metaLine{color:var(--creamm);font-size:13.5px;margin:4px 0 0}
.headline{font-weight:500;font-size:clamp(26px,4.2vw,38px);line-height:1.18;letter-spacing:-.01em;max-width:30ch;margin:36px 0 0;text-wrap:balance}
.rest{color:var(--creamm);font-size:16px;line-height:1.65;max-width:66ch;margin:16px 0 0}
main{padding:8px 20px 56px}
h2{font-weight:500;font-size:24px;line-height:1.2;margin:44px 0 18px}
.scores{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:32px;padding:30px 0 30px;border-bottom:1px solid var(--line)}
.sn{margin:0;color:var(--muted);font-size:14px}
.sn b{font-size:44px;font-weight:500;line-height:1;color:var(--pine2);margin-right:6px}
.sl{font-weight:700;font-size:14px;margin:10px 0 0}
.sl abbr{text-decoration:none;font-weight:400;color:var(--muted)}
.scale{display:grid;grid-template-columns:repeat(10,1fr);gap:3px;margin-top:10px}
.scale i{height:6px;border-radius:2px;background:var(--line)}
.scale i.on{background:var(--pine2)}
.sw{color:var(--muted);font-size:13px;line-height:1.55;margin:12px 0 0}
ol.moves{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:28px}
ol.moves li{border-top:2px solid var(--pine2);padding-top:14px;min-width:0}
.mn{font-size:30px;line-height:1;color:var(--lilacInk)}
.mt{font-size:18.5px;line-height:1.38;margin:10px 0 0}
.mp{color:var(--muted);font-size:12.5px;margin:10px 0 0;overflow-wrap:anywhere}
ol.plan{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
ol.plan li{display:grid;grid-template-columns:36px minmax(0,1fr);gap:8px;padding:16px 0;border-bottom:1px solid var(--line);break-inside:avoid}
.rk{color:var(--lilacInk);font-weight:600;font-size:14px;padding-top:1px}
.pt{font-weight:600;font-size:15px;line-height:1.42;margin:0}
.pp{color:var(--muted);font-size:12.5px;margin:3px 0 0;overflow-wrap:anywhere}
.pw{color:var(--muted);font-size:14px;margin:8px 0 0;max-width:70ch}
.note{color:var(--muted);font-size:14px;margin-top:18px}
.task{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-top:12px;break-inside:avoid-page}
.task.sub{background:var(--soft);border-color:transparent;margin-top:8px;padding:12px 14px}
.th{display:flex;justify-content:space-between;gap:4px 14px;flex-wrap:wrap;align-items:baseline}
.tt{font-weight:600;font-size:15px;margin:0;min-width:0;overflow-wrap:anywhere}
.pg{color:var(--muted);font-size:12.5px;margin:0;overflow-wrap:anywhere}
.id{color:var(--lilacInk)}
.meta{color:var(--muted);font-size:12.5px;margin:6px 0 0}
.lbl{font-size:12.5px;font-weight:700;color:var(--muted);margin:14px 0 4px}
.task p{margin-bottom:0}
pre.chg{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:14px;margin:0;background:var(--soft);border-radius:6px;padding:10px 12px}
.task.sub pre.chg{background:var(--bg)}
ul.ev{margin:0;padding-left:1.2em;color:var(--muted);font-size:13px}
.gaps{margin-top:30px;padding:12px 16px;border-radius:8px;background:var(--warnbg);color:var(--warn);font-size:14px}
.gaps p{margin:0}.gaps ul{margin:6px 0 0;padding-left:1.2em}
footer{color:var(--muted);font-size:12.5px;margin-top:48px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:640px){.cover{padding:30px 16px 34px}main{padding:4px 16px 40px}.scores,ol.moves{grid-template-columns:1fr;gap:22px}}
@media print{.cover{-webkit-print-color-adjust:exact;print-color-adjust:exact}h2{break-after:avoid}}
</style></head><body>
<header class="cover"><div class="wrap">
<p class="domain">${esc(domain)}</p>
<p class="metaLine">${esc(meta)}</p>
${headline ? `<h1 class="headline">${esc(headline)}</h1>` : `<h1 class="headline">${esc(title)}</h1>`}
${rest ? `<p class="rest">${esc(rest)}</p>` : ''}
</div></header>
<main><div class="wrap">
${scoresHtml(r.scores)}
${movesHtml(r.top_moves, clean)}
${body}
<footer>Based on ${esc(sources.join(', '))}${r.audit_date ? `, ${esc(formatDate(r.audit_date))}` : ''}.</footer>
</div></main>
</body></html>`;
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
