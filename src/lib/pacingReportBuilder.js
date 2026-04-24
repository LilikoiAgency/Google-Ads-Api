// src/lib/pacingReportBuilder.js
// Pure functions: parsed sheet data → email HTML + structured summary.
// Styling is 100% inline per Gmail constraints.

const PALETTE = {
  headerBg: '#1a1a2e',
  onTrackBg: '#38a169',
  underBg: '#3182ce',
  overBg: '#dd6b20',
  criticalBg: '#e53e3e',
  noBudgetBg: '#fff3cd',
  noBudgetText: '#856404',
  inactiveBg: '#edf2f7',
  inactiveText: '#4a5568',
  rowNormal: '#ffffff',
  rowWarn: '#fffff0',
  rowCritical: '#fff5f5',
  rowInactive: '#f9fafb',
  rowTotal: '#f7fafc',
  textPrimary: '#2d3748',
  textSecondary: '#4a5568',
  textMuted: '#a0aec0',
  onTrackText: '#276749',
  overText: '#c05621',
  underText: '#2b6cb0',
  criticalText: '#e53e3e',
  borderLight: '#edf2f7',
  borderMed: '#e2e8f0',
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function fmtCurrency(n, decimals = 2) {
  if (n == null || !Number.isFinite(n)) return '—';
  return '$' + Number(n).toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}
function fmtCurrencyNoDec(n) { return fmtCurrency(n, 0); }

function fmtPct(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toFixed(1) + '%';
}

function fmtDateLong(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function daysInMonth(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

function dayOfMonth(dateStr) {
  return new Date(dateStr + 'T00:00:00').getDate();
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Status classification ─────────────────────────────────────────────────────

function classifyLine(line) {
  const { budget, spendMtd, eomPacing } = line;
  const hasSpend = (spendMtd || 0) > 0;
  const hasBudget = budget != null && budget > 0;

  if (!hasBudget && !hasSpend) return { status: 'INACTIVE', pacingPct: null };
  if (!hasBudget && hasSpend)  return { status: 'NO_BUDGET', pacingPct: null };
  const pct = eomPacing != null && budget > 0 ? (eomPacing / budget) * 100 : null;
  if (pct == null) return { status: 'INACTIVE', pacingPct: null };
  if (pct <= 85)   return { status: 'UNDER', pacingPct: pct };
  if (pct <= 115)  return { status: 'ON_TRACK', pacingPct: pct };
  return { status: 'OVER', pacingPct: pct };
}

function classifyClientTotal(totals) {
  const { budget, eomPacing } = totals;
  if (!budget || budget === 0) return { status: 'NO_BUDGET', pacingPct: null };
  const pct = eomPacing != null ? (eomPacing / budget) * 100 : null;
  if (pct == null) return { status: 'INACTIVE', pacingPct: null };
  if (pct <= 85)   return { status: 'UNDER', pacingPct: pct };
  if (pct <= 115)  return { status: 'ON_TRACK', pacingPct: pct };
  return { status: 'OVER', pacingPct: pct };
}

// ── Row renderers ─────────────────────────────────────────────────────────────

function renderPlatformRow(line) {
  const cls = classifyLine(line);
  const label = line.rawLabel || `${line.platform}${line.vertical ? ' / ' + line.vertical : ''}`;

  if (cls.status === 'INACTIVE') {
    return `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};color:${PALETTE.textMuted};">${escapeHtml(label)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};color:${PALETTE.textMuted};text-align:right;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};color:${PALETTE.textMuted};text-align:right;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};color:${PALETTE.textMuted};text-align:right;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};color:${PALETTE.textMuted};text-align:right;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};text-align:center;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowInactive};text-align:center;"><span style="color:${PALETTE.textMuted};">Inactive</span></td>
      </tr>`;
  }

  if (cls.status === 'NO_BUDGET') {
    return `
      <tr>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};color:${PALETTE.textPrimary};font-weight:500;">${escapeHtml(label)} <span style="color:${PALETTE.criticalText};font-size:11px;">(no budget)</span></td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};color:${PALETTE.textPrimary};text-align:right;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};color:${PALETTE.textPrimary};text-align:right;">${fmtCurrencyNoDec(line.campaignBudget)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};color:${PALETTE.textPrimary};text-align:right;">${fmtCurrency(line.spendMtd)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};color:${PALETTE.textPrimary};text-align:right;">${fmtCurrency(line.eomPacing)}</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};text-align:center;">—</td>
        <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${PALETTE.rowCritical};text-align:center;"><span style="color:${PALETTE.criticalText};font-weight:bold;">No Budget</span></td>
      </tr>`;
  }

  const isOver = cls.status === 'OVER';
  const isCriticalOver = isOver && cls.pacingPct > 200;
  const bg = isOver ? PALETTE.rowWarn : PALETTE.rowNormal;
  const pctColor = isOver ? PALETTE.overText
    : cls.status === 'UNDER' ? PALETTE.underText
    : PALETTE.onTrackText;
  const pctWeight = isOver || cls.status === 'UNDER' ? 'bold' : 'normal';
  const statusLabel = cls.status === 'OVER' ? (isCriticalOver ? '🚨 Over' : 'Over')
    : cls.status === 'UNDER' ? 'Under'
    : 'On Track';
  const eomColor = isOver ? PALETTE.overText : (cls.status === 'UNDER' ? PALETTE.underText : PALETTE.textPrimary);
  const eomWeight = isOver || cls.status === 'UNDER' ? 'bold' : 'normal';

  return `
    <tr>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};color:${PALETTE.textPrimary};font-weight:500;">${escapeHtml(label)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};color:${PALETTE.textPrimary};text-align:right;">${fmtCurrencyNoDec(line.budget)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};color:${PALETTE.textSecondary};text-align:right;">${fmtCurrencyNoDec(line.campaignBudget)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};color:${PALETTE.textPrimary};text-align:right;">${fmtCurrency(line.spendMtd)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};color:${eomColor};font-weight:${eomWeight};text-align:right;">${fmtCurrency(line.eomPacing)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};text-align:center;color:${pctColor};font-weight:${pctWeight};">${fmtPct(cls.pacingPct)}</td>
      <td style="padding:7px 10px;border-bottom:1px solid ${PALETTE.borderLight};background:${bg};text-align:center;"><span style="color:${pctColor};font-weight:${isOver ? 'bold' : 'normal'};">${statusLabel}</span></td>
    </tr>`;
}

function renderTotalRow(totals, cls) {
  const pctColor = cls.status === 'OVER' ? PALETTE.overText
    : cls.status === 'UNDER' ? PALETTE.underText
    : PALETTE.onTrackText;
  const label = cls.status === 'OVER' ? '⚠ Over'
    : cls.status === 'UNDER' ? 'Under'
    : cls.status === 'NO_BUDGET' ? 'No Budget'
    : '✓ On Track';

  return `
    <tr>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;border-top:2px solid ${PALETTE.borderMed};">TOTAL</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${totals.budget ? fmtCurrencyNoDec(totals.budget) : '—'}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textSecondary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${totals.campaignBudget != null ? fmtCurrencyNoDec(totals.campaignBudget) : '—'}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.spendMtd)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};color:${PALETTE.textPrimary};font-weight:bold;text-align:right;border-top:2px solid ${PALETTE.borderMed};">${fmtCurrency(totals.eomPacing)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};font-weight:bold;text-align:center;border-top:2px solid ${PALETTE.borderMed};color:${pctColor};">${fmtPct(cls.pacingPct)}</td>
      <td style="padding:8px 10px;background:${PALETTE.rowTotal};text-align:center;border-top:2px solid ${PALETTE.borderMed};"><span style="color:${pctColor};font-weight:bold;">${label}</span></td>
    </tr>`;
}

// ── Banner rendering ──────────────────────────────────────────────────────────

function renderClientBanner(totals, cls) {
  if (cls.status === 'NO_BUDGET') {
    return `
      <div style="background:${PALETTE.noBudgetBg};color:${PALETTE.noBudgetText};padding:10px 32px;font-size:13px;font-weight:bold;">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ffc107;margin-right:8px;vertical-align:middle;"></span>
        ⚠️ NO BUDGET LOADED &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)}
      </div>`;
  }
  const bg = cls.status === 'OVER' ? PALETTE.overBg
    : cls.status === 'UNDER' ? PALETTE.underBg
    : PALETTE.onTrackBg;
  const label = cls.status === 'OVER' ? 'OVER PACING'
    : cls.status === 'UNDER' ? 'UNDER PACING'
    : 'ON TRACK';
  return `
    <div style="background:${bg};color:#ffffff;padding:10px 32px;font-size:13px;font-weight:bold;">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ffffff;margin-right:8px;vertical-align:middle;"></span>
      ${label} &nbsp;|&nbsp; Spend: ${fmtCurrency(totals.spendMtd)} &nbsp;|&nbsp; EOM Pacing: ${fmtCurrency(totals.eomPacing)} &nbsp;|&nbsp; Budget: ${fmtCurrency(totals.budget)} &nbsp;|&nbsp; Pacing: ${fmtPct(cls.pacingPct)}
    </div>`;
}

// ── Validation flag box ───────────────────────────────────────────────────────

function renderValidationBox(validation, diffAlerts) {
  const platformFlags = (validation?.platforms || [])
    .filter((p) => (p.incorrectCount || 0) > 0 && p.incorrectNames?.length);

  if (!platformFlags.length && !diffAlerts?.length) return '';

  const diffLines = (diffAlerts || []).map((d) => `
    <strong style="color:${PALETTE.criticalText};">${escapeHtml(d.platform)} — dollar difference detected:</strong> ${fmtCurrency(d.differencesUsd)}<br>`).join('');

  const flagLines = platformFlags.map((p) => `
    <strong>${escapeHtml(p.platform)} — ${p.incorrectCount} incorrect campaign name${p.incorrectCount === 1 ? '' : 's'}:</strong><br>
    ${p.incorrectNames.map((n) => escapeHtml(n)).join(' &nbsp;·&nbsp; ')}<br>`).join('');

  return `
    <div style="margin:12px 32px;background:${PALETTE.rowCritical};border:1px solid #feb2b2;border-radius:5px;padding:12px 16px;">
      <div style="font-size:12px;font-weight:bold;color:${PALETTE.criticalText};margin-bottom:6px;">🚨 VALIDATION FLAGS</div>
      <div style="font-size:12px;color:${PALETTE.textPrimary};line-height:1.7;">
        ${diffLines}${flagLines}
      </div>
    </div>`;
}

// ── Geo bar ───────────────────────────────────────────────────────────────────

function renderGeoBar(geos) {
  if (!geos || !geos.length) return '';
  const parts = geos.map((g) => `${escapeHtml(g.name)} ${fmtCurrency(g.pacing)}`);
  return `
    <div style="margin-top:10px;font-size:12px;color:${PALETTE.textSecondary};background:${PALETTE.rowTotal};border-radius:4px;padding:10px 14px;">
      <strong style="color:${PALETTE.textPrimary};">Geo Pacing EOM:</strong> &nbsp;${parts.join(' &nbsp;·&nbsp; ')}
    </div>`;
}

// ── Client section ────────────────────────────────────────────────────────────

function computeClientTotals(lines) {
  return lines.reduce(
    (acc, l) => ({
      budget: (acc.budget || 0) + (l.budget || 0),
      campaignBudget: l.campaignBudget != null
        ? (acc.campaignBudget || 0) + l.campaignBudget
        : acc.campaignBudget,
      spendMtd: (acc.spendMtd || 0) + (l.spendMtd || 0),
      eomPacing: (acc.eomPacing || 0) + (l.eomPacing || 0),
    }),
    { budget: 0, campaignBudget: null, spendMtd: 0, eomPacing: 0 },
  );
}

function renderClientSection(client) {
  const { name, pacing, validation } = client;
  const lines = pacing?.lines || [];
  const totals = computeClientTotals(lines);
  const cls = classifyClientTotal(totals);

  const diffAlerts = (validation?.platforms || []).filter((p) => Math.abs(p.differencesUsd || 0) >= 0.01);

  const tableBody = lines.length
    ? lines.map(renderPlatformRow).join('') + renderTotalRow(totals, cls)
    : `<tr><td colspan="7" style="padding:14px;text-align:center;color:${PALETTE.textMuted};font-size:12px;">No platform data</td></tr>`;

  return `
  <div style="padding:24px 32px 8px 32px;">
    <h2 style="margin:0 0 4px 0;font-size:16px;font-weight:bold;color:${PALETTE.headerBg};border-bottom:2px solid ${PALETTE.headerBg};padding-bottom:6px;">${escapeHtml(name)}</h2>
  </div>
  ${renderClientBanner(totals, cls)}
  ${renderValidationBox(validation, diffAlerts)}
  <div style="padding:0 32px 16px 32px;">
    <table style="width:100%;border-collapse:collapse;font-size:12px;">
      <thead>
        <tr>
          <th style="text-align:left;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Platform / Vertical</th>
          <th style="text-align:right;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Budget</th>
          <th style="text-align:right;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Campaign Budget</th>
          <th style="text-align:right;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Spend MTD</th>
          <th style="text-align:right;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">EOM Pacing</th>
          <th style="text-align:center;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Pacing %</th>
          <th style="text-align:center;padding:8px 10px;background:${PALETTE.rowTotal};border-bottom:2px solid ${PALETTE.borderMed};color:${PALETTE.textSecondary};font-weight:bold;">Status</th>
        </tr>
      </thead>
      <tbody>${tableBody}</tbody>
    </table>
    ${renderGeoBar(pacing?.geos)}
  </div>
  <hr style="border:none;border-top:2px solid ${PALETTE.borderMed};margin:0 32px;">`;
}

// ── Recommended actions ───────────────────────────────────────────────────────

function buildRecommendedActions(clients) {
  const actions = [];

  for (const client of clients) {
    const lines = client.pacing?.lines || [];
    const validation = client.validation?.platforms || [];

    // Critical over-pacing (>200%)
    const critical = lines.filter((l) => {
      const cls = classifyLine(l);
      return cls.status === 'OVER' && cls.pacingPct > 200;
    });
    for (const l of critical) {
      const cls = classifyLine(l);
      actions.push({
        icon: '🚨',
        priority: 0,
        text: `<strong style="color:${PALETTE.overText};">${escapeHtml(client.name)} — ${escapeHtml(l.platform)}${l.vertical ? ' ' + escapeHtml(l.vertical) : ''} CRITICALLY OVER PACING (${fmtPct(cls.pacingPct)}):</strong> Spent ${fmtCurrency(l.spendMtd)} against ${fmtCurrency(l.budget)} budget, pacing to ${fmtCurrency(l.eomPacing)} EOM. Reduce daily caps or pause to stop further overspend.`,
      });
    }

    // No-budget with spend
    const nobudget = lines.filter((l) => (l.budget == null || l.budget === 0) && (l.spendMtd || 0) > 0);
    for (const l of nobudget) {
      actions.push({
        icon: '🔴',
        priority: 1,
        text: `<strong>${escapeHtml(client.name)} — ${escapeHtml(l.platform)}${l.vertical ? ' ' + escapeHtml(l.vertical) : ''} spending with no budget loaded:</strong> ${fmtCurrency(l.spendMtd)} MTD (pacing ${fmtCurrency(l.eomPacing)} EOM) with no monthly budget set. Load a budget or pause.`,
      });
    }

    // Moderate over (>115% but ≤200%)
    const moderateOver = lines.filter((l) => {
      const cls = classifyLine(l);
      return cls.status === 'OVER' && cls.pacingPct <= 200;
    });
    if (moderateOver.length) {
      const items = moderateOver.map((l) => {
        const cls = classifyLine(l);
        return `${escapeHtml(l.platform)}${l.vertical ? ' ' + escapeHtml(l.vertical) : ''} (${fmtPct(cls.pacingPct)})`;
      }).join(', ');
      actions.push({
        icon: '⚠️',
        priority: 2,
        text: `<strong>${escapeHtml(client.name)} — Over pacing:</strong> ${items}. Consider reducing daily caps if overspend is unintended.`,
      });
    }

    // Zero spend on budgeted platforms
    const zeroSpend = lines.filter((l) => (l.budget || 0) > 0 && (l.spendMtd || 0) === 0);
    if (zeroSpend.length) {
      const items = zeroSpend.map((l) => `${escapeHtml(l.platform)}${l.vertical ? ' ' + escapeHtml(l.vertical) : ''}`).join(', ');
      const budgetTotal = zeroSpend.reduce((s, l) => s + (l.budget || 0), 0);
      actions.push({
        icon: '⚠️',
        priority: 3,
        text: `<strong>${escapeHtml(client.name)} — ${zeroSpend.length} line${zeroSpend.length > 1 ? 's' : ''} at 0% spend:</strong> ${items} (combined ${fmtCurrencyNoDec(budgetTotal)} budget). Confirm campaigns are live, approved, and launched.`,
      });
    }

    // Significantly under pacing (<60%)
    const under = lines.filter((l) => {
      const cls = classifyLine(l);
      return cls.status === 'UNDER' && cls.pacingPct != null && cls.pacingPct < 60 && (l.spendMtd || 0) > 0;
    });
    if (under.length) {
      const items = under.map((l) => {
        const cls = classifyLine(l);
        return `${escapeHtml(l.platform)}${l.vertical ? ' ' + escapeHtml(l.vertical) : ''} (${fmtPct(cls.pacingPct)})`;
      }).join(', ');
      actions.push({
        icon: '⚠️',
        priority: 4,
        text: `<strong>${escapeHtml(client.name)} — Significantly under pacing:</strong> ${items}. Increase daily budgets or bids to recover spend before month end.`,
      });
    }

    // Naming violations
    const namingFlags = validation.filter((v) => (v.incorrectCount || 0) > 0);
    if (namingFlags.length) {
      const total = namingFlags.reduce((s, v) => s + v.incorrectCount, 0);
      const detail = namingFlags.map((v) => `${v.incorrectCount} ${escapeHtml(v.platform)}`).join(', ');
      actions.push({
        icon: '📋',
        priority: 5,
        text: `<strong>${escapeHtml(client.name)} — ${total} naming convention violation${total > 1 ? 's' : ''}:</strong> ${detail}. Rename to match convention for consistent reporting.`,
      });
    }

    // Client has zero data at all
    if (!lines.length) {
      actions.push({
        icon: '⚠️',
        priority: 6,
        text: `<strong>${escapeHtml(client.name)} — No budget or spend data loaded:</strong> All platforms show no activity. Confirm if budgets have been intentionally withheld or if data needs to be loaded into the sheet.`,
      });
    }
  }

  actions.sort((a, b) => a.priority - b.priority);
  return actions;
}

function renderRecommendedActions(actions) {
  if (!actions.length) {
    return `
      <div style="background:${PALETTE.rowTotal};border-top:2px solid ${PALETTE.borderMed};padding:20px 32px;">
        <h3 style="margin:0 0 10px 0;font-size:14px;font-weight:bold;color:${PALETTE.headerBg};">Recommended Actions</h3>
        <div style="font-size:12px;color:${PALETTE.textSecondary};">No urgent actions — all accounts within normal pacing ranges.</div>
      </div>`;
  }

  const rows = actions.map((a) => `
    <table style="width:100%;border-collapse:collapse;margin-bottom:2px;">
      <tbody><tr>
        <td style="width:30px;font-size:16px;vertical-align:top;padding:10px 10px 10px 0;">${a.icon}</td>
        <td style="font-size:12px;color:${PALETTE.textPrimary};line-height:1.7;padding:10px 0;border-bottom:1px solid ${PALETTE.borderLight};">${a.text}</td>
      </tr></tbody>
    </table>`).join('');

  return `
    <div style="background:${PALETTE.rowTotal};border-top:2px solid ${PALETTE.borderMed};padding:20px 32px;">
      <h3 style="margin:0 0 14px 0;font-size:14px;font-weight:bold;color:${PALETTE.headerBg};">Recommended Actions</h3>
      ${rows}
    </div>`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

/**
 * Build the pacing report HTML + summary from parsed client data.
 * @param {object} params
 * @param {string} params.reportDate - YYYY-MM-DD
 * @param {Array<{key:string,name:string,pacing:object,validation:object,error?:string}>} params.clients
 */
export function buildPacingReport({ reportDate, clients }) {
  const dim = daysInMonth(reportDate);
  const dom = dayOfMonth(reportDate);
  // Prefer remainingDays from the first client that reported it
  const reportedRemaining = clients
    .map((c) => c.pacing?.header?.remainingDays)
    .find((n) => n != null && Number.isFinite(n));
  const remaining = reportedRemaining != null ? reportedRemaining : Math.max(0, dim - dom);
  const elapsedPct = (dom / dim) * 100;

  const header = `
  <div style="background:${PALETTE.headerBg};color:#ffffff;padding:24px 32px;">
    <h1 style="margin:0 0 4px 0;font-size:20px;font-weight:bold;color:#ffffff;">📊 Daily Budget Pacing Report</h1>
    <div style="color:#a0aec0;font-size:13px;">${fmtDateLong(reportDate)} &nbsp;·&nbsp; Day ${dom} of ${dim} &nbsp;·&nbsp; ${remaining} Days Remaining &nbsp;·&nbsp; ${elapsedPct.toFixed(1)}% Elapsed</div>
  </div>`;

  const sections = clients.map(renderClientSection).join('');
  const actions = buildRecommendedActions(clients);
  const actionsBlock = renderRecommendedActions(actions);

  const footer = `
  <div style="background:${PALETTE.headerBg};color:#718096;padding:14px 32px;font-size:11px;text-align:center;">
    Lilikoi Agency — Automated Budget Pacing Report &nbsp;·&nbsp; ${fmtDateLong(reportDate)} &nbsp;·&nbsp; Data as of 9:00 AM ET
  </div>`;

  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;font-size:13px;color:#222222;background-color:#f0f2f5;margin:0;padding:20px 0;">
<div style="max-width:860px;margin:0 auto;background:#ffffff;border-radius:6px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
${header}${sections}${actionsBlock}${footer}
</div>
</body></html>`;

  const summary = {
    reportDate,
    dayOfMonth: dom,
    daysInMonth: dim,
    daysRemaining: remaining,
    clients: clients.map((c) => {
      const lines = c.pacing?.lines || [];
      const totals = computeClientTotals(lines);
      const cls = classifyClientTotal(totals);
      return {
        key: c.key,
        name: c.name,
        status: cls.status,
        pacingPct: cls.pacingPct,
        totalBudget: totals.budget,
        totalSpend: totals.spendMtd,
        totalEomPacing: totals.eomPacing,
        lineCount: lines.length,
        namingFlags: (c.validation?.platforms || []).reduce((s, v) => s + (v.incorrectCount || 0), 0),
        dollarDiffFlags: (c.validation?.platforms || []).filter((v) => Math.abs(v.differencesUsd || 0) >= 0.01).length,
      };
    }),
    actionCount: actions.length,
  };

  return { html, summary };
}
