// Generates a fully self-contained HTML report file with tabs + Chart.js charts.
// Charts are lazily initialized when their tab is first opened.

function fmt$(n) { return n == null ? 'N/A' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtN(n) { return n == null ? '—' : Number(n).toLocaleString(); }
function fmtPct(n) { return n == null ? '—' : Number(n).toFixed(1) + '%'; }
function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function ratingBadge(r) {
    const map = { Good:'#d1fae5|#065f46', Average:'#fef3cd|#92400e', Poor:'#fee2e2|#991b1b', 'N/A':'#f3f4f6|#6b7280' };
    const [bg,col] = (map[r]||map['N/A']).split('|');
    return `<span style="background:${bg};color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${r}</span>`;
}
function priorityBadge(p) {
    const map = { High:'#fee2e2|#991b1b', Medium:'#fef3cd|#92400e', Low:'#f0f9ff|#0369a1' };
    const [bg,col] = (map[p]||'#f3f4f6|#6b7280').split('|');
    return `<span style="background:${bg};color:${col};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700">${p||'—'}</span>`;
}

// Store chart config as JSON attr — initialized lazily when tab first opens
function chartCanvas(id, config) {
    return `<canvas id="${id}" data-chartcfg='${JSON.stringify(config).replace(/'/g,"&#39;")}'></canvas>`;
}

function stopBiddingTab(rows) {
    if (!rows.length) return '<p style="color:#888;padding:24px">No stop-bidding candidates identified.</p>';
    const total = rows.reduce((s,r)=>s+r.paidSpend,0);
    const top10 = rows.slice(0,10);
    const labels = top10.map(r=>r.keyword.length>22?r.keyword.slice(0,20)+'…':r.keyword);
    const values = top10.map(r=>+r.paidSpend.toFixed(2));
    const colors = values.map((_,i)=>`hsl(${200+i*12},70%,52%)`);

    return `
    <div class="section-header">
        <span class="section-icon">🛑</span>
        <div><div class="section-title">Stop Bidding Candidates</div>
        <div class="section-sub">${rows.length} keywords ranking organically top 5 — ${fmt$(total)} in recoverable spend</div></div>
    </div>
    <div class="chart-row">
        <div class="chart-box"><div class="chart-title">Top 10 by Paid Spend</div>
            ${chartCanvas('stopBar',{type:'bar',data:{labels,datasets:[{label:'Paid Spend ($)',data:values,backgroundColor:colors,borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{callback:'$v'}}}}})}
        </div>
        <div class="chart-box"><div class="chart-title">Spend Distribution</div>
            ${chartCanvas('stopPie',{type:'doughnut',data:{labels,datasets:[{data:values,backgroundColor:colors}]},options:{plugins:{legend:{position:'right',labels:{font:{size:10},boxWidth:12}}}}})}
        </div>
    </div>
    <table>
        <thead><tr><th>Keyword</th><th>Organic Pos</th><th>Organic Impr</th><th>Paid Spend</th><th>Paid Convs</th><th>Paid CPA</th><th>Recommendation</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
            <td><strong>${esc(r.keyword)}</strong></td>
            <td>${r.organicPosition}</td>
            <td>${fmtN(r.organicImpressions)}</td>
            <td>${fmt$(r.paidSpend)}</td>
            <td>${fmtN(r.paidConversions)}</td>
            <td>${r.paidCpa?fmt$(r.paidCpa):'—'}</td>
            <td style="color:#991b1b;font-size:11px">${esc(r.recommendation||'—')}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function wastedSpendTab(rows) {
    if (!rows.length) return '<p style="color:#888;padding:24px">No wasted spend identified.</p>';
    const total = rows.reduce((s,r)=>s+r.paidSpend,0);
    const byCampaign = {};
    rows.forEach(r=>{ byCampaign[r.campaignName]=(byCampaign[r.campaignName]||0)+r.paidSpend; });
    const sorted = Object.entries(byCampaign).sort((a,b)=>b[1]-a[1]).slice(0,8);
    const labels = sorted.map(([n])=>n.length>22?n.slice(0,20)+'…':n);
    const values = sorted.map(([,v])=>+v.toFixed(2));
    const colors = values.map((_,i)=>`hsl(${i*15},65%,55%)`);

    return `
    <div class="section-header">
        <span class="section-icon">⚠️</span>
        <div><div class="section-title">Wasted Spend — Zero Conversions</div>
        <div class="section-sub">${rows.length} keywords — ${fmt$(total)} total wasted</div></div>
    </div>
    <div class="chart-row">
        <div class="chart-box"><div class="chart-title">Waste by Campaign</div>
            ${chartCanvas('wasteBar',{type:'bar',data:{labels,datasets:[{label:'Wasted ($)',data:values,backgroundColor:colors,borderRadius:4}]},options:{indexAxis:'y',plugins:{legend:{display:false}},scales:{x:{ticks:{callback:'$v'}}}}})}
        </div>
        <div class="chart-box"><div class="chart-title">Campaign Share of Waste</div>
            ${chartCanvas('wastePie',{type:'doughnut',data:{labels,datasets:[{data:values,backgroundColor:colors}]},options:{plugins:{legend:{position:'right',labels:{font:{size:10},boxWidth:12}}}}})}
        </div>
    </div>
    <table>
        <thead><tr><th>Keyword</th><th>Spend</th><th>Clicks</th><th>Campaign</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
            <td><strong>${esc(r.keyword)}</strong></td>
            <td style="color:#991b1b;font-weight:600">${fmt$(r.paidSpend)}</td>
            <td>${fmtN(r.paidClicks)}</td>
            <td style="font-size:11px;color:#666">${esc(r.campaignName)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function opportunitiesTab(rows) {
    if (!rows.length) return '<p style="color:#888;padding:24px">No missed opportunities identified.</p>';
    return `
    <div class="section-header">
        <span class="section-icon">🚀</span>
        <div><div class="section-title">Missed Opportunities</div>
        <div class="section-sub">${rows.length} organic queries with no paid coverage</div></div>
    </div>
    <table>
        <thead><tr><th>Keyword</th><th>Organic Pos</th><th>Impressions</th><th>Organic CTR</th><th>Organic Clicks</th><th>Priority</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
            <td><strong>${esc(r.keyword)}</strong></td>
            <td>${r.organicPosition}</td>
            <td>${fmtN(r.organicImpressions)}</td>
            <td>${fmtPct(r.organicCtr)}</td>
            <td>${fmtN(r.organicClicks)}</td>
            <td>${priorityBadge(r.priority)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function campaignsTab(campaigns, summary) {
    if (!campaigns.length) return '<p style="color:#888;padding:24px">No campaign data.</p>';
    const top8 = campaigns.slice(0,8);
    const labels = top8.map(c=>c.name.length>22?c.name.slice(0,20)+'…':c.name);
    const spendVals = top8.map(c=>+c.cost.toFixed(2));
    const convVals  = top8.map(c=>c.conversions);
    const totalSpend = summary.totalSpend||1;
    const totalConvs = summary.totalConversions||1;
    const spendPct = spendVals.map(v=>+(v/totalSpend*100).toFixed(1));
    const convPct  = convVals.map(v=>+(v/totalConvs*100).toFixed(1));
    const blue = 'rgba(15,52,96,0.8)', orange = 'rgba(230,126,34,0.8)';

    return `
    <div class="section-header">
        <span class="section-icon">📈</span>
        <div><div class="section-title">Campaign Performance</div>
        <div class="section-sub">${campaigns.length} campaigns · Blended CPA ${fmt$(summary.blendedCpa)}</div></div>
    </div>
    <div class="chart-row">
        <div class="chart-box"><div class="chart-title">Spend by Campaign</div>
            ${chartCanvas('campSpend',{type:'bar',data:{labels,datasets:[{label:'Spend ($)',data:spendVals,backgroundColor:blue,borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{x:{ticks:{maxRotation:30,font:{size:10}}},y:{ticks:{callback:'$v'}}}}})}
        </div>
        <div class="chart-box"><div class="chart-title">Spend % vs Conversion %</div>
            ${chartCanvas('campShare',{type:'bar',data:{labels,datasets:[{label:'Spend %',data:spendPct,backgroundColor:blue,borderRadius:4},{label:'Conv %',data:convPct,backgroundColor:orange,borderRadius:4}]},options:{scales:{x:{ticks:{maxRotation:30,font:{size:10}}},y:{ticks:{callback:'v%'}}}}})}
        </div>
    </div>
    <table>
        <thead><tr><th>Campaign</th><th>Spend</th><th>Conversions</th><th>CPA</th><th>CTR</th><th>Rating</th></tr></thead>
        <tbody>${campaigns.map(c=>`<tr>
            <td><strong>${esc(c.name)}</strong></td>
            <td>${fmt$(c.cost)}</td>
            <td>${fmtN(c.conversions)}</td>
            <td>${c.cpa?fmt$(c.cpa):'—'}</td>
            <td>${c.ctr?fmtPct(c.ctr*100):'—'}</td>
            <td>${ratingBadge(c.cpaRating)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function overlapTab(rows) {
    if (!rows.length) return '<p style="color:#888;padding:24px">No overlap identified.</p>';
    return `
    <div class="section-header">
        <span class="section-icon">🔁</span>
        <div><div class="section-title">Paid + Organic Overlap</div>
        <div class="section-sub">${rows.length} keywords appearing in both channels</div></div>
    </div>
    <table>
        <thead><tr><th>Keyword</th><th>Organic Pos</th><th>Organic Impr</th><th>Paid Spend</th><th>Paid Convs</th><th>Signal</th></tr></thead>
        <tbody>${rows.map(r=>`<tr>
            <td><strong>${esc(r.keyword)}</strong></td>
            <td>${r.organicPosition}</td>
            <td>${fmtN(r.organicImpressions)}</td>
            <td>${fmt$(r.paidSpend)}</td>
            <td>${fmtN(r.paidConversions)}</td>
            <td style="font-size:11px;color:#555">${esc(r.signal)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function organicTab(rows) {
    if (!rows.length) return '<p style="color:#888;padding:24px">No organic data.</p>';
    const buckets = {'1–3':0,'4–10':0,'11–20':0,'21–50':0,'50+':0};
    rows.forEach(r=>{
        const p=r.organicPosition;
        if(p<=3)buckets['1–3']++;
        else if(p<=10)buckets['4–10']++;
        else if(p<=20)buckets['11–20']++;
        else if(p<=50)buckets['21–50']++;
        else buckets['50+']++;
    });
    const bLabels=Object.keys(buckets), bValues=Object.values(buckets);
    const bColors=['#22c55e','#3b82f6','#f59e0b','#f97316','#ef4444'];

    return `
    <div class="section-header">
        <span class="section-icon">🌿</span>
        <div><div class="section-title">Organic SEO Performance</div>
        <div class="section-sub">${rows.length} queries from Google Search Console</div></div>
    </div>
    <div class="chart-row">
        <div class="chart-box"><div class="chart-title">Position Distribution</div>
            ${chartCanvas('orgPie',{type:'doughnut',data:{labels:bLabels,datasets:[{data:bValues,backgroundColor:bColors}]},options:{plugins:{legend:{position:'right',labels:{font:{size:11},boxWidth:14}}}}})}
        </div>
        <div class="chart-box"><div class="chart-title">Queries by Position Bucket</div>
            ${chartCanvas('orgBar',{type:'bar',data:{labels:bLabels,datasets:[{label:'Queries',data:bValues,backgroundColor:bColors,borderRadius:4}]},options:{plugins:{legend:{display:false}},scales:{y:{beginAtZero:true}}}})}
        </div>
    </div>
    <table>
        <thead><tr><th>Query</th><th>Avg Position</th><th>Impressions</th><th>Clicks</th><th>CTR</th></tr></thead>
        <tbody>${rows.slice(0,50).map(r=>`<tr>
            <td><strong>${esc(r.query||r.keyword)}</strong></td>
            <td>${r.organicPosition}</td>
            <td>${fmtN(r.organicImpressions)}</td>
            <td>${fmtN(r.organicClicks)}</td>
            <td>${fmtPct(r.organicCtr)}</td>
        </tr>`).join('')}</tbody>
    </table>`;
}

function aiInsightsTab(analysis) {
    if (!analysis) return '<p style="color:#888;padding:24px">AI analysis was not run for this report.</p>';

    const AI_SECTION_META = {
        'Executive Summary':          { icon:'📋', color:'#0f3460',  bg:'#f0f4ff' },
        'Top 3 Priority Actions':     { icon:'🎯', color:'#7b2d8b',  bg:'#fdf4ff' },
        'Quick Wins':                 { icon:'⚡', color:'#b45309',  bg:'#fffbeb' },
        'Strategic Recommendations':  { icon:'🗺️', color:'#065f46',  bg:'#f0fdf4' },
        'Risks to Watch':             { icon:'⚠️', color:'#991b1b',  bg:'#fff5f5' },
    };

    const sections = [];
    let current = null;
    for (const line of analysis.split('\n')) {
        if (line.startsWith('## ')) {
            if (current) sections.push(current);
            current = { title: line.replace('## ', '').trim(), lines: [] };
        } else if (current) {
            current.lines.push(line);
        }
    }
    if (current) sections.push(current);

    const sectionsHtml = sections.map(s => {
        const m = AI_SECTION_META[s.title] || { icon:'💡', color:'#1a1a2e', bg:'#f8f9fb' };
        const linesHtml = s.lines.filter(l => l.trim()).map(line => {
            const numbered = line.match(/^(\d+)\.\s+(.*)/);
            const bulleted  = line.match(/^[-•]\s+(.*)/);
            if (numbered) return `<div style="display:flex;gap:10px;margin-bottom:8px;align-items:flex-start"><span style="flex-shrink:0;width:20px;height:20px;border-radius:50%;background:${m.color};color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center">${numbered[1]}</span><span style="font-size:13px;color:#333;line-height:1.65">${esc(numbered[2])}</span></div>`;
            if (bulleted)  return `<div style="display:flex;gap:8px;margin-bottom:6px;align-items:flex-start"><span style="flex-shrink:0;width:6px;height:6px;border-radius:50%;background:${m.color};margin-top:6px"></span><span style="font-size:13px;color:#333;line-height:1.65">${esc(bulleted[1])}</span></div>`;
            return `<p style="font-size:13px;color:#444;line-height:1.7;margin-bottom:4px">${esc(line)}</p>`;
        }).join('');
        return `<div style="background:${m.bg};border-radius:12px;padding:18px 22px;margin-bottom:14px;border-left:4px solid ${m.color}">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
                <span style="font-size:16px">${m.icon}</span>
                <span style="font-size:14px;font-weight:800;color:${m.color}">${esc(s.title)}</span>
            </div>
            ${linesHtml}
        </div>`;
    }).join('');

    return `
    <div class="section-header">
        <span class="section-icon">🤖</span>
        <div><div class="section-title">AI-Powered Analysis — Claude</div>
        <div class="section-sub">Generated by Claude Opus · Strategic insights tailored to this account</div></div>
    </div>
    ${sectionsHtml}`;
}

export function generateReportHtml(data, aiAnalysis) {
    const { meta, summary, stopBidding, wastedSpend, opportunities, overlap, campaigns, organic } = data;
    const totalWaste = wastedSpend.reduce((s,r)=>s+r.paidSpend,0);
    const totalRecoverable = stopBidding.reduce((s,r)=>s+r.paidSpend,0);
    const genDate = new Date(meta.generatedAt||Date.now()).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});

    const tabs = [
        { id:'overview',     label:'Overview',              icon:'📊', badge:null },
        { id:'stop-bidding', label:'Stop Bidding',          icon:'🛑', badge:stopBidding.length },
        { id:'waste',        label:'Wasted Spend',          icon:'⚠️', badge:wastedSpend.length },
        { id:'opportunities',label:'Missed Opportunities',  icon:'🚀', badge:opportunities.length },
        { id:'campaigns',    label:'Campaigns',             icon:'📈', badge:null },
        { id:'overlap',      label:'Overlap',               icon:'🔁', badge:overlap.length },
        { id:'organic',      label:'Organic SEO',           icon:'🌿', badge:null },
        { id:'ai-insights',  label:'AI Insights',           icon:'🤖', badge:null },
    ];

    const overviewContent = `
    <div class="section-header">
        <span class="section-icon">📊</span>
        <div><div class="section-title">Account Overview</div>
        <div class="section-sub">${meta.startDate} → ${meta.endDate}</div></div>
    </div>
    <div class="kpi-grid">
        <div class="kpi" style="border-left-color:#0f3460"><div class="kpi-label">Total Ad Spend</div><div class="kpi-value">${fmt$(summary.totalSpend)}</div></div>
        <div class="kpi" style="border-left-color:#22c55e"><div class="kpi-label">Total Conversions</div><div class="kpi-value">${fmtN(summary.totalConversions)}</div></div>
        <div class="kpi" style="border-left-color:#3b82f6"><div class="kpi-label">Blended CPA</div><div class="kpi-value">${fmt$(summary.blendedCpa)}</div></div>
        <div class="kpi" style="border-left-color:#f59e0b"><div class="kpi-label">Organic Clicks</div><div class="kpi-value">${fmtN(summary.organicClicks)}</div></div>
        <div class="kpi" style="border-left-color:#ef4444"><div class="kpi-label">Recoverable Spend</div><div class="kpi-value">${fmt$(totalRecoverable)}</div></div>
        <div class="kpi" style="border-left-color:#f97316"><div class="kpi-label">Wasted Spend</div><div class="kpi-value">${fmt$(totalWaste)}</div></div>
        <div class="kpi" style="border-left-color:#8b5cf6"><div class="kpi-label">Overlapping Keywords</div><div class="kpi-value">${fmtN(summary.overlappingKeywords)}</div></div>
        <div class="kpi" style="border-left-color:#06b6d4"><div class="kpi-label">Organic Impressions</div><div class="kpi-value">${fmtN(summary.organicImpressions)}</div></div>
    </div>`;

    const tabContents = {
        'overview':      overviewContent,
        'stop-bidding':  stopBiddingTab(stopBidding),
        'waste':         wastedSpendTab(wastedSpend),
        'opportunities': opportunitiesTab(opportunities),
        'campaigns':     campaignsTab(campaigns, summary),
        'overlap':       overlapTab(overlap),
        'organic':       organicTab(organic||[]),
        'ai-insights':   aiInsightsTab(aiAnalysis),
    };

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(meta.customerName)} — Paid vs. Organic Report</title>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4/dist/chart.umd.min.js"><\/script>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f4f6f9;color:#222;min-height:100vh}
.header{background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:24px 32px;color:#fff;display:flex;align-items:center;justify-content:space-between}
.header h1{font-size:20px;font-weight:800;margin-bottom:4px}
.header p{font-size:12px;opacity:.6}
.tab-bar{background:#fff;border-bottom:1px solid #e5e7eb;padding:0 24px;display:flex;gap:0;overflow-x:auto;position:sticky;top:0;z-index:100;box-shadow:0 1px 4px rgba(0,0,0,0.06)}
.tab-btn{padding:14px 18px;font-size:13px;font-weight:600;color:#666;cursor:pointer;border:none;background:none;border-bottom:3px solid transparent;white-space:nowrap;display:flex;align-items:center;gap:6px;transition:color .15s}
.tab-btn:hover{color:#0f3460}
.tab-btn.active{color:#0f3460;border-bottom-color:#0f3460}
.tab-badge{font-size:10px;font-weight:700;border-radius:10px;padding:1px 6px}
.badge-danger{background:#fee2e2;color:#991b1b}
.badge-warning{background:#fef3cd;color:#92400e}
.badge-default{background:#e8f0fe;color:#0f3460}
.tab-panel{display:none;padding:24px 32px}
.tab-panel.active{display:block}
table{width:100%;border-collapse:collapse;font-size:12px}
th{background:#f8f9fb;color:#555;font-weight:700;text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid #f0f0f0;color:#333;vertical-align:middle}
tr:hover td{background:#fafafa}
.section-header{display:flex;align-items:flex-start;gap:12px;margin-bottom:20px}
.section-icon{font-size:24px;line-height:1}
.section-title{font-size:16px;font-weight:800;color:#1a1a2e;margin-bottom:2px}
.section-sub{font-size:12px;color:#888}
.kpi-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:8px}
.kpi{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 1px 4px rgba(0,0,0,0.07);border-left:4px solid #0f3460}
.kpi-label{font-size:10px;font-weight:700;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px}
.kpi-value{font-size:22px;font-weight:800;color:#1a1a2e}
.chart-row{display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;margin-top:4px}
@media(max-width:700px){.chart-row{grid-template-columns:1fr}}
.chart-box{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 4px rgba(0,0,0,0.07)}
.chart-title{font-size:12px;font-weight:700;color:#1a1a2e;margin-bottom:12px}
</style>
</head>
<body>

<div class="header">
    <div>
        <h1>${esc(meta.customerName)} — Paid vs. Organic Cross-Analysis</h1>
        <p>${esc(meta.siteUrl)} &nbsp;·&nbsp; ${meta.startDate} → ${meta.endDate} &nbsp;·&nbsp; Generated ${genDate}</p>
    </div>
</div>

<div class="tab-bar">
${tabs.map(t => {
    const badgeClass = t.id==='stop-bidding'||t.id==='waste' ? 'badge-danger' : t.id==='opportunities' ? 'badge-warning' : 'badge-default';
    const badge = t.badge != null ? `<span class="tab-badge ${badgeClass}">${t.badge}</span>` : '';
    return `    <button class="tab-btn${t.id==='overview'?' active':''}" data-tab="${t.id}">${t.icon} ${t.label}${badge}</button>`;
}).join('\n')}
</div>

${tabs.map(t => `
<div class="tab-panel${t.id==='overview'?' active':''}" id="panel-${t.id}">
${tabContents[t.id]}
</div>`).join('')}

<script>
(function(){
    var initialized = {};

    function initChartsInPanel(panelId) {
        if (initialized[panelId]) return;
        initialized[panelId] = true;
        var panel = document.getElementById('panel-' + panelId);
        if (!panel) return;
        panel.querySelectorAll('canvas[data-chartcfg]').forEach(function(canvas) {
            try {
                var cfg = JSON.parse(canvas.getAttribute('data-chartcfg'));
                // Resolve tick callback shorthands
                if (cfg.options && cfg.options.scales) {
                    Object.values(cfg.options.scales).forEach(function(axis) {
                        if (axis.ticks && typeof axis.ticks.callback === 'string') {
                            var tmpl = axis.ticks.callback;
                            axis.ticks.callback = function(v) {
                                return tmpl.replace('$v','$'+v).replace('v%',v+'%');
                            };
                        }
                    });
                }
                new Chart(canvas, cfg);
            } catch(e) { console.warn('Chart init error', e); }
        });
    }

    // Init overview charts on load
    initChartsInPanel('overview');

    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(function(btn) {
        btn.addEventListener('click', function() {
            var tabId = this.getAttribute('data-tab');
            document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.remove('active'); });
            document.querySelectorAll('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
            this.classList.add('active');
            var panel = document.getElementById('panel-' + tabId);
            if (panel) {
                panel.classList.add('active');
                initChartsInPanel(tabId);
            }
        });
    });
})();
<\/script>
</body>
</html>`;
}

export function downloadReportAsHtml(data, aiAnalysis) {
    const html = generateReportHtml(data, aiAnalysis);
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const name = (data.meta?.customerName || 'report').replace(/[^a-z0-9]/gi, '-').toLowerCase();
    const date = (data.meta?.endDate || '').replaceAll('-', '');
    a.href     = url;
    a.download = `${name}-paid-vs-organic-${date}.html`;
    a.click();
    URL.revokeObjectURL(url);
}
