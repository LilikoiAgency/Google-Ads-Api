"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { downloadReportAsHtml } from "../../../lib/reportHtml";
import Link from "next/link";
import "../../globals.css";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import {
  BarChart as ReBarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, PieChart, Pie, Cell, ResponsiveContainer, Sector,
} from "recharts";

// ─── module-level cache — survives "New Report" clicks and soft navigations ──
const _cache = { customers: null, gscStatus: null };

// ─── formatters ──────────────────────────────────────────────────────────────

function fmt$(n) {
  if (n == null) return "—";
  return "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtN(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US");
}
function fmtPct(n) {
  if (n == null) return "—";
  return Number(n).toFixed(2) + "%";
}

// ─── KPI card ────────────────────────────────────────────────────────────────

const KPI_COLORS = {
  blue:   "#0f3460",
  green:  "#27ae60",
  orange: "#e67e22",
  red:    "#e74c3c",
  purple: "#8e44ad",
  teal:   "#16a085",
};

function KpiCard({ label, value, sub, color = "blue" }) {
  return (
    <div style={{ borderLeft: `4px solid ${KPI_COLORS[color]}`, background: "#fff", borderRadius: 12, padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#888", marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: "#999", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

// ─── alert banner ────────────────────────────────────────────────────────────

const ALERT_STYLES = {
  red:   { background: "#fde8e8", border: "1px solid #f5c6c6", color: "#7b1c1c" },
  amber: { background: "#fef3cd", border: "1px solid #f5e09f", color: "#6d4c00" },
  green: { background: "#e6f9f0", border: "1px solid #b2e8cf", color: "#0d4f2f" },
  blue:  { background: "#e8f0fe", border: "1px solid #aec6fb", color: "#0c3473" },
};

function Alert({ type = "blue", icon, title, body }) {
  return (
    <div style={{ ...ALERT_STYLES[type], borderRadius: 10, padding: "14px 18px", marginBottom: 20, fontSize: 13, display: "flex", alignItems: "flex-start", gap: 12 }}>
      <span style={{ fontSize: 18, lineHeight: 1.2 }}>{icon}</span>
      <div>
        {title && <strong style={{ display: "block", marginBottom: 3 }}>{title}</strong>}
        {body}
      </div>
    </div>
  );
}

// ─── insight box ─────────────────────────────────────────────────────────────

const INSIGHT_COLORS = {
  blue:  { border: "#0f3460", heading: "#0f3460" },
  red:   { border: "#e74c3c", heading: "#c0392b" },
  green: { border: "#27ae60", heading: "#1a7a4a" },
  amber: { border: "#f39c12", heading: "#8a6d00" },
};

function InsightBox({ type = "blue", title, body }) {
  const c = INSIGHT_COLORS[type];
  return (
    <div style={{ background: "#fff", borderRadius: 10, padding: "16px 18px", borderLeft: `4px solid ${c.border}`, marginBottom: 12, boxShadow: "0 1px 4px rgba(0,0,0,0.06)" }}>
      <p style={{ fontSize: 13, fontWeight: 700, marginBottom: 6, color: c.heading }}>{title}</p>
      <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{body}</p>
    </div>
  );
}

// ─── chip / badge ─────────────────────────────────────────────────────────────

const CHIP_STYLES = {
  green:  { background: "#e6f9f0", color: "#1a7a4a" },
  amber:  { background: "#fef3cd", color: "#7d5a00" },
  red:    { background: "#fde8e8", color: "#c0392b" },
  blue:   { background: "#e8f0fe", color: "#0c3473" },
  gray:   { background: "#f0f2f5", color: "#555" },
  purple: { background: "#f3e8fe", color: "#6b21a8" },
};

function Chip({ type = "gray", children }) {
  return (
    <span style={{ ...CHIP_STYLES[type], display: "inline-block", padding: "2px 8px", borderRadius: 10, fontSize: 11, fontWeight: 700 }}>
      {children}
    </span>
  );
}

function cpaBadgeType(rating) {
  if (rating === "Good") return "green";
  if (rating === "Average") return "amber";
  if (rating === "Poor") return "red";
  return "gray";
}

function priorityBadgeType(p) {
  if (p === "High") return "red";
  if (p === "Medium") return "amber";
  return "gray";
}

function signalBadgeType(signal) {
  if (signal?.startsWith("Stop")) return "red";
  if (signal?.startsWith("Monitor")) return "amber";
  return "blue";
}

function posBadgeType(pos) {
  if (pos <= 3) return "green";
  if (pos <= 10) return "amber";
  return "gray";
}

// ─── sortable table ───────────────────────────────────────────────────────────

function SortableTable({ columns, rows, filterPlaceholder, footer }) {
  const [filter, setFilter] = useState("");
  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("desc");

  const handleSort = (idx) => {
    if (sortCol === idx) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortCol(idx); setSortDir("desc"); }
  };

  let visible = rows;
  if (filter) {
    const lower = filter.toLowerCase();
    visible = rows.filter((row) =>
      row.some((cell) => String(cell ?? "").toLowerCase().includes(lower))
    );
  }
  if (sortCol !== null) {
    visible = [...visible].sort((a, b) => {
      const av = a[sortCol], bv = b[sortCol];
      const an = parseFloat(String(av ?? "").replace(/[$,%]/g, ""));
      const bn = parseFloat(String(bv ?? "").replace(/[$,%]/g, ""));
      const cmp = isNaN(an) || isNaN(bn)
        ? String(av ?? "").localeCompare(String(bv ?? ""))
        : an - bn;
      return sortDir === "asc" ? cmp : -cmp;
    });
  }

  return (
    <div>
      {filterPlaceholder && (
        <input
          style={{ padding: "7px 12px", border: "1px solid #e0e4ea", borderRadius: 8, fontSize: 13, width: 220, outline: "none", marginBottom: 12 }}
          placeholder={filterPlaceholder}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div style={{ maxHeight: 480, overflowY: "auto", overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  onClick={() => handleSort(i)}
                  style={{ background: "#f8f9fb", padding: "10px 12px", textAlign: "left", fontWeight: 700, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.6px", color: "#666", borderBottom: "2px solid #e8eaed", cursor: "pointer", whiteSpace: "nowrap" }}
                >
                  {col}{sortCol === i ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr><td colSpan={columns.length} style={{ padding: "24px", textAlign: "center", color: "#aaa" }}>No data</td></tr>
            ) : (
              visible.map((row, ri) => (
                <tr key={ri} style={{ borderBottom: "1px solid #f0f2f5" }}
                  onMouseEnter={e => e.currentTarget.style.background = "#f8f9fb"}
                  onMouseLeave={e => e.currentTarget.style.background = ""}
                >
                  {row.map((cell, ci) => (
                    <td key={ci} style={{ padding: "10px 12px", color: "#333", whiteSpace: "nowrap" }}>{cell}</td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {footer && <p style={{ fontSize: 12, color: "#888", marginTop: 10, textAlign: "right" }}>{footer}</p>}
    </div>
  );
}

// ─── table card wrapper ───────────────────────────────────────────────────────

function TableCard({ title, sub, children }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 20 }}>
      <div style={{ marginBottom: 14 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e" }}>{title}</p>
        {sub && <p style={{ fontSize: 12, color: "#888", marginTop: 2 }}>{sub}</p>}
      </div>
      {children}
    </div>
  );
}

// ─── chart palette ────────────────────────────────────────────────────────────

const CHART_COLORS = ["#0f3460","#27ae60","#e67e22","#8e44ad","#16a085","#e74c3c","#2980b9","#f39c12","#1abc9c","#d35400"];

const CustomTooltip = ({ active, payload, label, fmt }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: "#fff", border: "1px solid #e0e4ea", borderRadius: 8, padding: "10px 14px", fontSize: 12, boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}>
      {label && <p style={{ fontWeight: 700, marginBottom: 4, color: "#333" }}>{label}</p>}
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color || "#333" }}>{p.name}: <strong>{fmt ? fmt(p.value) : p.value}</strong></p>
      ))}
    </div>
  );
};

// Horizontal bar chart — campaign spend / CPA
function HBarChart({ data, valueKey, labelKey, colorFn, formatFn, height = 320 }) {
  const sliced = data.slice(0, 15).map(d => ({ ...d, _label: (d[labelKey] || "").slice(0, 28) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={sliced} layout="vertical" margin={{ left: 8, right: 40, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f0f2f5" />
        <XAxis type="number" tickFormatter={formatFn} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="_label" width={180} tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip fmt={formatFn} />} />
        <Bar dataKey={valueKey} radius={[0, 4, 4, 0]}>
          {sliced.map((d, i) => <Cell key={i} fill={colorFn ? colorFn(d) : CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Bar>
      </ReBarChart>
    </ResponsiveContainer>
  );
}

// Vertical grouped bar chart — spend vs conversions share
function GroupedBarChart({ data, keys, colors, formatFns, height = 300 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ReBarChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 60 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} />
        <YAxis tickFormatter={v => v + "%"} tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip fmt={v => v.toFixed(1) + "%"} />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {keys.map((k, i) => <Bar key={k} dataKey={k} fill={colors[i]} radius={[4,4,0,0]} />)}
      </ReBarChart>
    </ResponsiveContainer>
  );
}

// Line chart — organic traffic trend
function TrendLineChart({ data, height = 240 }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ left: 8, right: 8, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f2f5" />
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={v => v.slice(5)} interval="preserveStartEnd" />
        <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
        <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
        <Tooltip content={<CustomTooltip />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line yAxisId="left" type="monotone" dataKey="clicks" stroke="#0f3460" strokeWidth={2} dot={false} name="Clicks" />
        <Line yAxisId="right" type="monotone" dataKey="impressions" stroke="#16a085" strokeWidth={2} dot={false} name="Impressions" />
      </LineChart>
    </ResponsiveContainer>
  );
}

// Donut / pie chart
function DonutChart({ data, height = 300 }) {
  const [active, setActive] = useState(null);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          cx="50%" cy="50%"
          innerRadius="55%" outerRadius="80%"
          dataKey="value"
          nameKey="name"
          activeIndex={active}
          onMouseEnter={(_, i) => setActive(i)}
          onMouseLeave={() => setActive(null)}
        >
          {data.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
        </Pie>
        <Tooltip formatter={(v, n) => [fmtN(v), n]} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// ─── section title ────────────────────────────────────────────────────────────

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "28px 0 16px", fontSize: 16, fontWeight: 800, color: "#1a1a2e" }}>
      {children}
      <div style={{ flex: 1, height: 1, background: "#e8eaed" }} />
    </div>
  );
}

// ─── chart card ───────────────────────────────────────────────────────────────

function ChartCard({ title, sub, children, full }) {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: 20, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", gridColumn: full ? "1 / -1" : undefined }}>
      <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>{title}</p>
      {sub && <p style={{ fontSize: 12, color: "#888", marginBottom: 16 }}>{sub}</p>}
      {children}
    </div>
  );
}

// ─── tab content components ───────────────────────────────────────────────────

function TabOverview({ data }) {
  const { summary, campaigns, stopBidding, wastedSpend, opportunities, gscTrend } = data;
  const best  = campaigns.filter(c => c.cpa !== null).sort((a, b) => a.cpa - b.cpa)[0];
  const worst = campaigns.filter(c => c.cpa !== null).sort((a, b) => b.cpa - a.cpa)[0];

  // Spend vs Conversion Share — top 8 campaigns
  const totalSpend = campaigns.reduce((s, c) => s + c.cost, 0) || 1;
  const totalConv  = campaigns.reduce((s, c) => s + c.conversions, 0) || 1;
  const spendVsConv = campaigns.slice(0, 8).map(c => ({
    name: c.name.slice(0, 22),
    "Spend %":       parseFloat(((c.cost / totalSpend) * 100).toFixed(1)),
    "Conversion %":  parseFloat(((c.conversions / totalConv) * 100).toFixed(1)),
  }));

  // Budget breakdown donut
  const goodSpend   = campaigns.filter(c => c.cpaRating === "Good").reduce((s, c) => s + c.cost, 0);
  const avgSpend    = campaigns.filter(c => c.cpaRating === "Average").reduce((s, c) => s + c.cost, 0);
  const poorSpend   = campaigns.filter(c => c.cpaRating === "Poor").reduce((s, c) => s + c.cost, 0);
  const naSpend     = campaigns.filter(c => c.cpaRating === "N/A").reduce((s, c) => s + c.cost, 0);
  const budgetDonut = [
    { name: "Good CPA",    value: Math.round(goodSpend) },
    { name: "Average CPA", value: Math.round(avgSpend) },
    { name: "Poor CPA",    value: Math.round(poorSpend) },
    { name: "No Convs.",   value: Math.round(naSpend) },
  ].filter(d => d.value > 0);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 16, marginBottom: 28 }}>
        <KpiCard label="Google Ads Spend"       value={fmt$(summary.totalSpend)}          sub="Selected period"                                  color="blue" />
        <KpiCard label="Total Conversions"       value={fmtN(summary.totalConversions)}    sub="Google Ads paid"                                  color="green" />
        <KpiCard label="Blended CPA"             value={fmt$(summary.blendedCpa)}          sub="Across all campaigns"                             color="orange" />
        <KpiCard label="Organic Clicks (GSC)"    value={fmtN(summary.organicClicks)}       sub={fmtN(summary.organicImpressions) + " impressions"} color="teal" />
        <KpiCard label="Overlapping Keywords"    value={fmtN(summary.overlappingKeywords)} sub="In both paid & organic"                           color="purple" />
        <KpiCard label="Recoverable Spend"       value={fmt$(summary.recoverableSpend)}    sub="Stop bidding + waste"                             color="red" />
      </div>

      {/* Row 1: Spend by campaign + Budget by CPA rating */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20, marginBottom: 20 }}>
        <ChartCard title="Spend by Campaign" sub="Top 15 campaigns by total spend">
          <HBarChart data={[...campaigns].sort((a,b) => b.cost - a.cost)} valueKey="cost" labelKey="name" formatFn={fmt$} colorFn={() => "#0f3460"} />
        </ChartCard>
        <ChartCard title="Budget by CPA Rating" sub="How spend is distributed across efficiency tiers">
          <DonutChart data={budgetDonut} />
        </ChartCard>
      </div>

      {/* Row 2: Spend vs Conversion Share */}
      <ChartCard title="Spend vs. Conversion Share" sub="Where money goes vs. where results come from — top 8 campaigns by spend">
        <GroupedBarChart
          data={spendVsConv}
          keys={["Spend %", "Conversion %"]}
          colors={["#0f3460", "#27ae60"]}
          height={300}
        />
      </ChartCard>

      {/* Row 3: Organic Traffic Trend */}
      {gscTrend?.length > 0 && (
        <ChartCard title="Organic Traffic Trend (GSC)" sub="Daily clicks & impressions from Google Search Console">
          <TrendLineChart data={gscTrend} height={220} />
        </ChartCard>
      )}

      <SectionTitle>Key Findings</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 14 }}>
        {stopBidding.length > 0 && (
          <InsightBox type="red" title="🛑 Stop Bidding Candidates"
            body={`${stopBidding.length} keywords rank organically in the top 5 positions but are still receiving paid spend — ${fmt$(stopBidding.reduce((s, r) => s + r.paidSpend, 0))} potentially recoverable. Top: "${stopBidding[0]?.keyword}" (pos ${stopBidding[0]?.organicPosition}).`} />
        )}
        {wastedSpend.length > 0 && (
          <InsightBox type="amber" title="💸 Zero-Conversion Spend"
            body={`${wastedSpend.length} paid keywords have ${fmt$(wastedSpend.reduce((s, r) => s + r.paidSpend, 0))} in spend with zero conversions. Top offender: "${wastedSpend[0]?.keyword}" (${fmt$(wastedSpend[0]?.paidSpend)}).`} />
        )}
        {opportunities?.length > 0 && (
          <InsightBox type="green" title="🚀 Missed Opportunities"
            body={`${opportunities.length} organic keywords have no paid coverage. Top: "${opportunities[0]?.keyword}" (pos ${opportunities[0]?.organicPosition}, ${fmtN(opportunities[0]?.organicImpressions)} impressions).`} />
        )}
        {best && (
          <InsightBox type="green" title="✅ Best Performing Campaign"
            body={`"${best.name}" delivers the best CPA at ${fmt$(best.cpa)} with ${fmtN(best.conversions)} conversions. Consider scaling budget here.`} />
        )}
        {worst && worst.name !== best?.name && (
          <InsightBox type="red" title="🔴 Highest CPA Campaign"
            body={`"${worst.name}" averages ${fmt$(worst.cpa)} CPA — ${summary.blendedCpa ? Math.round(worst.cpa / summary.blendedCpa) + "x" : ""} the account median. Warrants immediate review or pause.`} />
        )}
      </div>
    </div>
  );
}

function TabStopBidding({ rows }) {
  const tableRows = rows.map((r) => [
    r.keyword,
    <Chip key="pos" type={posBadgeType(r.organicPosition)}>{r.organicPosition}</Chip>,
    fmtN(r.organicImpressions),
    fmt$(r.paidSpend),
    fmtN(r.paidClicks),
    fmtN(r.paidConversions),
    r.paidCpa != null ? fmt$(r.paidCpa) : "—",
    <Chip key="rec" type="red">{r.recommendation}</Chip>,
  ]);
  return (
    <div>
      <Alert type="red" icon="🛑"
        title={`Stop Bidding Candidates — ${fmt$(rows.reduce((s,r)=>s+r.paidSpend,0))} in Potentially Redundant Spend`}
        body={`These ${rows.length} keywords rank organically in positions 1–5 on Google yet are still being bid on in paid search. Since you already appear prominently in organic results, paid spend here offers diminishing returns.`} />
      <TableCard title="🛑 Keywords — Organic Top 5, Still Bidding on Paid" sub="Sorted by paid spend. Consider pausing or reducing bids, especially on branded terms.">
        <SortableTable
          columns={["Keyword","Organic Pos.","Organic Impr.","Paid Spend","Paid Clicks","Paid Convs.","Paid CPA","Recommendation"]}
          rows={tableRows}
          filterPlaceholder="Search keywords..."
          footer={`Showing all ${rows.length} keywords · Total: ${fmt$(rows.reduce((s,r)=>s+r.paidSpend,0))}`}
        />
      </TableCard>
    </div>
  );
}

function TabWastedSpend({ rows }) {
  const tableRows = rows.slice(0, 100).map((r) => [
    r.keyword,
    fmt$(r.paidSpend),
    fmtN(r.paidClicks),
    r.campaignName,
    <Chip key="a" type="red">Pause / Negative</Chip>,
  ]);
  return (
    <div>
      <Alert type="red" icon="💸"
        title={`Zero-Conversion Paid Keywords — ${fmt$(rows.reduce((s,r)=>s+r.paidSpend,0))} Spent, 0 Results`}
        body={`These ${rows.length} keywords have accumulated spend with no recorded conversions. Recommendation: pause or add as negatives immediately, then audit match types.`} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20, marginBottom: 20 }}>
        <ChartCard title="Wasted Spend by Campaign" sub="Which campaigns are driving the most zero-conversion spend">
          <DonutChart data={Object.entries(rows.reduce((acc, r) => { acc[r.campaignName] = (acc[r.campaignName] || 0) + r.paidSpend; return acc; }, {}))
            .map(([name, value]) => ({ name: name.slice(0,30), value: Math.round(value) }))
            .sort((a,b) => b.value - a.value).slice(0, 8)} />
        </ChartCard>
        <ChartCard title="Top Zero-Conversion Keywords by Spend" sub="Biggest individual offenders">
          <HBarChart data={rows.slice(0,15)} valueKey="paidSpend" labelKey="keyword" formatFn={fmt$} colorFn={() => "#e74c3c"} height={320} />
        </ChartCard>
      </div>

      <TableCard title="⚠️ Paid Keywords with Zero Conversions" sub="Sorted by spend — immediate candidates for pause or negative keyword addition.">
        <SortableTable
          columns={["Keyword","Paid Spend","Paid Clicks","Campaign","Action"]}
          rows={tableRows}
          filterPlaceholder="Search keywords..."
          footer={`Showing top 100 of ${rows.length} zero-conversion keywords · Total: ${fmt$(rows.reduce((s,r)=>s+r.paidSpend,0))}`}
        />
      </TableCard>
    </div>
  );
}

function TabOpportunities({ rows }) {
  const tableRows = rows.slice(0, 100).map((r) => [
    r.keyword,
    <Chip key="pos" type={posBadgeType(r.organicPosition)}>{r.organicPosition}</Chip>,
    fmtN(r.organicImpressions),
    fmtN(r.organicClicks),
    fmtPct(r.organicCtr),
    <Chip key="p" type={priorityBadgeType(r.priority)}>{r.priority}</Chip>,
  ]);
  return (
    <div>
      <Alert type="green" icon="🚀"
        title={`Missed Paid Search Opportunities — ${rows.length} Organic Keywords with No Paid Coverage`}
        body="These terms generate organic impressions but have no corresponding paid keyword bids. High-volume, lower-position terms are prime candidates to add to paid campaigns." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px,1fr))", gap: 14, marginBottom: 20 }}>
        <InsightBox type="green" title="🔥 Priority 1 — High Volume, Decent Organic Rank"
          body={rows.filter(r=>r.priority==="High").slice(0,3).map(r=>`"${r.keyword}" (pos ${r.organicPosition}, ${fmtN(r.organicImpressions)} impr)`).join(" · ") || "No high-priority keywords."} />
        <InsightBox type="amber" title="📌 Priority 2 — Medium Volume / Local Intent"
          body={rows.filter(r=>r.priority==="Medium").slice(0,3).map(r=>`"${r.keyword}" (pos ${r.organicPosition})`).join(" · ") || "No medium-priority keywords."} />
        <InsightBox type="blue" title="ℹ️ Priority 3 — Lower Volume, Still Worth Testing"
          body={rows.filter(r=>r.priority==="Low").slice(0,3).map(r=>`"${r.keyword}" (pos ${r.organicPosition})`).join(" · ") || "No low-priority keywords."} />
      </div>
      <TableCard title="🚀 Organic Keywords with No Paid Presence" sub="Organically visible but no paid coverage. Sorted by organic impressions.">
        <SortableTable
          columns={["Keyword","Organic Position","Organic Impressions","Organic Clicks","Organic CTR","Priority"]}
          rows={tableRows}
          filterPlaceholder="Search keywords..."
          footer={`Showing top 100 of ${rows.length} keywords`}
        />
      </TableCard>
    </div>
  );
}

function TabOverlap({ rows }) {
  const tableRows = rows.slice(0, 100).map((r) => [
    r.keyword,
    <Chip key="pos" type={posBadgeType(r.organicPosition)}>{r.organicPosition}</Chip>,
    fmtN(r.organicImpressions),
    fmtN(r.organicClicks),
    fmt$(r.paidSpend),
    fmtN(r.paidConversions),
    r.paidCpa != null ? fmt$(r.paidCpa) : "—",
    <Chip key="sig" type={signalBadgeType(r.signal)}>{r.signal}</Chip>,
  ]);
  return (
    <div>
      <Alert type="blue" icon="🔁"
        title={`${rows.length} Keywords Appear in Both Paid Ads and Organic Search`}
        body="Keywords with strong organic positions (1–5) and high paid spend are your best stop-bidding candidates. Keywords with weak organic positions (10+) and high paid spend are justified paid investments." />
      <TableCard title="🔁 Keyword Overlap — Paid & Organic Combined View" sub="Color-coded by organic position: Green = pos 1–5 | Yellow = pos 6–10 | Gray = pos 10+">
        <SortableTable
          columns={["Keyword","Organic Pos.","Organic Impr.","Organic Clicks","Paid Spend","Paid Convs.","Paid CPA","Signal"]}
          rows={tableRows}
          filterPlaceholder="Search keywords..."
          footer={`Showing top 100 of ${rows.length} overlapping keywords`}
        />
      </TableCard>
    </div>
  );
}

function TabCampaigns({ campaigns, summary }) {
  const best  = campaigns.filter(c => c.cpa !== null).sort((a, b) => a.cpa - b.cpa)[0];
  const worst = campaigns.filter(c => c.cpa !== null).sort((a, b) => b.cpa - a.cpa)[0];
  const tableRows = campaigns.map((c) => [
    c.name,
    fmt$(c.cost),
    fmtN(c.clicks),
    fmtN(c.impressions),
    fmtPct(c.ctr),
    fmtN(c.conversions),
    c.cpa != null ? fmt$(c.cpa) : "—",
    <Chip key="r" type={cpaBadgeType(c.cpaRating)}>{c.cpaRating}</Chip>,
  ]);
  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 16, marginBottom: 24 }}>
        <KpiCard label="Active Campaigns"     value={fmtN(campaigns.length)}    sub="With spend"        color="blue" />
        <KpiCard label="Best CPA Campaign"    value={fmt$(best?.cpa)}           sub={best?.name}        color="green" />
        <KpiCard label="Worst CPA Campaign"   value={fmt$(worst?.cpa)}          sub={worst?.name}       color="red" />
        <KpiCard label="Account Median CPA"   value={fmt$(summary.blendedCpa)}  sub="Blended across all" color="orange" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20, marginBottom: 24 }}>
        <ChartCard title="CPA by Campaign" sub={`Color-coded vs. account median (${fmt$(summary.blendedCpa)}) — Green = efficient · Yellow = average · Red = poor`}>
          <HBarChart
            data={campaigns.filter(c => c.cpa !== null).sort((a, b) => a.cpa - b.cpa)}
            valueKey="cpa" labelKey="name" formatFn={fmt$}
            colorFn={(d) => d.cpaRating === "Good" ? "#27ae60" : d.cpaRating === "Poor" ? "#e74c3c" : "#f39c12"}
          />
        </ChartCard>
        <ChartCard title="Spend vs. Conversions by Campaign" sub="Top 8 campaigns — spend share vs conversion share">
          <GroupedBarChart
            data={campaigns.slice(0,8).map(c => ({
              name: c.name.slice(0,20),
              "Spend %":      parseFloat(((c.cost / (campaigns.reduce((s,x)=>s+x.cost,0)||1)) * 100).toFixed(1)),
              "Conversion %": parseFloat(((c.conversions / (campaigns.reduce((s,x)=>s+x.conversions,0)||1)) * 100).toFixed(1)),
            }))}
            keys={["Spend %", "Conversion %"]}
            colors={["#0f3460", "#27ae60"]}
            height={320}
          />
        </ChartCard>
      </div>
      <TableCard title="📈 Campaign Performance Table" sub="Click column headers to sort">
        <SortableTable
          columns={["Campaign","Spend","Clicks","Impressions","CTR","Conversions","CPA","CPA Rating"]}
          rows={tableRows}
          filterPlaceholder="Search campaigns..."
        />
      </TableCard>
    </div>
  );
}

function TabOrganic({ rows, summary, gscPages }) {
  const top10 = rows.filter(r => r.position <= 10).length;

  // Position distribution donut
  const posDist = [
    { name: "Top 3",   value: rows.filter(r => r.position <= 3).length },
    { name: "4–10",    value: rows.filter(r => r.position > 3  && r.position <= 10).length },
    { name: "11–20",   value: rows.filter(r => r.position > 10 && r.position <= 20).length },
    { name: "21–50",   value: rows.filter(r => r.position > 20 && r.position <= 50).length },
    { name: "50+",     value: rows.filter(r => r.position > 50).length },
  ].filter(d => d.value > 0);
  const tableRows = rows.slice(0, 200).map((r) => [
    r.query,
    <Chip key="pos" type={posBadgeType(r.position)}>{r.position}</Chip>,
    fmtN(r.impressions),
    fmtN(r.clicks),
    fmtPct(r.ctr),
    r.inPaid
      ? <Chip key="p" type="blue">Yes</Chip>
      : <Chip key="p" type="gray">No</Chip>,
  ]);
  return (
    <div>
      <Alert type="blue" icon="🌿"
        title="Google Search Console — Organic SEO Performance"
        body="GSC data for the selected date range. Position is impression-weighted average. Green = pos 1–3 · Yellow = pos 4–10 · Gray = pos 10+" />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px,1fr))", gap: 16, marginBottom: 24 }}>
        <KpiCard label="Total Organic Clicks"    value={fmtN(summary.organicClicks)}      sub="Selected period"        color="teal" />
        <KpiCard label="Total Impressions"        value={fmtN(summary.organicImpressions)} sub="Times shown in results"  color="teal" />
        <KpiCard label="Avg. Organic CTR"
          value={summary.organicImpressions ? fmtPct((summary.organicClicks / summary.organicImpressions) * 100) : "—"}
          sub="Impressions → Clicks" color="orange" />
        <KpiCard label="Keywords Ranking Top 10"  value={fmtN(top10)}                      sub="GSC position ≤ 10"      color="green" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))", gap: 20, marginBottom: 24 }}>
        {gscPages?.length > 0 && (
          <ChartCard title="Top Organic Pages by Clicks" sub="Best-performing landing pages from organic search">
            <HBarChart data={gscPages.slice(0,15)} valueKey="clicks" labelKey="page" formatFn={fmtN} colorFn={() => "#16a085"} height={360} />
          </ChartCard>
        )}
        <ChartCard title="Organic Position Distribution" sub="How many keywords fall into each ranking bucket">
          <DonutChart data={posDist} height={360} />
        </ChartCard>
      </div>

      <TableCard title="🌿 Top Organic Queries (GSC)" sub="Sorted by clicks — showing top 200">
        <SortableTable
          columns={["Query","Position","Impressions","Clicks","CTR","In Paid Ads?"]}
          rows={tableRows}
          filterPlaceholder="Search queries..."
          footer={`Showing top 200 of ${rows.length} organic queries`}
        />
      </TableCard>
    </div>
  );
}

// ─── AI insights tab ─────────────────────────────────────────────────────────

const AI_SECTION_META = {
  "Executive Summary":            { icon: "📋", color: "#0f3460", bg: "#f0f4ff" },
  "Top 3 Priority Actions":       { icon: "🎯", color: "#7b2d8b", bg: "#fdf4ff" },
  "Quick Wins":                   { icon: "⚡", color: "#b45309", bg: "#fffbeb" },
  "Strategic Recommendations":    { icon: "🗺️", color: "#065f46", bg: "#f0fdf4" },
  "Risks to Watch":               { icon: "⚠️", color: "#991b1b", bg: "#fff5f5" },
};

function parseAnalysisSections(text) {
  const sections = [];
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: line.replace('## ', '').trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// Renders inline markdown: **bold**, *italic*, `code`
function inlineMd(text) {
  const pattern = /(\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`)/g;
  const parts = [];
  let last = 0, key = 0, m;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2]) parts.push(<strong key={key++}>{m[2]}</strong>);
    else if (m[3]) parts.push(<em key={key++}>{m[3]}</em>);
    else if (m[4]) parts.push(<code key={key++} style={{ background: "#f0f0f0", padding: "1px 5px", borderRadius: 3, fontSize: "0.88em", fontFamily: "monospace" }}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 0 ? text : parts;
}

function AiSection({ title, lines }) {
  const meta = AI_SECTION_META[title] || { icon: "💡", color: "#1a1a2e", bg: "#f8f9fb" };
  return (
    <div style={{ background: meta.bg, borderRadius: 12, padding: "20px 24px", marginBottom: 16, borderLeft: `4px solid ${meta.color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 18 }}>{meta.icon}</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: meta.color }}>{title}</span>
      </div>
      <div>
        {lines.filter(l => l.trim()).map((line, i) => {
          const numbered = line.match(/^(\d+)\.\s+(.*)/s);
          const bulleted  = line.match(/^[-•]\s+(.*)/s);
          if (numbered) {
            return (
              <div key={i} style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
                <span style={{ flexShrink: 0, width: 22, height: 22, borderRadius: "50%", background: meta.color, color: "#fff", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>{numbered[1]}</span>
                <span style={{ fontSize: 13, color: "#333", lineHeight: 1.65 }}>{inlineMd(numbered[2])}</span>
              </div>
            );
          }
          if (bulleted) {
            return (
              <div key={i} style={{ display: "flex", gap: 10, marginBottom: 8, alignItems: "flex-start" }}>
                <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: "50%", background: meta.color, marginTop: 7 }} />
                <span style={{ fontSize: 13, color: "#333", lineHeight: 1.65 }}>{inlineMd(bulleted[1])}</span>
              </div>
            );
          }
          return <p key={i} style={{ fontSize: 13, color: "#444", lineHeight: 1.7, margin: "0 0 6px" }}>{inlineMd(line)}</p>;
        })}
      </div>
    </div>
  );
}

function AiLoadingState() {
  return (
    <div style={{ background: "#fff", borderRadius: 12, padding: "40px 32px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center" }}>
      <style>{`
        @keyframes aiSpin { to { transform: rotate(360deg); } }
        @keyframes aiPulse { 0%,100%{opacity:.3} 50%{opacity:1} }
        @keyframes aiSkimmer { 0%{background-position:200% 0} 100%{background-position:-200% 0} }
      `}</style>
      <div style={{ width: 44, height: 44, border: "3px solid #e0e4ea", borderTopColor: "#1a1a2e", borderRadius: "50%", animation: "aiSpin 0.9s linear infinite", margin: "0 auto 20px" }} />
      <p style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", marginBottom: 6 }}>Claude is analyzing your data…</p>
      <p style={{ fontSize: 13, color: "#888", marginBottom: 28 }}>Reviewing paid + organic signals. Usually takes 10–20 seconds.</p>
      <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 32 }}>
        {["Spend efficiency","Keyword overlap","Wasted budget","Opportunities"].map((label, i) => (
          <span key={label} style={{ fontSize: 11, background: "#f0f4f8", color: "#666", borderRadius: 20, padding: "4px 10px", animation: `aiPulse 1.5s ease-in-out ${i*0.2}s infinite` }}>{label}</span>
        ))}
      </div>
      {[80, 60, 70, 50].map((w, i) => (
        <div key={i} style={{ height: 10, borderRadius: 6, marginBottom: 10, width: `${w}%`, margin: "0 auto 10px",
          background: "linear-gradient(90deg, #f0f4f8 25%, #e4e8ed 50%, #f0f4f8 75%)",
          backgroundSize: "400% 100%", animation: `aiSkimmer 1.4s ease-in-out ${i*0.15}s infinite` }} />
      ))}
    </div>
  );
}

function TabAiInsights({ reportData, onAnalysis }) {
  const [analysis, setAnalysis]     = useState(null);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState(null);
  const [remaining, setRemaining]   = useState(null);

  const runAnalysis = async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch('/api/report/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reportData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Analysis failed');
      setAnalysis(data.analysis);
      setRemaining(data.remainingToday);
      if (onAnalysis) onAnalysis(data.analysis);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  return (
    <div>
      <Alert type="blue" icon="🤖"
        title="AI-Powered Analysis — Claude"
        body="Claude analyzes your paid + organic data and returns prioritized recommendations, quick wins, and strategic insights tailored to this account." />

      {!analysis && !loading && (
        <div style={{ background: "#fff", borderRadius: 12, padding: 32, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", textAlign: "center" }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>🤖</div>
          <p style={{ fontSize: 15, fontWeight: 700, color: "#1a1a2e", marginBottom: 6 }}>Ready to analyze {reportData.meta?.customerName}</p>
          <p style={{ fontSize: 13, color: "#aaa", marginBottom: 24 }}>
            Sends a structured summary to Claude — spend, keywords, organic rankings, and campaign performance.
          </p>
          <button onClick={runAnalysis}
            style={{ background: "#1a1a2e", color: "#fff", border: "none", borderRadius: 10, padding: "12px 28px", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>
            Run AI Analysis
          </button>
        </div>
      )}

      {loading && <AiLoadingState />}

      {error && <Alert type="red" icon="⚠️" title="Analysis failed" body={error} />}

      {analysis && (
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <p style={{ fontSize: 13, color: "#888" }}>Generated by Claude Opus · {reportData.meta?.customerName}</p>
              {remaining !== null && (
                <span style={{ fontSize: 11, fontWeight: 600, background: remaining <= 2 ? "#fef3cd" : "#f0f9ff", color: remaining <= 2 ? "#92400e" : "#0369a1", borderRadius: 20, padding: "2px 10px" }}>
                  {remaining} analysis{remaining !== 1 ? "es" : ""} left today
                </span>
              )}
            </div>
            <button onClick={runAnalysis}
              style={{ background: "none", border: "1px solid #e0e4ea", borderRadius: 8, padding: "6px 14px", fontSize: 12, color: "#666", cursor: "pointer" }}>
              ↺ Regenerate
            </button>
          </div>
          <div>
            {parseAnalysisSections(analysis).map((s, i) => (
              <AiSection key={i} title={s.title} lines={s.lines} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── config form ──────────────────────────────────────────────────────────────

function getFavicon(siteUrl) {
  let domain = siteUrl || "";
  if (domain.startsWith("sc-domain:")) domain = domain.replace("sc-domain:", "");
  else { try { domain = new URL(domain).hostname; } catch(e) {} }
  return `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
}

function Skeleton({ height = 42 }) {
  return (
    <div style={{
      height, borderRadius: 10, width: "100%",
      background: "linear-gradient(90deg, #f0f4f8 25%, #e4e8ed 50%, #f0f4f8 75%)",
      backgroundSize: "400% 100%",
      animation: "cfSkeleton 1.4s ease-in-out infinite",
    }} />
  );
}

function ConfigForm({ onGenerate }) {
  const [customers, setCustomers]           = useState([]);
  const [gscStatus, setGscStatus]           = useState({ connected: false, sites: [] });
  const [loadingCustomers, setLoadingCustomers] = useState(true);
  const [loadingGsc, setLoadingGsc]         = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedSite, setSelectedSite]     = useState("");
  const [selectedPreset, setSelectedPreset] = useState("last30");
  const [startDate, setStartDate]           = useState(() => { const d = new Date(); d.setDate(d.getDate()-29); return d.toISOString().slice(0,10); });
  const [endDate, setEndDate]               = useState(() => new Date().toISOString().slice(0,10));
  const [loading, setLoading]               = useState(false);
  const [error, setError]                   = useState(null);

  useEffect(() => {
    if (_cache.customers) {
      setCustomers(_cache.customers);
      setSelectedCustomer(_cache.customers[0]);
      setLoadingCustomers(false);
    } else {
      fetch("/api/customers").then(r=>r.json()).then(d => {
        if (d.customers?.length) {
          _cache.customers = d.customers;
          setCustomers(d.customers);
          setSelectedCustomer(d.customers[0]);
        }
      }).catch(()=>{}).finally(() => setLoadingCustomers(false));
    }

    if (_cache.gscStatus) {
      setGscStatus(_cache.gscStatus);
      if (_cache.gscStatus.sites?.length) setSelectedSite(_cache.gscStatus.sites[0].url);
      setLoadingGsc(false);
    } else {
      fetch("/api/gsc-sites").then(r=>r.json()).then(d => {
        _cache.gscStatus = d;
        setGscStatus(d);
        if (d.sites?.length) setSelectedSite(d.sites[0].url);
      }).catch(()=>{}).finally(() => setLoadingGsc(false));
    }
  }, []);

  const handleGenerate = async () => {
    if (!selectedCustomer || !selectedSite || !startDate || !endDate) { setError("Please fill in all fields."); return; }
    setError(null); setLoading(true);
    try {
      const res = await fetch("/api/report", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId: selectedCustomer.id, customerName: selectedCustomer.name, startDate, endDate, siteUrl: selectedSite }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Report generation failed");
      onGenerate(data);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const canGenerate = !loading && !loadingGsc && gscStatus.connected;

  return (
    <div style={{ maxWidth: 640, margin: "0 auto" }}>
      <style>{`@keyframes cfSkeleton { 0%{background-position:200% 0} 100%{background-position:-200% 0} }`}</style>
      <div style={{ background: "#fff", borderRadius: 16, padding: 32, boxShadow: "0 1px 4px rgba(0,0,0,0.08)" }}>
        <h2 style={{ fontSize: 18, fontWeight: 800, color: "#1a1a2e", marginBottom: 4 }}>Generate Paid vs. Organic Report</h2>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 28 }}>
          Cross-references Google Ads keyword data with Google Search Console to surface inefficiencies and opportunities.
        </p>

        {/* Google Ads Account */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 }}>
            <img src="https://www.google.com/s2/favicons?domain=ads.google.com&sz=16" width={14} height={14} alt="" style={{ borderRadius: 2 }} />
            Google Ads Account
          </label>
          {loadingCustomers
            ? <Skeleton />
            : <select style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e4ea", fontSize: 13, color: "#333", outline: "none", background: "#fff" }}
                value={selectedCustomer?.id || ""} onChange={e => setSelectedCustomer(customers.find(c=>String(c.id)===e.target.value))}>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>}
        </div>

        {/* Search Console Property */}
        <div style={{ marginBottom: 20 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 }}>
            <img src="https://www.google.com/s2/favicons?domain=search.google.com&sz=16" width={14} height={14} alt="" style={{ borderRadius: 2 }} />
            Search Console Property
          </label>
          {loadingGsc
            ? <Skeleton />
            : !gscStatus.connected
              ? <div style={{ border: "1px dashed #d0d5dd", borderRadius: 10, padding: "14px 16px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <p style={{ fontSize: 13, color: "#888", margin: 0 }}>Search Console not connected yet.</p>
                  <a href="/api/gsc-auth" style={{ flexShrink: 0, background: "#1a1a2e", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 12, fontWeight: 600, textDecoration: "none" }}>
                    Connect ↗
                  </a>
                </div>
              : gscStatus.sites.length === 0
                ? <p style={{ fontSize: 13, color: "#e74c3c" }}>No properties found for this account.</p>
                : <div style={{ position: "relative" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e4ea", background: "#fff", pointerEvents: "none" }}>
                      <img src={getFavicon(selectedSite)} width={16} height={16} alt="" onError={e => e.target.style.display="none"} style={{ borderRadius: 2, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 13, color: "#333", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{selectedSite}</span>
                      <span style={{ color: "#aaa", fontSize: 11, flexShrink: 0 }}>▾</span>
                    </div>
                    <select style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", color: "#333", background: "#fff" }}
                      value={selectedSite} onChange={e => setSelectedSite(e.target.value)}>
                      {gscStatus.sites.map(s => <option key={s.url} value={s.url} style={{ color: "#333", background: "#fff" }}>{s.url}</option>)}
                    </select>
                  </div>}
        </div>

        {/* Date Range */}
        <div style={{ marginBottom: 28 }}>
          <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#444", marginBottom: 8 }}>Date Range</label>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {[
              { key: "last7",  label: "Last 7 Days" },
              { key: "last30", label: "Last 30 Days" },
              { key: "mtd",    label: "MTD" },
              { key: "ytd",    label: "YTD" },
              { key: "custom", label: "Custom" },
            ].map(({ key, label }) => {
              const active = selectedPreset === key;
              return (
                <button key={key} onClick={() => {
                  setSelectedPreset(key);
                  const today = new Date();
                  const fmt = d => d.toISOString().slice(0,10);
                  if (key === "last7")  { const s = new Date(today); s.setDate(today.getDate()-6);  setStartDate(fmt(s)); setEndDate(fmt(today)); }
                  if (key === "last30") { const s = new Date(today); s.setDate(today.getDate()-29); setStartDate(fmt(s)); setEndDate(fmt(today)); }
                  if (key === "mtd")    { setStartDate(fmt(new Date(today.getFullYear(), today.getMonth(), 1))); setEndDate(fmt(today)); }
                  if (key === "ytd")    { setStartDate(fmt(new Date(today.getFullYear(), 0, 1))); setEndDate(fmt(today)); }
                }}
                style={{ padding: "8px 14px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", border: active ? "none" : "1px solid #d0d5dd", background: active ? "#1a1a2e" : "#fff", color: active ? "#fff" : "#555", transition: "all 0.15s" }}>
                  {label}
                </button>
              );
            })}
          </div>
          {selectedPreset === "custom" && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginTop: 12 }}>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>Start Date</label>
                <input type="date" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e4ea", fontSize: 13, color: "#333", outline: "none", boxSizing: "border-box" }}
                  value={startDate} max={endDate} onChange={e => setStartDate(e.target.value)} />
              </div>
              <div>
                <label style={{ display: "block", fontSize: 12, color: "#666", marginBottom: 4 }}>End Date</label>
                <input type="date" style={{ width: "100%", padding: "10px 14px", borderRadius: 10, border: "1px solid #e0e4ea", fontSize: 13, color: "#333", outline: "none", boxSizing: "border-box" }}
                  value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        {error && <div style={{ background: "#fde8e8", color: "#7b1c1c", borderRadius: 10, padding: "12px 16px", fontSize: 13, marginBottom: 16 }}>{error}</div>}

        <button onClick={handleGenerate} disabled={!canGenerate}
          style={{ width: "100%", padding: "14px", borderRadius: 10, background: canGenerate ? "#1a1a2e" : "#c8cdd6", color: "#fff", fontSize: 14, fontWeight: 700, border: "none", cursor: canGenerate ? "pointer" : "not-allowed", transition: "background 0.2s" }}>
          {loading ? "Generating Report..." : "Generate Report"}
        </button>
      </div>
    </div>
  );
}

// ─── report view ──────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",      label: "Overview",               icon: "📊", badgeType: null },
  { id: "stop-bidding",  label: "Stop Bidding",            icon: "🛑", badgeType: "danger" },
  { id: "waste",         label: "Wasted Spend",            icon: "⚠️", badgeType: "warning" },
  { id: "opportunities", label: "Missed Opportunities",    icon: "🚀", badgeType: "success" },
  { id: "overlap",       label: "Paid + Organic Overlap",  icon: "🔁", badgeType: null },
  { id: "campaigns",     label: "Campaigns",               icon: "📈", badgeType: null },
  { id: "organic",       label: "Organic SEO",             icon: "🌿", badgeType: null },
  { id: "ai-insights",   label: "AI Insights",             icon: "🤖", badgeType: null },
];

const TAB_BADGE_STYLES = {
  danger:  { background: "#fde8e8", color: "#c0392b" },
  warning: { background: "#fef3cd", color: "#8a6d00" },
  success: { background: "#e6f9f0", color: "#1a7a4a" },
  default: { background: "#e8f0fe", color: "#0f3460" },
};

function ReportView({ data, onReset }) {
  const [activeTab, setActiveTab] = useState("overview");
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const { meta, summary, campaigns, stopBidding, wastedSpend, opportunities, overlap, organic } = data;

  const tabBadge = {
    "stop-bidding":  stopBidding.length,
    "waste":         wastedSpend.length,
    "opportunities": opportunities.length,
    "overlap":       overlap.length,
  };

  const tabContent = {
    "overview":      <TabOverview data={data} />,
    "stop-bidding":  <TabStopBidding rows={stopBidding} />,
    "waste":         <TabWastedSpend rows={wastedSpend} />,
    "opportunities": <TabOpportunities rows={opportunities} />,
    "overlap":       <TabOverlap rows={overlap} />,
    "campaigns":     <TabCampaigns campaigns={campaigns} summary={summary} />,
    "organic":       <TabOrganic rows={organic} summary={summary} gscPages={data.gscPages} />,
    "ai-insights":   <TabAiInsights reportData={data} onAnalysis={setAiAnalysis} />,
  };

  return (
    <div>
      <style>{PRINT_STYLES}</style>
      {/* Report header — dark gradient */}
      <div style={{ background: "linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)", borderRadius: 16, padding: "24px 32px", marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: -0.5 }}>{meta.customerName} — Paid vs. Organic Cross-Analysis</h1>
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", marginTop: 4 }}>
            {meta.siteUrl} &nbsp;·&nbsp; {meta.startDate} → {meta.endDate} &nbsp;·&nbsp; Lilikoi Agency
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }} className="no-print">
          <button onClick={() => downloadReportAsHtml(data, aiAnalysis)}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>
            ⬇ Download Report
          </button>
          <button onClick={onReset}
            style={{ background: "rgba(255,255,255,0.1)", border: "1px solid rgba(255,255,255,0.2)", borderRadius: 10, padding: "8px 16px", fontSize: 13, fontWeight: 600, color: "#fff", cursor: "pointer" }}>
            ← New Report
          </button>
        </div>
      </div>

      {/* Tab nav */}
      <div className="no-print" style={{ background: "#fff", borderBottom: "1px solid #e0e4ea", padding: "0 16px", display: "flex", gap: 0, overflowX: "auto", marginBottom: 24, borderRadius: "12px 12px 0 0" }}>
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          const count = tabBadge[tab.id];
          const badgeStyle = tab.badgeType ? TAB_BADGE_STYLES[tab.badgeType] : TAB_BADGE_STYLES.default;
          return (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)}
              style={{ padding: "14px 20px", fontSize: 13, fontWeight: 600, color: isActive ? "#0f3460" : "#666", cursor: "pointer", borderBottom: isActive ? "3px solid #0f3460" : "3px solid transparent", background: "none", border: "none", borderBottom: isActive ? "3px solid #0f3460" : "3px solid transparent", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: 6 }}>
              {tab.icon} {tab.label}
              {count != null && (
                <span style={{ ...badgeStyle, borderRadius: 10, padding: "1px 7px", fontSize: 11 }}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* Content — all tabs stay mounted to preserve state (e.g. AI insights) */}
      {TABS.map(tab => (
        <div key={tab.id} data-tab-panel={tab.id} style={{ display: activeTab === tab.id ? "block" : "none" }}>
          {tabContent[tab.id]}
        </div>
      ))}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

const PRINT_STYLES = `
@media print {
  .no-print { display: none !important; }
  /* Show ALL tab panels when printing */
  [data-tab-panel] { display: block !important; }
  /* Clean page breaks between sections */
  [data-tab-panel] { page-break-before: always; }
  [data-tab-panel]:first-child { page-break-before: avoid; }
  body { background: #fff !important; }
}
`;

function ReportPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { status } = useSession();
  const [reportData, setReportData] = useState(null);
  const [gscNotice, setGscNotice] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/report");
  }, [status, router]);

  useEffect(() => {
    const connected = searchParams.get("gsc_connected");
    const error = searchParams.get("gsc_error");
    if (connected) setGscNotice({ type: "success", message: "Search Console connected successfully." });
    if (error) {
      const msgs = { access_denied: "Access denied — please try again.", no_refresh_token: "No refresh token received. Revoke access in your Google account and reconnect.", auth_failed: "Authentication failed." };
      setGscNotice({ type: "error", message: msgs[error] || "Connection failed." });
    }
  }, [searchParams]);

  if (status === "loading") {
    return <div style={{ display:"flex", minHeight:"100vh", alignItems:"center", justifyContent:"center", background:"#f0f2f5" }}><p style={{color:"#aaa"}}>Loading...</p></div>;
  }

  return (

    <div className="flex flex-col flex-1" style={{ overflowX: "hidden" }}>
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none">
            <path d="M7 17V13M10 17V10M13 17V12M16 17V7" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        }
        title="Paid vs. Organic Report"
        subtitle="Cross-channel keyword overlap analysis"
      />

      <main style={{ width: "100%", padding: "32px 24px", background: "#f0f2f5", minHeight: "calc(100vh - 73px)", boxSizing: "border-box" }}>
        {gscNotice && (
          <div style={{ marginBottom: 24, borderRadius: 10, padding: "12px 18px", fontSize: 13, fontWeight: 600, ...(gscNotice.type === "success" ? { background: "#e6f9f0", color: "#0d4f2f" } : { background: "#fde8e8", color: "#7b1c1c" }) }}>
            {gscNotice.message}
          </div>
        )}
        {reportData
          ? <ReportView data={reportData} onReset={() => setReportData(null)} />
          : <ConfigForm onGenerate={setReportData} />}
      </main>
    </div>
  );
}

export default function ReportPage() {
  return (
    <Suspense fallback={<div style={{ display:"flex", minHeight:"100vh", alignItems:"center", justifyContent:"center", background:"#f0f2f5" }}><p style={{color:"#aaa"}}>Loading...</p></div>}>
      <ReportPageInner />
    </Suspense>
  );
}
