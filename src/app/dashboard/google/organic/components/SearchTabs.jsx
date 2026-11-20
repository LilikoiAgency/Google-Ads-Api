"use client";
import { useEffect, useMemo, useState } from "react";
import SearchTable from "./SearchTable";
import { fmtInt, fmtCtr, fmtPos, Change, PosChange, PosPill, shortUrl } from "./format";
import {
  strikingDistance, lowCtr, cannibalization, pageGroups, pagesForQuery, queriesForPage, isBranded,
} from "@/lib/gscInsights";
import { countryName, appearanceName } from "@/lib/gscCountries";

// ── shared column builders ────────────────────────────────────────────────

function metricCols(hasCompare, hasPosition = true) {
  const cols = [
    { key: "clicks", label: "Clicks", num: true, render: (r) => fmtInt(r.clicks) },
  ];
  if (hasCompare) {
    cols.push({ key: "dClicks", label: "Δ", num: true, title: "Change in clicks vs the comparison period",
      sort: (r) => (r.prev ? r.clicks - r.prev.clicks : r.clicks), csv: (r) => (r.prev ? r.clicks - r.prev.clicks : ""),
      render: (r) => <Change cur={r.clicks} prev={r.prev ? r.prev.clicks : null} /> });
  }
  cols.push(
    { key: "impressions", label: "Impr.", num: true, render: (r) => fmtInt(r.impressions) },
    { key: "ctr", label: "CTR", num: true, render: (r) => fmtCtr(r.ctr), csv: (r) => (r.ctr * 100).toFixed(2) },
  );
  if (hasPosition) {
    cols.push({ key: "position", label: "Pos.", num: true, render: (r) => <PosPill pos={r.position} />, csv: (r) => r.position.toFixed(1) });
    if (hasCompare) {
      cols.push({ key: "dPos", label: "Δ pos", num: true, title: "Position change (▲ = moved up)",
        sort: (r) => (r.prev?.position ? r.prev.position - r.position : null),
        csv: (r) => (r.prev?.position ? (r.prev.position - r.position).toFixed(1) : ""),
        render: (r) => <PosChange cur={r.position} prev={r.prev?.position} /> });
    }
  }
  return cols;
}

function useMultiHost(pages) {
  return useMemo(() => {
    const hosts = new Set();
    for (const p of pages || []) {
      try { hosts.add(new URL(p.page).hostname.replace(/^www\./, "")); } catch { /* skip */ }
      if (hosts.size > 1) return true;
    }
    return false;
  }, [pages]);
}

// Says when a list is the API's top-N rather than everything.
function CapNote({ count, limit, what }) {
  if (!limit || count < limit) return null;
  return <p className="ga4-sub gsc-tab-intro">Showing the top {limit.toLocaleString("en-US")} {what} by clicks (Search Console&apos;s limit per request). Totals above include everything.</p>;
}

function Seg({ value, onChange, options, label }) {
  return (
    <div className="ga4-segment ga4-segment-sm" role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" className={`ga4-segment-btn${value === k ? " is-active" : ""}`}
          aria-pressed={value === k} onClick={() => onChange(k)}>{l}</button>
      ))}
    </div>
  );
}

// ── Queries ───────────────────────────────────────────────────────────────

// Branded / non-branded filtering happens page-wide (segmentReport), so this
// tab just shows the rows it's given.
export function QueriesTab({ report, brandTerms, onOpenQuery, csvBase }) {
  const hasCompare = !!report.compareRange;
  const branded = brandTerms.length > 0;
  const columns = [
    { key: "query", label: "Query", render: (r) => (
      <span className="gsc-cell-q">
        <span className="ga4-cell-title" title={r.query}>{r.query}</span>
        {branded && isBranded(r.query, brandTerms) && <span className="gsc-tag">Brand</span>}
      </span>
    ) },
    ...metricCols(hasCompare),
  ];
  return (
    <>
    <CapNote count={report.allQueryCount ?? report.queries.length} limit={report.limits?.queries} what="queries" />
    <SearchTable
      columns={columns} rows={report.queries} rowKey={(r) => r.query} searchKeys={["query"]} searchPlaceholder="Filter queries…"
      onRowClick={(r) => onOpenQuery(r.query)} csvName={`${csvBase} queries.csv`}
      emptyMsg="No queries in this range."
    />
    </>
  );
}

// ── Pages ─────────────────────────────────────────────────────────────────

const VERDICT = {
  PASS: ["Indexed", "ok"], PARTIAL: ["Partly", "warn"], FAIL: ["Not indexed", "bad"], NEUTRAL: ["Excluded", "warn"],
};

export function IndexBadge({ result }) {
  if (!result) return null;
  if (result.loading) return <span className="gsc-badge">Checking…</span>;
  if (result.error) return <span className="gsc-badge gsc-badge-bad" title={result.error}>Error</span>;
  const [text, tone] = VERDICT[result.verdict] || ["Unknown", "warn"];
  return <span className={`gsc-badge gsc-badge-${tone}`} title={result.coverage || ""}>{text}</span>;
}

export function PagesTab({ report, ga4, inspections, onInspect, onOpenPage, csvBase }) {
  const hasCompare = !!report.compareRange;
  const multiHost = useMultiHost(report.pages);
  const hasGa = !!ga4?.byPath;
  const rows = useMemo(() => report.pages.map((p) => ({
    ...p,
    ga: hasGa ? ga4.lookup(p.page) : undefined,
  })), [report.pages, ga4, hasGa]);

  const columns = [
    { key: "page", label: "Page", render: (r) => (
      <span className="ga4-cell-title gsc-url" title={r.page}>{shortUrl(r.page, { keepHost: multiHost })}</span>
    ) },
    ...metricCols(hasCompare, report.hasQueries),
  ];
  if (hasGa) {
    columns.push(
      { key: "gaSessions", label: "Sessions", num: true, title: `GA4 google / organic sessions (${ga4.propertyName})`,
        sort: (r) => r.ga?.sessions ?? -1, csv: (r) => r.ga?.sessions ?? "",
        render: (r) => (r.ga ? fmtInt(r.ga.sessions) : <span className="gsc-muted">—</span>) },
      { key: "gaKeyEvents", label: "Key events", num: true, title: "GA4 key events from those sessions",
        sort: (r) => r.ga?.keyEvents ?? -1, csv: (r) => r.ga?.keyEvents ?? "",
        render: (r) => (r.ga ? fmtInt(r.ga.keyEvents) : <span className="gsc-muted">—</span>) },
      { key: "gaConv", label: "Conv. rate", num: true, title: "Key events per organic session",
        sort: (r) => (r.ga?.sessions ? r.ga.keyEvents / r.ga.sessions : -1),
        csv: (r) => (r.ga?.sessions ? ((r.ga.keyEvents / r.ga.sessions) * 100).toFixed(2) : ""),
        render: (r) => (r.ga?.sessions ? fmtCtr(r.ga.keyEvents / r.ga.sessions) : <span className="gsc-muted">—</span>) },
    );
  }
  columns.push({
    key: "index", label: "Index", sortable: false, csv: (r) => inspections[r.page]?.coverage || "",
    render: (r) => (inspections[r.page]
      ? <IndexBadge result={inspections[r.page]} />
      : <button type="button" className="ga4-link gsc-check" onClick={(e) => { e.stopPropagation(); onInspect([r.page]); }}>Check</button>),
  });

  return (
    <>
    <CapNote count={report.pages.length} limit={report.limits?.pages} what="pages" />
    <SearchTable
      columns={columns} rows={rows} rowKey={(r) => r.page} searchKeys={["page"]} searchPlaceholder="Filter pages…"
      onRowClick={report.hasQueries ? (r) => onOpenPage(r.page) : undefined}
      csvName={`${csvBase} pages.csv`} emptyMsg="No pages in this range."
      toolbar={(
        <button type="button" className="ga4-btn gsc-btn-sm"
          onClick={() => onInspect([...report.pages].sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((p) => p.page))}>
          Check indexing of top 10
        </button>
      )}
    />
    </>
  );
}

// ── Page groups ───────────────────────────────────────────────────────────

export function GroupsTab({ report, csvBase }) {
  const hasCompare = !!report.compareRange;
  const rows = useMemo(() => pageGroups(report.pages), [report.pages]);
  const columns = [
    { key: "group", label: "Section", render: (r) => <span className="ga4-cell-title">{r.group === "/" ? "/ (home & top-level pages)" : `${r.group}/…`}</span> },
    { key: "pages", label: "Pages", num: true },
    ...metricCols(hasCompare, report.hasQueries),
  ];
  return (
    <>
      <p className="ga4-sub gsc-tab-intro">Pages grouped by the first folder in their URL, so you can compare sections of the site (services, blog, locations…).</p>
      <SearchTable columns={columns} rows={rows} rowKey={(r) => r.group} csvName={`${csvBase} sections.csv`} emptyMsg="No pages in this range." />
    </>
  );
}

// ── Opportunities ─────────────────────────────────────────────────────────

export function OpportunitiesTab({ report, ctrAt, brandTerms, onOpenQuery, onOpenPage, csvBase }) {
  const [kind, setKind] = useState("striking");
  const nonBrand = useMemo(
    () => (brandTerms.length ? report.queries.filter((q) => !isBranded(q.query, brandTerms)) : report.queries),
    [report.queries, brandTerms],
  );
  const striking = useMemo(() => strikingDistance(nonBrand, ctrAt), [nonBrand, ctrAt]);
  const lowPages = useMemo(() => lowCtr(report.pages, ctrAt), [report.pages, ctrAt]);
  const lowQueries = useMemo(() => lowCtr(nonBrand, ctrAt, { minImpressions: 50 }), [nonBrand, ctrAt]);
  const multiHost = useMultiHost(report.pages);

  const intro = {
    striking: "Queries ranking 4–15 that get real impressions. A push to the top 3 (better content, internal links, a dedicated page) pays off most here. Ranked by the extra clicks position 3 would bring.",
    lowPages: "Pages in the top 10 whose click-through rate is under half of what that position normally gets on this site. Usually a weak title or meta description, or a rich result taking the clicks.",
    lowQueries: "Same check per query: ranking well, but searchers aren't clicking.",
  }[kind];

  const tag = brandTerms.length ? " (non-branded)" : "";
  return (
    <>
      <div className="gsc-tab-head">
        <Seg label="Opportunity type" value={kind} onChange={setKind} options={[
          ["striking", `Close to top 3 (${striking.length})`],
          ["lowPages", `Low-CTR pages (${lowPages.length})`],
          ["lowQueries", `Low-CTR queries (${lowQueries.length})`],
        ]} />
        <p className="ga4-sub gsc-tab-intro">{intro}</p>
      </div>
      {kind === "striking" && (
        <SearchTable
          rows={striking} rowKey={(r) => r.query} defaultSort={{ key: "potential", dir: "desc" }}
          searchKeys={["query"]} onRowClick={(r) => onOpenQuery(r.query)} csvName={`${csvBase} close to top 3.csv`}
          emptyMsg={`No queries${tag} ranking 4–15 with enough impressions.`}
          columns={[
            { key: "query", label: `Query${tag}`, render: (r) => <span className="ga4-cell-title">{r.query}</span> },
            { key: "position", label: "Pos.", num: true, render: (r) => <PosPill pos={r.position} />, csv: (r) => r.position.toFixed(1) },
            { key: "impressions", label: "Impr.", num: true, render: (r) => fmtInt(r.impressions) },
            { key: "clicks", label: "Clicks", num: true, render: (r) => fmtInt(r.clicks) },
            { key: "ctr", label: "CTR", num: true, render: (r) => fmtCtr(r.ctr), csv: (r) => (r.ctr * 100).toFixed(2) },
            { key: "potential", label: "+ clicks at #3", num: true, title: "Estimated extra clicks per period at position 3",
              render: (r) => <strong className="gsc-gain">+{fmtInt(r.potential)}</strong> },
          ]}
        />
      )}
      {kind !== "striking" && (
        <SearchTable
          rows={kind === "lowPages" ? lowPages : lowQueries}
          rowKey={(r) => r.page || r.query} defaultSort={{ key: "lostClicks", dir: "desc" }}
          searchKeys={[kind === "lowPages" ? "page" : "query"]}
          onRowClick={(r) => (r.page ? onOpenPage(r.page) : onOpenQuery(r.query))}
          csvName={`${csvBase} low ctr ${kind === "lowPages" ? "pages" : "queries"}.csv`}
          emptyMsg="Nothing under-performing on click-through. 👍"
          columns={[
            kind === "lowPages"
              ? { key: "page", label: "Page", render: (r) => <span className="ga4-cell-title gsc-url" title={r.page}>{shortUrl(r.page, { keepHost: multiHost })}</span> }
              : { key: "query", label: `Query${tag}`, render: (r) => <span className="ga4-cell-title">{r.query}</span> },
            { key: "position", label: "Pos.", num: true, render: (r) => <PosPill pos={r.position} />, csv: (r) => r.position.toFixed(1) },
            { key: "impressions", label: "Impr.", num: true, render: (r) => fmtInt(r.impressions) },
            { key: "ctr", label: "CTR", num: true, render: (r) => fmtCtr(r.ctr), csv: (r) => (r.ctr * 100).toFixed(2) },
            { key: "expectedCtr", label: "Expected", num: true, title: "Typical CTR at this position on this site",
              render: (r) => fmtCtr(r.expectedCtr), csv: (r) => (r.expectedCtr * 100).toFixed(2) },
            { key: "lostClicks", label: "Missed clicks", num: true, render: (r) => <strong className="gsc-loss">{fmtInt(r.lostClicks)}</strong> },
          ]}
        />
      )}
    </>
  );
}

// ── Cannibalization ───────────────────────────────────────────────────────

export function CannibalizationTab({ report, brandTerms, onOpenQuery }) {
  const rows = useMemo(() => cannibalization(report.queryPages, { brandTerms }), [report.queryPages, brandTerms]);
  const multiHost = useMultiHost(report.pages);
  const [limit, setLimit] = useState(20);
  return (
    <>
      <p className="ga4-sub gsc-tab-intro">
        Non-branded queries where two or more of the site&apos;s pages each take 10%+ of the impressions (tracking-link versions of a URL count as one page). Google is splitting its vote, so neither page ranks as well as one strong page would. Fix: merge the pages, or make one clearly the main page and link to it from the others.
      </p>
      {rows.length === 0 ? (
        <p className="ga4-empty-cell">No competing pages found. 👍</p>
      ) : (
        <div className="gsc-cannibal-list">
          {rows.slice(0, limit).map((r) => (
            <div key={r.query} className="gsc-cannibal">
              <button type="button" className="gsc-cannibal-q" onClick={() => onOpenQuery(r.query)}>
                <span className="ga4-cell-title">{r.query}</span>
                <span className="ga4-cell-meta">{fmtInt(r.impressions)} impr. · {fmtInt(r.clicks)} clicks · {r.pages.length} pages</span>
              </button>
              <ul>
                {r.pages.map((p) => (
                  <li key={p.page}>
                    <span className="gsc-url" title={p.page}>{shortUrl(p.page, { keepHost: multiHost })}</span>
                    <span className="gsc-share"><span style={{ width: `${Math.round(p.share * 100)}%` }} /></span>
                    <span className="gsc-cannibal-num">{Math.round(p.share * 100)}%</span>
                    <PosPill pos={p.position} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {rows.length > limit && (
            <button type="button" className="ga4-btn gsc-btn-sm" onClick={() => setLimit((l) => l + 20)}>Show more ({rows.length - limit} left)</button>
          )}
        </div>
      )}
    </>
  );
}

// ── Devices, countries, search appearance ────────────────────────────────

export function AudienceTab({ report, csvBase }) {
  const hasCompare = !!report.compareRange;
  const total = report.totals?.clicks || 0;
  const share = { key: "share", label: "Share", num: true, sort: (r) => r.clicks, csv: (r) => (total ? ((r.clicks / total) * 100).toFixed(1) : ""),
    render: (r) => (total ? `${((r.clicks / total) * 100).toFixed(1)}%` : "—") };
  return (
    <div className="gsc-audience">
      {report.devices.length > 0 && (
        <div>
          <h3 className="gsc-h3">Devices</h3>
          <SearchTable rows={report.devices} rowKey={(r) => r.device} pageSize={10} csvName={`${csvBase} devices.csv`}
            columns={[{ key: "device", label: "Device", render: (r) => <span className="ga4-cell-title">{r.device}</span> }, share, ...metricCols(hasCompare, report.hasQueries)]} />
        </div>
      )}
      <div>
        <h3 className="gsc-h3">Countries</h3>
        <SearchTable
          rows={report.countries.map((c) => ({ ...c, name: countryName(c.country) }))} rowKey={(r) => r.country} pageSize={10}
          searchKeys={["name"]} searchPlaceholder="Filter countries…" csvName={`${csvBase} countries.csv`}
          columns={[{ key: "name", label: "Country", render: (r) => <span className="ga4-cell-title">{r.name}</span> }, share, ...metricCols(hasCompare, report.hasQueries)]} />
      </div>
      {report.hasQueries && (
        <div>
          <h3 className="gsc-h3">Search appearance</h3>
          <p className="ga4-sub gsc-tab-intro">Clicks from rich results and special result types. Empty or tiny numbers here mean the site isn&apos;t earning rich results (reviews, FAQ, video…). Schema markup is the fix.</p>
          <SearchTable
            rows={report.appearance.map((a) => ({ ...a, name: appearanceName(a.appearance) }))} rowKey={(r) => r.appearance} pageSize={10}
            emptyMsg="No rich results or special result types in this range." csvName={`${csvBase} search appearance.csv`}
            columns={[{ key: "name", label: "Result type", render: (r) => <span className="ga4-cell-title">{r.name}</span> }, ...metricCols(false)]} />
        </div>
      )}
    </div>
  );
}

// ── Sitemaps & indexing ───────────────────────────────────────────────────

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

export function IndexingTab({ report, inspections, onInspect, csvBase }) {
  const sitemaps = report.sitemaps;
  const checked = Object.values(inspections).filter((r) => r && !r.loading);
  const multiHost = useMultiHost(report.pages);
  const topPages = useMemo(() => [...report.pages].sort((a, b) => b.clicks - a.clicks).slice(0, 10).map((p) => p.page), [report.pages]);
  return (
    <div className="gsc-audience">
      <div>
        <h3 className="gsc-h3">Sitemaps</h3>
        {sitemaps === null ? (
          <p className="ga4-sub">Couldn&apos;t load sitemaps for this property.</p>
        ) : (
          <SearchTable
            rows={sitemaps} rowKey={(r) => r.path} defaultSort={{ key: "lastDownloaded", dir: "desc" }} pageSize={15}
            emptyMsg="No sitemaps submitted. Submit one in Search Console so Google finds every page."
            csvName={`${csvBase} sitemaps.csv`}
            rowClassName={(r) => (r.errors ? "ga4-row-flag" : "")}
            columns={[
              { key: "path", label: "Sitemap", render: (r) => <span className="ga4-cell-title gsc-url" title={r.path}>{shortUrl(r.path, { keepHost: true })}{r.isIndex ? " (index)" : ""}</span> },
              { key: "submitted", label: "URLs", num: true, render: (r) => fmtInt(r.submitted) },
              { key: "lastDownloaded", label: "Last read by Google", render: (r) => fmtDate(r.lastDownloaded) },
              { key: "lastSubmitted", label: "Submitted", render: (r) => fmtDate(r.lastSubmitted) },
              { key: "errors", label: "Errors", num: true, render: (r) => (r.errors ? <strong className="gsc-loss">{r.errors}</strong> : "0") },
              { key: "warnings", label: "Warnings", num: true },
              { key: "isPending", label: "Status", render: (r) => (r.isPending ? "Pending" : "Processed"), csv: (r) => (r.isPending ? "Pending" : "Processed") },
            ]}
          />
        )}
      </div>
      <div>
        <div className="gsc-tab-head gsc-row">
          <h3 className="gsc-h3">Page indexing checks</h3>
          <button type="button" className="ga4-btn gsc-btn-sm" onClick={() => onInspect(topPages)} disabled={!topPages.length}>Check top 10 pages</button>
        </div>
        <p className="ga4-sub gsc-tab-intro">
          Live URL Inspection for individual pages (Google allows ~2,000 checks a day per site, so this only runs when you ask). Results are kept for 24 hours. Use &ldquo;Check&rdquo; on any row in the Pages tab for other pages.
        </p>
        <SearchTable
          rows={checked} rowKey={(r) => r.url} defaultSort={{ key: "verdict", dir: "asc" }} pageSize={15}
          emptyMsg="No pages checked yet." csvName={`${csvBase} index checks.csv`}
          rowClassName={(r) => (r.verdict && r.verdict !== "PASS" ? "ga4-row-flag" : "")}
          columns={[
            { key: "url", label: "Page", render: (r) => <span className="ga4-cell-title gsc-url" title={r.url}>{shortUrl(r.url, { keepHost: multiHost })}</span> },
            { key: "verdict", label: "Status", render: (r) => <IndexBadge result={r} />, csv: (r) => r.verdict || r.error },
            { key: "coverage", label: "Coverage", render: (r) => r.coverage || r.error || "—" },
            { key: "lastCrawl", label: "Last crawl", render: (r) => fmtDate(r.lastCrawl) },
            { key: "canonical", label: "Canonical", sortable: false, csv: (r) => r.googleCanonical || "",
              render: (r) => {
                if (!r.googleCanonical) return "—";
                const same = r.googleCanonical === r.url || r.googleCanonical === r.userCanonical;
                return same ? "Matches" : <span className="gsc-loss" title={`Google chose ${r.googleCanonical}`}>Google chose another URL</span>;
              } },
            { key: "richResults", label: "Rich results", render: (r) => (r.richResults ? (r.richResults === "PASS" ? "Valid" : r.richResults) : "—") },
            { key: "link", label: "", sortable: false, csv: false,
              render: (r) => (r.link ? <a className="ga4-link" href={r.link} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Open ↗</a> : null) },
          ]}
        />
      </div>
    </div>
  );
}

// ── Detail drawer (query -> pages, page -> queries) ───────────────────────

export function DetailDrawer({ detail, report, onClose, onOpenQuery, onOpenPage }) {
  useEffect(() => {
    if (!detail) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [detail, onClose]);
  const multiHost = useMultiHost(report?.pages);
  if (!detail || !report) return null;

  const isQuery = detail.kind === "query";
  const rows = isQuery ? pagesForQuery(report.queryPages, detail.value) : queriesForPage(report.queryPages, detail.value);
  const summary = isQuery ? report.queries.find((q) => q.query === detail.value) : report.pages.find((p) => p.page === detail.value);

  return (
    <div className="gsc-drawer-backdrop" onClick={onClose}>
      <aside className="gsc-drawer" role="dialog" aria-modal="true" aria-label={isQuery ? "Pages for this query" : "Queries for this page"} onClick={(e) => e.stopPropagation()}>
        <div className="gsc-drawer-head">
          <div>
            <p className="ga4-kpi-label">{isQuery ? "Query" : "Page"}</p>
            <h2 className="ga4-h2 gsc-drawer-title">{isQuery ? detail.value : shortUrl(detail.value, { keepHost: true })}</h2>
            {!isQuery && <a className="ga4-link" href={detail.value} target="_blank" rel="noreferrer">Open page ↗</a>}
          </div>
          <button type="button" className="ga4-btn gsc-btn-sm" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {summary && (
          <div className="gsc-drawer-stats">
            <div><b>{fmtInt(summary.clicks)}</b><span>clicks</span></div>
            <div><b>{fmtInt(summary.impressions)}</b><span>impr.</span></div>
            <div><b>{fmtCtr(summary.ctr)}</b><span>CTR</span></div>
            <div><b>{fmtPos(summary.position)}</b><span>position</span></div>
          </div>
        )}
        <h3 className="gsc-h3">{isQuery ? `Pages ranking for it (${rows.length})` : `Queries it ranks for (${rows.length})`}</h3>
        {rows.length === 0 ? (
          <p className="ga4-sub">No {isQuery ? "page" : "query"} detail for this row. Search Console only returns the top 25,000 query + page pairs and leaves out anonymized queries; pairs with a single impression are skipped.</p>
        ) : (
          <SearchTable
            rows={rows} rowKey={(r) => (isQuery ? r.page : r.query)} pageSize={50}
            searchKeys={[isQuery ? "page" : "query"]}
            onRowClick={(r) => (isQuery ? onOpenPage(r.page) : onOpenQuery(r.query))}
            columns={[
              isQuery
                ? { key: "page", label: "Page", render: (r) => <span className="ga4-cell-title gsc-url" title={r.page}>{shortUrl(r.page, { keepHost: multiHost })}</span> }
                : { key: "query", label: "Query", render: (r) => <span className="ga4-cell-title">{r.query}</span> },
              ...metricCols(false),
            ]}
          />
        )}
      </aside>
    </div>
  );
}
