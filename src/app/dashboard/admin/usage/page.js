"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../../components/DashboardToolHeader";
import DashboardLoader from "../../components/DashboardLoader";
import { UsageAnalyticsIcon } from "../../components/DashboardIcons";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import "../../../globals.css";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function timeAgo(dateStr) {
  if (!dateStr) return "—";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ─── UI Components ───────────────────────────────────────────────────────────

const KPI_COLORS = {
  blue:   "#0f3460",
  green:  "#27ae60",
  orange: "#e67e22",
  purple: "#8e44ad",
};

function KpiCard({ label, value, sub, color = "blue" }) {
  return (
    <div style={{ borderLeft: `4px solid ${KPI_COLORS[color]}`, background: "#fff", borderRadius: 12, padding: "20px", boxShadow: "0 1px 4px rgba(0,0,0,0.07)", flex: 1, minWidth: 160 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "#888", marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 26, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{value}</p>
      {sub && <p style={{ fontSize: 12, color: "#999", marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function SectionTitle({ children }) {
  return <h3 style={{ fontSize: 16, fontWeight: 700, color: "#1a1a2e", marginBottom: 14, marginTop: 28, paddingBottom: 8, borderBottom: "2px solid #eee" }}>{children}</h3>;
}

// ─── ApiHealthSection ─────────────────────────────────────────────────────────

function ApiHealthSection({ health }) {
  if (!health) return null;
  const { meta, claude } = health;
  const pct = Math.min(100, Math.round(claude.budgetUsedPct));
  const barColor = pct >= 90 ? "#e74c3c" : pct >= 70 ? "#e67e22" : "#27ae60";

  return (
    <>
      <SectionTitle>API Health</SectionTitle>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginBottom: 28 }}>

        {/* Meta card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <p style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "#1877F2", marginBottom: 16 }}>Meta Graph API</p>
          <div style={{ display: "flex", gap: 20, marginBottom: 20 }}>
            <div>
              <p style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Last Hour</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{meta.callsLastHour}</p>
              <p style={{ fontSize: 11, color: "#bbb", marginTop: 4 }}>of {meta.hourlyLimit} limit</p>
            </div>
            <div>
              <p style={{ fontSize: 11, color: "#999", fontWeight: 700, textTransform: "uppercase", marginBottom: 4 }}>Today</p>
              <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1 }}>{meta.callsToday}</p>
            </div>
          </div>
          {meta.dailyTrend?.length > 0 && (
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={meta.dailyTrend} margin={{ top: 0, right: 0, left: -30, bottom: 0 }}>
                <XAxis dataKey="date" tick={{ fontSize: 9, fill: "#ccc" }} tickFormatter={(d) => { const p = d.split("-"); return `${p[1]}/${p[2]}`; }} />
                <Tooltip contentStyle={{ fontSize: 11, borderRadius: 6 }} formatter={(v) => [v, "calls"]} />
                <Bar dataKey="calls" fill="#1877F2" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Claude card */}
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
          <p style={{ fontSize: 13, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.8px", color: "#8e44ad", marginBottom: 16 }}>Claude API — This Month</p>
          <p style={{ fontSize: 28, fontWeight: 800, color: "#1a1a2e", lineHeight: 1, marginBottom: 6 }}>
            ${claude.monthlySpend.toFixed(2)}
            <span style={{ fontSize: 14, fontWeight: 400, color: "#999" }}> / ${claude.budgetCap.toFixed(2)}</span>
          </p>
          <div style={{ background: "#f0f0f0", borderRadius: 999, height: 8, marginBottom: 6, overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, background: barColor, height: "100%", borderRadius: 999, transition: "width 0.4s" }} />
          </div>
          <p style={{ fontSize: 11, color: "#999", marginBottom: 16 }}>{pct}% of monthly budget used · {claude.monthlyCalls} calls</p>
          {claude.byFeature?.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <tbody>
                {claude.byFeature.map((f) => (
                  <tr key={f.feature} style={{ borderBottom: "1px solid #f5f5f5" }}>
                    <td style={{ padding: "5px 0", color: "#555" }}>{f.feature || "—"}</td>
                    <td style={{ padding: "5px 0", textAlign: "right", color: "#8e44ad", fontWeight: 700 }}>{f.calls} calls</td>
                    <td style={{ padding: "5px 0", textAlign: "right", color: "#e67e22", fontWeight: 700, paddingLeft: 12 }}>${f.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

      </div>
    </>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function UsageAnalyticsPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const [data, setData] = useState(null);
  const [apiHealth, setApiHealth] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard/admin/usage");
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    Promise.all([
      fetch("/api/admin/usage").then((r) => { if (!r.ok) throw new Error("Failed to load usage data"); return r.json(); }),
      fetch("/api/admin/api-health").then((r) => r.ok ? r.json() : null).catch(() => null),
    ])
      .then(([usageData, healthData]) => { setData(usageData); setApiHealth(healthData); })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authStatus]);

  if (authStatus === "loading" || loading) {
    return <DashboardLoader label="Loading..." />;
  }

  const { kpis, byTool, users, dailyTrend, tokens } = data || {};

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader
        icon={<UsageAnalyticsIcon />}
        title="Usage Analytics"
        subtitle="Dashboard tool adoption"
      />

      <div className="mx-auto max-w-6xl px-6 py-10">
        {error && (
          <div style={{ background: "#fde8e8", border: "1px solid #f5c6c6", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#7b1c1c" }}>
            {error}
          </div>
        )}
        <ApiHealthSection health={apiHealth} />

        {/* KPI Cards */}
        {kpis && (
          <div className="kpi-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 28 }}>
            <KpiCard label="Page Views (7d)" value={kpis.total7d?.toLocaleString() || "0"} color="blue" />
            <KpiCard label="Unique Users (7d)" value={kpis.uniqueUsers7d || "0"} color="green" />
            <KpiCard label="Most Used Tool" value={kpis.topTool7d || "—"} color="orange" />
            <KpiCard label="Most Active User" value={kpis.topUser7d?.split("@")[0] || "—"} sub={kpis.topUser7d || ""} color="purple" />
          </div>
        )}

        {/* Daily Trend Chart */}
        {dailyTrend?.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 28 }}>
            <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 16 }}>Daily Page Views (Last 30 Days)</p>
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={dailyTrend} margin={{ top: 0, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11, fill: "#999" }}
                  tickFormatter={(d) => { const p = d.split("-"); return `${p[1]}/${p[2]}`; }}
                />
                <YAxis tick={{ fontSize: 11, fill: "#999" }} allowDecimals={false} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                  formatter={(v, name) => [v, name === "visits" ? "Views" : "Users"]}
                  labelFormatter={(d) => new Date(d + "T00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                />
                <Bar dataKey="visits" fill="#0f3460" radius={[4, 4, 0, 0]} name="visits" />
                <Bar dataKey="uniqueUsers" fill="#27ae60" radius={[4, 4, 0, 0]} name="uniqueUsers" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Tools Table */}
        {byTool?.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 28 }}>
            <SectionTitle>Tool Usage</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8f9fb" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Tool</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>7 Days</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>30 Days</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>All Time</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Last Visit</th>
                  </tr>
                </thead>
                <tbody>
                  {byTool.map((t) => (
                    <tr key={t.tool} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{t.tool}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#0f3460", fontWeight: 700 }}>{t.visits7d}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{t.visits30d}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#999" }}>{t.visitsAll}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#999", fontSize: 12 }}>{timeAgo(t.lastVisit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Users Table */}
        {users?.length > 0 && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 28 }}>
            <SectionTitle>User Activity</SectionTitle>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8f9fb" }}>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>User</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>7 Days</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>30 Days</th>
                    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Top Tool</th>
                    <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Last Active</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map((u) => (
                    <tr key={u.email} style={{ borderBottom: "1px solid #f0f0f0" }}>
                      <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>
                        {u.email.split("@")[0]}
                        <span style={{ color: "#bbb", fontWeight: 400 }}>@{u.email.split("@")[1]}</span>
                      </td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#0f3460", fontWeight: 700 }}>{u.visits7d}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{u.visits30d}</td>
                      <td style={{ padding: "10px 12px", color: "#666" }}>{u.topTool}</td>
                      <td style={{ padding: "10px 12px", textAlign: "right", color: "#999", fontSize: 12 }}>{timeAgo(u.lastActive)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Claude AI Usage */}
        {tokens && (
          <>
            <SectionTitle>Claude AI Usage</SectionTitle>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 20 }}>
              <KpiCard
                label="Claude Calls (7d)"
                value={tokens.last7d?.calls?.toLocaleString() || "0"}
                sub={`${(tokens.last7d?.inputTokens || 0).toLocaleString()} input · ${(tokens.last7d?.outputTokens || 0).toLocaleString()} output tokens`}
                color="purple"
              />
              <KpiCard
                label="Est. Cost (7d)"
                value={`$${(tokens.last7d?.estimatedCost || 0).toFixed(4)}`}
                sub="Based on Anthropic published pricing"
                color="orange"
              />
            </div>

            {tokens.byFeature?.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 20 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 4 }}>By Feature (30 days)</p>
                <p style={{ fontSize: 12, color: "#999", marginBottom: 16 }}>Cost estimates based on Anthropic published pricing. Actual billing may vary.</p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8f9fb" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Feature</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Calls</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Input Tokens</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Output Tokens</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Est. Cost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.byFeature.map((f) => (
                        <tr key={f.feature} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{f.feature || "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#8e44ad", fontWeight: 700 }}>{f.calls}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{f.inputTokens.toLocaleString()}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{f.outputTokens.toLocaleString()}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#e67e22", fontWeight: 700 }}>${f.estimatedCost.toFixed(4)}</td>
                        </tr>
                      ))}
                      <tr style={{ background: "#f8f9fb", fontWeight: 700 }}>
                        <td style={{ padding: "10px 12px", color: "#333" }}>Total (30d)</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#8e44ad" }}>{tokens.last30d?.calls?.toLocaleString() || "0"}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{(tokens.last30d?.inputTokens || 0).toLocaleString()}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#555" }}>{(tokens.last30d?.outputTokens || 0).toLocaleString()}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: "#e67e22" }}>${(tokens.last30d?.estimatedCost || 0).toFixed(4)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {tokens.auditCalls?.length > 0 && (
              <div style={{ background: "#fff", borderRadius: 12, padding: 24, boxShadow: "0 1px 4px rgba(0,0,0,0.07)", marginBottom: 28 }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: "#1a1a2e", marginBottom: 16 }}>Google Ads Audit Calls (30 days)</p>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr style={{ background: "#f8f9fb" }}>
                        <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>User</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Audits Run</th>
                        <th style={{ textAlign: "right", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee" }}>Last Audit</th>
                      </tr>
                    </thead>
                    <tbody>
                      {tokens.auditCalls.map((u) => (
                        <tr key={u.email} style={{ borderBottom: "1px solid #f0f0f0" }}>
                          <td style={{ padding: "10px 12px", fontWeight: 600, color: "#333" }}>{u.email || "—"}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#0f3460", fontWeight: 700 }}>{u.calls}</td>
                          <td style={{ padding: "10px 12px", textAlign: "right", color: "#999", fontSize: 12 }}>{timeAgo(u.lastAudit)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Empty state */}
        {!loading && !error && (!byTool || byTool.length === 0) && (
          <div style={{ background: "#fff", borderRadius: 12, padding: 40, textAlign: "center", boxShadow: "0 1px 4px rgba(0,0,0,0.07)" }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#333", marginBottom: 6 }}>No usage data yet</p>
            <p style={{ fontSize: 13, color: "#999" }}>Page views will appear here as people use the dashboard.</p>
          </div>
        )}
      </div>
    </div>
  );
}
