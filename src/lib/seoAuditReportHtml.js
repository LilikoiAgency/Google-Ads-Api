// Standalone HTML downloads of a v2 SEO audit, to email.
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
const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;800&display=swap';

const SCORE_LABELS = [
  ['seo', 'Search visibility', 'SEO'],
  ['geo', 'AI search readiness', 'GEO'],
  ['aeo', 'Answer readiness', 'AEO'],
];

const CATEGORY = { technical: 'Technical', content: 'Content', local: 'Local', aeo: 'Answers', conversion: 'Conversion' };

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Client copy never shows the analyst's "[confirm: …]" notes.
export function stripConfirm(s) {
  return String(s ?? '').replace(/\s*\[confirm:[^\]]*\]/gi, '').replace(/\s{2,}/g, ' ').trim();
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

function scoresHtml(scores, { reasons }) {
  const cells = SCORE_LABELS.filter(([k]) => Number.isFinite(scores?.[k]?.score)).map(([k, label, abbr]) => `<div class="score">
<b>${esc(scores[k].score)}<small>/10</small></b><span>${esc(label)} <abbr>(${abbr})</abbr></span>${reasons && scores[k].reason ? `<p>${esc(scores[k].reason)}</p>` : ''}</div>`);
  return cells.length ? `<div class="scores">${cells.join('')}</div>` : '';
}

function movesHtml(moves, clean) {
  if (!moves?.length) return '';
  return `<h2>The three moves that matter most</h2><ol class="moves">${moves.map((m) => `<li><b>${esc(clean(m.headline))}</b>${m.task ? `<span>${esc(clean(m.task.title))} · ${esc(where(m.task))}</span>` : ''}</li>`).join('')}</ol>`;
}

function clientTasks(plan) {
  const top = plan.slice(0, CLIENT_TOP);
  if (!top.length) return '';
  const rest = plan.length - top.length;
  return `<h2>What we'll work on first</h2>
<ol class="plan">${top.map((t) => `<li><div class="th"><b>${esc(stripConfirm(t.title))}</b><span class="pg">${esc(where(t))}</span></div>${t.why ? `<p>${esc(stripConfirm(t.why))}</p>` : ''}</li>`).join('')}</ol>
${rest > 0 ? `<p class="note">Plus ${rest} more improvement${rest === 1 ? '' : 's'} in the full action plan.</p>` : ''}`;
}

function chip(label, cls = '') {
  return `<span class="chip ${cls}">${esc(label)}</span>`;
}

function taskCard(t, { nested = false } = {}) {
  const meta = nested ? '' : `<div class="meta">${chip(CATEGORY[t.category] || t.category)}${chip(`Impact ${t.impact}/5`)}${chip(`Effort ${t.effort}/5`)}${chip(`${t.confidence} confidence`)}</div>`;
  const kids = children(t);
  const kidsLabel = t.group ? `Each page (${kids.length})` : 'Do together with this task';
  return `<article class="${nested ? 'task sub' : 'task'}">
<div class="th"><b><span class="id">${esc(t.id)}</span> ${esc(t.title)}</b><span class="pg">${esc(where(t))}</span></div>
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
  const sub = [
    `${r.audit_type === 'quick' ? 'Quick' : 'Full'} audit`,
    pages ? `${pages} pages reviewed` : null,
    r.audit_date || null,
  ].filter(Boolean).join(' · ');
  const clean = full ? (s) => String(s ?? '') : stripConfirm;

  const body = full
    ? `${r.data_gaps?.length ? `<div class="gaps"><b>Data gaps</b><ul>${r.data_gaps.map((g) => `<li>${esc(g)}</li>`).join('')}</ul></div>` : ''}
<h2>Action plan · ${plan.length} task${plan.length === 1 ? '' : 's'}, highest value first</h2>
${plan.map((t) => taskCard(t)).join('')}`
    : clientTasks(plan);

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="color-scheme" content="light dark">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="${FONT_CSS}" rel="stylesheet">
<style>
:root{--bg:#ffffff;--ink:#17231a;--muted:#5d6b60;--line:#dfe6e0;--soft:#f3f6f3;--c1:#2f7d32;--warn:#8a6500;--warnbg:#fff7e0;
box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#141a15;--ink:#e8eee9;--muted:#9aa89d;--line:#2b352d;--soft:#1b231c;--c1:#6cc46f;--warn:#e0bb45;--warnbg:#2a2614}}
:root[data-theme="dark"]{--bg:#141a15;--ink:#e8eee9;--muted:#9aa89d;--line:#2b352d;--soft:#1b231c;--c1:#6cc46f;--warn:#e0bb45;--warnbg:#2a2614}
*,*::before,*::after{box-sizing:inherit}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:Archivo,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.55}
main{max-width:900px;margin:0 auto;padding:40px 20px 56px}
h1{font-size:clamp(1.6rem,3.5vw,2.3rem);font-weight:800;line-height:1.15;margin:0 0 6px;letter-spacing:-.01em;overflow-wrap:anywhere}
h2{font-size:1.15rem;font-weight:800;margin:44px 0 14px}
.sub{color:var(--muted);margin:0 0 24px}
.summary{font-size:1.05rem;max-width:70ch;margin:0}
.scores{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-top:28px}
.score{border:1px solid var(--line);border-radius:8px;padding:14px 16px;min-width:0}
.score b{display:block;font-size:1.9rem;font-weight:800;line-height:1.1;color:var(--c1)}
.score b small{font-size:.9rem;color:var(--muted);font-weight:600}
.score span{display:block;font-weight:600}
.score abbr{text-decoration:none;color:var(--muted);font-weight:400}
.score p{margin:6px 0 0;color:var(--muted);font-size:.85rem}
ol.moves,ol.plan{margin:0;padding-left:1.4em;display:grid;gap:12px}
ol.moves li b,ol.plan li b{display:block}
ol.moves li span{display:block;color:var(--muted);font-size:.85rem;margin-top:2px}
ol.plan li p{margin:4px 0 0;color:var(--muted);font-size:.92rem}
.th{display:flex;justify-content:space-between;gap:6px 14px;flex-wrap:wrap;align-items:baseline}
.th b{min-width:0;overflow-wrap:anywhere}
.pg{color:var(--muted);font-size:.85rem;overflow-wrap:anywhere}
.id{color:var(--c1)}
.task{border:1px solid var(--line);border-radius:8px;padding:14px 16px;margin-top:12px;break-inside:avoid-page}
.task.sub{background:var(--soft);border-color:transparent;margin-top:8px;padding:10px 12px}
.meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{font-size:.75rem;font-weight:600;border:1px solid var(--line);border-radius:999px;padding:1px 8px;text-transform:capitalize}
.lbl{font-size:.72rem;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:12px 0 4px}
.task p{margin:0}
pre.chg{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;font-size:.92rem;margin:0;background:var(--soft);border-radius:6px;padding:8px 10px}
.task.sub pre.chg{background:var(--bg)}
ul.ev{margin:0;padding-left:1.2em;color:var(--muted);font-size:.88rem}
.gaps{margin-top:28px;padding:12px 16px;border-radius:8px;background:var(--warnbg);color:var(--warn);font-size:.9rem}
.gaps ul{margin:6px 0 0;padding-left:1.2em}
.note{color:var(--muted);font-size:.88rem;margin-top:18px}
footer{color:var(--muted);font-size:.8rem;margin-top:48px;border-top:1px solid var(--line);padding-top:12px}
@media (max-width:520px){main{padding:28px 16px 44px}}
@media print{main{padding:0}h2{break-after:avoid}}
</style></head><body><main>
<h1>${esc(title)}</h1>
<p class="sub">${esc(sub)}</p>
${r.client_summary ? `<p class="summary">${esc(clean(r.client_summary))}</p>` : ''}
${scoresHtml(r.scores, { reasons: true })}
${movesHtml(r.top_moves, clean)}
${body}
<footer>Based on a crawl of ${esc(domain)}${r.data_sources?.search_console?.status === 'ok' ? ', Google Search Console' : ''}${r.data_sources?.ga4?.status === 'ok' ? ', Google Analytics' : ''}${r.audit_date ? ` · ${esc(r.audit_date)}` : ''}.</footer>
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
