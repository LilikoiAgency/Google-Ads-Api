"use client";
// The Reputation tab: Google review numbers per location, what customers say
// (themes with one quote each), and what a web search finds. The search check is
// a web search run during the audit, so it shows appear / not appear, never a rank.

import { SectionTitle } from "../ui";

const muted = { fontSize: 12, color: "var(--muted)" };
const badge = { fontSize: 11, fontWeight: 600, color: "var(--ink-2)", border: "1px solid var(--line)", borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" };

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// The stat fragments shown after the rating; a null stat is skipped.
export function statParts(loc) {
  const st = loc.stats || {};
  const parts = [];
  if (typeof st.rating === "number") parts.push(`${st.rating.toFixed(1)} ★`);
  if (typeof st.count === "number") parts.push(plural(st.count, "review"));
  if (loc.coverage === "full") {
    if (typeof st.per_month === "number") parts.push(`≈${Math.round(st.per_month)}/month`);
    if (typeof st.reply_rate === "number") parts.push(`replies ${Math.round(st.reply_rate * 100)}%`);
    if (typeof st.days_since_newest === "number") {
      const d = st.days_since_newest;
      parts.push(d === 0 ? "newest today" : d === 1 ? "newest 1 day ago" : `newest ${d} days ago`);
    }
  } else {
    parts.push("(5 sample reviews)");
  }
  return parts;
}

function LocationRow({ loc }) {
  const sample = loc.coverage === "sample";
  return (
    <li style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, flexWrap: "wrap", padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
      <div style={{ minWidth: 0 }}>
        <p style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
          {loc.name}{loc.city ? <span style={{ fontWeight: 500, color: "var(--muted)" }}> · {loc.city}</span> : null}
        </p>
        <p style={{ fontSize: 13, color: "var(--ink-2)", marginTop: 2 }}>{statParts(loc).join(" · ")}</p>
      </div>
      <span style={badge}>{sample ? "Public data" : "Managed"}</span>
    </li>
  );
}

function ThemeList({ title, mark, items, showLocation }) {
  if (!items.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 700, color: "var(--ink-2)", marginBottom: 6 }}>{title}</p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
        {items.map((t, i) => (
          <li key={i} style={{ fontSize: 13, color: "var(--ink)" }}>
            <span style={{ fontWeight: 700 }}>{mark} {t.theme} ({t.count})</span>
            {showLocation && t.location ? <span style={muted}> · {t.location}</span> : null}
            {t.quotes?.[0] && <p style={{ ...muted, fontStyle: "italic", marginTop: 2 }}>&ldquo;{t.quotes[0]}&rdquo;</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchBlock({ search }) {
  return (
    <div style={{ marginTop: 24 }}>
      <SectionTitle>What a web search finds</SectionTitle>
      <p style={{ ...muted, marginBottom: 8 }}>A web search run during this audit, not Google rankings.</p>
      <p style={{ fontSize: 14, fontWeight: 700, color: "var(--ink)", marginBottom: 6 }}>
        You appear in {search.appear_count} of {search.total} searches
      </p>
      {search.summary && <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 8 }}>{search.summary}</p>}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(search.queries || []).map((q, i) => (
          <li key={i} style={{ display: "flex", gap: 10, padding: "6px 0", borderBottom: "1px solid var(--line)", fontSize: 13 }}>
            <span aria-label={q.you_appear ? "appears" : "does not appear"} style={{ fontWeight: 800, color: q.you_appear ? "var(--up)" : "var(--muted)", width: 14 }}>{q.you_appear ? "✓" : "✗"}</span>
            <span style={{ color: "var(--ink)", flex: "0 1 45%" }}>{q.query}</span>
            {!q.you_appear && q.others?.length > 0 && <span style={{ ...muted, flex: 1 }}>{q.others.join(", ")}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Reputation({ reputation }) {
  if (!reputation) return null;
  const { locations = [], themes = [], search, attribution } = reputation;
  const praise = themes.filter((t) => t.kind === "praise");
  const complaints = themes.filter((t) => t.kind === "complaint");
  return (
    <div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, borderTop: "1px solid var(--line)" }}>
        {locations.map((loc, i) => <LocationRow key={`${loc.name}-${i}`} loc={loc} />)}
      </ul>

      {themes.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <SectionTitle>What customers say</SectionTitle>
          <ThemeList title="Praise" mark="+" items={praise} showLocation={locations.length > 1} />
          <ThemeList title="Complaints" mark="−" items={complaints} showLocation={locations.length > 1} />
        </div>
      )}

      {search && <SearchBlock search={search} />}

      {attribution && <p style={{ ...muted, marginTop: 20 }}>{attribution}</p>}
    </div>
  );
}
