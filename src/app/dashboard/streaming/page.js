"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import DashboardToolHeader from "../components/DashboardToolHeader";
import Papa from "papaparse";
import {
  validateFileType, processAll, filterData, createConversionsObject,
  impressionsByBreakdown, topNSiteResults, getConversionsByFrequency,
  createTDIDObject, countConvByPRIORUTMParam, createUserFilterOptions,
  getLPToConversionRateData, createCtvVsNoCtvStats, summaryStats,
} from "../../../lib/ptcProcessor";
import { CtvAppLookUp } from "../../../lib/ctvAppLookup";

const Plot = dynamic(() => import("react-plotly.js"), { ssr: false, loading: () => <div className="h-48 bg-gray-100 rounded-xl animate-pulse" /> });

// ── helpers ────────────────────────────────────────────────────────────────────
const n2  = (v, d = 2) => Number(v || 0).toLocaleString(undefined, { maximumFractionDigits: d });
const pct = (v)        => Number(v || 0).toLocaleString(undefined, { style: "percent", minimumFractionDigits: 0 });
const usd = (v)        => Number(v || 0).toLocaleString("en-US", { style: "currency", currency: "USD" });
const PLOTLY_CONFIG    = { responsive: true, displayModeBar: false };
const BAR_LAYOUT = (title, xVals) => ({
  title, barmode: "group", autosize: true,
  margin: { t: 40, b: 80, l: 50, r: 20 },
  xaxis: { tickmode: "array", tickvals: xVals, ticktext: xVals, type: "category", automargin: true },
});

function makeBarTraces(dataObj, y1Key, y1Name, y2Key, y2Name) {
  const x = Object.keys(dataObj);
  const traces = [{
    x, y: x.map((k) => dataObj[k][y1Key] || 0),
    name: y1Name, type: "bar", marker: { color: "#0098FA" },
  }];
  if (y2Key) {
    traces.push({
      x, y: x.map((k) => dataObj[k][y2Key] || 0),
      name: y2Name, type: "bar", marker: { color: "#002E87" },
    });
  }
  return traces;
}

// ── sub-components ─────────────────────────────────────────────────────────────

function StreamingIconSVG() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
      <rect x="2" y="12" width="44" height="28" rx="4" stroke="#0ea5e9" strokeWidth="2.5"/>
      <polygon points="21,22 21,30 30,26" fill="#0ea5e9"/>
    </svg>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
      <p className="text-2xl font-black text-blue-700">{value}</p>
      <p className="text-xs text-gray-500 mt-1">{label}</p>
    </div>
  );
}

function InfoTooltip({ text }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex items-center">
      <button
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-center w-4 h-4 rounded-full border border-gray-300 text-gray-400 hover:border-blue-400 hover:text-blue-500 transition text-[10px] font-bold leading-none"
        aria-label="More info"
      >i</button>
      {open && (
        <div className="absolute left-6 top-1/2 -translate-y-1/2 z-50 w-72 rounded-xl bg-gray-900 text-white text-xs px-3 py-2.5 shadow-xl leading-relaxed">
          {text}
          <div className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-3 h-3 bg-gray-900 rotate-45" />
        </div>
      )}
    </div>
  );
}

function SectionHeader({ title, icon, info }) {
  return (
    <div className="flex items-center gap-2 mb-4">
      {icon && <span className="text-xl">{icon}</span>}
      <h2 className="text-base font-bold text-gray-800">{title}</h2>
      {info && <InfoTooltip text={info} />}
    </div>
  );
}

function InsightBullet({ text }) {
  return <li className="text-sm text-gray-700 mb-1" dangerouslySetInnerHTML={{ __html: text }} />;
}

// ── UserPath component ─────────────────────────────────────────────────────────

function UserPathViewer({ tdidData }) {
  const { TDIDObject, specialTDIDs } = tdidData;
  const allUsers   = Object.keys(TDIDObject);
  const multiDev   = Object.keys(specialTDIDs);
  const [filterMultiDev, setFilterMultiDev] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  useEffect(() => {
    const pool = filterMultiDev && multiDev.length ? multiDev : allUsers;
    const idx  = Math.floor(Math.random() * pool.length);
    setCurrentUser(TDIDObject[pool[idx]] || TDIDObject[allUsers[0]]);
  }, [filterMultiDev]);

  useEffect(() => {
    const pool = multiDev.length ? multiDev : allUsers;
    setCurrentUser(TDIDObject[pool[0]] || TDIDObject[allUsers[0]]);
  }, []);

  const randomUser = () => {
    const pool = filterMultiDev && multiDev.length ? multiDev : allUsers;
    const idx  = Math.floor(Math.random() * pool.length);
    setCurrentUser(TDIDObject[pool[idx]]);
  };

  if (!currentUser) return null;

  const timestamps = currentUser.TimestampOrder || [];

  return (
    <div>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <button onClick={randomUser}
          className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-2 transition">
          Generate Random User
        </button>
        {multiDev.length > 0 && (
          <button
            onClick={() => setFilterMultiDev((v) => !v)}
            className={`rounded-lg border text-sm font-semibold px-4 py-2 transition ${filterMultiDev ? "bg-blue-100 border-blue-400 text-blue-700" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}
          >
            2+ Devices ({multiDev.length} users)
          </button>
        )}
      </div>

      <div className="overflow-x-auto pb-2">
        <div className="flex items-start gap-2 min-w-max">
          {/* Person icon */}
          <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 min-w-[80px]">
            <span className="text-2xl">👤</span>
            <span className="text-xs text-gray-500 mt-1">User</span>
          </div>

          {timestamps.map((ts, i) => {
            const ev      = currentUser[ts];
            if (!ev) return null;
            const isConv  = ev["Event Type"] === "Conversion";
            const site    = CtvAppLookUp[ev.Site] ? `${CtvAppLookUp[ev.Site]} (${ev.Site})` : (ev.Site || "");
            const devIcon = { ConnectedTV: "📺", Desktop: "🖥️", Mobile: "📱", Tablet: "📱" }[ev.Device] || "📡";
            return (
              <div key={ts} className="flex items-start gap-2">
                <span className="text-gray-400 mt-6 text-lg">→</span>
                <div className={`rounded-xl border px-3 py-2 min-w-[140px] max-w-[200px] text-xs ${isConv ? "border-green-300 bg-green-50" : "border-blue-200 bg-blue-50"}`}>
                  <p className="font-bold text-gray-700 mb-1">{isConv ? "✅ Conversion" : `${devIcon} ${ev["Event Type"] || "Impression"}`}</p>
                  <p className="text-gray-500 truncate">{ev.Time}</p>
                  {ev.Device && !isConv && <p className="text-gray-600 font-semibold">{ev.Device}</p>}
                  {site && <p className="text-gray-500 truncate" title={site}>{site}</p>}
                  {ev.Campaign && <p className="text-gray-400 truncate" title={ev.Campaign}>📢 {ev.Campaign}</p>}
                  {isConv && ev["Conversion Sub Category"] && <p className="text-green-700 font-semibold">{ev["Conversion Sub Category"]}</p>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── UTM Table ──────────────────────────────────────────────────────────────────

function UTMTable({ utmData }) {
  const tags   = Object.keys(utmData);
  if (!tags.length) return <p className="text-sm text-gray-400">No UTM data found.</p>;

  const allUTMs = [...new Set(tags.flatMap((t) => Object.keys(utmData[t])))];
  if (allUTMs.length < 2) return null;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-200">UTM Source</th>
            {tags.map((t) => (
              <th key={t} colSpan={2} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase border-b border-gray-200">{t}</th>
            ))}
          </tr>
          <tr className="bg-gray-50">
            <th className="px-3 py-2 border-b border-gray-200"></th>
            {tags.flatMap((t) => [
              <th key={t + "c"} className="px-3 py-2 text-xs text-gray-500 border-b border-gray-200">Conversions</th>,
              <th key={t + "r"} className="px-3 py-2 text-xs text-gray-500 border-b border-gray-200">Revenue</th>,
            ])}
          </tr>
        </thead>
        <tbody>
          {allUTMs.map((utm) => (
            <tr key={utm} className="border-b border-gray-100 hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-gray-700">{utm || "(none)"}</td>
              {tags.flatMap((t) => [
                <td key={t + utm + "c"} className="px-3 py-2 text-gray-600">{utmData[t]?.[utm]?.conversions || 0}</td>,
                <td key={t + utm + "r"} className="px-3 py-2 text-gray-600">{usd(utmData[t]?.[utm]?.revenue || 0)}</td>,
              ])}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function StreamingPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/");
  }, [status]);

  // ── state ──────────────────────────────────────────────────────────────────
  const [step,            setStep]           = useState("clients"); // clients | client | upload | processing | results
  const [fileName,        setFileName]       = useState("");
  const [rawData,         setRawData]        = useState([]);
  const [processedData,   setProcessedData]  = useState(null);
  const [intlDate,        setIntlDate]       = useState(false);
  const [filterOptions,   setFilterOptions]  = useState({});
  const [selectedFilters, setSelectedFilters] = useState({});
  const [clients,         setClients]        = useState([]);
  const [clientsLoading,  setClientsLoading] = useState(true);
  const [selectedClient,  setSelectedClient] = useState(null); // full client object
  const [savedReports,    setSavedReports]   = useState([]);
  const [reportsLoading,  setReportsLoading] = useState(false);
  const [saving,          setSaving]         = useState(false);
  const [saveStatus,      setSaveStatus]     = useState(null); // null | "ok" | "error"
  const [lpPixels,        setLpPixels]       = useState([]);
  const [convPixels,      setConvPixels]     = useState([]);
  const [lpRateData,      setLpRateData]     = useState(null);
  const [viewingReportId, setViewingReportId] = useState(null); // ID if viewing a saved report
  const fileInputRef = useRef();

  // ── fetch clients ──────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/admin/clients")
      .then((r) => r.json())
      .then((d) => setClients(d.clients || []))
      .catch(() => {})
      .finally(() => setClientsLoading(false));
  }, []);

  // ── select a client → load their saved reports ─────────────────────────────
  const selectClient = (client) => {
    setSelectedClient(client);
    setSavedReports([]);
    setReportsLoading(true);
    setStep("client");
    fetch(`/api/streaming/ptc?slug=${client.slug}`)
      .then((r) => r.json())
      .then((d) => setSavedReports(d.reports || []))
      .catch(() => {})
      .finally(() => setReportsLoading(false));
  };

  // ── load a saved report by ID → render charts ──────────────────────────────
  const loadSavedReport = async (reportId, reportFileName) => {
    setStep("processing");
    setFileName(reportFileName);
    setViewingReportId(reportId);
    try {
      const res  = await fetch(`/api/streaming/ptc?id=${reportId}`);
      const data = await res.json();
      if (data.report?.reportData) {
        // Reconstruct processedData shape from saved reportData
        const rd = data.report.reportData;
        setProcessedData({
          summary:         rd.summary         || {},
          deviceResults:   rd.deviceResults   || { "Breakdown Data": {} },
          siteResults:     rd.siteResults     || {},
          campaignResults: rd.campaignResults || { "Breakdown Data": {} },
          frequencyObj:    rd.frequencyObj    || {},
          tdidData:        null, // not saved — user path not available
          utmData:         rd.utmData         || {},
          filterOptions:   rd.filterOptions   || {},
          ctvStats:        rd.ctvStats        || {},
          dateRange:       rd.dateRange       || null,
        });
        setFilterOptions(rd.filterOptions || {});
        setSelectedFilters(
          Object.fromEntries(Object.keys(rd.filterOptions || {}).map((k) => [k, Object.keys(rd.filterOptions[k])]))
        );
        setRawData([]);
        setLpPixels([]);
        setConvPixels([]);
        setLpRateData(null);
        setSaveStatus("ok"); // already saved
        setStep("results");
      } else {
        alert("Could not load report.");
        setStep("client");
      }
    } catch {
      alert("Error loading report.");
      setStep("client");
    }
  };

  // ── CSV upload ─────────────────────────────────────────────────────────────
  const handleFile = useCallback((file) => {
    if (!file) return;
    setFileName(file.name);
    setStep("processing");
    setProcessedData(null);
    setSaveStatus(null);
    setLpRateData(null);

    const allRows = [];
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      chunkSize: 10_000_000, // 10MB chunks
      chunk: (results) => allRows.push(...results.data),
      complete: () => {
        if (!validateFileType(allRows)) {
          alert("Invalid file format. Please upload a Trade Desk Path-to-Conversion CSV.");
          setStep("upload");
          return;
        }
        setRawData(allRows);
        const opts = createUserFilterOptions(allRows);
        setFilterOptions(opts);
        setSelectedFilters(
          Object.fromEntries(Object.keys(opts).map((k) => [k, Object.keys(opts[k])]))
        );
        const result = processAll([...allRows], intlDate);
        setProcessedData(result);
        setLpPixels([]);
        setConvPixels([]);
        setViewingReportId(null);
        setSaveStatus(null);
        setStep("results");
      },
      error: () => { alert("Error reading file."); setStep("upload"); },
    });
  }, [intlDate]);

  const onFileInput = (e) => handleFile(e.target.files[0]);
  const onDrop      = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };
  const onDragOver  = (e) => e.preventDefault();

  // ── apply filters ──────────────────────────────────────────────────────────
  const applyFilters = () => {
    const filtered = filterData([...rawData], selectedFilters);
    const result   = processAll(filtered, intlDate);
    setProcessedData(result);
    setLpRateData(null);
  };

  // ── LP to conversion rate ──────────────────────────────────────────────────
  const generateLPRate = () => {
    if (!processedData || !lpPixels.length || !convPixels.length) return;
    const data = getLPToConversionRateData(processedData.tdidData.TDIDObject, lpPixels, convPixels);
    setLpRateData(data);
  };

  // ── save report ────────────────────────────────────────────────────────────
  const saveReport = async () => {
    if (!selectedClient || !processedData || viewingReportId) return;
    setSaving(true);
    setSaveStatus(null);
    try {
      const reportData = {
        summary:         processedData.summary,
        deviceResults:   processedData.deviceResults,
        siteResults:     processedData.siteResults,
        campaignResults: processedData.campaignResults,
        frequencyObj:    processedData.frequencyObj,
        utmData:         processedData.utmData,
        ctvStats:        processedData.ctvStats,
        filterOptions:   processedData.filterOptions,
        dateRange:       processedData.dateRange,
      };
      const res = await fetch("/api/streaming/ptc", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ slug: selectedClient.slug, clientName: selectedClient.name, fileName, reportData }),
      });
      const d = await res.json();
      if (d.ok) {
        setSaveStatus("ok");
        setViewingReportId(d.id);
        // Refresh saved reports list
        fetch(`/api/streaming/ptc?slug=${selectedClient.slug}`)
          .then((r) => r.json())
          .then((rd) => setSavedReports(rd.reports || []))
          .catch(() => {});
      } else {
        setSaveStatus("error");
      }
    } catch {
      setSaveStatus("error");
    } finally {
      setSaving(false);
    }
  };

  // ── client picker screen ───────────────────────────────────────────────────
  if (step === "clients") {
    return (
      <div className="flex flex-col flex-1">
        <DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle="Select a client to get started" />
        <div className="mx-auto max-w-4xl px-6 py-8">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Choose a Client</p>
          {/* Quick View — always shown first */}
          <button
            onClick={() => { setSelectedClient(null); setSavedReports([]); setStep("client"); }}
            className="group w-full text-left rounded-2xl border-2 border-dashed border-gray-300 bg-white p-5 hover:border-sky-400 hover:shadow-sm transition mb-6"
          >
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-gray-100 flex items-center justify-center text-2xl flex-shrink-0">⚡</div>
              <div className="flex-1">
                <p className="font-semibold text-gray-800">Quick View</p>
                <p className="text-xs text-gray-400 mt-0.5">Upload and analyze a CSV without saving to a client</p>
              </div>
              <svg className="w-4 h-4 text-gray-300 group-hover:text-sky-400 transition flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
            </div>
          </button>

          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-4">Or Choose a Client</p>

          {clientsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-white border border-gray-200 animate-pulse" />)}
            </div>
          ) : clients.length === 0 ? (
            <div className="text-center py-10">
              <p className="text-gray-400 text-sm">No clients configured yet.</p>
              <Link href="/dashboard/admin/clients" className="mt-3 inline-block text-sm font-semibold text-sky-600 hover:text-sky-800">
                Set up clients →
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {clients.map((c) => (
                <button key={c.slug} onClick={() => selectClient(c)}
                  className="group text-left rounded-2xl bg-white border border-gray-200 p-5 hover:border-sky-300 hover:shadow-md transition">
                  <div className="flex items-center gap-3">
                    {c.logo ? (
                      <img src={c.logo} alt={c.name} className="h-10 w-10 rounded-xl object-contain border border-gray-100 bg-white p-1 flex-shrink-0" />
                    ) : (
                      <div className="h-10 w-10 rounded-xl bg-sky-100 flex items-center justify-center text-sky-600 font-bold text-lg flex-shrink-0">
                        {(c.name || "?")[0].toUpperCase()}
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 truncate">{c.name}</p>
                      {c.streamingReportCount > 0 ? (
                        <p className="text-xs text-sky-600 font-medium mt-0.5">📺 {c.streamingReportCount} saved report{c.streamingReportCount !== 1 ? "s" : ""}</p>
                      ) : (
                        <p className="text-xs text-gray-400 mt-0.5">No reports yet</p>
                      )}
                    </div>
                    <svg className="w-4 h-4 text-gray-300 group-hover:text-sky-400 transition flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── client detail screen (upload + past reports) ───────────────────────────
  if (step === "client") {
    const fmtDR = (dr) => {
      if (!dr?.start) return null;
      const s = new Date(dr.start + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
      const e = dr.end ? new Date(dr.end + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : null;
      return e && e !== s ? `${s} – ${e}` : s;
    };
    return (
      <div className="flex flex-col flex-1">
        <DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle={selectedClient ? "Upload a report or view a previous one" : "Quick View — no client selected"}><button onClick={() => { setSelectedClient(null); setStep("clients"); }} style={{ display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"6px 12px",color:"rgba(255,255,255,0.7)",fontSize:12,cursor:"pointer" }}>← Back</button></DashboardToolHeader>
        <div className="mx-auto max-w-4xl px-6 py-8 space-y-8">

          {/* Upload new report */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Upload New Report</p>
            <div
              className="rounded-2xl bg-white border-2 border-dashed border-gray-300 hover:border-sky-400 transition p-10 text-center cursor-pointer"
              onClick={() => fileInputRef.current?.click()}
              onDrop={onDrop}
              onDragOver={onDragOver}
            >
              <p className="text-4xl mb-3">📂</p>
              <p className="font-semibold text-gray-700 mb-1">Drop your CSV here or click to browse</p>
              <p className="text-sm text-gray-400">Trade Desk Path-to-Conversion export</p>
              <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={(e) => { setStep("upload"); handleFile(e.target.files[0]); }} />
            </div>
            <label className="flex items-center gap-2 mt-3 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={intlDate} onChange={(e) => setIntlDate(e.target.checked)} />
              International date format (DD/MM/YYYY)
            </label>
          </div>

          {/* Previous reports */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Previous Reports</p>
            {reportsLoading ? (
              <div className="space-y-3">
                {[...Array(2)].map((_, i) => <div key={i} className="h-16 rounded-xl bg-white border border-gray-200 animate-pulse" />)}
              </div>
            ) : savedReports.length === 0 ? (
              <div className="rounded-2xl bg-white border border-gray-200 p-6 text-center text-sm text-gray-400">
                No reports saved yet for {selectedClient?.name}. Upload one above.
              </div>
            ) : (
              <div className="space-y-3">
                {savedReports.map((r) => {
                  const dr = fmtDR(r.reportData?.dateRange);
                  return (
                    <button key={r._id} onClick={() => loadSavedReport(r._id, r.fileName)}
                      className="w-full text-left rounded-2xl bg-white border border-gray-200 hover:border-sky-300 hover:shadow-sm transition p-4 flex items-center gap-4">
                      <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-sky-50 text-sky-500 flex-shrink-0 text-xl">📺</div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-gray-800 truncate">{r.fileName}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {dr && <span className="text-sky-600 font-medium">{dr} · </span>}
                          Uploaded {new Date(r.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                        </p>
                      </div>
                      <svg className="w-4 h-4 text-gray-300 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7"/></svg>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

        </div>
      </div>
    );
  }

  // ── processing screen ──────────────────────────────────────────────────────
  if (step === "processing") {
    return (
      <div className="flex flex-col flex-1">
        <DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle="Processing your file…" />
        <div className="flex flex-col items-center justify-center" style={{ minHeight: "calc(100vh - 73px)" }}>
          <div className="rounded-2xl bg-white border border-gray-200 p-10 text-center w-full max-w-md mx-6">
            <div className="text-4xl mb-4">⚙️</div>
            <p className="font-semibold text-gray-700">Processing <span className="text-sky-600">{fileName}</span>…</p>
            <p className="text-sm text-gray-400 mt-2">Parsing and aggregating your data</p>
            <div className="mt-4 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-2 bg-sky-500 rounded-full animate-pulse w-2/3" />
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── results screen ─────────────────────────────────────────────────────────
  if (!processedData) return null;
  const { summary, deviceResults, siteResults, campaignResults, frequencyObj, tdidData, utmData, ctvStats } = processedData;
  const hasCTV = !!deviceResults["Breakdown Data"]?.["ConnectedTV"];
  const trackingTags = Object.keys(filterOptions["Conversion Tracking Tag Name"] || {});

  // Frequency chart data
  const freqBuckets = Object.keys(frequencyObj.Overall || {}).sort((a, b) => Number(a) - Number(b));
  const freqX = freqBuckets.filter((f) => Number(f) < 30);
  const over30 = freqBuckets.some((f) => Number(f) >= 30);
  if (over30) freqX.push("30+");

  const freqTraces = Object.keys(frequencyObj).map((tag) => {
    const y = freqBuckets.filter((f) => Number(f) < 30).map((f) => frequencyObj[tag][f] || 0);
    if (over30) {
      const o30 = freqBuckets.filter((f) => Number(f) >= 30).reduce((s, f) => s + (frequencyObj[tag][f] || 0), 0);
      y.push(o30);
    }
    return { x: freqX, y, name: tag, type: "bar" };
  });

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle={fileName}>
        <button onClick={() => { setStep("client"); setProcessedData(null); setRawData([]); setViewingReportId(null); }} style={{ display:"flex",alignItems:"center",gap:4,background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.15)",borderRadius:8,padding:"6px 12px",color:"rgba(255,255,255,0.7)",fontSize:12,cursor:"pointer" }}>← Back</button>
        {viewingReportId ? (
          <span className="text-sm text-sky-400 font-medium">📺 Saved report</span>
        ) : selectedClient ? (
          <>
            <button
              onClick={saveReport}
              disabled={saving || !!saveStatus}
              className="rounded-lg bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white text-sm font-semibold px-4 py-2 transition"
            >
              {saving ? "Saving…" : "Save Report"}
            </button>
            {saveStatus === "ok"    && <span className="text-sm text-green-400 font-medium">✓ Saved!</span>}
            {saveStatus === "error" && <span className="text-sm text-red-400 font-medium">Save failed</span>}
          </>
        ) : (
          <span className="text-sm text-gray-400 font-medium">⚡ Quick View</span>
        )}
      </DashboardToolHeader>

      <div className="mx-auto max-w-6xl px-6 py-8 space-y-8">

        {/* ── Filters ── */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Filters</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {Object.entries(filterOptions).map(([field, opts]) => (
              <div key={field}>
                <p className="text-xs font-medium text-gray-600 mb-1">{field.replace("Event ", "")}</p>
                <div className="flex flex-wrap gap-1">
                  {Object.keys(opts).map((val) => {
                    const active = selectedFilters[field]?.includes(val) ?? true;
                    return (
                      <button key={val}
                        onClick={() => setSelectedFilters((prev) => {
                          const current = prev[field] || Object.keys(opts);
                          const next = active ? current.filter((v) => v !== val) : [...current, val];
                          return { ...prev, [field]: next };
                        })}
                        className={`rounded-full text-xs px-2.5 py-1 font-medium transition border ${active ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-500 border-gray-300 hover:border-blue-400"}`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          <button onClick={applyFilters}
            className="mt-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-5 py-2 transition">
            Apply Filters
          </button>
        </div>

        {/* ── Summary Stats ── */}
        <div>
          <SectionHeader title="Summary" icon="📊" info="High-level totals across all conversion paths in the file. Impressions per Conversion = total impressions ÷ total conversions. Days to Conversion measured from first or last impression timestamp to the conversion event timestamp." />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Object.entries(summary).map(([label, val]) => (
              <StatCard key={label} label={label} value={n2(val)} />
            ))}
          </div>
        </div>

        {/* ── Sample User Path ── */}
        {tdidData?.TDIDObject && Object.keys(tdidData.TDIDObject).length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 p-5">
            <SectionHeader title="Sample User Path" icon="👤" info="Shows the actual impression and conversion sequence for a single user (identified by Trade Desk ID). Each card is one touchpoint — device type, site, campaign, and timestamp — in chronological order. Use 'Generate Random User' to explore different journeys. '2+ Devices' filters to users who converted across multiple device types." />
            <UserPathViewer tdidData={tdidData} />
          </div>
        )}

        {/* ── Device Section ── */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <SectionHeader title="Cross-Device Paths" icon="📱" info="Breaks down conversions by device type (CTV, Desktop, Mobile, Tablet). First Touch = the device that delivered the very first impression on the conversion path. Last Touch = the device closest to the conversion. Impressions per Conversion = how many ads on this device type it took on average before converting. Days to Convert = average time from last impression on this device to the conversion event." />

          {hasCTV && ctvStats.ctvData && (
            <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
              {ctvStats.ctvData["Impressions per Conversion"] < ctvStats["Impressions per Conversion"] && (
                <>
                  <div>
                    <p className="text-xs text-gray-500 mb-2 font-semibold">Impressions Per Conversion: CTV vs No CTV</p>
                    <Plot
                      data={[{
                        x: ["No CTV On Path", "CTV On Path"],
                        y: [ctvStats["Impressions per Conversion"], ctvStats.ctvData["Impressions per Conversion"]],
                        type: "bar", marker: { color: "#0098FA" },
                      }]}
                      layout={BAR_LAYOUT("Impression Per Conversion", ["No CTV On Path", "CTV On Path"])}
                      config={PLOTLY_CONFIG}
                      style={{ width: "100%", height: 220 }}
                      useResizeHandler
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-500 mb-2 font-semibold">Avg Days to Conversion: CTV vs No CTV</p>
                    <Plot
                      data={[{
                        x: ["No CTV On Path", "CTV On Path"],
                        y: [ctvStats["Avg. Days From Last Impression to Conversion"], ctvStats.ctvData["Average Days From Last Imp To Conversion"]],
                        type: "bar", marker: { color: "#0098FA" },
                      }]}
                      layout={BAR_LAYOUT("Avg Days to Conversion (Last Imp)", ["No CTV On Path", "CTV On Path"])}
                      config={PLOTLY_CONFIG}
                      style={{ width: "100%", height: 220 }}
                      useResizeHandler
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Plot
              data={makeBarTraces(deviceResults["Breakdown Data"], "Conversions-FirstImp", "First Impression", "Conversions-LastImp", "Last Impression")}
              layout={BAR_LAYOUT("First & Last Impression Conversions", Object.keys(deviceResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 240 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(deviceResults["Breakdown Data"], "Impressions per Conversion", "Impressions per Conversion")}
              layout={BAR_LAYOUT("Impressions Per Conversion", Object.keys(deviceResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 240 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(deviceResults["Breakdown Data"], "Average Days From Last Imp To Conversion", "Avg Days to Convert")}
              layout={BAR_LAYOUT("Days to Convert (Last Impression)", Object.keys(deviceResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 240 }} useResizeHandler
            />
          </div>

          <ul className="list-disc list-inside space-y-1 mt-2">
            <InsightBullet text={`Avg of <strong>${n2(deviceResults.averageNumberofXTouched)}</strong> devices on conversion path.`} />
            <InsightBullet text={`<strong>${pct(deviceResults.percentConversionsWithMoreThanOneGrain)}</strong> of conversions touched more than one device.`} />
            {Object.entries(deviceResults["Least Impressions per Conversion"] || {}).map(([g, v]) =>
              g && <InsightBullet key={g} text={`<strong>${g}</strong> needed fewest impressions to convert (avg ${n2(v)}).`} />
            )}
          </ul>
        </div>

        {/* ── Site Section ── */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <SectionHeader title="Site Conversion Paths (Top 10)" icon="🌐" info="The top 10 streaming sites by conversion volume. A site 'appears on a conversion path' when at least one impression from that site was served to a user who eventually converted. First Touch = site that delivered the opening impression; Last Touch = site closest to conversion. Impressions per Conversion shows how many exposures on that site it took on average before a user converted." />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Plot
              data={makeBarTraces(siteResults, "Conversions-FirstImp", "First Impression", "Conversions-LastImp", "Last Impression")}
              layout={BAR_LAYOUT("First & Last Impression Conversions by Site", Object.keys(siteResults))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(siteResults, "Impressions per Conversion", "Impressions per Conversion")}
              layout={BAR_LAYOUT("Impressions Per Conversion by Site", Object.keys(siteResults))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(siteResults, "Average Days From Last Imp To Conversion", "Avg Days")}
              layout={BAR_LAYOUT("Days to Convert by Site", Object.keys(siteResults))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
          </div>
        </div>

        {/* ── Campaign Section ── */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <SectionHeader title="Campaign Conversion Paths" icon="📢" info="Same attribution logic as devices and sites, but broken out by campaign name. First Touch = campaign that made the first impression; Last Touch = campaign that made the final impression before conversion. Useful for identifying which campaigns open the funnel vs. which ones close it. '2+ campaigns on path' means the user was touched by more than one campaign before converting." />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
            <Plot
              data={makeBarTraces(campaignResults["Breakdown Data"], "Conversions-FirstImp", "First Impression", "Conversions-LastImp", "Last Impression")}
              layout={BAR_LAYOUT("First & Last Impression Conversions by Campaign", Object.keys(campaignResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(campaignResults["Breakdown Data"], "Impressions per Conversion", "Impressions per Conversion")}
              layout={BAR_LAYOUT("Impressions Per Conversion by Campaign", Object.keys(campaignResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
            <Plot
              data={makeBarTraces(campaignResults["Breakdown Data"], "Average Days From Last Imp To Conversion", "Avg Days")}
              layout={BAR_LAYOUT("Days to Convert by Campaign", Object.keys(campaignResults["Breakdown Data"]))}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
          </div>
          <ul className="list-disc list-inside space-y-1 mt-2">
            <InsightBullet text={`Avg of <strong>${n2(campaignResults.averageNumberofXTouched)}</strong> campaigns on conversion path.`} />
            <InsightBullet text={`<strong>${pct(campaignResults.percentConversionsWithMoreThanOneGrain)}</strong> of conversions had 2+ campaigns on path.`} />
          </ul>
        </div>

        {/* ── Frequency Distribution ── */}
        <div className="rounded-2xl bg-white border border-gray-200 p-5">
          <SectionHeader title="Frequency Distribution" icon="📈" info="Shows how many impressions were on the path before a user converted. X-axis = number of impressions (frequency); Y-axis = number of conversions at that frequency. The count chart shows raw volume; the % chart normalizes each tag so you can compare patterns across conversion types. Lower frequency with high conversions = efficient creative. Broken out by Conversion Tracking Tag." />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Plot
              data={freqTraces}
              layout={{ ...BAR_LAYOUT("Frequency Distribution — Conversion Count", freqX), barmode: "group" }}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
            <Plot
              data={freqTraces.map((t) => {
                const total = t.y.reduce((s, v) => s + (v || 0), 0);
                return { ...t, y: t.y.map((v) => total > 0 ? v / total : 0), type: "line" };
              })}
              layout={{ ...BAR_LAYOUT("Frequency Distribution — % of Conversions", freqX) }}
              config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
            />
          </div>
        </div>

        {/* ── LP to Conversion Rate ── */}
        {trackingTags.length > 1 && (
          <div className="rounded-2xl bg-white border border-gray-200 p-5">
            <SectionHeader title="Landing Page to Conversion Rate" icon="🎯" info="Measures how often a user who hit a landing page pixel (e.g. a site visit tag) went on to fire a conversion pixel (e.g. a lead or purchase tag). Select the LP pixel(s) and conversion pixel(s) from your tracking tags, then click Generate. Rate = users who hit both ÷ users who hit the LP only. Broken out by device type so you can see where drop-off happens." />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 mb-4">
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Landing Page Pixel(s)</p>
                <div className="flex flex-wrap gap-2">
                  {trackingTags.map((t) => (
                    <button key={t}
                      onClick={() => setLpPixels((p) => p.includes(t) ? p.filter((v) => v !== t) : [...p, t])}
                      className={`rounded-full text-xs px-3 py-1 font-medium border transition ${lpPixels.includes(t) ? "bg-blue-600 text-white border-blue-600" : "border-gray-300 text-gray-600 hover:border-blue-400"}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-medium text-gray-500 mb-2">Conversion Pixel(s)</p>
                <div className="flex flex-wrap gap-2">
                  {trackingTags.map((t) => (
                    <button key={t}
                      onClick={() => setConvPixels((p) => p.includes(t) ? p.filter((v) => v !== t) : [...p, t])}
                      className={`rounded-full text-xs px-3 py-1 font-medium border transition ${convPixels.includes(t) ? "bg-green-600 text-white border-green-600" : "border-gray-300 text-gray-600 hover:border-green-400"}`}
                    >{t}</button>
                  ))}
                </div>
              </div>
            </div>
            <button onClick={generateLPRate}
              disabled={!lpPixels.length || !convPixels.length}
              className="rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white text-sm font-semibold px-5 py-2 transition mb-4">
              Generate Chart
            </button>
            {lpRateData && (() => {
              const xs = Object.keys(lpRateData).filter((k) => k !== "Overall");
              return (
                <Plot
                  data={[{ x: xs, y: xs.map((k) => lpRateData[k]["LP to Conversion Rate"]), type: "bar", marker: { color: "#0098FA" }, name: "LP → Conv Rate" }]}
                  layout={BAR_LAYOUT("Landing Page to Conversion Rate (%)", xs)}
                  config={PLOTLY_CONFIG} style={{ width: "100%", height: 260 }} useResizeHandler
                />
              );
            })()}
          </div>
        )}

        {/* ── UTM Source ── */}
        {Object.keys(utmData).length > 0 && (
          <div className="rounded-2xl bg-white border border-gray-200 p-5">
            <SectionHeader title="UTM Source Data" icon="🔗" info="Counts conversions where a utm_source parameter was present on the conversion referrer URL earlier in the user's path — meaning the user had a prior web session from that source before converting on the streaming campaign. Broken out by Conversion Tracking Tag. Useful for understanding how paid search, organic, or email traffic overlaps with streaming exposure." />
            <UTMTable utmData={utmData} />
          </div>
        )}

      </div>
    </div>
  );
}
