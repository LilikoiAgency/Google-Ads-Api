"use client";
// The v2 Action Plan: ranked tasks with filters, expandable evidence and exact change,
// and export as a Markdown checklist or CSV.

import { useId, useMemo, useState } from "react";
import { tasksToCsv } from "@/lib/seoAuditV2/tasks";
import { buildRoadmap, phaseByTaskId } from "@/lib/seoAuditV2/roadmap";
import { guessService, isUsablePhrase, MIN_PHRASE } from "@/lib/seoAuditV2/corrections";
import p from "./plan.module.css";

export const CATEGORY_META = {
  technical:  { label: "Technical",  bg: "#e6edf3", color: "#60a5fa" },
  content:    { label: "Content",    bg: "#ece8f4", color: "#a78bfa" },
  local:      { label: "Local",      bg: "#dcebe7", color: "#34d399" },
  aeo:        { label: "Answers",    bg: "#f5ecd7", color: "#fbbf24" },
  conversion: { label: "Conversion", bg: "#f6e3df", color: "#fb7185" },
  reputation: { label: "Reputation", bg: "#f3e4ee", color: "#f472b6" },
};

const CONFIDENCE_COLOR = { high: "var(--up)", medium: "var(--amber)", low: "var(--muted)" };

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

// One quick-win rule and effort wording for the app and the downloaded report.
export { isQuickWin, effortLabel } from "@/lib/seoAuditV2/overview";
import { isQuickWin, effortLabel } from "@/lib/seoAuditV2/overview";

function ImpactMeter({ value }) {
  return (
    <span className={p.meter} role="img" aria-label={`Impact ${value} of 5`} title={`Impact ${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= value ? p.meterOn : undefined} />)}
    </span>
  );
}

function Area({ category }) {
  const m = CATEGORY_META[category] || { label: category, color: "var(--ink-2)" };
  return <span className={p.area}><i style={{ background: m.color }} aria-hidden />{m.label}</span>;
}

export function CategoryChip({ category }) {
  const m = CATEGORY_META[category] || { label: category, bg: "var(--line)", color: "var(--ink-2)" };
  return (
    <span style={{ display: "inline-block", padding: "2px 8px", borderRadius: 12, fontSize: 11, fontWeight: 600, background: m.bg, color: m.color, whiteSpace: "nowrap" }}>
      {m.label}
    </span>
  );
}

const SELECT = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--line)", fontSize: 13.5, color: "var(--ink)", background: "var(--panel)", maxWidth: 260, fontFamily: "inherit" };
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
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--ink)" }}>Exact change</p>
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {copyNotice && !copyNotice.ok && <span role="status" style={{ fontSize: 11, color: "var(--down)" }}>{copyNotice.text}</span>}
            <button
              onClick={(e) => { e.stopPropagation(); onCopy(); }}
              style={{ ...BUTTON, padding: "3px 10px", fontSize: 11, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)" }}
            >
              {copyNotice?.ok ? "Copied" : "Copy change"}
            </button>
          </span>
        </div>
        <p style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6, background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", whiteSpace: "pre-wrap" }}>
          {task.change}
        </p>
        {task.why && (
          <>
            <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginTop: 12, marginBottom: 4 }}>Why it matters</p>
            <p style={{ fontSize: 13, color: "var(--ink-2)", lineHeight: 1.6 }}>{task.why}</p>
          </>
        )}
        {href && (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: "inline-block", marginTop: 10, fontSize: 12, color: "var(--ink)", wordBreak: "break-all" }}
          >
            Open {href} &#8599;
          </a>
        )}
      </div>
      <div style={{ flex: "1 1 260px", minWidth: 0 }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 6 }}>Evidence</p>
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {(task.evidence || []).map((e, i) => (
            <li key={i} style={{ fontSize: 12, color: "var(--ink-2)", lineHeight: 1.6, marginBottom: 2, wordBreak: "break-word" }}>{e}</li>
          ))}
        </ul>
        {task.confidence && (
          <p style={{ fontSize: 12, color: CONFIDENCE_COLOR[task.confidence] || "var(--muted)", marginTop: 8, fontWeight: 600 }}>
            {task.confidence[0].toUpperCase() + task.confidence.slice(1)} confidence, impact {task.impact} of 5, effort {task.effort} of 5
          </p>
        )}
        {task.source_ids?.length > 0 && !task.group && (
          <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 8 }}>From findings {task.source_ids.join(", ")}</p>
        )}
      </div>
    </div>
  );
}

// "Not for this business": hide this task (and, for a service the business
// doesn't offer, every task about it). Only for tasks that carry source ids.
function CorrectionControl({ task, onCorrect }) {
  const uid = useId();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState("not_offered");
  const [service, setService] = useState(() => guessService(task.title));
  const [saveToBrief, setSaveToBrief] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  if (!onCorrect || !task.source_ids?.length) return null;

  if (!open) {
    return (
      <button type="button" className={p.correctBtn} onClick={(e) => { e.stopPropagation(); setOpen(true); }}>
        Not for this business
      </button>
    );
  }

  async function save() {
    const offered = kind === "not_offered";
    // Follow-ups are hidden with their task, so a plan update must leave them out too.
    const ids = [...new Set([task.source_ids, ...(task.follow_ups || []).map((f) => f.source_ids)].flatMap((x) => x || []))];
    if (offered && !isUsablePhrase(service)) {
      setError(`Name the service in at least ${MIN_PHRASE} characters.`);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await onCorrect(offered
        ? { kind, service: service.trim(), source_ids: ids, saveToBrief }
        : { kind, source_ids: ids, saveToBrief: false });
      setOpen(false);
    } catch (err) {
      setError(err?.message || "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const offered = kind === "not_offered";
  return (
    <fieldset className={p.correctForm} onClick={(e) => e.stopPropagation()} style={{ minWidth: 0 }}>
      <legend>Not for this business</legend>
      <label className={p.choice}>
        <input type="radio" name={`${uid}-kind`} checked={offered} onChange={() => setKind("not_offered")} />
        We don&apos;t offer this
      </label>
      <div className={p.choiceBody}>
        <label className={p.field} htmlFor={`${uid}-service`}>Service</label>
        <input
          id={`${uid}-service`}
          className={p.input}
          value={service}
          maxLength={80}
          disabled={!offered}
          onChange={(e) => setService(e.target.value)}
        />
        <label className={p.check}>
          <input type="checkbox" checked={saveToBrief} disabled={!offered} onChange={(e) => setSaveToBrief(e.target.checked)} />
          Don&apos;t recommend it in future audits
        </label>
      </div>
      <label className={p.choice}>
        <input type="radio" name={`${uid}-kind`} checked={!offered} onChange={() => setKind("not_relevant")} />
        Not relevant here
      </label>
      {error && <p role="alert" className={p.error}>{error}</p>}
      <div className={p.formActions}>
        <button type="button" className={p.primary} disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        <button type="button" className={p.secondary} disabled={saving} onClick={() => { setOpen(false); setError(null); }}>Cancel</button>
      </div>
    </fieldset>
  );
}

const hiddenReason = (c) => (c?.kind === "not_offered"
  ? (c.service ? `You don't offer ${c.service}` : "You don't offer this")
  : "Marked not relevant");

// "N hidden · Show hidden" and the greyed list of hidden tasks, each with Undo.
function HiddenTasks({ hidden, onUndo }) {
  const [show, setShow] = useState(false);
  const [error, setError] = useState(null);
  if (!hidden?.length) return null;
  async function undo(id) {
    setError(null);
    try {
      await onUndo?.(id);
    } catch (err) {
      setError(err?.message || "Couldn't undo. Try again.");
    }
  }
  return (
    <div>
      <p className={p.hiddenBar}>
        <span>{hidden.length} hidden · </span>
        <button type="button" className={p.linkBtn} aria-expanded={show} onClick={() => setShow((v) => !v)}>
          {show ? "Hide hidden" : "Show hidden"}
        </button>
      </p>
      {error && <p role="alert" className={p.error}>{error}</p>}
      {show && (
        <ul className={p.hiddenList}>
          {hidden.map(({ task, correction }, i) => (
            <li key={`${task.id || i}-${correction?.id || ""}`} className={p.hiddenItem}>
              <span className={p.rank}>{task.id}</span>
              <span className={p.hiddenTitle}>{task.title}</span>
              <span className={p.hiddenReason}>{hiddenReason(correction)}</span>
              {onUndo && correction?.id && (
                <button type="button" className={p.secondary} onClick={() => undo(correction.id)}>Undo</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SubTasks({ task, domain, notice, onCopy, onCorrect }) {
  const children = childrenOf(task);
  if (!children.length) return null;
  return (
    <div style={{ marginTop: 6, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
      <p style={{ fontSize: 11, fontWeight: 700, color: "var(--muted)", marginBottom: 8 }}>
        {task.group ? `Each page (${children.length})` : "Do together with this task"}
      </p>
      <ol style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 10 }}>
        {children.map((c) => {
          const href = pageHref(c.page, domain);
          const n = notice?.key === `change-${c.id}` ? notice : null;
          return (
            <li key={c.id} style={{ border: "1px solid var(--line)", borderRadius: 8, padding: "10px 12px", background: "var(--panel)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}>
                <p style={{ fontSize: 13, fontWeight: 600, color: "var(--ink)" }}>
                  <span style={{ color: "var(--ink)", marginRight: 6 }}>{c.id}</span>{c.title}
                </p>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  {n && !n.ok && <span role="status" style={{ fontSize: 11, color: "var(--down)" }}>{n.text}</span>}
                  <button
                    onClick={(e) => { e.stopPropagation(); onCopy(c); }}
                    style={{ ...BUTTON, padding: "3px 10px", fontSize: 11, border: "1px solid var(--line)", background: "var(--panel)", color: "var(--ink)" }}
                  >
                    {n?.ok ? "Copied" : "Copy change"}
                  </button>
                </span>
              </div>
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{ fontSize: 12, color: "var(--ink)", wordBreak: "break-all" }}>
                  {pagePath(c.page)} &#8599;
                </a>
              ) : <span style={{ fontSize: 12, color: "var(--ink-2)" }}>{pagePath(c.page)}</span>}
              <p style={{ fontSize: 13, color: "var(--ink)", lineHeight: 1.6, background: "var(--soft)", border: "1px solid var(--line)", borderRadius: 8, padding: "8px 10px", whiteSpace: "pre-wrap", marginTop: 6 }}>
                {c.change}
              </p>
              {c.evidence?.length > 0 && (
                <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6, lineHeight: 1.5 }}>Evidence: {c.evidence.join(" · ")}</p>
              )}
              {/* Group items can be corrected one by one; follow-ups go with their task. */}
              {task.group && task.items?.includes(c) && <CorrectionControl task={c} onCorrect={onCorrect} />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// focusId: a task to show opened (from another tab); a nested id (T2.1) opens its parent.
// hidden / onCorrect / onUndo: corrections on a saved audit; without them the
// plan shows no correction controls.
export default function ActionPlan({ tasks = [], domain = "", auditDate, focusId = null, hidden = [], onCorrect, onUndo }) {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState("");
  const [quickOnly, setQuickOnly] = useState(false);
  const [open, setOpen] = useState(() => new Set(focusId ? [String(focusId).split(".")[0]] : []));
  const [notice, setNotice] = useState(null); // { key, text, ok }
  const [showAll, setShowAll] = useState(!!focusId);
  const [view, setView] = useState("ranked"); // "ranked" | "roadmap"
  // Phases come from the whole plan, so filtering never moves a task to another month.
  const roadmap = useMemo(() => buildRoadmap(tasks), [tasks]);
  const phaseOf = useMemo(() => new Map(roadmap.flatMap((ph) => ph.tasks.map((t) => [t.id, ph]))), [roadmap]);
  const phaseLabels = useMemo(() => phaseByTaskId(tasks), [tasks]);

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
  const collapsed = view === "ranked" && !filtered && !showAll && visible.length > TOP_COUNT;
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
    downloadCsv(tasksToCsv(visible, { phases: phaseLabels }), `${domain} SEO action plan ${date}.csv`);
  }

  const hiddenTasks = <HiddenTasks hidden={hidden} onUndo={onUndo} />;

  if (!tasks.length) {
    return (
      <>
        <p style={{ color: "var(--muted)", fontSize: 13 }}>No tasks in this audit&apos;s action plan.</p>
        {hiddenTasks}
      </>
    );
  }

  const renderRows = (list) => list.map((t) => {
    const isOpen = open.has(t.id);
    return [
      <tr key={t.id} onClick={() => toggle(t.id)} className={isOpen ? `${p.row} ${p.rowOpen}` : p.row}>
        <td className={`${p.td} ${p.rank}`}>{t.id}</td>
        <td className={`${p.td} ${p.taskCell}`}>
          <span className={p.title}>{t.title}</span>
          <span className={p.sub} title={t.group ? t.pages?.join(", ") : t.page}>
            <span className={p.path}>{t.group ? `${t.items.length} pages` : pagePath(t.page)}</span>
            {t.follow_ups?.length > 0 && <span className={p.tag}>+{t.follow_ups.length} related</span>}
            {isQuickWin(t) && <span className={`${p.tag} ${p.tagWin}`}>Quick win</span>}
            {view === "ranked" && phaseOf.get(t.id) && <span className={p.tag}>{phaseOf.get(t.id).label}</span>}
          </span>
        </td>
        <td className={p.td}><Area category={t.category} /></td>
        <td className={p.td}><ImpactMeter value={t.impact} /></td>
        <td className={`${p.td} ${p.effort}`}>{effortLabel(t.effort)}</td>
        <td className={p.td}>
          <button
            type="button"
            aria-expanded={isOpen}
            aria-label={`Show details for ${t.id}`}
            onClick={(e) => { e.stopPropagation(); toggle(t.id); }}
            className={p.chev}
          >
            <span aria-hidden style={{ display: "inline-block", transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.15s" }}>&#9656;</span>
          </button>
        </td>
      </tr>,
      isOpen && (
        <tr key={`${t.id}-detail`} className={p.detailRow}>
          <td />
          <td colSpan={5} style={{ padding: "0 12px 18px" }}>
            <ExpandedTask task={t} domain={domain} copyNotice={notice?.key === `change-${t.id}` ? notice : null} onCopy={() => handleCopyChange(t)} />
            <CorrectionControl task={t} onCorrect={onCorrect} />
            <SubTasks task={t} domain={domain} notice={notice} onCopy={handleCopyChange} onCorrect={onCorrect} />
          </td>
        </tr>
      ),
    ];
  });

  const table = (list) => (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th className={p.th} style={{ width: 52 }}>#</th>
            <th className={p.th}>Task</th>
            <th className={p.th}>Area</th>
            <th className={p.th}>Impact</th>
            <th className={p.th}>Effort</th>
            <th className={p.th} style={{ width: 36 }}><span className={p.srOnly}>Details</span></th>
          </tr>
        </thead>
        <tbody>{renderRows(list)}</tbody>
      </table>
    </div>
  );

  const visibleIds = new Set(visible.map((t) => t.id));

  return (
    <div>
      <div role="group" aria-label="Plan view" className={p.viewToggle}>
        {[["ranked", "Highest value first"], ["roadmap", "30 / 60 / 90 days"]].map(([key, label]) => (
          <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)} className={view === key ? `${p.viewBtn} ${p.viewOn}` : p.viewBtn}>
            {label}
          </button>
        ))}
      </div>
      {/* Filters + export */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={SELECT}>
              <option value="">All categories</option>
              {categories.map(([c, n]) => (
                <option key={c} value={c}>{CATEGORY_META[c]?.label || c} ({n})</option>
              ))}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>
            Page
            <select value={page} onChange={(e) => setPage(e.target.value)} style={SELECT}>
              <option value="">All pages</option>
              {pages.map((p) => <option key={p} value={p}>{pagePath(p)}</option>)}
            </select>
          </label>
          {quickCount > 0 && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--ink-2)", paddingBottom: 7, cursor: "pointer" }}>
              <input type="checkbox" checked={quickOnly} onChange={(e) => setQuickOnly(e.target.checked)} />
              Quick wins only ({quickCount})
            </label>
          )}
          {filtered && (
            <button
              onClick={() => { setCategory(""); setPage(""); setQuickOnly(false); }}
              style={{ ...BUTTON, padding: "7px 10px", border: "none", background: "transparent", color: "var(--ink)", textDecoration: "underline" }}
            >
              Clear filters
            </button>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {notice?.key === "checklist" && <span role="status" style={{ fontSize: 12, color: notice.ok ? "var(--ink)" : "var(--down)" }}>{notice.text}</span>}
          <button onClick={handleCopyChecklist} disabled={!visible.length} style={{ ...BUTTON, border: "1px solid var(--line)", background: "var(--panel-2)", color: "var(--ink)" }}>
            Copy as checklist
          </button>
          <button onClick={handleCsv} disabled={!visible.length} style={{ ...BUTTON, border: "none", background: "var(--btn-bg)", color: "var(--btn-ink)" }}>
            Download CSV
          </button>
        </div>
      </div>

      {view === "ranked" ? (
        <>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {filtered
              ? `Showing ${visible.length} of ${tasks.length} tasks`
              : collapsed ? `Do these first: the top ${TOP_COUNT} of ${tasks.length} tasks` : `${tasks.length} tasks, highest value first`}
            {". "}Open a task for the evidence and the exact change.
          </p>
          {table(shown)}
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
            {filtered ? `Showing ${visible.length} of ${tasks.length} tasks. ` : ""}
            Problems that hold the site back and quick wins come first; bigger work follows once there is room. Open a task for the evidence and the exact change.
          </p>
          {roadmap.map((ph) => {
            const list = ph.tasks.filter((t) => visibleIds.has(t.id));
            const mix = ph.categories.map((c) => `${c.count} ${(CATEGORY_META[c.category]?.label || c.category).toLowerCase()}`).join(", ");
            return (
              <section key={ph.days} className={p.phase} aria-label={ph.label}>
                <header className={p.phaseHead}>
                  <span className={p.phaseLabel}>{ph.label}</span>
                  <span className={p.phaseTitle}>{ph.title}</span>
                  <span className={p.phaseCount}>
                    {ph.tasks.length} task{ph.tasks.length === 1 ? "" : "s"}{mix ? ` · ${mix}` : ""}
                  </span>
                </header>
                {list.length ? table(list) : (
                  <p style={{ color: "var(--muted)", fontSize: 13, padding: "8px 12px" }}>
                    {ph.tasks.length ? "No tasks in this period match the filters." : "Nothing planned here: earlier work carries over."}
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
      {collapsed && (
        <button
          onClick={() => setShowAll(true)}
          style={{ ...BUTTON, marginTop: 12, width: "100%", border: "1px dashed var(--line)", background: "var(--soft)", color: "var(--ink)" }}
        >
          Show {visible.length - TOP_COUNT} more task{visible.length - TOP_COUNT === 1 ? "" : "s"}
        </button>
      )}
      {!visible.length && <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 12 }}>No tasks match these filters.</p>}
      {hiddenTasks}
    </div>
  );
}
