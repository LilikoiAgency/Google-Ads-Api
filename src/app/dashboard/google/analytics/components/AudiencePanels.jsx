"use client";
import { useState } from "react";
import { fmtInt, fmtRate } from "./format";

// Audience breakdowns for the selected view: where visitors are, what they
// use, whether they've been before, which key events they complete and when
// they visit. All from selectAudience (src/lib/ga4View.js).

function Panel({ title, sub, children, head }) {
  return (
    <section className="ga4-card ga4-panel">
      <div className="ga4-panel-head ga4-panel-head-row">
        <div>
          <h2 className="ga4-h2">{title}</h2>
          {sub && <p className="ga4-sub">{sub}</p>}
        </div>
        {head}
      </div>
      <div className="ga4-table-wrap">{children}</div>
    </section>
  );
}

function ShareBar({ share }) {
  const pct = Math.max(0, Math.min(1, share || 0)) * 100;
  return (
    <span className="ga4-share">
      <span className="ga4-share-track"><span className="ga4-share-fill" style={{ width: `${pct}%` }} /></span>
      <span className="ga4-share-pct">{pct.toFixed(pct < 10 ? 1 : 0)}%</span>
    </span>
  );
}

const EmptyRow = ({ cols, children }) => (
  <tr><td colSpan={cols} className="ga4-empty-cell">{children}</td></tr>
);

const placeName = (v) => (v && v !== "(not set)" ? v : "Unknown");

// "generate_lead" -> "Generate lead"
export function prettyEvent(name) {
  const s = String(name || "").replace(/_/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "(unnamed)";
}

function CitiesTable({ cities, showKeyEvents }) {
  const cols = showKeyEvents ? 5 : 4;
  return (
    <table className="ga4-table ga4-table-compact">
      <thead>
        <tr>
          <th>City</th>
          <th className="ga4-num">Sessions</th>
          <th className="ga4-num">Users (approx.)</th>
          <th className="ga4-num">Eng. rate</th>
          {showKeyEvents && <th className="ga4-num">Key events</th>}
        </tr>
      </thead>
      <tbody>
        {cities.length === 0 ? <EmptyRow cols={cols}>No city data for this view.</EmptyRow> : cities.map((c) => (
          <tr key={`${c.country}|${c.region}|${c.city}`}>
            <td className="ga4-cell-main">
              <span className="ga4-cell-title">{placeName(c.city)}</span>
              <span className="ga4-cell-meta">{[placeName(c.region), c.country].filter((x) => x && x !== "Unknown").join(", ") || "Location unknown"}</span>
            </td>
            <td className="ga4-num">{fmtInt(c.sessions)}</td>
            <td className="ga4-num">{fmtInt(c.users)}</td>
            <td className="ga4-num">{fmtRate(c.engagementRate)}</td>
            {showKeyEvents && <td className="ga4-num">{fmtInt(c.keyEvents)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RegionsTable({ regions, showKeyEvents }) {
  const cols = showKeyEvents ? 3 : 2;
  return (
    <table className="ga4-table ga4-table-compact">
      <thead>
        <tr>
          <th>State / region</th>
          <th>Share of sessions</th>
          {showKeyEvents && <th className="ga4-num">Key events</th>}
        </tr>
      </thead>
      <tbody>
        {regions.length === 0 ? <EmptyRow cols={cols}>No region data for this view.</EmptyRow> : regions.map((r) => (
          <tr key={`${r.country}|${r.region}`}>
            <td className="ga4-cell-main">
              <span className="ga4-cell-title">{placeName(r.region)}</span>
              <span className="ga4-cell-meta">{fmtInt(r.sessions)} sessions{r.country && r.country !== "(not set)" ? ` · ${r.country}` : ""}</span>
            </td>
            <td><ShareBar share={r.share} /></td>
            {showKeyEvents && <td className="ga4-num">{fmtInt(r.keyEvents)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// Devices / new vs returning: share, engagement and key-event rate per row.
function SplitTable({ rows, nameKey, nameLabel, showKeyEvents, empty }) {
  const cols = showKeyEvents ? 4 : 3;
  return (
    <table className="ga4-table ga4-table-compact">
      <thead>
        <tr>
          <th>{nameLabel}</th>
          <th>Share</th>
          <th className="ga4-num">Eng. rate</th>
          {showKeyEvents && <th className="ga4-num" title="Key events per session">Conv. rate</th>}
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? <EmptyRow cols={cols}>{empty}</EmptyRow> : rows.map((r) => (
          <tr key={r[nameKey]}>
            <td className="ga4-cell-main">
              <span className="ga4-cell-title">{r[nameKey]}</span>
              <span className="ga4-cell-meta">{fmtInt(r.sessions)} sessions{showKeyEvents ? ` · ${fmtInt(r.keyEvents)} key events` : ""}</span>
            </td>
            <td><ShareBar share={r.share} /></td>
            <td className="ga4-num">{fmtRate(r.engagementRate)}</td>
            {showKeyEvents && <td className="ga4-num">{fmtRate(r.keyEventRate)}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function KeyEventsTable({ events }) {
  return (
    <table className="ga4-table ga4-table-compact">
      <thead>
        <tr>
          <th>Key event</th>
          <th className="ga4-num">Count</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {events.length === 0 ? <EmptyRow cols={3}>No key events from these channels.</EmptyRow> : events.map((e) => (
          <tr key={e.event}>
            <td className="ga4-cell-main">
              <span className="ga4-cell-title" title={e.event}>{prettyEvent(e.event)}</span>
              <span className="ga4-cell-meta">{e.event}</span>
            </td>
            <td className="ga4-num">{fmtInt(e.count)}</td>
            <td><ShareBar share={e.share} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const HOUR_LABEL = (h) => (h === 0 ? "12a" : h < 12 ? `${h}a` : h === 12 ? "12p" : `${h - 12}p`);

function Heatmap({ heatmap, showKeyEvents }) {
  const [metric, setMetric] = useState("sessions");
  const useKe = showKeyEvents && metric === "keyEvents";
  const grid = useKe ? heatmap.keyEvents : heatmap.sessions;
  const max = Math.max(0, ...grid.flat());
  const unit = useKe ? "key events" : "sessions";

  const toggle = showKeyEvents ? (
    <div className="ga4-segment ga4-segment-sm" role="group" aria-label="Heatmap metric">
      {[["sessions", "Sessions"], ["keyEvents", "Key events"]].map(([k, l]) => (
        <button key={k} type="button" className={`ga4-segment-btn${metric === k ? " is-active" : ""}`} aria-pressed={metric === k} onClick={() => setMetric(k)}>{l}</button>
      ))}
    </div>
  ) : null;

  return (
    <Panel title="When people visit" sub="Day of week × hour, in the GA property's time zone. Darker = more." head={toggle}>
      {max === 0 ? (
        <p className="ga4-chart-empty">No {unit} for this view.</p>
      ) : (
        <div className="ga4-heat" role="table" aria-label={`${unit} by day and hour`}>
          <div className="ga4-heat-row" role="row">
            <span className="ga4-heat-day" />
            {Array.from({ length: 24 }, (_, h) => (
              <span key={h} className="ga4-heat-hour" role="columnheader">{h % 3 === 0 ? HOUR_LABEL(h) : ""}</span>
            ))}
          </div>
          {heatmap.days.map((day, d) => (
            <div key={day} className="ga4-heat-row" role="row">
              <span className="ga4-heat-day" role="rowheader">{day}</span>
              {grid[d].map((v, h) => (
                <span
                  key={h}
                  role="cell"
                  className="ga4-heat-cell"
                  style={{ opacity: v > 0 ? 0.12 + 0.88 * (v / max) : 0.04 }}
                  title={`${day} ${HOUR_LABEL(h)}: ${fmtInt(v)} ${unit}`}
                />
              ))}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default function AudiencePanels({ audience, showKeyEvents }) {
  if (!audience) return null;
  return (
    <>
      <div className="ga4-two-col">
        <Panel title="Top cities" sub="Where visitors are, filtered to this view">
          <CitiesTable cities={audience.cities} showKeyEvents={showKeyEvents} />
        </Panel>
        <Panel title="Top states / regions" sub="Share of this view's sessions">
          <RegionsTable regions={audience.regions} showKeyEvents={showKeyEvents} />
        </Panel>
      </div>

      <div className={showKeyEvents ? "ga4-three-col" : "ga4-two-col"}>
        <Panel title="Devices" sub="Sessions by device type">
          <SplitTable rows={audience.devices} nameKey="device" nameLabel="Device" showKeyEvents={showKeyEvents} empty="No device data for this view." />
        </Panel>
        <Panel title="New vs returning" sub="First visit vs coming back">
          <SplitTable rows={audience.visitorTypes} nameKey="type" nameLabel="Visitor" showKeyEvents={showKeyEvents} empty="No visitor data for this view." />
        </Panel>
        {showKeyEvents && (
          <Panel title="Key events by action" sub="What the key events actually were">
            <KeyEventsTable events={audience.keyEvents} />
          </Panel>
        )}
      </div>

      <Heatmap heatmap={audience.heatmap} showKeyEvents={showKeyEvents} />
    </>
  );
}
