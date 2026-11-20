"use client";
// The Target keywords tab: for each page the agency wants to rank, the searches it
// should go after (chosen or recommended), with monthly searches from Keyword
// Planner and where the site shows up today from Search Console, plus clashes
// with other pages and the action plan tasks for the page.

import { SectionTitle } from "../ui";
import PassFindings, { IncompleteNotice } from "./PassFindings";

const muted = { fontSize: 12, color: "var(--muted)" };
const th = { textAlign: "left", padding: "8px 10px", fontSize: 12, fontWeight: 600, color: "var(--muted)", borderBottom: "1px solid var(--line)", whiteSpace: "nowrap" };
const td = { padding: "9px 10px", fontSize: 13, color: "var(--ink)", borderBottom: "1px solid var(--panel-2)", verticalAlign: "top" };

export const ROLE_META = {
  primary: { label: "Main", color: "var(--accent-ink)", bg: "var(--accent-soft)" },
  secondary: { label: "Supporting", color: "var(--ink-2)", bg: "var(--panel-2)" },
  drop: { label: "Not for this page", color: "var(--muted)", bg: "transparent" },
};

const fmt = (n) => (typeof n === "number" ? n.toLocaleString("en-US") : "—");

// "Position 8.1" on the target page, "8.1 on /services" when another page shows up instead.
export function whereNow(k, page) {
  if (k.position == null) return "Not showing yet";
  if (k.ranking_page && k.ranking_page !== page) return `${k.position} on ${k.ranking_page}`;
  return String(k.position);
}

function RoleChip({ role }) {
  const m = ROLE_META[role] || ROLE_META.secondary;
  return (
    <span style={{ fontSize: 11, fontWeight: 600, color: m.color, background: m.bg, border: role === "drop" ? "1px solid var(--line)" : "none", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

function PageBlock({ target, onTask }) {
  const recommend = target.mode === "recommend";
  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: "var(--ink)", margin: 0, wordBreak: "break-all" }}>{target.page}</h3>
        <span style={muted}>{recommend ? "Keywords recommended for this page" : "Keywords you chose"}</span>
      </div>
      {target.keywords.length ? (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Search</th>
                <th style={th}>Role</th>
                <th style={{ ...th, textAlign: "right" }}>Monthly searches</th>
                <th style={th}>Search Console position</th>
                <th style={th}>Why</th>
              </tr>
            </thead>
            <tbody>
              {target.keywords.map((k) => (
                <tr key={k.keyword} style={k.role === "drop" ? { opacity: 0.7 } : undefined}>
                  <td style={{ ...td, fontWeight: 600 }}>
                    {k.keyword}
                    {!k.given && !recommend && <span style={{ ...muted, fontWeight: 500 }}> · suggested</span>}
                  </td>
                  <td style={td}><RoleChip role={k.role} /></td>
                  <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{fmt(k.volume)}</td>
                  <td style={{ ...td, color: k.position == null ? "var(--muted)" : k.ranking_page && k.ranking_page !== target.page ? "var(--amber)" : "var(--ink)" }}>
                    {whereNow(k, target.page)}
                  </td>
                  <td style={{ ...td, color: "var(--ink-2)", minWidth: 220 }}>{k.note || ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p style={muted}>No keyword picks for this page; see the tasks below.</p>
      )}
      {target.conflicts?.length > 0 && (
        <div style={{ marginTop: 10, padding: "10px 12px", borderRadius: 8, border: "1px solid var(--line)", background: "var(--soft)" }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: "var(--ink)", marginBottom: 4 }}>Other pages competing for these searches</p>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {target.conflicts.map((c, i) => (
              <li key={i} style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>
                <b style={{ color: "var(--ink)" }}>{c.keyword}</b> · {c.other_page}{c.note ? `: ${c.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      {target.task_ids?.length > 0 && (
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 10 }}>
          Tasks for this page in the action plan:{" "}
          {target.task_ids.map((id, i) => (
            <span key={id}>
              {i > 0 && ", "}
              <button type="button" onClick={() => onTask?.(id)} style={{ border: "none", background: "none", padding: 0, font: "inherit", color: "var(--ink)", fontWeight: 600, textDecoration: "underline", cursor: "pointer" }}>{id}</button>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

export default function TargetKeywords({ targets, findings, incomplete, onTask }) {
  if (!targets) return null;
  return (
    <div>
      {incomplete && <IncompleteNotice area="Target keywords" />}
      <p style={{ ...muted, marginBottom: 16 }}>
        Monthly searches are Google Ads Keyword Planner estimates{targets.volumes_for ? ` for ${targets.volumes_for}` : ""}, not traffic the page will get.
        Positions are the Search Console average for the audit period.
      </p>
      {targets.pages.map((t) => <PageBlock key={t.page} target={t} onTask={onTask} />)}
      {findings?.length > 0 && (
        <>
          <SectionTitle>Target keyword findings</SectionTitle>
          <PassFindings findings={findings} />
        </>
      )}
    </div>
  );
}
