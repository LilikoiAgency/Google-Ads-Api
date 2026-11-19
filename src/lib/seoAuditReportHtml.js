// Standalone HTML downloads of a v2 SEO audit, to email. Same clean look as
// the in-app view: header, score strip, summary, top moves, then the tasks.
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
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap';

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

function statsHtml(scores, plan) {
  const cells = SCORE_LABELS.filter(([k]) => Number.isFinite(scores?.[k]?.score)).map(([k, label, abbr]) => {
    const { score } = scores[k];
    const pct = Math.max(0, Math.min(10, score)) * 10;
    return `<div class="stat"><p class="sl"><b>${abbr}</b> ${esc(label)}</p><p class="sv">${esc(score)}<small>/10</small></p><div class="bar" role="img" aria-label="${esc(label)}: ${esc(score)} out of 10"><i style="width:${pct}%"></i></div></div>`;
  });
  if (plan.length) {
    const quick = plan.filter((t) => t.impact >= 4 && t.effort <= 2).length;
    cells.push(`<div class="stat"><p class="sl">Action plan</p><p class="sv">${plan.length}<small> tasks</small></p><p class="sn">${quick ? `${quick} quick win${quick === 1 ? '' : 's'}` : 'Ranked by value'}</p></div>`);
  }
  return cells.length ? `<div class="stats">${cells.join('')}</div>` : '';
}

function summaryHtml(headline, rest, scores, { reasons }) {
  const why = reasons
    ? SCORE_LABELS.filter(([k]) => scores?.[k]?.reason).map(([k, , abbr]) => `<li><b>${abbr}:</b> ${esc(scores[k].reason)}</li>`)
    : [];
  if (!headline && !why.length) return '';
  return `<div class="summary">${headline ? `<p class="lead">${esc(headline)}</p>` : ''}${rest ? `<p class="rest">${esc(rest)}</p>` : ''}${why.length ? `<ul class="why">${why.join('')}</ul>` : ''}</div>`;
}

function movesHtml(moves, clean) {
  if (!moves?.length) return '';
  return `<h2>Top ${moves.length} moves</h2><ol class="moves">${moves.map((m, i) => `<li><span class="mn" aria-hidden="true">${i + 1}</span><p class="mt">${esc(clean(m.headline))}</p>${m.task ? `<p class="mp">${esc(where(m.task))}</p>` : ''}</li>`).join('')}</ol>`;
}

function clientTasks(plan) {
  const top = plan.slice(0, CLIENT_TOP);
  if (!top.length) return '';
  const rest = plan.length - top.length;
  return `<h2>What we'll work on first</h2>
<ol class="plan">${top.map((t, i) => `<li><span class="rk">${i + 1}</span><div><p class="pt">${esc(stripConfirm(t.title))}</p><p class="pp">${esc(where(t))}</p>${t.why ? `<p class="pw">${esc(stripConfirm(t.why))}</p>` : ''}</div><span class="ef">${esc(EFFORT(t.effort))}</span></li>`).join('')}</ol>
${rest > 0 ? `<p class="note">Plus ${rest} more improvement${rest === 1 ? '' : 's'} in the full action plan.</p>` : ''}`;
}

function taskCard(t, { nested = false } = {}) {
  const meta = nested ? '' : `<p class="meta"><span class="chip">${esc(CATEGORY[t.category] || t.category)}</span><span class="chip">Impact ${esc(t.impact)}/5</span><span class="chip">${esc(EFFORT(t.effort))}</span><span class="chip">${esc(t.confidence)} confidence</span></p>`;
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
  ].filter(Boolean).join(' · ');
  const clean = full ? (s) => String(s ?? '') : stripConfirm;
  const { headline, rest } = splitSummary(clean(r.client_summary));

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
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<style>
:root{--bg:#ffffff;--ink:#09090b;--ink2:#27272a;--muted:#71717a;--line:#e4e4e7;--soft:#fafafa;--track:#f4f4f5;--accent:#7c3aed;--accentInk:#6d28d9;--accentSoft:#f5f3ff;--warn:#b45309;--warnbg:#fffbeb;box-sizing:border-box}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#09090b;--ink:#fafafa;--ink2:#e4e4e7;--muted:#a1a1aa;--line:#27272a;--soft:#18181b;--track:#27272a;--accent:#8b5cf6;--accentInk:#c4b5fd;--accentSoft:#2e1065;--warn:#fbbf24;--warnbg:#1c1917}}
:root[data-theme="dark"]{--bg:#09090b;--ink:#fafafa;--ink2:#e4e4e7;--muted:#a1a1aa;--line:#27272a;--soft:#18181b;--track:#27272a;--accent:#8b5cf6;--accentInk:#c4b5fd;--accentSoft:#2e1065;--warn:#fbbf24;--warnbg:#1c1917}
*,*::before,*::after{box-sizing:inherit}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55;font-feature-settings:"tnum" 1}
main{max-width:920px;margin:0 auto;padding:40px 20px 56px}
h1{font-size:28px;font-weight:650;letter-spacing:-.025em;line-height:1.15;margin:0;overflow-wrap:anywhere}
.metaLine{color:var(--muted);font-size:14px;margin:6px 0 0}
h2{font-size:16px;font-weight:600;letter-spacing:-.01em;margin:36px 0 12px}
.stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid var(--line);border-radius:10px;margin-top:24px;overflow:hidden}
.stat{padding:16px 18px 18px;min-width:0}
.stat+.stat{border-left:1px solid var(--line)}
.sl{margin:0;color:var(--muted);font-size:13px}
.sl b{color:var(--ink2);font-weight:600}
.sv{margin:8px 0 0;font-size:30px;font-weight:650;letter-spacing:-.03em;line-height:1.1}
.sv small{font-size:15px;font-weight:500;color:var(--muted);letter-spacing:0;margin-left:2px}
.bar{height:6px;border-radius:99px;background:var(--track);margin-top:12px;overflow:hidden}
.bar i{display:block;height:100%;border-radius:99px;background:var(--accent);-webkit-print-color-adjust:exact;print-color-adjust:exact}
.sn{margin:10px 0 0;color:var(--muted);font-size:12.5px}
.summary{margin-top:16px;padding:18px 20px;border:1px solid var(--line);border-radius:10px;background:var(--soft)}
.lead{margin:0;font-size:16.5px;font-weight:600;line-height:1.5;letter-spacing:-.01em;max-width:80ch}
.rest{margin:8px 0 0;font-size:14.5px;line-height:1.65;color:var(--ink2);max-width:80ch}
ul.why{list-style:none;margin:14px 0 0;padding:12px 0 0;border-top:1px solid var(--line);display:grid;gap:6px;font-size:13px;color:var(--muted)}
ul.why b{color:var(--ink2)}
ol.moves{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
ol.moves li{border:1px solid var(--line);border-radius:10px;padding:16px;min-width:0;break-inside:avoid}
.mn{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:7px;background:var(--accentSoft);color:var(--accentInk);font-size:12.5px;font-weight:650}
.mt{font-size:14.5px;font-weight:550;line-height:1.5;margin:12px 0 0}
.mp{color:var(--muted);font-size:12.5px;margin:12px 0 0;overflow-wrap:anywhere}
ol.plan{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
ol.plan li{display:grid;grid-template-columns:32px minmax(0,1fr) auto;gap:10px;padding:14px 0;border-bottom:1px solid var(--line);break-inside:avoid}
.rk{color:var(--muted);font-weight:600;font-size:13px;padding-top:2px}
.pt{font-weight:600;font-size:14.5px;line-height:1.45;margin:0}
.pp{color:var(--muted);font-size:12.5px;margin:3px 0 0;overflow-wrap:anywhere}
.pw{color:var(--ink2);font-size:13.5px;margin:6px 0 0;max-width:72ch}
.ef{font-size:12px;font-weight:500;color:var(--muted);background:var(--track);border-radius:99px;padding:2px 9px;height:fit-content;white-space:nowrap}
.note{color:var(--muted);font-size:13.5px;margin-top:16px}
.task{border:1px solid var(--line);border-radius:10px;padding:16px 18px;margin-top:12px;break-inside:avoid-page}
.task.sub{background:var(--soft);margin-top:8px;padding:12px 14px}
.th{display:flex;justify-content:space-between;gap:4px 14px;flex-wrap:wrap;align-items:baseline}
.tt{font-weight:600;font-size:14.5px;margin:0;min-width:0;overflow-wrap:anywhere}
.pg{color:var(--muted);font-size:12.5px;margin:0;overflow-wrap:anywhere}
.id{color:var(--accentInk);margin-right:4px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0}
.chip{font-size:12px;font-weight:500;color:var(--ink2);background:var(--track);border-radius:6px;padding:1px 8px;text-transform:capitalize}
.lbl{font-size:12.5px;font-weight:600;color:var(--muted);margin:14px 0 4px}
.task p{margin-bottom:0}
pre.chg{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:13.5px;margin:0;background:var(--soft);border:1px solid var(--line);border-radius:8px;padding:10px 12px}
.task.sub pre.chg{background:var(--bg)}
ul.ev{margin:0;padding-left:1.2em;color:var(--muted);font-size:13px}
.gaps{margin-top:24px;padding:12px 16px;border-radius:10px;background:var(--warnbg);color:var(--warn);font-size:13.5px;border:1px solid var(--line)}
.gaps p{margin:0}.gaps ul{margin:6px 0 0;padding-left:1.2em}
footer{color:var(--muted);font-size:12.5px;margin-top:40px;border-top:1px solid var(--line);padding-top:14px}
@media (max-width:640px){main{padding:28px 16px 40px}.stats{grid-template-columns:repeat(2,minmax(0,1fr))}.stat:nth-child(3){border-left:0}.stat:nth-child(n+3){border-top:1px solid var(--line)}ol.moves{grid-template-columns:1fr}ol.plan li{grid-template-columns:28px minmax(0,1fr)}.ef{grid-column:2;width:fit-content}}
@media print{main{padding:0}h2{break-after:avoid}}
</style></head><body><main>
<h1>${esc(domain)}</h1>
<p class="metaLine">${esc(meta)}</p>
${statsHtml(r.scores, plan)}
${summaryHtml(headline, rest, r.scores, { reasons: full })}
${movesHtml(r.top_moves, clean)}
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
