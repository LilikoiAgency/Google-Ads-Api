"use client";
import { useEffect, useMemo, useState } from "react";

const C = {
  bg:      "#0f0f17",
  card:    "#1a1a2e",
  cardAlt: "#13131f",
  border:  "rgba(255,255,255,0.08)",
  borderStrong: "rgba(255,255,255,0.14)",
  accent:  "#e94560",
  teal:    "#4ecca3",
  amber:   "#f5a623",
  blue:    "#3182ce",
  textPri: "#ffffff",
  textSec: "rgba(255,255,255,0.55)",
  textMut: "rgba(255,255,255,0.35)",
};

const STATUS_COLORS = {
  sent:    C.teal,
  skipped: C.amber,
  failed:  C.accent,
};

function StatusBadge({ status, error }) {
  const color = STATUS_COLORS[status] || C.textSec;
  const label = status === 'sent' ? 'Sent'
    : status === 'skipped' ? 'Not sent'
    : status === 'failed' ? 'Failed'
    : status || '—';
  return (
    <span title={error || ''} style={{
      display: "inline-block", fontSize: 11, fontWeight: 700,
      padding: "2px 8px", borderRadius: 4,
      background: `${color}22`, color, border: `1px solid ${color}55`,
    }}>{label}</span>
  );
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export default function PacingDashboardPage() {
  const [config, setConfig] = useState(null);
  const [configDraft, setConfigDraft] = useState(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [reports, setReports] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [activeReport, setActiveReport] = useState(null);
  const [previewHtml, setPreviewHtml] = useState(null);
  const [previewSummary, setPreviewSummary] = useState(null);
  const [loading, setLoading] = useState({ config: true, reports: true, active: false });
  const [busy, setBusy] = useState({ preview: false, send: false });
  const [toast, setToast] = useState(null);
  const [showConfig, setShowConfig] = useState(false);

  // Load config + report list
  useEffect(() => {
    fetch("/api/pacing/config").then((r) => r.json()).then((j) => {
      if (j?.data) { setConfig(j.data); setConfigDraft(j.data); }
    }).finally(() => setLoading((l) => ({ ...l, config: false })));

    fetch("/api/pacing/reports").then((r) => r.json()).then((j) => {
      if (j?.data) setReports(j.data);
    }).finally(() => setLoading((l) => ({ ...l, reports: false })));
  }, []);

  // Load selected report
  useEffect(() => {
    if (!activeId) { setActiveReport(null); return; }
    setLoading((l) => ({ ...l, active: true }));
    setPreviewHtml(null);
    fetch(`/api/pacing/reports/${activeId}`)
      .then((r) => r.json())
      .then((j) => { if (j?.data) setActiveReport(j.data); })
      .finally(() => setLoading((l) => ({ ...l, active: false })));
  }, [activeId]);

  function showToast(msg, tone = 'info') {
    setToast({ msg, tone });
    setTimeout(() => setToast(null), 4000);
  }

  async function handlePreview() {
    setBusy((b) => ({ ...b, preview: true }));
    setPreviewHtml(null);
    setActiveId(null);
    setActiveReport(null);
    try {
      const res = await fetch("/api/pacing/preview", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setPreviewHtml(json.html);
      setPreviewSummary(json.summary);
      showToast("Preview rendered (not sent)", 'ok');
    } catch (err) {
      showToast(`Preview failed: ${err.message}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, preview: false }));
    }
  }

  async function handleSendNow() {
    if (!confirm("Send the pacing report to all recipients now?")) return;
    setBusy((b) => ({ ...b, send: true }));
    try {
      const res = await fetch("/api/pacing/send-now", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      if (json.status === 'failed') {
        showToast(`Send failed: ${json.sendError}`, 'err');
      } else {
        showToast("Report sent", 'ok');
      }
      // Refresh report list + open new one
      const listRes = await fetch("/api/pacing/reports");
      const listJson = await listRes.json();
      if (listJson?.data) setReports(listJson.data);
      if (json.id) setActiveId(json.id);
    } catch (err) {
      showToast(`Send failed: ${err.message}`, 'err');
    } finally {
      setBusy((b) => ({ ...b, send: false }));
    }
  }

  async function handleSaveConfig() {
    if (!configDraft) return;
    setConfigSaving(true);
    try {
      const res = await fetch("/api/pacing/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipients: configDraft.recipients,
          clients: configDraft.clients,
          subjectPrefix: configDraft.subjectPrefix,
          fromAddress: configDraft.fromAddress,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
      setConfig(json.data);
      setConfigDraft(json.data);
      setConfigDirty(false);
      showToast("Config saved", 'ok');
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'err');
    } finally {
      setConfigSaving(false);
    }
  }

  function updateDraft(patch) {
    setConfigDraft((prev) => ({ ...(prev || {}), ...patch }));
    setConfigDirty(true);
  }

  function updateClient(idx, patch) {
    setConfigDraft((prev) => {
      const next = { ...(prev || {}) };
      next.clients = [...(prev?.clients || [])];
      next.clients[idx] = { ...next.clients[idx], ...patch };
      return next;
    });
    setConfigDirty(true);
  }

  function addRecipient(email) {
    const trimmed = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return;
    if ((configDraft?.recipients || []).includes(trimmed)) return;
    updateDraft({ recipients: [...(configDraft?.recipients || []), trimmed] });
  }

  function removeRecipient(email) {
    updateDraft({ recipients: (configDraft?.recipients || []).filter((e) => e !== email) });
  }

  const displayedHtml = previewHtml || activeReport?.html || null;
  const displayedSummary = previewHtml ? previewSummary : activeReport?.summary;

  return (
    <div style={{ padding: "24px 32px", color: C.textPri, fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 800 }}>Daily Pacing Reports</h1>
          <p style={{ margin: "4px 0 0", color: C.textSec, fontSize: 13 }}>Automated Mon–Fri at 9 AM ET. Edit recipients and sheet IDs here.</p>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setShowConfig((v) => !v)} style={btnSecondary}>
            {showConfig ? "Hide config" : "Config"}
          </button>
          <button onClick={handlePreview} disabled={busy.preview || busy.send} style={btnSecondary}>
            {busy.preview ? "Rendering…" : "Preview"}
          </button>
          <button onClick={handleSendNow} disabled={busy.preview || busy.send} style={btnPrimary}>
            {busy.send ? "Sending…" : "Send now"}
          </button>
        </div>
      </div>

      {toast && (
        <div style={{
          marginBottom: 16, padding: "10px 14px", borderRadius: 6, fontSize: 13,
          background: toast.tone === 'err' ? `${C.accent}22` : toast.tone === 'ok' ? `${C.teal}22` : "rgba(255,255,255,0.06)",
          border: `1px solid ${toast.tone === 'err' ? C.accent : toast.tone === 'ok' ? C.teal : C.border}`,
          color: toast.tone === 'err' ? C.accent : toast.tone === 'ok' ? C.teal : C.textPri,
        }}>{toast.msg}</div>
      )}

      {/* Config panel */}
      {showConfig && (
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20, marginBottom: 20 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700 }}>Configuration</h2>
            <button onClick={handleSaveConfig} disabled={!configDirty || configSaving} style={configDirty ? btnPrimary : btnSecondaryDisabled}>
              {configSaving ? "Saving…" : configDirty ? "Save changes" : "Saved"}
            </button>
          </div>

          {!configDraft ? (
            <div style={{ color: C.textSec, fontSize: 13 }}>Loading…</div>
          ) : (
            <>
              {/* Recipients */}
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Recipients</label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {(configDraft.recipients || []).map((e) => (
                    <span key={e} style={chip}>
                      {e}
                      <button onClick={() => removeRecipient(e)} style={chipX}>×</button>
                    </span>
                  ))}
                </div>
                <input
                  placeholder="Add email + press Enter"
                  onKeyDown={(e) => { if (e.key === 'Enter') { addRecipient(e.currentTarget.value); e.currentTarget.value = ''; } }}
                  style={input}
                />
              </div>

              {/* Clients */}
              <div style={{ marginBottom: 20 }}>
                <label style={lbl}>Clients & sheet IDs</label>
                <div style={{ display: "grid", gap: 8 }}>
                  {(configDraft.clients || []).map((c, i) => (
                    <div key={c.key} style={{
                      display: "grid", gridTemplateColumns: "80px 1fr 1fr 100px", gap: 10, alignItems: "center",
                      background: C.cardAlt, border: `1px solid ${C.border}`, borderRadius: 6, padding: "8px 12px",
                    }}>
                      <div style={{ fontSize: 12, color: C.textSec, fontWeight: 700 }}>{c.key}</div>
                      <input
                        value={c.name}
                        onChange={(e) => updateClient(i, { name: e.target.value })}
                        style={inputSm}
                      />
                      <input
                        value={c.sheetId}
                        onChange={(e) => updateClient(i, { sheetId: e.target.value })}
                        placeholder="Sheet ID"
                        style={{ ...inputSm, fontFamily: "monospace", fontSize: 11 }}
                      />
                      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: c.enabled ? C.teal : C.textMut, cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={!!c.enabled}
                          onChange={(e) => updateClient(i, { enabled: e.target.checked })}
                        />
                        {c.enabled ? "Enabled" : "Disabled"}
                      </label>
                    </div>
                  ))}
                </div>
              </div>

              {/* Subject + From */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div>
                  <label style={lbl}>Subject prefix</label>
                  <input
                    value={configDraft.subjectPrefix || ''}
                    onChange={(e) => updateDraft({ subjectPrefix: e.target.value })}
                    style={input}
                  />
                </div>
                <div>
                  <label style={lbl}>From address</label>
                  <input
                    value={configDraft.fromAddress || ''}
                    onChange={(e) => updateDraft({ fromAddress: e.target.value })}
                    style={input}
                  />
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main split: history list + preview */}
      <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 16, minHeight: 600 }}>
        {/* History list */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 12, maxHeight: 800, overflowY: "auto" }}>
          <h3 style={{ margin: "4px 8px 12px", fontSize: 13, fontWeight: 700, color: C.textSec, textTransform: "uppercase", letterSpacing: 0.5 }}>Past Reports</h3>
          {loading.reports ? (
            <div style={{ padding: 12, color: C.textSec, fontSize: 12 }}>Loading…</div>
          ) : reports.length === 0 ? (
            <div style={{ padding: 12, color: C.textSec, fontSize: 12 }}>No reports yet. Click <strong>Send now</strong> or wait for tomorrow&apos;s cron.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {reports.map((r) => {
                const active = r._id === activeId;
                return (
                  <button
                    key={r._id}
                    onClick={() => setActiveId(r._id)}
                    style={{
                      background: active ? "rgba(78,204,163,0.12)" : "transparent",
                      border: `1px solid ${active ? C.teal : "transparent"}`,
                      borderRadius: 6, padding: "8px 10px", textAlign: "left",
                      cursor: "pointer", color: C.textPri,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                      <span style={{ fontSize: 13, fontWeight: 700 }}>{r.reportDate}</span>
                      <StatusBadge status={r.status} error={r.sendError} />
                    </div>
                    <div style={{ fontSize: 11, color: C.textMut }}>
                      {fmtDate(r.createdAt)} · {r.manual ? 'manual' : 'cron'}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Main pane */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {loading.active ? (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec }}>Loading report…</div>
          ) : displayedHtml ? (
            <>
              <div style={{ padding: "10px 16px", borderBottom: `1px solid ${C.border}`, background: C.cardAlt, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: 13, color: C.textSec }}>
                  {previewHtml ? <strong style={{ color: C.amber }}>PREVIEW</strong> : <strong style={{ color: C.textPri }}>{activeReport?.reportDate}</strong>}
                  {displayedSummary && (
                    <span style={{ marginLeft: 12, color: C.textMut }}>
                      {displayedSummary.clients?.length || 0} clients · {displayedSummary.actionCount || 0} actions
                    </span>
                  )}
                </div>
                {activeReport && !previewHtml && (
                  <div style={{ fontSize: 12, color: C.textMut }}>
                    Sent to {activeReport.recipients?.length || 0} · {fmtDate(activeReport.createdAt)}
                  </div>
                )}
              </div>
              <iframe
                title="pacing-report"
                srcDoc={displayedHtml}
                onLoad={(e) => {
                  try {
                    const doc = e.currentTarget.contentDocument;
                    const h = doc?.documentElement?.scrollHeight ?? doc?.body?.scrollHeight;
                    if (h) e.currentTarget.style.height = h + 'px';
                  } catch {}
                }}
                style={{ width: "100%", border: "none", background: "#f0f2f5", display: "block" }}
              />
            </>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", color: C.textSec, textAlign: "center", padding: 40 }}>
              <div>
                <div style={{ fontSize: 14, marginBottom: 8 }}>Select a past report, or click <strong>Preview</strong> to render today&apos;s data without sending.</div>
                <div style={{ fontSize: 12, color: C.textMut }}>Reports generate automatically each weekday at 9 AM ET.</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Inline style objects ─────────────────────────────────────────────────────

const btnPrimary = {
  background: "linear-gradient(135deg, #e94560 0%, #c13650 100%)",
  color: "#fff", border: "none", padding: "9px 16px",
  borderRadius: 6, fontSize: 13, fontWeight: 700, cursor: "pointer",
};
const btnSecondary = {
  background: "rgba(255,255,255,0.06)", color: "#fff",
  border: "1px solid rgba(255,255,255,0.14)", padding: "9px 16px",
  borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer",
};
const btnSecondaryDisabled = { ...btnSecondary, opacity: 0.4, cursor: "default" };

const lbl = { display: "block", fontSize: 11, fontWeight: 700, color: "rgba(255,255,255,0.55)", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 8 };

const chip = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "4px 10px",
  background: "rgba(78,204,163,0.12)", border: "1px solid rgba(78,204,163,0.35)",
  borderRadius: 12, fontSize: 12, color: "#4ecca3",
};
const chipX = {
  background: "none", border: "none", color: "#4ecca3", cursor: "pointer",
  fontSize: 16, lineHeight: 1, padding: 0, marginLeft: 2,
};

const input = {
  width: "100%", boxSizing: "border-box", background: "#13131f",
  border: "1px solid rgba(255,255,255,0.08)", color: "#fff",
  borderRadius: 6, padding: "8px 12px", fontSize: 13, outline: "none",
};
const inputSm = { ...input, padding: "6px 10px", fontSize: 12 };
