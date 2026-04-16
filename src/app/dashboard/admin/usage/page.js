"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../../components/DashboardToolHeader";
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

// ─── Main Page ───────────────────────────────────────────────────────────────

export default function UsageAnalyticsPage() {
  const router = useRouter();
  const { data: session, status: authStatus } = useSession();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (authStatus === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard/admin/usage");
    }
  }, [authStatus, router]);

  useEffect(() => {
    if (authStatus !== "authenticated") return;
    fetch("/api/admin/usage")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load usage data");
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [authStatus]);

  if (authStatus === "loading" || loading) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-customPurple-dark">
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          className="w-24 h-24"
        />
      </div>
    );
  }

  const { kpis, byTool, users, dailyTrend } = data || {};

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
            <rect x="6" y="28" width="7" height="14" rx="1.5" fill="#ec4899" opacity="0.9"/>
            <rect x="16" y="20" width="7" height="22" rx="1.5" fill="#ec4899"/>
            <rect x="26" y="12" width="7" height="30" rx="1.5" fill="#ec4899" opacity="0.8"/>
            <rect x="36" y="24" width="7" height="18" rx="1.5" fill="#ec4899" opacity="0.6"/>
          </svg>
        }
        title="Usage Analytics"
        subtitle="Dashboard tool adoption"
      />

      <div className="mx-auto max-w-6xl px-6 py-10">
        {error && (
          <div style={{ background: "#fde8e8", border: "1px solid #f5c6c6", borderRadius: 10, padding: "12px 16px", marginBottom: 20, fontSize: 13, color: "#7b1c1c" }}>
            {error}
          </div>
        )}

        {/* KPI Cards */}
        {kpis && (
          <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
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
