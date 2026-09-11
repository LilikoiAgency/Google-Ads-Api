// src/lib/streamingPacingReportBuilder.js
// Pure functions: parsed Targeted Streaming sheet data → email HTML + structured summary.
// Styling is 100% inline per Gmail constraints.

import {
  PALETTE, fmtCurrency, fmtCurrencyNoDec, fmtPct, fmtDateLong, escapeHtml, statusFromPct,
} from './pacingShared.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MAX_GEOS = 6;

// ── Classification ────────────────────────────────────────────────────────────

export function classifyTotals({ budget, eomPacing }) {
  if (!budget || budget <= 0) return { status: 'NO_BUDGET', pacingPct: null };
  const pct = ((eomPacing || 0) / budget) * 100;
  return { status: statusFromPct(pct), pacingPct: pct };
}

export function groupByVertical(lines) {
  const order = [];
  const map = new Map();
  for (const l of lines) {
    const v = l.vertical || 'GENERAL';
    if (!map.has(v)) { map.set(v, { vertical: v, lines: [], spendMtd: 0, eomPacing: 0 }); order.push(v); }
    const g = map.get(v);
    g.lines.push(l);
    g.spendMtd += l.spendMtd || 0;
    g.eomPacing += l.eomPacing || 0;
  }
  return order.map((v) => map.get(v));
}

export function isSheetStale(info, reportDate) {
  if (!info?.currentMonth) return false;
  const reportMonth = MONTHS[new Date(reportDate + 'T00:00:00').getMonth()];
  return info.currentMonth.trim().toLowerCase() !== reportMonth.toLowerCase();
}

function computeClientTotals(client) {
  const spendMtd = client.lines.reduce((s, l) => s + (l.spendMtd || 0), 0);
  const eomPacing = client.lines.reduce((s, l) => s + (l.eomPacing || 0), 0);
  return { budget: client.budget, spendMtd, eomPacing };
}

// ── Cell / row helpers ────────────────────────────────────────────────────────

const td = (extra = '') => `padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};${extra}`;
const th = (align) => `text-align:${align};padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;`;

function statusColor(status) {
  return status === 'OVER' ? PALETTE.overText
    : status === 'UNDER' ? PALETTE.underText
    : status === 'NO_BUDGET' ? PALETTE.criticalText
    : PALETTE.onTrackText;
}

function statusLabel(status, pct) {
  if (status === 'OVER') return pct > 200 ? '🚨 Over' : 'Over';
  if (status === 'UNDER') return 'Under';
  if (status === 'NO_BUDGET') return 'No Budget';
  return 'On Track';
}

function geoBreakdown(geos) {
  if (!geos?.length) return '—';
  const sorted = [...geos].sort((a, b) => b.pacing - a.pacing);
  const shown = sorted.slice(0, MAX_GEOS).map((g) => `${escapeHtml(g.name)} ${fmtCurrency(g.pacing)}`);
  const extra = sorted.length - shown.length;
  return shown.join(' &nbsp;·&nbsp; ') + (extra > 0 ? ` &nbsp;·&nbsp; +${extra} more` : '');
}

function renderVerticalRow(group, budget) {
  const cls = classifyTotals({ budget, eomPacing: group.eomPacing });
  const color = statusColor(cls.status);
  const bg = cls.status === 'OVER' ? PALETTE.rowWarn : cls.status === 'NO_BUDGET' ? PALETTE.rowCritical : PALETTE.rowTotal;
  return `
    <tr>
      <td colspan="2" style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;border-top:2px solid ${PALETTE.borderMed};`)}">${escapeHtml(group.vertical)}</td>
      <td style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${budget ? fmtCurrencyNoDec(budget) : '—'}</td>
      <td style="${td(`background:${bg};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtCurrency(group.spendMtd)}</td>
      <td style="${td(`background:${bg};color:${color};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtCurrency(group.eomPacing)}</td>
      <td style="${td(`background:${bg};color:${color};font-weight:bold;text-align:center;border-top:2px solid ${PALETTE.borderMed};`)}">${fmtPct(cls.pacingPct)}</td>
      <td style="${td(`background:${bg};text-align:center;border-top:2px solid ${PALETTE.borderMed};`)}"><span style="color:${color};font-weight:bold;">${statusLabel(cls.status, cls.pacingPct)}</span></td>
    </tr>`;
}

function renderPlatformRow(line) {
  return `
    <tr>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};padding-left:22px;`)}">${escapeHtml(line.platform)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textSecondary};font-size:11px;`)}">${geoBreakdown(line.geos)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textMuted};text-align:right;`)}">—</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};text-align:right;`)}">${fmtCurrency(line.spendMtd)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textPrimary};text-align:right;`)}">${fmtCurrency(line.eomPacing)}</td>
      <td style="${td(`background:${PALETTE.rowNormal};color:${PALETTE.textMuted};text-align:center;`)}">—</td>
      <td style="${td(`background:${PALETTE.rowNormal};text-align:center;`)}"></td>
    </tr>`;
}

function renderTotalRow(totals, cls) {
  const color = statusColor(cls.status);
  return `
    <tr>
      <td colspan="2" style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;border-top:2px solid ${PALETTE.borderMed};">TOTAL</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${totals.budget ? fmtCurrencyNoDec(totals.budget) : '—'}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.spendMtd)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.eomPacing)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};font-weight:bold;text-align:center;border-top:2px solid ${PALETTE.borderMed};color:${color};">${fmtPct(cls.pacingPct)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};text-align:center;border-top:2px solid ${PALETTE.borderMed};"><span style="color:${color};font-weight:bold;">${statusLabel(cls.status, cls.pacingPct)}</span></td>
    </tr>`;
}

function renderClientBanner(totals, cls) {
  if (cls.status === 'NO_BUDGET') {
    return `
      <div style="background:${PALETTE.noBudgetBg};color:${PALETTE.noBudgetText};padding:10px 32px;font-size:13px;font-weight:bold;">
        ⚠️ NO BUDGET LOADED &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)}
      </div>`;
  }
  const bg = cls.status === 'OVER' ? PALETTE.overBg : cls.status === 'UNDER' ? PALETTE.underBg : PALETTE.onTrackBg;
  const label = cls.status === 'OVER' ? 'OVER PACING' : cls.status === 'UNDER' ? 'UNDER PACING' : 'ON TRACK';
  return `
    <div style="background:${bg};color:#ffffff;padding:10px 32px;font-size:13px;font-weight:bold;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ffffff;margin-right:8px;vertical-align:middle;"></span>
      ${label} &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)} &nbsp;|&nbsp; Budget: ${fmtCurrency(totals.budget)} &nbsp;|&nbsp; Pacing: ${fmtPct(cls.pacingPct)}
    </div>`;
}

function renderClientSection(client) {
  const title = `
  <div style="padding:24px 32px 8px 32px;">
    <h2 style="margin:0 0 4px 0;font-size:16px;font-weight:bold;color:${PALETTE.headerBg};border-bottom:2px solid ${PALETTE.headerBg};padding-bottom:6px;">${escapeHtml(client.name)}</h2>
  </div>`;

  if (client.error) {
    return `${title}
  <div style="margin:12px 32px 16px;background:${PALETTE.rowCritical};border:1px solid #feb2b2;border-radius:5px;padding:12px 16px;font-size:12px;color:${PALETTE.textPrimary};">
    <strong style="color:${PALETTE.criticalText};">Data unavailable:</strong> ${escapeHtml(client.error)}
  </div>
  <hr style="border:none;border-top:2px solid ${PALETTE.borderMed};margin:0 32px;">`;
  }

  const totals = computeClientTotals(client);
  const cls = classifyTotals(totals);
  const groups = groupByVertical(client.lines);

  const body = groups.length
    ? groups.map((g) => renderVerticalRow(g, client.verticalBudgets[g.vertical] ?? null) + g.lines.map(renderPlatformRow).join('')).join('') + renderTotalRow(totals, cls)
    : `<tr><td colspan="7" style="padding:14px;text-align:center;color:${PALETTE.textMuted};font-size:12px;">No spend data</td></tr>`;

  return `${title}
  ${renderClientBanner(totals, cls)}
  <div style="padding:0 32px 16px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="${th('left')}">Vertical / Platform</th>
          <th style="${th('left')}">Geo Pacing EOM</th>
          <th style="${th('right')}">Budget</th>
          <th style="${th('right')}">Spend MTD</th>
          <th style="${th('right')}">EOM Pacing</th>
          <th style="${th('center')}">Pacing %</th>
          <th style="${th('center')}">Status</th>
        </tr>
      </thead>
      <tbody>${body}</tbody>
    </table>
  </div>
  <hr style="border:none;border-top:2px solid ${PALETTE.borderMed};margin:0 32px;">`;
}

// ── Recommended actions ───────────────────────────────────────────────────────

function buildRecommendedActions(clients, info, stale) {
  const actions = [];

  if (stale) {
    actions.push({
      icon: '📅', priority: 0,
      text: `<strong style="color:${PALETTE.overText};">Sheet not rolled forward:</strong> "Client Information" still says ${escapeHtml(info.currentMonth)}. Update Current Month and Last Updated in the Targeted Streaming Spends sheet so budgets and pacing reflect the current month.`,
    });
  }

  for (const client of clients) {
    const name = escapeHtml(client.name);
    if (client.error) {
      actions.push({ icon: '🔴', priority: 1, text: `<strong>${name} — Pacing tab unreadable:</strong> ${escapeHtml(client.error)}. Confirm the "${escapeHtml(client.key)} Pacing" tab exists and the service account has Viewer access.` });
      continue;
    }

    const groups = groupByVertical(client.lines);
    const byVertical = groups.map((g) => ({ g, budget: client.verticalBudgets[g.vertical] ?? null, cls: classifyTotals({ budget: client.verticalBudgets[g.vertical] ?? null, eomPacing: g.eomPacing }) }));

    for (const { g, budget, cls } of byVertical.filter((x) => x.cls.status === 'OVER' && x.cls.pacingPct > 200)) {
      actions.push({ icon: '🚨', priority: 0, text: `<strong style="color:${PALETTE.overText};">${name} — ${escapeHtml(g.vertical)} CRITICALLY OVER PACING (${fmtPct(cls.pacingPct)}):</strong> Spent ${fmtCurrency(g.spendMtd)} against ${fmtCurrency(budget)} budget, pacing to ${fmtCurrency(g.eomPacing)} EOM. Reduce vendor caps or pause to stop further overspend.` });
    }

    for (const { g } of byVertical.filter((x) => x.cls.status === 'NO_BUDGET' && x.g.spendMtd > 0)) {
      actions.push({ icon: '🔴', priority: 1, text: `<strong>${name} — ${escapeHtml(g.vertical)} spending with no budget loaded:</strong> ${fmtCurrency(g.spendMtd)} MTD (pacing ${fmtCurrency(g.eomPacing)} EOM) with no Targeted Streaming budget in the Budget tab. Load a budget or pause.` });
    }

    const moderate = byVertical.filter((x) => x.cls.status === 'OVER' && x.cls.pacingPct <= 200);
    if (moderate.length) {
      actions.push({ icon: '⚠️', priority: 2, text: `<strong>${name} — Over pacing:</strong> ${moderate.map((x) => `${escapeHtml(x.g.vertical)} (${fmtPct(x.cls.pacingPct)})`).join(', ')}. Consider reducing vendor caps if overspend is unintended.` });
    }

    const spentVerticals = new Set(groups.map((g) => g.vertical));
    const zero = Object.entries(client.verticalBudgets).filter(([v, b]) => b > 0 && !spentVerticals.has(v));
    if (zero.length && client.lines.length) {
      const total = zero.reduce((s, [, b]) => s + b, 0);
      actions.push({ icon: '⚠️', priority: 3, text: `<strong>${name} — ${zero.length} vertical${zero.length > 1 ? 's' : ''} at 0% spend:</strong> ${zero.map(([v]) => escapeHtml(v)).join(', ')} (combined ${fmtCurrencyNoDec(total)} budget). Confirm campaigns are live and vendor spend files have been loaded.` });
    }

    const under = byVertical.filter((x) => x.cls.status === 'UNDER' && x.cls.pacingPct < 60 && x.g.spendMtd > 0);
    if (under.length) {
      actions.push({ icon: '⚠️', priority: 4, text: `<strong>${name} — Significantly under pacing:</strong> ${under.map((x) => `${escapeHtml(x.g.vertical)} (${fmtPct(x.cls.pacingPct)})`).join(', ')}. Increase vendor budgets to recover spend before month end.` });
    }

    if (!client.lines.length) {
      actions.push({ icon: '⚠️', priority: 6, text: `<strong>${name} — No spend data:</strong> ${client.budget ? `${fmtCurrencyNoDec(client.budget)} budgeted but ` : ''}no platform spend found in the "${escapeHtml(client.key)} Pacing" tab. Confirm vendor spend files were loaded for this client.` });
    }
  }

  actions.sort((a, b) => a.priority - b.priority);
  return actions;
}

function renderRecommendedActions(actions) {
  const rows = actions.length
    ? actions.map((a) => `
    <table style="width:100%;border-collapse:collapse;margin-bottom:2px;">
      <tbody><tr>
        <td style="width:30px;font-size:16px;vertical-align:top;padding:10px 10px 10px 0;">${a.icon}</td>
        <td style="font-size:12px;color:${PALETTE.textPrimary};line-height:1.7;padding:10px 0;border-bottom:1px solid ${PALETTE.borderLight};">${a.text}</td>
      </tr></tbody>
    </table>`).join('')
    : `<div style="font-size:12px;color:${PALETTE.textSecondary};">No urgent actions — all accounts within normal pacing ranges.</div>`;

  return `
    <div style="background:${PALETTE.rowTotal};border-top:2px solid ${PALETTE.borderMed};padding:20px 32px;">
      <h3 style="margin:0 0 14px 0;font-size:14px;font-weight:bold;color:${PALETTE.headerBg};">Recommended Actions</h3>
      ${rows}
    </div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * @param {{ reportDate: string, info: object, clients: Array<object> }} params
 *   reportDate — YYYY-MM-DD (ET). info — parseClientInfo shape. clients — fetchStreamingSheet().clients.
 */
export function buildStreamingPacingReport({ reportDate, info, clients }) {
  const stale = isSheetStale(info, reportDate);
  const sheetMonth = info?.currentMonth ? `${info.currentMonth}${info.currentYear ? ' ' + info.currentYear : ''}` : null;
  const dayLine = info?.lastUpdatedDay != null && info?.daysInMonth != null ? ` &nbsp;·&nbsp; Day ${info.lastUpdatedDay} of ${info.daysInMonth}` : '';

  const header = `
  <div style="background:${PALETTE.headerBg};color:#ffffff;padding:24px 32px;">
    <h1 style="margin:0 0 4px 0;font-size:20px;font-weight:bold;color:#ffffff;">📺 Targeted Streaming Pacing Report</h1>
    <div style="color:#a0aec0;font-size:13px;">${fmtDateLong(reportDate)}${info?.lastUpdated ? ` &nbsp;·&nbsp; Data as of ${fmtDateLong(info.lastUpdated)}` : ''}${sheetMonth ? ` &nbsp;·&nbsp; ${escapeHtml(sheetMonth)}` : ''}${dayLine}</div>
  </div>`;

  const staleBanner = stale ? `
  <div style="background:${PALETTE.noBudgetBg};color:${PALETTE.noBudgetText};padding:10px 32px;font-size:13px;font-weight:bold;">
    ⚠️ Sheet is still on ${escapeHtml(info.currentMonth)} — roll "Client Information" forward before trusting these numbers.
  </div>` : '';

  const sections = clients.map(renderClientSection).join('');
  const actions = buildRecommendedActions(clients, info, stale);

  const footer = `
  <div style="background:${PALETTE.headerBg};color:#718096;padding:14px 32px;font-size:11px;text-align:center;">
    Lilikoi Agency — Automated Targeted Streaming Pacing Report &nbsp;·&nbsp; ${fmtDateLong(reportDate)}
  </div>`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#222222;background-color:#f0f2f5;margin:0;padding:20px 0;">
<div style="max-width:860px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${header}${staleBanner}${sections}${renderRecommendedActions(actions)}${footer}
</div>
</body></html>`;

  const summary = {
    reportDate,
    dataAsOf: info?.lastUpdated || null,
    sheetMonth,
    stale,
    clients: clients.map((c) => {
      const totals = computeClientTotals(c);
      const cls = classifyTotals(totals);
      return {
        key: c.key,
        name: c.name,
        status: c.error ? 'ERROR' : cls.status,
        pacingPct: cls.pacingPct,
        totalBudget: c.budget,
        totalSpend: totals.spendMtd,
        totalEomPacing: totals.eomPacing,
        verticalCount: groupByVertical(c.lines).length,
        lineCount: c.lines.length,
      };
    }),
    actionCount: actions.length,
  };

  return { html, summary };
}
