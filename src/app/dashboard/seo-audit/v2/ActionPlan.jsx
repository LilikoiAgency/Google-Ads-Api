"use client";
// The v2 Action Plan: ranked tasks with filters, expandable evidence and exact change,
// and export as a Markdown checklist or CSV.

import { useMemo, useState } from "react";
import { tasksToCsv } from "@/lib/seoAuditV2/tasks";

export const CATEGORY_META = {
  technical:  { label: "Technical",  bg: "#e8f0fe", color: "#0c3473" },
  content:    { label: "Content",    bg: "#f3e8ff", color: "#6b21a8" },
  local:      { label: "Local",      bg: "#e6f9f0", color: "#1a7a4a" },
  aeo:        { label: "Answers",    bg: "#fef3cd", color: "#7d5a00" },
  conversion: { label: "Conversion", bg: "#fde8e8", color: "#c0392b" },
};

const CONFIDENCE_COLOR = { high: "#1a7a4a", medium: "#b7791f", low: "#888" };

// "https://acme.com/services/turf?x=1" -> "/services/turf"; "site-wide" stays as is.
export function pagePath(page) {
  const s = String(page || "");
  if (!/^https?:\/\//i.test(s)) return s;
  try {
    return new URL(s).pathname || "/";
  } catch {
    return s;
  }
}

const oneLine = (s) => String(s || "").replace(/\s*\n\s*/g, " ").trim();

// Link for a task or page: a full URL as is, a path on the audited domain.
export function pageHref(page, domain) {
  const s = String(page || "");
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/") && domain) return `https://${domain}${s}`;
  return null;
}

// Sub-tasks of a task: a group's per-page items and folded follow-ups.
export const childrenOf = (t) => [...(t.items || []), ...(t.follow_ups || [])];

function checklistLines(t, indent) {
  const [first = "", ...rest] = String(t.change || "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // A group's change only lists its items, which follow as their own lines.
  const lines = t.group ? [] : rest;
  const head = `${indent}- [ ] ${t.id} · ${pagePath(t.page)} · ${oneLine(t.title)}${t.group ? "" : ` — ${first}`}`;
  return [head, ...lines.map((l) => `${indent}  - ${l}`), ...childrenOf(t).flatMap((c) => checklistLines(c, `${indent}  `))];
}

// "- [ ] T1 · /page · title — change"; a multi-line change (summary plus the
// exact text of each fix) keeps its extra lines as indented sub-items, and a
// task's group items and follow-ups follow as nested checkboxes.
export function tasksToChecklist(tasks) {
  return (tasks || []).flatMap((t) => checklistLines(t, "")).join("\n");
}

export const TOP_COUNT = 10;
const taskPages = (t) => (t.group ? childrenOf(t).map((c) => c.page) : [t.page, ...childrenOf(t).map((c) => c.page)]);

export const isQuickWin = (t) => t.impact >= 4 && t.effort <= 2;

export function CategoryChip({ category }) {
  const m = CATEGORY_META[category] || { label: category, bg: "#f0f0f0", color: "#555" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

// Impact: higher is better. Effort: lower is better.
function ScaleChip({ value, kind }) {
  const good = kind === "impact" ? value >= 4 : value <= 2;
  const bad = kind === "impact" ? value <= 2 : value >= 4;
  const s = good ? { bg: "#e6f9f0", color: "#1a7a4a" } : bad ? { bg: "#fef3cd", color: "#7d5a00" } : { bg: "#e8f0fe", color: "#0c3473" };
  return (
    <span
      title={`${kind === "impact" ? "Impact" : "Effort"} ${value} of 5`}
      style={{ display: "inline-block", minWidth: 34, padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 700, background: s.bg, color: s.color, textAlign: "center" }}
    >
      {value}/5
    </span>
  );
}

const TH = { textAlign: "left", padding: "10px 12px", fontWeight: 700, color: "#555", borderBottom: "2px solid #eee", fontSize: 12, whiteSpace: "nowrap" };
const TD = { padding: "11px 12px", verticalAlign: "top" };
const SELECT = { padding: "7px 10px", borderRadius: 8, border: "1px solid #ddd", fontSize: 13, color: "#333", background: "#fff", maxWidth: 260 };
const BUTTON = { padding: "8px 14px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" };

const COPY_FAILED = "Couldn't copy. Your browser blocked the clipboard.";

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function downloadCsv(csv, filename) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// copyNotice: { ok, text } after a "Copy change" click on this task, else null.
function ExpandedTask({ task, domain, onCopy, copyNotice }) {
  const href = pageHref(task.page, domain);
  return (
    <div style={{ display: "flex", gap: 20, flexWrap: "wrap", padding: "4px 4px 8px" }}>
      <div style={{ flex: "1 1 320px", minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#1a7a4a" }}>Exact change</p>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {copyNotice && !copyNotice.ok && <span role="status" style={{ fontSize: 11, color: "#c0392b" }}>{copyNotice.text}</span>}
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              style={{ ...BUTTON, padding: "3px 10px", fontSize: 11, border: "1px solid #cde7d8", background: "#fff", color: "#1a7a4a" }}
            >
              {copyNotice?.ok ? "Copied" : "Copy change"}
            </button>
          </span>
        </div>
        <p style={{ fontSize: 13, color: "#1a1a2e", lineHeight: 1.6, background: "#f0fdf4", border: "1px solid #cde7d8", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>
          {task.change}
        </p>
        {task.why && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginTop: 12, marginBottom: 4 }}>Why it matters</p>
            <p style={{ fontSize: 13, color: "#444", lineHeight: 1.6 }}>{task.why}</p>
          </>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: "inline-block", marginTop: 10, fontSize: 12, color: "#0f3460", wordBreak: "break-all" }}
          >
            Open {href} &#8599;
          </a>
        )}
      </div>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 6 }}>Evidence</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(task.evidence || []).map((e, i) => (
            <li key={i} style={{ fontSize: 12, color: "#444", lineHeight: 1.6, marginBottom: 2, wordBreak: "break-word" }}>{e}</li>
          ))}
        </ul>
        {task.source_ids?.length > 0 && !task.group && (
          <p style={{ fontSize: 11, color: "#aaa", marginTop: 8 }}>From findings {task.source_ids.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

function SubTasks({ task, domain, notice, onCopy }) {
  const children = childrenOf(task);
  if (!children.length) return null;
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid #eee", paddingTop: 10 }}>
      <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", color: "#888", marginBottom: 8 }}>
        {task.group ? `Each page (${children.length})` : "Do together with this task"}
      </p>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 10 }}>
        {children.map((c) => {
          const href = pageHref(c.page, domain);
          const n = notice?.key === `change-${c.id}` ? notice : null;
          return (
            <li key={c.id} style={{ border: "1px solid #eef0f4", borderRadius: 8, padding: "10px 12px", background: "#fff" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "#1a1a2e" }}>
                  <span style={{ color: "#0f3460", marginRight: 6 }}>{c.id}</span>{c.title}
                </p>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {n && !n.ok && <span role="status" style={{ fontSize: 11, color: "#c0392b" }}>{n.text}</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopy(c); }}
                    style={{ ...BUTTON, padding: "3px 10px", fontSize: 11, border: "1px solid #cde7d8", background: "#fff", color: "#1a7a4a" }}
                  >
                    {n?.ok ? "Copied" : "Copy change"}
                  </button>
                </span>
              </div>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 12, color: "#0f3460", wordBreak: "break-all" }}>
                  {pagePath(c.page)} &#8599;
                </a>
              ) : <span style={{ fontSize: 12, color: "#555" }}>{pagePath(c.page)}</span>}
              <p style={{ fontSize: 13, color: "#1a1a2e", lineHeight: 1.6, background: "#f0fdf4", border: "1px solid #cde7d8", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap", marginTop: 6 }}>
                {c.change}
              </p>
              {c.evidence?.length > 0 && (
                <p style={{ fontSize: 12, color: "#666", marginTop: 6, lineHeight: 1.5 }}>Evidence: {c.evidence.join(" · ")}</p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

export default function ActionPlan({ tasks = [], domain = "", auditDate }) {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState("");
  const [quickOnly, setQuickOnly] = useState(false);
  const [open, setOpen] = useState(() => new Set());
  const [notice, setNotice] = useState(null); // { key, text, ok }
  const [showAll, setShowAll] = useState(false);

  const categories = useMemo(() => {
    const counts = new Map();
    for (const t of tasks) counts.set(t.category, (counts.get(t.category) || 0) + 1);
    return [...counts.entries()];
  }, [tasks]);
  const pages = useMemo(() => [...new Set(tasks.flatMap(taskPages))], [tasks]);

  const visible = tasks.filter(
    (t) => (!category || t.category === category) && (!page || taskPages(t).includes(page)) && (!quickOnly || isQuickWin(t)),
  );
  const filtered = Boolean(category || page || quickOnly);
  // Unfiltered: the first TOP_COUNT tasks; the rest behind "Show more". Copy and
  // download always cover every matching task.
  const collapsed = !filtered && !showAll && visible.length > TOP_COUNT;
  const shown = collapsed ? visible.slice(0, TOP_COUNT) : visible;
  const quickCount = tasks.filter(isQuickWin).length;

  const flash = (key, text, ok = true) => {
    setNotice({ key, text, ok });
    setTimeout(() => setNotice((n) => (n?.key === key ? null : n)), 2500);
  };

  const toggle = (id) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  async function handleCopyChecklist() {
    const ok = await copyText(tasksToChecklist(visible));
    flash("checklist", ok ? `Copied ${visible.length} task${visible.length !== 1 ? "s" : ""}` : COPY_FAILED, ok);
  }

  async function handleCopyChange(task) {
    const ok = await copyText(task.change);
    flash(`change-${task.id}`, ok ? "Copied" : COPY_FAILED, ok);
  }

  function handleCsv() {
    const date = auditDate || new Date().toISOString().slice(0, 10);
    downloadCsv(tasksToCsv(visible), `${domain} SEO action plan ${date}.csv`);
  }

  if (!tasks.length) {
    return <p style={{ color: "#999", fontSize: 13 }}>No tasks in this audit&apos;s action plan.</p>;
  }

  return (
    <div>
      {/* Filters + export */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={SELECT}>
              <option value="">All categories</option>
              {categories.map(([c, n]) => (
                <option key={c} value={c}>{CATEGORY_META[c]?.label || c} ({n})</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11, fontWeight: 700, color: "#888", textTransform: "uppercase" }}>
            Page
            <select value={page} onChange={(e) => setPage(e.target.value)} style={SELECT}>
              <option value="">All pages</option>
              {pages.map((p) => <option key={p} value={p}>{pagePath(p)}</option>)}
            </select>
          </label>
          {quickCount > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#444", paddingBottom: 7, cursor: "pointer" }}>
              <input type="checkbox" checked={quickOnly} onChange={(e) => setQuickOnly(e.target.checked)} />
              Quick wins only ({quickCount})
            </label>
          )}
          {filtered && (
            <button
              onClick={() => { setCategory(""); setPage(""); setQuickOnly(false); }}
              style={{ ...BUTTON, padding: "7px 10px", border: "none", background: "transparent", color: "#0f3460", textDecoration: "underline" }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {notice?.key === "checklist" && <span role="status" style={{ fontSize: 12, color: notice.ok ? "#1a7a4a" : "#c0392b" }}>{notice.text}</span>}
          <button onClick={handleCopyChecklist} disabled={!visible.length} style={{ ...BUTTON, border: "1px solid #0f3460", background: "#fff", color: "#0f3460" }}>
            Copy as checklist
          </button>
          <button onClick={handleCsv} disabled={!visible.length} style={{ ...BUTTON, border: "none", background: "#0f3460", color: "#fff" }}>
            Download CSV
          </button>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "#888", marginBottom: 8 }}>
        {filtered
          ? `Showing ${visible.length} of ${tasks.length} tasks`
          : collapsed ? `Do these first: the top ${TOP_COUNT} of ${tasks.length} tasks` : `${tasks.length} tasks, highest value first`}
        {" · "}open a task for the evidence and the exact change
      </p>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ background: "#f8f9fb" }}>
              <th style={{ ...TH, width: 44 }}>#</th>
              <th style={TH}>Task</th>
              <th style={TH}>Page</th>
              <th style={TH}>Category</th>
              <th style={{ ...TH, textAlign: "center" }}>Impact</th>
              <th style={{ ...TH, textAlign: "center" }}>Effort</th>
              <th style={TH}>Confidence</th>
              <th style={{ ...TH, width: 24 }}><span style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>Details</span></th>
            </tr>
          </thead>
          <tbody>
            {shown.map((t) => {
              const isOpen = open.has(t.id);
              return [
                <tr
                  key={t.id}
                  onClick={() => toggle(t.id)}
                  style={{ borderBottom: isOpen ? "none" : "1px solid #f0f0f0", cursor: "pointer", background: isOpen ? "#fafbff" : "transparent" }}
                >
                  <td style={{ ...TD, fontWeight: 700, color: "#0f3460" }}>{t.id}</td>
                  <td style={{ ...TD, fontWeight: 600, color: "#1a1a2e", lineHeight: 1.45, minWidth: 220 }}>
                    {t.title}
                    {t.group && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#0c3473", background: "#e8f0fe", padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" }}>{t.items.length} pages</span>
                    )}
                    {t.follow_ups?.length > 0 && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#555", background: "#f0f0f0", padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" }}>+{t.follow_ups.length} related</span>
                    )}
                    {isQuickWin(t) && (
                      <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: "#1a7a4a", background: "#e6f9f0", padding: "1px 6px", borderRadius: 8, whiteSpace: "nowrap" }}>Quick win</span>
                    )}
                  </td>
                  <td style={{ ...TD, color: "#555", maxWidth: 200, wordBreak: "break-all" }} title={t.group ? t.pages?.join(", ") : t.page}>{t.group ? `${t.items.length} pages` : pagePath(t.page)}</td>
                  <td style={TD}><CategoryChip category={t.category} /></td>
                  <td style={{ ...TD, textAlign: "center" }}><ScaleChip value={t.impact} kind="impact" /></td>
                  <td style={{ ...TD, textAlign: "center" }}><ScaleChip value={t.effort} kind="effort" /></td>
                  <td style={{ ...TD, color: CONFIDENCE_COLOR[t.confidence] || "#888", fontWeight: 600, textTransform: "capitalize" }}>{t.confidence}</td>
                  <td style={{ ...TD, textAlign: "center", padding: "6px 8px" }}>
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      aria-label={`Show details for ${t.id}`}
                      onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
                      style={{ border: "none", background: "transparent", color: "#888", cursor: "pointer", padding: "4px 6px", borderRadius: 6, fontSize: 13 }}
                    >
                      <span aria-hidden style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#9656;</span>
                    </button>
                  </td>
                </tr>,
                isOpen && (
                  <tr key={`${t.id}-detail`} style={{ borderBottom: "1px solid #f0f0f0", background: "#fafbff" }}>
                    <td />
                    <td colSpan={7} style={{ padding: "0 12px 14px" }}>
                      <ExpandedTask task={t} domain={domain} copyNotice={notice?.key === `change-${t.id}` ? notice : null} onCopy={() => handleCopyChange(t)} />
                      <SubTasks task={t} domain={domain} notice={notice} onCopy={handleCopyChange} />
                    </td>
                  </tr>
                ),
              ];
            })}
          </tbody>
        </table>
      </div>
      {collapsed && (
        <button
          onClick={() => setShowAll(true)}
          style={{ ...BUTTON, marginTop: 12, width: "100%", border: "1px dashed #c9d3e6", background: "#f8f9fb", color: "#0f3460" }}
        >
          Show {visible.length - TOP_COUNT} more task{visible.length - TOP_COUNT === 1 ? "" : "s"}
        </button>
      )}
      {!visible.length && <p style={{ color: "#999", fontSize: 13, marginTop: 12 }}>No tasks match these filters.</p>}
    </div>
  );
}
