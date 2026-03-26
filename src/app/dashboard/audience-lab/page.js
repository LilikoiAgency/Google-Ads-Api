"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import "../../globals.css";

const ADMIN_EMAILS = ["frank@lilikoiagency.com"];

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

export default function AudienceLabPage() {
  const router = useRouter();
  const { data: session, status } = useSession();

  const userEmail = session?.user?.email || "";
  const isAdminUser = ADMIN_EMAILS.includes(userEmail.toLowerCase());

  const [slots, setSlots]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  const [modal, setModal]             = useState(null);
  const [form, setForm]               = useState(EMPTY_FORM);
  const [saving, setSaving]           = useState(false);
  const [saveError, setSaveError]     = useState(null);
  const [running, setRunning]         = useState({});
  const [runResult, setRunResult]     = useState({});
  const [expandedLogs, setExpandedLogs] = useState({});
  const [activityLogs, setActivityLogs] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);

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

  const openAdd  = (slot) => { setForm({ ...EMPTY_FORM, slot: slot !== null ? String(slot) : "" }); setSaveError(null); setModal({ mode: "add", slot }); };
  const openEdit = (seg)  => { setForm({ key: seg.key, name: seg.name, segmentId: seg.segmentId, tableId: seg.tableId, active: seg.active, slot: String(seg.slot) }); setSaveError(null); setModal({ mode: "edit", segment: seg }); };
  const closeModal = ()   => { setModal(null); setSaveError(null); };

  const handleSave = async () => {
    setSaving(true); setSaveError(null);
    try {
      if (modal.mode === "add") {
        const res  = await fetch("/api/audience-lab/segments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, slot: form.slot !== "" ? Number(form.slot) : undefined }) });
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

  const handleDelete = async (key) => {
    if (!confirm(`Delete segment "${key}"? This cannot be undone.`)) return;
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

  const handleRunNow = async (seg) => {
    setRunning((r) => ({ ...r, [seg.key]: true }));
    setRunResult((r) => ({ ...r, [seg.key]: null }));
    try {
      const res  = await fetch(`/api/audience-lab/sync?mode=dry-run&slot=${seg.slot}`);
      const json = await res.json();
      setRunResult((r) => ({ ...r, [seg.key]: json.result ? `✅ ${(json.result.sourceRecords ?? 0).toLocaleString()} records found` : json.message || json.error || "Done" }));
    } catch (e) { setRunResult((r) => ({ ...r, [seg.key]: `❌ ${e.message}` })); }
    finally {
      setRunning((r) => ({ ...r, [seg.key]: false }));
      setTimeout(() => setRunResult((r) => ({ ...r, [seg.key]: null })), 8000);
    }
  };

  if (status === "loading") return (
    <div className="flex min-h-screen items-center justify-center bg-customPurple-dark">
      <img src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif" alt="Loading" className="w-24 h-24" />
    </div>
  );

  const occupied = slots.filter((s) => s.occupied).length;

  return (
    <div className="min-h-screen bg-customPurple-dark">

      {/* ── Header ── */}
      <header className="border-b border-white/10 bg-customPurple-dark px-6 py-4">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/dashboard" className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-sm text-white hover:bg-white/20 transition">←</Link>
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white">
              <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none">
                <rect x="3"  y="3"  width="7" height="7" rx="1" fill="#4285F4"/>
                <rect x="14" y="3"  width="7" height="7" rx="1" fill="#EA4335"/>
                <rect x="3"  y="14" width="7" height="7" rx="1" fill="#34A853"/>
                <rect x="14" y="14" width="7" height="7" rx="1" fill="#FBBC04"/>
              </svg>
            </div>
            <div>
              <p className="text-lg font-semibold text-white">Audience Lab Segments</p>
              <p className="text-sm text-gray-400">
                {occupied} of 10 slots used · Syncs every Monday
                {isAdminUser && <span className="ml-2 rounded-full bg-purple-500/20 px-2 py-0.5 text-xs font-semibold text-purple-300">Admin</span>}
              </p>
            </div>
          </div>
          {isAdminUser && (
            <button onClick={() => openAdd(null)} className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition px-4 py-2 text-sm font-semibold text-white">
              <span className="text-base leading-none">+</span> Add Segment
            </button>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div className="bg-gray-50 min-h-[calc(100vh-73px)]">
        <div className="mx-auto max-w-6xl px-6 py-8">

          {error && <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">⚠️ {error}</div>}

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6 items-start">

            {/* ── Segment slots ── */}
            <div className="grid gap-3">
              {loading ? (
                [...Array(7)].map((_, i) => <div key={i} className="h-20 rounded-2xl bg-white border border-gray-100 animate-pulse" />)
              ) : (
                slots.map(({ slot, schedule, occupied: occ, segment }) => (
                  <div key={slot} className={`rounded-2xl bg-white shadow-sm transition overflow-hidden ${occ ? "border border-gray-100" : "border border-dashed border-gray-200"}`}>

                    {/* Row */}
                    <div className="flex items-center gap-3 px-4 py-3.5">
                      <div className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl text-sm font-bold ${occ ? "bg-purple-100 text-purple-700" : "bg-gray-100 text-gray-400"}`}>
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
                            <p className="text-xs text-gray-400 mt-0.5 truncate">
                              <span className="font-mono">{segment.tableId}</span>
                              {" · "}Last sync: {fmtDateShort(segment.lastSyncedAt)}
                              {segment.lastSyncCount != null && ` · ${segment.lastSyncCount.toLocaleString()} rows`}
                            </p>
                            {runResult[segment.key] && <p className="mt-0.5 text-xs font-medium text-purple-700">{runResult[segment.key]}</p>}
                          </div>

                          <div className="hidden sm:block text-right flex-shrink-0">
                            <p className="text-xs font-semibold text-gray-500">{schedule}</p>
                          </div>

                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            <button onClick={() => handleRunNow(segment)} disabled={running[segment.key]}
                              className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition">
                              {running[segment.key] ? "…" : "Test"}
                            </button>
                            <button onClick={() => toggleLogs(segment)}
                              className={`rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${expandedLogs[segment.key] ? "border-purple-300 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                              {expandedLogs[segment.key] === "loading" ? "…" : "Logs"}
                            </button>
                            {isAdminUser ? (
                              <>
                                <button onClick={() => handleToggle(segment)}
                                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition">
                                  {segment.active ? "Pause" : "Resume"}
                                </button>
                                <button onClick={() => openEdit(segment)}
                                  className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 transition">
                                  Edit
                                </button>
                                <button onClick={() => handleDelete(segment.key)}
                                  className="rounded-lg border border-red-200 px-2.5 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 transition">
                                  Delete
                                </button>
                              </>
                            ) : (
                              <span title="Admin access required to make changes" className="rounded-lg border border-gray-100 px-2.5 py-1.5 text-xs font-medium text-gray-300 cursor-not-allowed select-none">
                                🔒 View only
                              </span>
                            )}
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
                              className="rounded-lg border border-dashed border-purple-300 px-3 py-1.5 text-xs font-semibold text-purple-500 hover:bg-purple-50 transition">
                              + Assign
                            </button>
                          )}
                        </>
                      )}
                    </div>

                    {/* Sync log history */}
                    {occ && expandedLogs[segment.key] && expandedLogs[segment.key] !== "loading" && (
                      <div className="border-t border-gray-100">
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
      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
              <h2 className="text-base font-bold text-gray-900">
                {modal.mode === "add" ? "Add Segment" : `Edit — ${modal.segment.name}`}
              </h2>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>
            <div className="px-6 py-5 space-y-4">
              {modal.mode === "add" && (
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Slot (0–9, blank = auto)</span>
                  <input type="number" min="0" max="9" value={form.slot} onChange={(e) => setForm((f) => ({ ...f, slot: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-purple-400" placeholder="Auto-assign" />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Display Name</span>
                <input type="text" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-purple-400" placeholder="e.g. Ranger Electric" />
              </label>
              {modal.mode === "add" && (
                <label className="block">
                  <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Key (unique ID)</span>
                  <input type="text" value={form.key} onChange={(e) => setForm((f) => ({ ...f, key: e.target.value }))}
                    className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:border-purple-400" placeholder="e.g. ranger_electric" />
                </label>
              )}
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Audience Lab Segment ID</span>
                <input type="text" value={form.segmentId} onChange={(e) => setForm((f) => ({ ...f, segmentId: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:border-purple-400" placeholder="Segment ID from Audience Lab" />
              </label>
              <label className="block">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">BigQuery Table ID</span>
                <input type="text" value={form.tableId} onChange={(e) => setForm((f) => ({ ...f, tableId: e.target.value }))}
                  className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm font-mono text-gray-800 focus:outline-none focus:border-purple-400" placeholder="e.g. ranger_interested_electric_segment" />
              </label>
              <label className="flex items-center gap-3 cursor-pointer" onClick={() => setForm((f) => ({ ...f, active: !f.active }))}>
                <div className={`relative w-10 h-6 rounded-full transition ${form.active ? "bg-purple-600" : "bg-gray-200"}`}>
                  <span className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${form.active ? "left-5" : "left-1"}`} />
                </div>
                <span className="text-sm font-medium text-gray-700">{form.active ? "Active" : "Paused"}</span>
              </label>
              {saveError && <p className="text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">⚠️ {saveError}</p>}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-100 px-6 py-4">
              <button onClick={closeModal} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">Cancel</button>
              <button onClick={handleSave} disabled={saving} className="rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-50 px-5 py-2 text-sm font-semibold text-white transition">
                {saving ? "Saving…" : modal.mode === "add" ? "Add Segment" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
