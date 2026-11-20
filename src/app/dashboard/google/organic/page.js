"use client";
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../../components/DashboardToolHeader";
import DashboardLoader from "../../components/DashboardLoader";
import MobileFilterSheet from "../../components/MobileFilterSheet";
import { SearchConsoleIcon } from "../../components/DashboardIcons";
import PropertyPicker from "../analytics/components/PropertyPicker";
import RangeControls from "../analytics/components/RangeControls";
import { localToday } from "../analytics/urlState";
import { presetRange, autoGranularity, rangeLabel, compareRange } from "@/lib/ga4Dates";
import { SEARCH_TYPES, SEGMENTS, canSegment, segmentReport } from "@/lib/gscReport";
import { expectedCtrModel } from "@/lib/gscInsights";
import { ga4ByPath, normalizePath } from "@/lib/gscGa4Join";
import { downloadSearchReport } from "@/lib/gscReportHtml";
import { parseParams, buildQuery, siteLabel, siteKind } from "./urlState";
import { useSearchReport, makeSearchKey, fetchJson } from "./useSearchReport";
import SearchKpis from "./components/SearchKpis";
import SearchTrend from "./components/SearchTrend";
import BrandPanel from "./components/BrandPanel";
import {
  QueriesTab, PagesTab, GroupsTab, OpportunitiesTab, CannibalizationTab, AudienceTab, IndexingTab, DetailDrawer,
} from "./components/SearchTabs";
import "../../../globals.css";
import "../analytics/ga4.css";
import "./organic.css";

const PAGE_PATH = "/dashboard/google/organic";
const LAST_SITE_KEY = "gsc:lastSite";

const ERROR_COPY = {
  no_access: "The connected Google account can't read this Search Console property anymore.",
  quota: "Search Console is rate-limiting us. Try again in a minute.",
  gsc_not_connected: "Search Console isn't connected (or the connection expired).",
  unauthorized: "Your session has expired. Reload the page to sign in again.",
  bad_params: "That request wasn't valid. Pick another range.",
};

function readStored() {
  try { return window.localStorage.getItem(LAST_SITE_KEY); } catch { return null; }
}
function store(site) {
  try { window.localStorage.setItem(LAST_SITE_KEY, site); } catch { /* storage unavailable */ }
}

function Notice({ tone = "neutral", children, actions }) {
  return (
    <div className={`ga4-card ga4-notice ga4-notice-${tone}`} role={tone === "error" ? "alert" : undefined}>
      <p className="ga4-notice-text">{children}</p>
      {actions && <div className="ga4-notice-actions">{actions}</div>}
    </div>
  );
}

// Which GA4 property the Pages tab joins with, and a way to change it.
function Ga4Link({ ga4, properties, onLoadProperties, onPick }) {
  const [open, setOpen] = useState(false);
  if (!ga4) return null;
  if (ga4.loading) return <p className="gsc-ga4-line">Matching GA4 landing pages…</p>;
  return (
    <div className="gsc-ga4-line">
      {ga4.error ? <span>GA4 data unavailable: {ga4.error}</span>
        : ga4.propertyName ? <span>Sessions and key events from GA4 <b>{ga4.propertyName}</b> (google / organic){ga4.matchedBy === "stream" ? ", matched by domain" : ""}.</span>
          : <span>No GA4 property found for this domain, so the Pages tab shows Search Console data only.</span>}
      {!open ? (
        <button type="button" className="ga4-link" onClick={() => { setOpen(true); onLoadProperties(); }}>
          {ga4.propertyName ? "Change" : "Pick a GA4 property"}
        </button>
      ) : (
        <select className="ga4-control gsc-ga4-select" defaultValue="" onChange={(e) => { onPick(e.target.value || null); setOpen(false); }}>
          <option value="" disabled>{properties ? "Choose a property…" : "Loading…"}</option>
          {(properties || []).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.account})</option>)}
          <option value="">Auto-match by domain</option>
        </select>
      )}
    </div>
  );
}

const TAB_LIST = [
  { key: "queries", label: "Queries", needsQueries: true },
  { key: "pages", label: "Pages" },
  { key: "groups", label: "Site sections" },
  { key: "opportunities", label: "Opportunities", needsQueries: true },
  { key: "cannibalization", label: "Competing pages", needsQueries: true },
  { key: "audience", label: "Devices & countries" },
  { key: "indexing", label: "Indexing & sitemaps" },
];

function OrganicPage() {
  const router = useRouter();
  const { status } = useSession();
  const searchParams = useSearchParams();
  const [initial] = useState(() => parseParams(searchParams));
  const [today] = useState(localToday);

  const [sites, setSites] = useState(null);
  const [connected, setConnected] = useState(null);
  const [sitesError, setSitesError] = useState(null);
  const [site, setSite] = useState(null);

  const [rangeKey, setRangeKey] = useState(initial.rangeKey);
  const [custom, setCustom] = useState(initial.custom);
  const [compare, setCompare] = useState(initial.compare);
  const [type, setType] = useState(initial.type);
  const [tab, setTab] = useState(initial.tab);
  const [seg, setSeg] = useState(initial.seg);
  const [granOverride, setGranOverride] = useState(initial.gran);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [filterOpen, setFilterOpen] = useState(false);

  const [settings, setSettings] = useState(null);
  const [brandVersion, setBrandVersion] = useState(0);
  const [ga4, setGa4] = useState(null);
  const [ga4Props, setGa4Props] = useState(null);
  const [inspections, setInspections] = useState({});
  const [detail, setDetail] = useState(null);
  const [actionError, setActionError] = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace(`/?callbackUrl=${PAGE_PATH}`);
  }, [status, router]);

  // ── sites ───────────────────────────────────────────────────────────────
  const loadSites = useCallback(async () => {
    setSitesError(null);
    try {
      const d = await fetchJson("/api/gsc-sites");
      setConnected(!!d.connected);
      setSites(d.sites || []);
    } catch (err) {
      setSitesError(err);
      setSites([]);
    }
  }, []);
  useEffect(() => { if (status === "authenticated") loadSites(); }, [status, loadSites]);

  useEffect(() => {
    if (!sites?.length) return;
    setSite((cur) => {
      const listed = (s) => !!s && sites.some((x) => x.url === s);
      if (listed(cur)) return cur;
      if (cur === null && listed(initial.site)) return initial.site;
      const stored = readStored();
      if (listed(stored)) return stored;
      return sites[0].url;
    });
  }, [sites, initial.site]);
  useEffect(() => { if (site) store(site); }, [site]);

  // Per-site state resets when the site changes.
  useEffect(() => {
    setInspections({});
    setDetail(null);
    setSettings(null);
    if (!site) return;
    let live = true;
    fetchJson(`/api/gsc/settings?siteUrl=${encodeURIComponent(site)}`)
      .then((s) => { if (live) setSettings(s); })
      .catch(() => { if (live) setSettings({ siteUrl: site, brandTerms: [], annotations: [], ga4Property: null }); });
    return () => { live = false; };
  }, [site]);

  // ── range ───────────────────────────────────────────────────────────────
  const range = useMemo(() => (rangeKey === "custom" ? custom : presetRange(rangeKey, today)), [rangeKey, custom, today]);
  const autoGran = range ? autoGranularity(range) : "day";
  const granularity = granOverride || autoGran;
  const pendingCompare = useMemo(() => (range ? compareRange(range, compare) : null), [range, compare]);

  useEffect(() => {
    if (!site) return;
    const qs = buildQuery({ site, rangeKey, custom, compare, type, tab, gran: granOverride, seg });
    if (window.location.search !== qs) window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs}`);
  }, [site, rangeKey, custom, compare, type, tab, granOverride, seg]);

  // ── report ──────────────────────────────────────────────────────────────
  const fetchKey = site && range && settings
    ? makeSearchKey({ site, startDate: range.startDate, endDate: range.endDate, compare, type, brandVersion })
    : null;
  const result = useSearchReport(fetchKey, { refreshNonce });
  const { loading } = result;
  const report = result.report && result.report.site === site ? result.report : null;
  const reportError = !loading && result.key === fetchKey ? result.error : null;
  const stale = loading && !!report;
  const hasCompare = !!report?.compareRange;
  const compareLabel = hasCompare ? rangeLabel(report.compareRange) : null;
  const brandTerms = settings?.brandTerms || [];
  const ctrAt = useMemo(() => expectedCtrModel(report?.queries || []), [report]);
  const noData = !!report && !loading && !(report.totals.impressions > 0);
  // Branded / non-branded view of the report (the "All searches" view is the report itself).
  const segmentable = canSegment(report);
  const activeSeg = segmentable ? seg : "all";
  const view = useMemo(() => segmentReport(report, activeSeg), [report, activeSeg]);
  const segLabel = SEGMENTS.find((x) => x.key === activeSeg)?.label;
  const tabs = TAB_LIST.filter((t) => !t.needsQueries || report?.hasQueries !== false);
  const activeTab = tabs.some((t) => t.key === tab) ? tab : "pages";

  // ── GA4 landing pages (web search only) ─────────────────────────────────
  const ga4Property = settings?.ga4Property ?? null;
  useEffect(() => {
    setGa4(null);
    if (!site || !range || type !== "web" || !settings) return undefined;
    const ctrl = new AbortController();
    setGa4({ loading: true });
    const qs = new URLSearchParams({ siteUrl: site, startDate: range.startDate, endDate: range.endDate });
    fetchJson(`/api/gsc/ga4-pages?${qs}`, { signal: ctrl.signal })
      .then((d) => {
        if (ctrl.signal.aborted) return;
        if (!d.property) { setGa4({ propertyName: null }); return; }
        const map = ga4ByPath(d.rows);
        setGa4({
          propertyName: d.property.name, matchedBy: d.matchedBy, byPath: map,
          lookup: (url) => map.get(normalizePath(url)) || null,
        });
      })
      .catch((err) => { if (!ctrl.signal.aborted && err?.name !== "AbortError") setGa4({ error: err.message }); });
    return () => ctrl.abort();
  }, [site, range?.startDate, range?.endDate, type, ga4Property, settings !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── settings writes ─────────────────────────────────────────────────────
  const saveSettings = useCallback(async (patch) => {
    setActionError(null);
    try {
      const saved = await fetchJson("/api/gsc/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: site, ...patch }),
      });
      setSettings(saved);
      return saved;
    } catch (err) {
      setActionError(`Couldn't save: ${err.message}`);
      throw err;
    }
  }, [site]);

  const onSaveTerms = async (terms) => {
    await saveSettings({ brandTerms: terms });
    setBrandVersion((v) => v + 1);
  };
  const onAddAnnotation = (a) => saveSettings({ annotations: [...(settings?.annotations || []), a] });
  const onRemoveAnnotation = (id) => saveSettings({ annotations: (settings?.annotations || []).filter((a) => a.id !== id) }).catch(() => {});
  const onPickGa4 = (id) => saveSettings({ ga4Property: id }).catch(() => {});
  const loadGa4Props = () => {
    if (ga4Props) return;
    fetchJson("/api/ga4/properties").then((d) => setGa4Props(d.properties || [])).catch(() => setGa4Props([]));
  };

  // ── URL inspection ──────────────────────────────────────────────────────
  const onInspect = useCallback(async (urls) => {
    const todo = urls.filter((u) => !inspections[u] || inspections[u].error);
    if (!todo.length) return;
    setInspections((m) => ({ ...m, ...Object.fromEntries(todo.map((u) => [u, { url: u, loading: true }])) }));
    try {
      const d = await fetchJson("/api/gsc/inspect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteUrl: site, urls: todo.slice(0, 10) }),
      });
      setInspections((m) => ({ ...m, ...Object.fromEntries(d.results.map((r) => [r.url, r])) }));
    } catch (err) {
      setInspections((m) => ({ ...m, ...Object.fromEntries(todo.map((u) => [u, { url: u, error: err.message }])) }));
    }
  }, [inspections, site]);

  const onRangeChange = useCallback(({ rangeKey: k, custom: c }) => {
    setRangeKey(k);
    setCustom(c);
    setGranOverride(null);
  }, []);
  const openQuery = useCallback((q) => setDetail({ kind: "query", value: q }), []);
  const openPage = useCallback((p) => setDetail({ kind: "page", value: p }), []);
  const closeDetail = useCallback(() => setDetail(null), []);

  const onDownload = () => {
    if (!report) return;
    try {
      downloadSearchReport(view, { brandTerms, granularity });
    } catch (err) {
      console.error("[gsc] download failed", err);
      window.alert("Couldn't build the report file. Please try again.");
    }
  };

  // ── render ──────────────────────────────────────────────────────────────
  if (status !== "authenticated") return <DashboardLoader label="Loading..." />;
  if (sites === null) return <DashboardLoader label="Loading Search Console properties..." />;

  const siteOptions = (sites || []).map((s) => ({ id: s.url, name: siteLabel(s.url), account: siteKind(s.url) }));
  const pickerProps = { properties: siteOptions, value: site, onChange: setSite, onRefresh: loadSites, refreshing: false };
  const rangeProps = { rangeKey, range, today, compare, onRangeChange, onCompareChange: setCompare };
  const typeSelect = (
    <label className="ga4-field">
      <span className="ga4-field-label">Search type</span>
      <select className="ga4-control ga4-select" value={type} onChange={(e) => setType(e.target.value)}>
        {SEARCH_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
      </select>
    </label>
  );
  const rangeText = range ? rangeLabel(range) : "";
  const compareText = pendingCompare ? `vs ${rangeLabel(pendingCompare)}` : "No comparison";
  const prelimInRange = report?.firstIncompleteDate && report.firstIncompleteDate <= report.range.endDate;
  const csvBase = `${siteLabel(site)} ${rangeText}`.replace(/[\\/:*?"<>|–]/g, "-");
  const hasSites = connected && sites.length > 0;
  const downloadBtn = (
    <button type="button" className="ga4-btn ga4-btn-primary" onClick={onDownload} disabled={!report || loading || noData}>
      Download report
    </button>
  );

  return (
    <div className="ga4-page">
      <DashboardToolHeader icon={<SearchConsoleIcon />} title="Organic Search" subtitle="Google Search Console performance">
        {hasSites && <div className="desktop-only">{downloadBtn}</div>}
      </DashboardToolHeader>

      {hasSites && (
        <>
          <div className="ga4-toolbar desktop-only">
            <div className="ga4-field">
              <span className="ga4-field-label">Site</span>
              <PropertyPicker {...pickerProps} />
            </div>
            <RangeControls {...rangeProps} />
            {typeSelect}
            <div className="ga4-range-summary" aria-live="polite">
              <span className="ga4-range-main">{rangeText}</span>
              <span className="ga4-range-vs">{compareText}</span>
            </div>
          </div>
          <div className="ga4-mobile-bar mobile-only">
            <button type="button" className="ga4-chip" onClick={() => setFilterOpen(true)}>Filters <span aria-hidden="true">▾</span></button>
            <span className="ga4-mobile-summary">
              <span className="ga4-mobile-prop">{siteLabel(site)}</span>
              <span className="ga4-mobile-range">{rangeText}</span>
            </span>
          </div>
          <MobileFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
            <div data-theme="dark" className="ga4-sheet">
              <p className="ga4-sheet-label">Site</p>
              <PropertyPicker {...pickerProps} />
              <p className="ga4-sheet-label">Dates</p>
              <RangeControls {...rangeProps} stacked />
              <p className="ga4-sheet-label">Search type</p>
              <select className="ga4-control ga4-select" style={{ width: "100%" }} value={type} onChange={(e) => setType(e.target.value)}>
                {SEARCH_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <p className="ga4-sheet-summary">{rangeText} · {compareText}</p>
            </div>
          </MobileFilterSheet>
        </>
      )}

      <div className="ga4-body">
        {sitesError && <Notice tone="error" actions={<button type="button" className="ga4-btn" onClick={loadSites}>Try again</button>}>Couldn&apos;t load Search Console properties: {sitesError.message}</Notice>}

        {!sitesError && connected === false && (
          <Notice actions={<a className="ga4-btn ga4-btn-primary" href="/api/gsc-auth">Connect Search Console</a>}>
            Connect the agency&apos;s Google account to Search Console to see clicks, impressions, rankings and indexing for client sites.
          </Notice>
        )}
        {!sitesError && connected && sites.length === 0 && (
          <Notice actions={<button type="button" className="ga4-btn" onClick={loadSites}>Refresh list</button>}>
            The connected Google account has no Search Console properties. Ask the client to add it as a user in Search Console (Settings → Users and permissions).
          </Notice>
        )}

        {hasSites && site && (
          <>
            <div className="ga4-view-row gsc-status-row">
              {report?.hasQueries && (
                <div className="gsc-seg-wrap">
                  <div className="ga4-segment" role="group" aria-label="Branded or non-branded searches">
                    {SEGMENTS.map((x) => (
                      <button key={x.key} type="button" disabled={!segmentable && x.key !== "all"}
                        className={`ga4-segment-btn${activeSeg === x.key ? " is-active" : ""}`}
                        aria-pressed={activeSeg === x.key} onClick={() => setSeg(x.key)}>{x.label}</button>
                    ))}
                  </div>
                  {!segmentable && !loading && (
                    <span className="gsc-seg-hint">
                      {brandTerms.length ? "Refresh to load the branded split." : "Add brand terms below to filter branded vs non-branded."}
                    </span>
                  )}
                </div>
              )}
              {loading && <span className="ga4-loading-pill"><span className="ga4-spinner" aria-hidden="true" />Loading Search Console…</span>}
              {report && !loading && (
                <span className="gsc-fetched">
                  Updated {new Date(report.fetchedAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
                  <button type="button" className="ga4-link" onClick={() => setRefreshNonce((n) => n + 1)}>Refresh</button>
                </span>
              )}
              <span className="mobile-only">{downloadBtn}</span>
            </div>

            {actionError && <Notice tone="error">{actionError}</Notice>}

            {reportError ? (
              <Notice tone="error" actions={
                <>
                  <button type="button" className="ga4-btn" onClick={() => setRefreshNonce((n) => n + 1)}>Try again</button>
                  {reportError.code === "gsc_not_connected" && <a className="ga4-btn ga4-btn-primary" href="/api/gsc-auth">Reconnect</a>}
                </>
              }>
                {ERROR_COPY[reportError.code] || `Search Console returned an error: ${reportError.message}`}
              </Notice>
            ) : noData ? (
              <Notice>No {type === "web" ? "" : `${SEARCH_TYPES.find((t) => t.key === type)?.label} `}search impressions for this site in this range.</Notice>
            ) : (
              <div className={`ga4-content${stale ? " is-stale" : ""}`} aria-busy={loading}>
                {activeSeg !== "all" && (
                  <p className="ga4-dq-note gsc-seg-note" role="note">
                    Showing <b>{segLabel.toLowerCase()}</b> searches only ({activeSeg === "brand" ? "queries containing" : "queries without"} {brandTerms.map((t) => `“${t}”`).join(", ")}). Searches Google keeps private are in neither, so branded + non-branded add up to less than all searches. Devices, countries and indexing always show all searches.
                  </p>
                )}
                <SearchKpis totals={view?.totals} prev={view?.totalsCompare} compareLabel={compareLabel}
                  hasPosition={report?.hasQueries !== false} loading={!report} />

                {prelimInRange && (
                  <p className="ga4-dq-note" role="note">
                    Data from {rangeLabel({ startDate: report.firstIncompleteDate, endDate: report.firstIncompleteDate })} on is preliminary: Google is still counting, so recent days usually rise.
                  </p>
                )}

                <SearchTrend
                  trend={view?.trend} trendCompare={view?.trendCompare} granularity={granularity}
                  onGranularityChange={(g) => setGranOverride(g === autoGran ? null : g)}
                  firstIncompleteDate={report?.firstIncompleteDate} annotations={settings?.annotations || []}
                  onAddAnnotation={onAddAnnotation} onRemoveAnnotation={onRemoveAnnotation}
                  hasPosition={report?.hasQueries !== false} loading={!report}
                />

                {report?.hasQueries && (
                  <BrandPanel brand={report.brand} terms={brandTerms} site={site} totals={report.totals}
                    granularity={granularity} onSaveTerms={onSaveTerms} hasCompare={hasCompare} />
                )}

                {report ? (
                  <section className="ga4-card ga4-panel gsc-tabs-card">
                    <div className="gsc-tabs" role="tablist" aria-label="Report sections">
                      {tabs.map((t) => (
                        <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
                          className={`gsc-tab${activeTab === t.key ? " is-active" : ""}`} onClick={() => setTab(t.key)}>
                          {t.label}
                        </button>
                      ))}
                    </div>
                    <div className="gsc-tab-body" role="tabpanel">
                      {activeTab === "queries" && <QueriesTab report={view} brandTerms={brandTerms} onOpenQuery={openQuery} csvBase={csvBase} />}
                      {activeTab === "pages" && (
                        <>
                          {type === "web" && <Ga4Link ga4={ga4} properties={ga4Props} onLoadProperties={loadGa4Props} onPick={onPickGa4} />}
                          <PagesTab report={view} ga4={ga4} inspections={inspections} onInspect={onInspect} onOpenPage={openPage} csvBase={csvBase} />
                        </>
                      )}
                      {activeTab === "groups" && <GroupsTab report={view} csvBase={csvBase} />}
                      {activeTab === "opportunities" && <OpportunitiesTab report={view} ctrAt={ctrAt} brandTerms={brandTerms} onOpenQuery={openQuery} onOpenPage={openPage} csvBase={csvBase} />}
                      {activeTab === "cannibalization" && <CannibalizationTab report={report} brandTerms={brandTerms} onOpenQuery={openQuery} />}
                      {activeTab === "audience" && <AudienceTab report={report} csvBase={csvBase} />}
                      {activeTab === "indexing" && <IndexingTab report={report} inspections={inspections} onInspect={onInspect} csvBase={csvBase} />}
                    </div>
                  </section>
                ) : (
                  <div className="ga4-card ga4-skel" style={{ height: 320 }} />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <DetailDrawer detail={detail} report={view} onClose={closeDetail} onOpenQuery={openQuery} onOpenPage={openPage} />
    </div>
  );
}

export default function OrganicPageRoute() {
  return (
    <Suspense fallback={<DashboardLoader label="Loading..." />}>
      <OrganicPage />
    </Suspense>
  );
}
