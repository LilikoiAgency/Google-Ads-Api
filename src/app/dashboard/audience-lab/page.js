"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import "../../globals.css";
import DashboardToolHeader from "../components/DashboardToolHeader";
import DashboardLoader from "../components/DashboardLoader";
import { AudienceLabIcon } from "../components/DashboardIcons";
import { isAdmin } from "../../../lib/admins";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return "Never";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
}

function fmtDateShort(d) {
  if (!d) return "Never";
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function timeAgo(d) {
  if (!d) return "";
  const s = Math.floor((Date.now() - new Date(d)) / 1000);
  if (s < 60)   return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDuration(ms) {
  if (!ms) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ─── status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status, size = "md" }) {
  const map = {
    success: "bg-green-100 text-green-700",
    error:   "bg-red-100   text-red-700",
    skipped: "bg-yellow-100 text-yellow-700",
  };
  const dot = { success: "bg-green-500", error: "bg-red-500", skipped: "bg-yellow-500" };
  const cls = map[status] || "bg-gray-100 text-gray-500";
  const d   = dot[status] || "bg-gray-400";
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs";
  if (!status) return <span className="text-xs text-gray-400 italic">No runs yet</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-semibold ${cls} ${pad}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${d}`} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

// ─── sync log row ──────────────────────────────────────────────────────────────

function SyncLogRow({ log }) {
  const isError = log.status === "error";
  return (
    <div className={`grid grid-cols-[auto_1fr] gap-x-3 px-5 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition ${isError ? "bg-red-50/30" : ""}`}>
      {/* left: dot + status */}
      <div className="flex flex-col items-center gap-1 pt-0.5">
        <span className={`w-2 h-2 rounded-full flex-shrink-0 ${log.status === "success" ? "bg-green-500" : log.status === "error" ? "bg-red-500" : "bg-yellow-500"}`} />
        <span className="w-px flex-1 bg-gray-100" />
      </div>
      {/* right: details */}
      <div className="pb-3">
        <div className="flex items-center gap-2 flex-wrap mb-1">
          <StatusBadge status={log.status} size="sm" />
          <span className="text-xs font-semibold text-gray-700">{(log.rowsInserted || 0).toLocaleString()} rows written</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500">{(log.sourceRecords || 0).toLocaleString()} fetched</span>
          <span className="text-xs text-gray-400">·</span>
          <span className="text-xs text-gray-500">{fmtDuration(log.durationMs)}</span>
          <span className={`ml-auto rounded px-1.5 py-0.5 text-xs font-medium ${log.triggeredBy === "cron" ? "bg-blue-50 text-blue-600" : "bg-purple-50 text-purple-600"}`}>
            {log.triggeredBy === "cron" ? "⏰ Cron" : "👤 Manual"}
          </span>
        </div>
        <p className="text-xs text-gray-400">{fmtDate(log.completedAt)}{log.runId && <span className="ml-2 font-mono text-gray-300">{log.runId}</span>}</p>
        {log.errorMessage && (
          <p className="mt-1 text-xs text-red-600 font-medium bg-red-50 rounded px-2 py-1">⚠ {log.errorMessage}</p>
        )}
      </div>
    </div>
  );
}

// ─── activity log item ─────────────────────────────────────────────────────────

const ACTION_STYLES = {
  created:  { icon: "✦", bg: "bg-green-100",  text: "text-green-700",  label: "Added"   },
  updated:  { icon: "✎", bg: "bg-blue-100",   text: "text-blue-700",   label: "Updated" },
  paused:   { icon: "⏸", bg: "bg-yellow-100", text: "text-yellow-700", label: "Paused"  },
  resumed:  { icon: "▶", bg: "bg-green-100",  text: "text-green-700",  label: "Resumed" },
  deleted:  { icon: "✕", bg: "bg-red-100",    text: "text-red-700",    label: "Deleted" },
};

function ActivityItem({ log }) {
  const s = ACTION_STYLES[log.action] || { icon: "·", bg: "bg-gray-100", text: "text-gray-600", label: log.action };
  return (
    <div className="flex items-start gap-3 py-3 border-b border-gray-50 last:border-0">
      <div className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-sm font-bold ${s.bg} ${s.text}`}>
        {s.icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-800">
          <span className="font-semibold">{log.userName || log.userEmail}</span>
          {" "}<span className={`font-medium ${s.text}`}>{s.label.toLowerCase()}</span>{" "}
          <span className="font-semibold">{log.segmentName || log.segmentKey}</span>
        </p>
        <p className="text-xs text-gray-400 mt-0.5">{log.userEmail} · {fmtDate(log.timestamp)}</p>
      </div>
      <span className="text-xs text-gray-400 flex-shrink-0 whitespace-nowrap">{timeAgo(log.timestamp)}</span>
    </div>
  );
}

// ─── main page ─────────────────────────────────────────────────────────────────

const EMPTY_FORM = { key: "", name: "", segmentId: "", tableId: "", active: true, slot: "" };

// Slots 0–9 = segments, 10–19 = audiences
const AUDIENCE_SLOT_START = 10;

export default function AudienceLabPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const userEmail = session?.user?.email || "";
  const isAdminUser = isAdmin(userEmail);

  const [activeTab, setActiveTab]         = useState("segments"); // "segments" | "audiences"
  const [slots, setSlots]                 = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [modal, setModal]                 = useState(null);
  const [form, setForm]                   = useState(EMPTY_FORM);
  const [saving, setSaving]               = useState(false);
  const [saveError, setSaveError]         = useState(null);
  const [running, setRunning]             = useState({});
  const [runResult, setRunResult]         = useState({});
  const [runPreview, setRunPreview]       = useState({});
  const [previewExpanded, setPreviewExpanded] = useState({});
  const [expandedLogs, setExpandedLogs]   = useState({});
  const [activityLogs, setActivityLogs]   = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [openMenu, setOpenMenu]           = useState(null);

  useEffect(() => {
    if (status === "unauthenticated") router.replace("/?callbackUrl=/dashboard/audience-lab");
  }, [status, router]);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch("/api/audience-lab/segments");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load");
      setSlots(json.slots || []);
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  };

  const loadActivity = async () => {
    setActivityLoading(true);
    try {
      const res  = await fetch("/api/audience-lab/logs?type=activity&limit=30");
      const json = await res.json();
      setActivityLogs(json.logs || []);
    } catch {}
    finally { setActivityLoading(false); }
  };

  useEffect(() => {
    if (status === "authenticated") { load(); loadActivity(); }
  }, [status]);

  const openAdd  = (slot) => {
    setForm({ ...EMPTY_FORM, slot: slot !== null ? String(slot) : "", entityType: activeTab === "audiences" ? "audience" : "segment" });
    setSaveError(null);
    setModal({ mode: "add", slot, entityType: activeTab === "audiences" ? "audience" : "segment" });
  };
  const openEdit = (seg)  => {
    setForm({ key: seg.key, name: seg.name, segmentId: seg.segmentId, tableId: seg.tableId, active: seg.active, slot: String(seg.slot), entityType: seg.entityType || "segment" });
    setSaveError(null);
    setModal({ mode: "edit", segment: seg, entityType: seg.entityType || "segment" });
  };
  const closeModal = ()   => { setModal(null); setSaveError(null); };

  const handleSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      if (modal.mode === "add") {
        const payload = { ...form, slot: form.slot !== "" ? Number(form.slot) : undefined, entityType: form.entityType || "segment" };
        const res  = await fetch("/api/audience-lab/segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to create");
      } else {
        const res  = await fetch(`/api/audience-lab/segments?key=${modal.segment.key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.name, segmentId: form.segmentId, tableId: form.tableId, active: form.active }) });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to update");
      }
      closeModal(); await load(); await loadActivity();
    } catch (e) { setSaveError(e.message); }
    finally     { setSaving(false); }
  };

  const handleDelete = async (key, entityType = "segment") => {
    const typeLabel = entityType === "audience" ? "audience" : "segment";
    if (!confirm(`Delete ${typeLabel} "${key}"? This cannot be undone.`)) return;
    const res  = await fetch(`/api/audience-lab/segments?key=${key}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) { alert(json.error || "Delete failed"); return; }
    await load(); await loadActivity();
  };

  const handleToggle = async (seg) => {
    await fetch(`/api/audience-lab/segments?key=${seg.key}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !seg.active }) });
    await load(); await loadActivity();
  };

  const toggleLogs = async (seg) => {
    const key = seg.key;
    if (expandedLogs[key]) { setExpandedLogs((l) => ({ ...l, [key]: null })); return; }
    setExpandedLogs((l) => ({ ...l, [key]: "loading" }));
    try {
      const res  = await fetch(`/api/audience-lab/logs?type=sync&key=${key}&limit=20`);
      const json = await res.json();
      setExpandedLogs((l) => ({ ...l, [key]: json.logs || [] }));
    } catch { setExpandedLogs((l) => ({ ...l, [key]: [] })); }
  };


  const refreshLogsIfOpen = async (key) => {
    if (!expandedLogs[key]) return;
    try {
      const res  = await fetch(`/api/audience-lab/logs?type=sync&key=${key}&limit=20`);
      const json = await res.json();
      setExpandedLogs((l) => ({ ...l, [key]: json.logs || [] }));
    } catch {}
  };

  const handleManualRun = async (seg) => {
    setOpenMenu(null);
    setRunning((r) => ({ ...r, [seg.key]: true }));
    setRunResult((r) => ({ ...r, [seg.key]: null }));
    try {
      const res  = await fetch(`/api/audience-lab/sync?mode=write&slot=${seg.slot}&triggered_by=manual`);
      const json = await res.json();
      const msg  = json.result
        ? `✅ ${(json.result.rowsInserted ?? 0).toLocaleString()} rows written to BigQuery`
        : json.error
          ? `❌ ${json.error}`
          : json.message || "Done";
      setRunResult((r) => ({ ...r, [seg.key]: msg }));
      await load();
      await loadActivity();
      // Always open + refresh logs so user can see the new entry (or the error)
      setExpandedLogs((l) => ({ ...l, [seg.key]: "loading" }));
      const res2  = await fetch(`/api/audience-lab/logs?type=sync&key=${seg.key}&limit=20`);
      const json2 = await res2.json();
      setExpandedLogs((l) => ({ ...l, [seg.key]: json2.logs || [] }));
    } catch (e) { setRunResult((r) => ({ ...r, [seg.key]: `❌ ${e.message}` })); }
    finally {
      setRunning((r) => ({ ...r, [seg.key]: false }));
      setTimeout(() => setRunResult((r) => ({ ...r, [seg.key]: null })), 12000);
    }
  };

  const handleRunNow = async (seg) => {
    setRunning((r) => ({ ...r, [seg.key]: true }));
    setRunResult((r) => ({ ...r, [seg.key]: null }));
    setRunPreview((p) => ({ ...p, [seg.key]: null }));
    setPreviewExpanded((e) => ({ ...e, [seg.key]: false }));
    try {
      const res  = await fetch(`/api/audience-lab/sync?mode=dry-run&slot=${seg.slot}&triggered_by=manual`);
      const json = await res.json();
      setRunResult((r) => {
        let msg = json.message || json.error || "Done";
        if (json.result) {
          const fetched = (json.result.sourceRecords ?? 0).toLocaleString();
          const total   = json.result.totalRecords != null ? json.result.totalRecords.toLocaleString() : null;
          msg = total && total !== fetched
            ? `✅ ${fetched} / ${total} records fetched`
            : `✅ ${fetched} records found`;
        }
        return { ...r, [seg.key]: msg };
      });
      if (json.result?.preview) {
        setRunPreview((p) => ({ ...p, [seg.key]: json.result.preview }));
      }
      // Auto-open logs so user can see the dry-run entry
      setExpandedLogs((l) => ({ ...l, [seg.key]: "loading" }));
      const res2  = await fetch(`/api/audience-lab/logs?type=sync&key=${seg.key}&limit=20`);
      const json2 = await res2.json();
      setExpandedLogs((l) => ({ ...l, [seg.key]: json2.logs || [] }));
    } catch (e) { setRunResult((r) => ({ ...r, [seg.key]: `❌ ${e.message}` })); }
    finally {
      setRunning((r) => ({ ...r, [seg.key]: false }));
      setTimeout(() => {
        setRunResult((r) => ({ ...r, [seg.key]: null }));
        setRunPreview((p) => ({ ...p, [seg.key]: null }));
        setPreviewExpanded((e) => ({ ...e, [seg.key]: false }));
      }, 30000);
    }
  };

  if (status === "loading") return <DashboardLoader label="Loading..." />;

  const isAudienceTab    = activeTab === "audiences";
  const tabSlots         = slots.filter((s) =>
    isAudienceTab ? s.slot >= AUDIENCE_SLOT_START : s.slot < AUDIENCE_SLOT_START
  );
  const tabOccupied      = tabSlots.filter((s) => s.occupied).length;
  const tabMax           = 10;
  const allSegmentCount  = slots.filter((s) => s.occupied && (s.segment?.entityType || "segment") === "segment").length;
  const allAudienceCount = slots.filter((s) => s.occupied && s.segment?.entityType === "audience").length;

  return (
    <div className="flex flex-col flex-1">

      <DashboardToolHeader
        icon={<AudienceLabIcon />}
        title="Audience Lab"
        subtitle={`${tabOccupied} of ${tabMax} ${isAudienceTab ? "audience" : "segment"} slots used · Syncs every Monday`}
      >
        {isAdminUser && (
          <button
            onClick={() => openAdd(null)}
            className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition px-4 py-2 text-sm font-semibold text-white"
          >
            <span className="text-base leading-none">+</span> Add {isAudienceTab ? "Audience" : "Segment"}
          </button>
        )}
      </DashboardToolHeader>

      {/* ── Tabs ── */}
      <div className="px-6 py-3 border-b border-white/10">
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("segments")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeTab === "segments" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
          >Segments</button>
          <button
            onClick={() => setActiveTab("audiences")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeTab === "audiences" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
          >Audiences</button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="bg-gray-50 min-h-[calc(100vh-73px)]">
        <div className="mx-auto max-w-6xl px-6 py-8">

          {error && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">⚠️ {error}</div>}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

            {/* ── Slot cards ── */}
            <div className="grid gap-3">
              {loading ? (
                [...Array(7)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100 animate-pulse" />)
              ) : tabSlots.length === 0 ? (
                <div className="rounded-2xl bg-white border border-dashed border-gray-200 px-6 py-10 text-center">
                  <p className="text-sm text-gray-400">No {isAudienceTab ? "audiences" : "segments"} added yet.</p>
                </div>
              ) : (
                tabSlots.map(({ slot, schedule, occupied: occ, segment }) => (
                  <div key={slot} className={`rounded-2xl bg-white shadow-sm transition ${occ ? "border border-gray-100" : "border border-dashed border-gray-200"}`}>

                    {/* Row */}
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ${occ ? (isAudienceTab ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700") : "bg-gray-100 text-gray-400"}`}>
                        {slot}
                      </div>

                      {occ ? (
                        <>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="font-semibold text-gray-900 text-sm">{segment.name}</p>
                              <StatusBadge status={segment.lastSyncStatus} size="sm" />
                              {!segment.active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">Paused</span>}
                            </div>
                            <p className="text-xs text-gray-400 mt-0.5">
                              <span className="font-mono">{segment.tableId}</span>
                            </p>
                            <p className="text-xs text-gray-400 mt-0.5">
                              Last sync: {fmtDateShort(segment.lastSyncedAt)}
                              {segment.lastSyncCount != null && ` · ${segment.lastSyncCount.toLocaleString()} rows`}
                            </p>
                            {runResult[segment.key] && (
                              <div className="mt-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className={`text-xs font-medium ${isAudienceTab ? "text-blue-700" : "text-purple-700"}`}>{runResult[segment.key]}</p>
                                  {runPreview[segment.key]?.rawRows?.length > 0 && (
                                    <button
                                      onClick={() => setPreviewExpanded((e) => ({ ...e, [segment.key]: !e[segment.key] }))}
                                      className="text-xs font-medium text-amber-600 hover:text-amber-700 underline underline-offset-2 transition"
                                    >
                                      Fields {previewExpanded[segment.key] ? "▲" : "▾"}
                                    </button>
                                  )}
                                </div>
                                {previewExpanded[segment.key] && runPreview[segment.key]?.rawRows?.length > 0 && (() => {
                                  const ADDRESS_FIELDS = new Set([
                                    "PERSONAL_ADDRESS","ADDRESS","SKIPTRACE_ADDRESS",
                                    "PERSONAL_CITY","CITY","HOME_CITY","MAILING_CITY","SKIPTRACE_CITY",
                                    "PERSONAL_STATE","STATE","HOME_STATE","MAILING_STATE","SKIPTRACE_STATE",
                                    "PERSONAL_ZIP","ZIP","HOME_ZIP","MAILING_ZIP","SKIPTRACE_ZIP",
                                  ]);
                                  const sampleRow = runPreview[segment.key].rawRows[0];
                                  const fields = runPreview[segment.key].previewFields || Object.keys(sampleRow);
                                  return (
                                    <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 overflow-hidden">
                                      <p className="px-3 py-1.5 text-xs font-semibold text-amber-800 bg-amber-100 border-b border-amber-200">
                                        Raw API fields · 1 sample row
                                      </p>
                                      <div className="divide-y divide-amber-100 max-h-64 overflow-y-auto">
                                        {fields.map((field) => {
                                          const val = sampleRow[field];
                                          const isAddr = ADDRESS_FIELDS.has(field);
                                          const display = val == null ? <span className="text-gray-400 italic">null</span>
                                            : Array.isArray(val) ? val.join(", ")
                                            : String(val);
                                          return (
                                            <div key={field} className={`flex items-start gap-2 px-3 py-1.5 text-xs ${isAddr ? "bg-amber-50" : ""}`}>
                                              <span className={`font-mono font-semibold flex-shrink-0 ${isAddr ? "text-amber-700" : "text-gray-600"}`}>
                                                {field}{isAddr ? " ★" : ""}
                                              </span>
                                              <span className="text-gray-500 break-all">{display}</span>
                                            </div>
                                          );
                                        })}
                                      </div>
                                    </div>
                                  );
                                })()}
                              </div>
                            )}
                          </div>

                          <div className="hidden sm:block text-right flex-shrink-0">
                            <p className="text-xs font-semibold text-gray-500">{schedule}</p>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {/* Test dry-run */}
                            <button onClick={() => handleRunNow(segment)} disabled={running[segment.key]}
                              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition">
                              {running[segment.key] ? "…" : "Test"}
                            </button>

                            {/* Logs toggle */}
                            <button onClick={() => toggleLogs(segment)}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${expandedLogs[segment.key] ? (isAudienceTab ? "border-blue-300 bg-blue-50 text-blue-700" : "border-purple-300 bg-purple-50 text-purple-700") : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                              {expandedLogs[segment.key] === "loading" ? "…" : "Logs"}
                            </button>

                            {/* ⋯ menu */}
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setOpenMenu(openMenu === segment.key ? null : segment.key); }}
                                className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition"
                              >
                                •••
                              </button>

                              {openMenu === segment.key && (
                                <>
                                  {/* Invisible overlay — click outside to close */}
                                  <div className="fixed inset-0 z-40" onClick={() => setOpenMenu(null)} />
                                  {/* Dropdown */}
                                  <div className="absolute right-0 top-full mt-1 z-50 w-44 rounded-xl bg-white shadow-xl border border-gray-100 overflow-hidden">
                                    <button
                                      onClick={() => handleManualRun(segment)}
                                      disabled={running[segment.key]}
                                      className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition disabled:opacity-50"
                                    >
                                      <span>▶</span> Run Now
                                    </button>
                                    {isAdminUser && (
                                      <>
                                        <div className="border-t border-gray-100" />
                                        <button
                                          onClick={() => { setOpenMenu(null); openEdit(segment); }}
                                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                                        >
                                          <span>✎</span> Edit
                                        </button>
                                        <button
                                          onClick={() => { setOpenMenu(null); handleToggle(segment); }}
                                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition"
                                        >
                                          <span>{segment.active ? "⏸" : "▶"}</span> {segment.active ? "Pause" : "Resume"}
                                        </button>
                                        <div className="border-t border-gray-100" />
                                        <button
                                          onClick={() => { setOpenMenu(null); handleDelete(segment.key, segment.entityType); }}
                                          className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition"
                                        >
                                          <span>✕</span> Delete
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="flex-1">
                            <p className="text-sm text-gray-400 font-medium">Empty slot</p>
                            <p className="text-xs text-gray-300">{schedule}</p>
                          </div>
                          {isAdminUser && (
                            <button onClick={() => openAdd(slot)}
                              className={`rounded-lg border border-dashed px-3 py-1.5 text-xs font-semibold transition ${isAudienceTab ? "border-blue-300 text-blue-500 hover:bg-blue-50" : "border-purple-300 text-purple-500 hover:bg-purple-50"}`}>
                              + Assign
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Sync log history */}
                    {occ && expandedLogs[segment.key] && expandedLogs[segment.key] !== "loading" && (
                      <div className="border-t border-gray-100 rounded-b-2xl overflow-hidden">
                        <div className="flex items-center justify-between px-5 py-2.5 bg-gray-50 border-b border-gray-100">
                          <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Sync History</p>
                          <p className="text-xs text-gray-400">{expandedLogs[segment.key].length} runs stored</p>
                        </div>
                        {expandedLogs[segment.key].length === 0 ? (
                          <p className="px-5 py-5 text-xs text-gray-400 text-center">No runs recorded yet — logs appear after the first sync.</p>
                        ) : (
                          <div className="px-2">
                            {expandedLogs[segment.key].map((log, i) => <SyncLogRow key={log.runId || i} log={log} />)}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* ── Activity feed ── */}
            <div className="rounded-2xl bg-white shadow-sm border border-gray-100 overflow-hidden sticky top-6">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <p className="text-sm font-bold text-gray-900">Activity</p>
                <button onClick={loadActivity} className="text-xs text-purple-600 hover:underline">Refresh</button>
              </div>
              {activityLoading ? (
                <div className="p-5 space-y-3">
                  {[...Array(4)].map((_, i) => <div key={i} className="h-10 rounded-lg bg-gray-100 animate-pulse" />)}
                </div>
              ) : activityLogs.length === 0 ? (
                <p className="px-5 py-8 text-xs text-gray-400 text-center">No activity yet — changes will appear here.</p>
              ) : (
                <div className="px-4 max-h-[600px] overflow-y-auto">
                  {activityLogs.map((log, i) => <ActivityItem key={i} log={log} />)}
                </div>
              )}
            </div>

          </div>
        </div>
      </div>

      {/* ── Modal ── */}
      {modal && (() => {
        const isAud      = modal.entityType === "audience";
        const typeLabel  = isAud ? "Audience" : "Segment";
        const accentSave = isAud ? "bg-blue-600 hover:bg-blue-500" : "bg-purple-600 hover:bg-purple-500";
        const accentFocus = isAud ? "focus:border-blue-400" : "focus:border-purple-400";
        const accentToggle = isAud ? "bg-blue-600" : "bg-purple-600";
        const slotMin    = isAud ? 10 : 0;
        const slotMax    = isAud ? 19 : 9;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
                <div>
                  <h2 className="text-base font-bold text-gray-900">
                    {modal.mode === "add" ? `Add ${typeLabel}` : `Edit — ${modal.segment.name}`}
                  </h2>
                  {modal.mode === "add" && (
                    <p className="text-xs text-gray-400 mt-0.5">
                      {isAud ? "Broad audience list · slots 10–19" : "Behavior-based segment · slots 0–9"}
                    </p>
                  )}
                </div>
                <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
              <div className="px-6 py-5 space-y-4">
                {modal.mode === "add" && (
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Slot ({slotMin}–{slotMax}, blank = auto)
                    </span>
                    <input type="number" min={slotMin} max={slotMax} value={form.slot} onChange={(e) => setForm((f) => ({ ...f, slot: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none ${accentFocus}`} placeholder="Auto-assign" />
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Display Name</span>
                  <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    className={`mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none ${accentFocus}`}
                    placeholder={isAud ? "e.g. Southwest Homeowners" : "e.g. Ranger Electric"} />
                </label>
                {modal.mode === "add" && (
                  <label className="block">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Key (unique ID)</span>
                    <input type="text" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                      className={`mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none ${accentFocus}`}
                      placeholder={isAud ? "e.g. southwest_homeowners" : "e.g. ranger_electric"} />
                  </label>
                )}
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                    Audience Lab {typeLabel} ID
                  </span>
                  <input type="text" value={form.segmentId} onChange={(e) => setForm((f) => ({ ...f, segmentId: e.target.value }))}
                    className={`mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none ${accentFocus}`}
                    placeholder={`UUID from Audience Lab`} />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">BigQuery Table ID</span>
                  <input type="text" value={form.tableId} onChange={(e) => setForm((f) => ({ ...f, tableId: e.target.value }))}
                    className={`mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none ${accentFocus}`}
                    placeholder={isAud ? "e.g. audience_southwest_homeowners" : "e.g. ranger_interested_electric_segment"} />
                </label>
                <label className="flex items-center gap-3 cursor-pointer" onClick={() => setForm((f) => ({ ...f, active: !f.active }))}>
                  <div className={`relative w-10 h-6 rounded-full transition ${form.active ? accentToggle : "bg-gray-200"}`}>
                    <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${form.active ? "left-5" : "left-1"}`} />
                  </div>
                  <span className="text-sm font-medium text-gray-700">{form.active ? "Active" : "Paused"}</span>
                </label>
                {saveError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {saveError}</p>}
              </div>
              <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
                <button onClick={closeModal} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
                <button onClick={handleSave} disabled={saving} className={`rounded-xl ${accentSave} disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white transition`}>
                  {saving ? "Saving…" : modal.mode === "add" ? `Add ${typeLabel}` : "Save Changes"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
