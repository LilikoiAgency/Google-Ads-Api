"use client";
import { CHANNEL_COLORS } from "@/lib/ga4Channels";
import { fmtInt } from "./format";

export const SOURCES_ANCHOR = "ga4-sources";

function Panel({ id, title, sub, children }) {
  return (
    <section id={id} className="ga4-card ga4-panel">
      <div className="ga4-panel-head">
        <h2 className="ga4-h2">{title}</h2>
        {sub && <p className="ga4-sub">{sub}</p>}
      </div>
      <div className="ga4-table-wrap">{children}</div>
    </section>
  );
}

// Top sources / medium and top landing pages for the selected view.
// Suspected untagged paid rows get a "Likely paid" tag.
export default function SourcesAndPages({ sources, pages }) {
  return (
    <div className="ga4-two-col">
      <Panel id={SOURCES_ANCHOR} title="Top sources / medium" sub="Filtered to this view">
        <table className="ga4-table ga4-table-compact">
          <thead>
            <tr>
              <th>Source / medium</th>
              <th className="ga4-num">Sessions</th>
              <th className="ga4-num">Users</th>
            </tr>
          </thead>
          <tbody>
            {sources.length === 0 ? (
              <tr><td colSpan={3} className="ga4-empty-cell">No sources for this view.</td></tr>
            ) : sources.map((s) => (
              <tr key={`${s.sourceMedium}|${s.channel}`} className={s.suspectedPaid ? "ga4-row-flag" : ""}>
                <td className="ga4-cell-main">
                  <span className="ga4-cell-title" title={s.sourceMedium}>{s.sourceMedium}</span>
                  <span className="ga4-cell-meta">
                    <span className="ga4-swatch ga4-swatch-sm" style={{ background: CHANNEL_COLORS[s.channel] || CHANNEL_COLORS.fallback }} />
                    {s.channel}
                    {s.suspectedPaid && <span className="ga4-tag-paid">Likely paid</span>}
                  </span>
                </td>
                <td className="ga4-num">{fmtInt(s.sessions)}</td>
                <td className="ga4-num">{fmtInt(s.users)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      <Panel title="Top landing pages" sub="Filtered to this view">
        <table className="ga4-table ga4-table-compact">
          <thead>
            <tr>
              <th>Landing page</th>
              <th className="ga4-num">Sessions</th>
              <th className="ga4-num">Users (approx.)</th>
              <th className="ga4-num">Key events</th>
            </tr>
          </thead>
          <tbody>
            {pages.length === 0 ? (
              <tr><td colSpan={4} className="ga4-empty-cell">No landing pages for this view.</td></tr>
            ) : pages.map((p) => (
              <tr key={p.page}>
                <td className="ga4-cell-main"><span className="ga4-cell-title" title={p.page}>{p.page}</span></td>
                <td className="ga4-num">{fmtInt(p.sessions)}</td>
                <td className="ga4-num">{fmtInt(p.users)}</td>
                <td className="ga4-num">{fmtInt(p.keyEvents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
    </div>
  );
}
