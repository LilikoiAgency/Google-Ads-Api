"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function formatDate(value) {
  if (!value) return "No date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function severityStyles(severity) {
  if (severity >= 2) {
    return { label: "Needs attention", color: "#ef4444", bg: "rgba(239,68,68,0.12)", border: "rgba(239,68,68,0.28)" };
  }
  if (severity === 1) {
    return { label: "Review", color: "#f59e0b", bg: "rgba(245,158,11,0.12)", border: "rgba(245,158,11,0.28)" };
  }
  return { label: "Current", color: "#10b981", bg: "rgba(16,185,129,0.12)", border: "rgba(16,185,129,0.28)" };
}

function ChannelPill({ channel }) {
  const styles = severityStyles(channel.severity || 0);
  const metricLabel = channel.metric
    ? `${channel.metric.impressions.toLocaleString("en-US")} impr.`
    : channel.lastSavedAt
      ? formatDate(channel.lastSavedAt)
      : null;
  return (
    <Link
      href={channel.href}
      style={{
        border: `1px solid ${styles.border}`,
        background: styles.bg,
        borderRadius: 8,
        padding: "9px 10px",
        textDecoration: "none",
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
        <span style={{ color: "var(--text-primary)", fontSize: 12, fontWeight: 800 }}>{channel.label}</span>
        <span style={{ width: 7, height: 7, borderRadius: "50%", background: styles.color, flexShrink: 0 }} />
      </div>
      <p style={{ color: "var(--text-secondary)", fontSize: 11, margin: "4px 0 0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {channel.status}
      </p>
      {metricLabel && (
        <p style={{ color: "var(--text-secondary)", fontSize: 11, margin: "3px 0 0" }}>
          {metricLabel}
        </p>
      )}
    </Link>
  );
}

function ClientCard({ client }) {
  const styles = severityStyles(client.severity);
  return (
    <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 16, boxShadow: "var(--card-shadow)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ color: "var(--text-primary)", fontSize: 16, fontWeight: 800, margin: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{client.name}</p>
          <p style={{ color: "var(--text-secondary)", fontSize: 12, margin: "4px 0 0" }}>
            {client.connectedChannels} connected channel{client.connectedChannels === 1 ? "" : "s"}
          </p>
        </div>
        <span style={{ background: styles.bg, border: `1px solid ${styles.border}`, color: styles.color, borderRadius: 999, padding: "5px 9px", fontSize: 11, fontWeight: 900, whiteSpace: "nowrap" }}>
          {styles.label}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(86px,1fr))", gap: 8 }}>
        {client.channels.map((channel) => <ChannelPill key={channel.label} channel={channel} />)}
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 13, flexWrap: "wrap" }}>
        <Link href="/dashboard/admin/clients" style={{ color: "var(--link-label)", fontSize: 12, fontWeight: 800, textDecoration: "none" }}>
          Manage client
        </Link>
        {client.portalHref && (
          <Link href={client.portalHref} style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, textDecoration: "none" }}>
            Portal
          </Link>
        )}
      </div>
    </div>
  );
}

export default function CommandCenter() {
  const [data, setData] = useState(null);
  const [status, setStatus] = useState("loading");
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    fetch("/api/command-center")
      .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
      .then((json) => {
        if (cancelled) return;
        setData(json.data || null);
        setStatus("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setStatus("error");
      });
    return () => { cancelled = true; };
  }, []);

  const topClients = useMemo(() => data?.clients || [], [data]);

  return (
    <section className="home-section">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 16, marginBottom: 16 }}>
        <div>
          <p style={{ fontSize: 13, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: "var(--section-label)", margin: "0 0 8px" }}>Command Center</p>
          <h2 style={{ color: "var(--text-primary)", fontSize: 24, lineHeight: 1.2, margin: 0 }}>Client operating view</h2>
        </div>
        {data?.generatedAt && (
          <span style={{ color: "var(--text-secondary)", fontSize: 12, fontWeight: 700, whiteSpace: "nowrap" }}>
            Updated {formatDate(data.generatedAt)}
          </span>
        )}
      </div>

      {status === "loading" && (
        <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 20, color: "var(--text-secondary)" }}>
          Loading client command center...
        </div>
      )}

      {status === "error" && (
        <div style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.22)", borderRadius: 14, padding: 20, color: "#ef4444" }}>
          Command center unavailable: {error}
        </div>
      )}

      {status === "ready" && data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 12, marginBottom: 14 }}>
            {[
              ["Active clients", data.totals.activeClients],
              ["Needs attention", data.totals.needsAttention],
              ["Channel links", data.totals.connectedChannels],
              ["Saved audits", data.totals.googleAudits + data.totals.metaAudits + data.totals.seoAudits],
            ].map(([label, value]) => (
              <div key={label} style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 12, padding: "14px 16px" }}>
                <p style={{ color: "var(--text-secondary)", fontSize: 11, fontWeight: 900, margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.7px" }}>{label}</p>
                <p style={{ color: "var(--text-primary)", fontSize: 25, fontWeight: 900, margin: 0 }}>{value}</p>
              </div>
            ))}
          </div>

          {data.pacing && (
            <Link href={`/dashboard/pacing?reportId=${data.pacing._id}`} style={{ display: "block", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.22)", borderRadius: 12, padding: 14, marginBottom: 14, textDecoration: "none" }}>
              <p style={{ color: "#f59e0b", fontSize: 11, fontWeight: 900, margin: "0 0 5px", textTransform: "uppercase", letterSpacing: "0.8px" }}>Latest pacing report</p>
              <p style={{ color: "var(--text-primary)", fontSize: 15, fontWeight: 800, margin: 0 }}>{data.pacing.status || "Report ready"} - {formatDate(data.pacing.createdAt || data.pacing.reportDate)}</p>
            </Link>
          )}

          {topClients.length > 0 ? (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(340px,1fr))", gap: 14 }}>
              {topClients.map((client) => <ClientCard key={client.slug || client.name} client={client} />)}
            </div>
          ) : (
            <div style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)", borderRadius: 14, padding: 20, color: "var(--text-secondary)" }}>
              No client portal records found yet. Add clients in Client Portals to activate the command center.
            </div>
          )}
        </>
      )}
    </section>
  );
}
