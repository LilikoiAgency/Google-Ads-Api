"use client";
import { CHANNEL_DEFINITIONS, inView } from "@/lib/ga4Channels";

// Plain-English channel definitions for the selected view (same wording and
// filter as the download), plus the data source note.
export default function ChannelDefinitions({ viewKey, rangeText }) {
  const defs = CHANNEL_DEFINITIONS.filter((d) => d.name.split(" / ").some((n) => inView(n, viewKey)));
  return (
    <section className="ga4-card ga4-panel">
      <details className="ga4-defs">
        <summary className="ga4-h2">What each channel means</summary>
        <dl className="ga4-defs-list">
          {defs.map((d) => (
            <div key={d.name} className="ga4-def">
              <dt>{d.name}</dt>
              <dd>{d.text}</dd>
            </div>
          ))}
        </dl>
      </details>
      <p className="ga4-source-note">
        Source: GA4, Session primary channel group{rangeText ? `, ${rangeText}` : ""}. Totals are unique users,
        deduplicated by Google Analytics, so they can be lower than the sum of the channel rows. Landing page users
        are approximate for the same reason.
      </p>
    </section>
  );
}
