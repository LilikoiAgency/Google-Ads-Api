"use client";
export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import DashboardToolHeader from "../../components/DashboardToolHeader";
import DashboardLoader from "../../components/DashboardLoader";
import MobileFilterSheet from "../../components/MobileFilterSheet";
import { AnalyticsIcon } from "../../components/DashboardIcons";
import { selectView, pageNotes } from "@/lib/ga4View";
import { presetRange, autoGranularity, rangeLabel, compareRange } from "@/lib/ga4Dates";
import { downloadTrafficReport } from "@/lib/ga4ReportHtml";
import PropertyPicker from "./components/PropertyPicker";
import RangeControls from "./components/RangeControls";
import ViewToggle from "./components/ViewToggle";
import KpiRow from "./components/KpiRow";
import TrafficChart from "./components/TrafficChart";
import ChannelTable from "./components/ChannelTable";
import SourcesAndPages, { SOURCES_ANCHOR } from "./components/SourcesAndPages";
import ChannelDefinitions from "./components/ChannelDefinitions";
import AudiencePanels from "./components/AudiencePanels";
import DownloadMenu from "./components/DownloadMenu";
import { localToday, parseParams, buildQuery, resolveProperty, isUrlPropertyMissing } from "./urlState";
import { useTrafficReport, makeReportKey, fetchJson } from "./useTrafficReport";
import "../../../globals.css";
import "./ga4.css";

// ─── constants ────────────────────────────────────────────────────────────────

const PAGE_PATH = "/dashboard/google/analytics";
const LAST_PROPERTY_KEY = "ga4:lastProperty";

const NO_PROPERTIES =
  "No Google Analytics properties are connected yet. Ask the client's GA admin to add lilikoi-reporting@lilikoi-ads-analytics.iam.gserviceaccount.com as a Viewer (Admin → Account access management), then click Refresh list.";
const NO_DATA = "No traffic recorded for this range.";
const ERROR_COPY = {
  no_access: "lilikoi-reporting doesn't have access to this property anymore.",
  quota: "Google Analytics is rate-limiting us. Try again in a minute.",
  missing_key: "GA4_SA_KEY isn't set on this server.",
  unauthorized: "Your session has expired. Reload the page to sign in again.",
  bad_params: "That date range isn't valid. Pick another range.",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

function readStoredProperty() {
  try { return window.localStorage.getItem(LAST_PROPERTY_KEY); } catch { return null; }
}

function storeProperty(id) {
  try { window.localStorage.setItem(LAST_PROPERTY_KEY, id); } catch { /* storage unavailable */ }
}

function errorText(err) {
  return ERROR_COPY[err.code] || `Google Analytics returned an error: ${err.message}`;
}

// ─── small presentational pieces ─────────────────────────────────────────────

function Notice({ tone = "neutral", children, actions }) {
  return (
    <div className={`ga4-card ga4-notice ga4-notice-${tone}`} role={tone === "error" ? "alert" : undefined}>
      <p className="ga4-notice-text">{children}</p>
      {actions && <div className="ga4-notice-actions">{actions}</div>}
    </div>
  );
}

function FieldLabel({ children }) {
  return <p className="ga4-sheet-label">{children}</p>;
}

// ─── page ─────────────────────────────────────────────────────────────────────

function WebTrafficPage() {
  const router = useRouter();
  const { status } = useSession();
  const searchParams = useSearchParams();
  const [initial] = useState(() => parseParams(searchParams));
  const [today] = useState(localToday);

  // Properties
  const [properties, setProperties] = useState(null);
  const [propsError, setPropsError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // Controls (mirrored into the URL)
  const [propertyId, setPropertyId] = useState(null);
  const [rangeKey, setRangeKey] = useState(initial.rangeKey);
  const [custom, setCustom] = useState(initial.custom);
  const [compare, setCompare] = useState(initial.compare);
  const [view, setView] = useState(initial.view);
  const [granOverride, setGranOverride] = useState(initial.gran);

  const [retryNonce, setRetryNonce] = useState(0);

  const [filterOpen, setFilterOpen] = useState(false);

  // ── auth guard ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "unauthenticated") router.replace(`/?callbackUrl=${PAGE_PATH}`);
  }, [status, router]);

  // ── properties ────────────────────────────────────────────────────────────
  const loadProperties = useCallback(async (refresh) => {
    if (refresh) setRefreshing(true);
    setPropsError(null);
    try {
      const body = await fetchJson(`/api/ga4/properties${refresh ? "?refresh=1" : ""}`);
      setProperties(body?.properties || []);
    } catch (err) {
      setPropsError(err);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (status === "authenticated") loadProperties(false);
  }, [status, loadProperties]);

  // Pick the property: keep the current one if still listed, else the URL's,
  // else the last one used, else the first.
  useEffect(() => {
    if (!properties?.length) return;
    setPropertyId((current) =>
      resolveProperty({ properties, current, fromUrl: initial.property, stored: readStoredProperty() })
    );
  }, [properties, initial.property]);

  useEffect(() => {
    if (propertyId) storeProperty(propertyId);
  }, [propertyId]);

  // The first property picked on load; the "link's property isn't connected"
  // notice shows only while that fallback is still on screen.
  const [firstPropertyId, setFirstPropertyId] = useState(null);
  useEffect(() => {
    if (propertyId && firstPropertyId === null) setFirstPropertyId(propertyId);
  }, [propertyId, firstPropertyId]);

  // ── derived range ─────────────────────────────────────────────────────────
  const range = useMemo(
    () => (rangeKey === "custom" ? custom : presetRange(rangeKey, today)),
    [rangeKey, custom, today]
  );
  const autoGran = range ? autoGranularity(range) : "day";
  const granularity = granOverride || autoGran;
  const pendingCompareRange = useMemo(() => (range ? compareRange(range, compare) : null), [range, compare]);

  // ── URL sync ──────────────────────────────────────────────────────────────
  // history.replaceState (not router.replace): no history spam, and no
  // server round trip, so a view switch makes no network request at all.
  // Next 14.1+ keeps useSearchParams in sync with it.
  useEffect(() => {
    if (!propertyId) return;
    const qs = buildQuery({ property: propertyId, rangeKey, custom, compare, view, gran: granOverride });
    if (window.location.search !== qs) {
      window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs}`);
    }
  }, [propertyId, rangeKey, custom, compare, view, granOverride]);

  // ── report fetch ──────────────────────────────────────────────────────────
  const fetchKey = propertyId && range
    ? makeReportKey({ property: propertyId, startDate: range.startDate, endDate: range.endDate, compare, granularity })
    : null;
  const result = useTrafficReport(fetchKey, retryNonce);
  const { loading } = result;

  // While a new report loads, keep the previous one on screen (dimmed), but
  // only if it belongs to the same property.
  const report = result.report && result.report.property?.id === propertyId ? result.report : null;
  const reportError = !loading && result.key === fetchKey ? result.error : null;
  const stale = loading && !!report;

  const selected = useMemo(() => (report ? selectView(report, view) : null), [report, view]);
  const allTotals = report?.totalsByView?.all;
  const noData = !!report && !loading && !(allTotals?.sessions > 0) && !(allTotals?.users > 0);
  const showKeyEvents = !!report && (
    (report.totalsByView.all?.keyEvents || 0) > 0 || (report.totalsByViewCompare?.all?.keyEvents || 0) > 0
  );
  const hasCompare = !!(report?.compareRange && report?.totalsByViewCompare);
  const compareLabel = hasCompare ? rangeLabel(report.compareRange) : null;
  // A rate change against a period with no sessions means nothing.
  const kpiDeltas = selected
    ? { ...selected.deltas, engagementRate: selected.totalsCompare?.sessions > 0 ? selected.deltas.engagementRate : null }
    : {};

  const currentProperty = properties?.find((p) => p.id === propertyId) || null;
  const showUrlPropertyNotice = !!currentProperty && propertyId === firstPropertyId
    && isUrlPropertyMissing({ properties, fromUrl: initial.property });
  const notes = pageNotes(report, selected);
  const rangeText = range ? rangeLabel(range) : "";
  const compareText = pendingCompareRange ? `vs ${rangeLabel(pendingCompareRange)}` : "No comparison";

  // ── handlers ──────────────────────────────────────────────────────────────
  const onRangeChange = useCallback(({ rangeKey: key, custom: c }) => {
    setRangeKey(key);
    setCustom(c);
    setGranOverride(null); // a new range gets its natural granularity
  }, []);

  const onGranularityChange = (g) => setGranOverride(g === autoGran ? null : g);

  const onDownload = ({ view: openOn, views }) => {
    if (!report) return;
    try {
      downloadTrafficReport(report, { view: openOn, views });
    } catch (err) {
      console.error("[ga4] download failed", err);
      window.alert("Couldn't build the report file. Please try again.");
    }
  };

  const downloadDisabled = loading || !report || noData;
  const scrollToSources = () =>
    document.getElementById(SOURCES_ANCHOR)?.scrollIntoView({ behavior: "smooth", block: "start" });

  // ── render ────────────────────────────────────────────────────────────────
  if (status !== "authenticated") return <DashboardLoader label="Loading..." />;
  if (properties === null && !propsError) return <DashboardLoader label="Loading Google Analytics properties..." />;

  const hasProperties = !!properties?.length;
  const refreshButton = (
    <button type="button" className="ga4-btn" onClick={() => loadProperties(true)} disabled={refreshing}>
      {refreshing ? "Refreshing…" : "Refresh list"}
    </button>
  );

  const pickerProps = {
    properties: properties || [],
    value: propertyId,
    onChange: setPropertyId,
    onRefresh: () => loadProperties(true),
    refreshing,
  };
  const rangeProps = {
    rangeKey, range, today, compare,
    onRangeChange,
    onCompareChange: setCompare,
  };

  return (
    <div className="ga4-page">
      <DashboardToolHeader icon={<AnalyticsIcon />} title="Web Traffic (GA4)" subtitle="Google Analytics traffic by channel">
        {hasProperties && (
          <div className="desktop-only">
            <DownloadMenu currentView={view} disabled={downloadDisabled} onDownload={onDownload} />
          </div>
        )}
      </DashboardToolHeader>

      {hasProperties && (
        <>
          {/* Desktop controls */}
          <div className="ga4-toolbar desktop-only">
            <div className="ga4-field">
              <span className="ga4-field-label">Property</span>
              <PropertyPicker {...pickerProps} />
            </div>
            <RangeControls {...rangeProps} />
            <div className="ga4-range-summary" aria-live="polite">
              <span className="ga4-range-main">{rangeText}</span>
              <span className="ga4-range-vs">{compareText}</span>
            </div>
          </div>

          {/* Mobile controls */}
          <div className="ga4-mobile-bar mobile-only">
            <button type="button" className="ga4-chip" onClick={() => setFilterOpen(true)}>
              Filters <span aria-hidden="true">▾</span>
            </button>
            <span className="ga4-mobile-summary">
              <span className="ga4-mobile-prop">{currentProperty?.name}</span>
              <span className="ga4-mobile-range">{rangeText}</span>
            </span>
            <DownloadMenu compact currentView={view} disabled={downloadDisabled} onDownload={onDownload} />
          </div>
          <MobileFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
            {/* The sheet is always dark: resolve theme variables as dark inside it. */}
            <div data-theme="dark" className="ga4-sheet">
              <FieldLabel>Property</FieldLabel>
              <PropertyPicker {...pickerProps} />
              <FieldLabel>Dates</FieldLabel>
              <RangeControls {...rangeProps} stacked />
              <p className="ga4-sheet-summary">{rangeText} · {compareText}</p>
            </div>
          </MobileFilterSheet>
        </>
      )}

      <div className="ga4-body">
        {propsError && (
          <Notice tone="error" actions={refreshButton}>
            {ERROR_COPY[propsError.code] || `Couldn't load Google Analytics properties: ${propsError.message}`}
          </Notice>
        )}

        {properties && properties.length === 0 && !propsError && (
          <Notice actions={refreshButton}>{NO_PROPERTIES}</Notice>
        )}

        {hasProperties && propertyId && (
          <>
            {showUrlPropertyNotice && (
              <Notice>
                The property in this link isn&apos;t connected to lilikoi-reporting, so we&apos;re showing {currentProperty.name} instead.
              </Notice>
            )}
            <div className="ga4-view-row">
              <ViewToggle value={view} onChange={setView} />
              {loading && <span className="ga4-loading-pill"><span className="ga4-spinner" aria-hidden="true" />Loading traffic…</span>}
            </div>

            {reportError ? (
              <Notice
                tone="error"
                actions={
                  <>
                    <button type="button" className="ga4-btn" onClick={() => setRetryNonce((n) => n + 1)}>Try again</button>
                    {reportError.code === "no_access" && refreshButton}
                  </>
                }
              >
                {errorText(reportError)}
              </Notice>
            ) : noData ? (
              <Notice>{NO_DATA}</Notice>
            ) : (
              <div className={`ga4-content${stale ? " is-stale" : ""}`} aria-busy={loading}>
                <KpiRow
                  totals={selected?.totals}
                  deltas={kpiDeltas}
                  compareLabel={compareLabel}
                  showKeyEvents={showKeyEvents}
                  loading={!selected}
                />

                <TrafficChart
                  series={selected?.series}
                  granularity={granularity}
                  onGranularityChange={onGranularityChange}
                  viewLabel={selected?.view.label}
                  loading={!selected}
                />

                {selected ? (
                  <>
                    <section className="ga4-card ga4-panel">
                      <div className="ga4-panel-head">
                        <h2 className="ga4-h2">Channels</h2>
                        <p className="ga4-sub">{selected.view.label} · {rangeLabel(report.range)}{compareLabel ? ` vs ${compareLabel}` : ""}</p>
                      </div>
                      <ChannelTable
                        channels={selected.channels}
                        totals={selected.totals}
                        totalDeltas={kpiDeltas}
                        hasCompare={hasCompare}
                        showKeyEvents={showKeyEvents}
                      />
                    </section>

                    {notes.paid.length > 0 && (
                      <div className="ga4-warn" role="note">
                        <span className="ga4-warn-icon" aria-hidden="true">⚠</span>
                        <div className="ga4-warn-body">
                          <p className="ga4-warn-title">Internal note (not in the client download)</p>
                          <ul>
                            {notes.paid.map((w) => <li key={w}>{w}</li>)}
                          </ul>
                        </div>
                        <button type="button" className="ga4-link ga4-warn-link" onClick={scrollToSources}>See sources</button>
                      </div>
                    )}

                    {notes.quality.length > 0 && (
                      <p className="ga4-dq-note" role="note">
                        Data note: {notes.quality.join("; ")}. Small numbers may be approximate.
                      </p>
                    )}

                    <SourcesAndPages sources={selected.sources} pages={selected.pages} />
                    <AudiencePanels audience={selected.audience} showKeyEvents={showKeyEvents} />
                    <ChannelDefinitions viewKey={view} rangeText={rangeLabel(report.range)} />
                  </>
                ) : (
                  <div className="ga4-card ga4-skel" style={{ height: 220 }} />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function WebTrafficPageRoute() {
  return (
    <Suspense fallback={<DashboardLoader label="Loading..." />}>
      <WebTrafficPage />
    </Suspense>
  );
}
