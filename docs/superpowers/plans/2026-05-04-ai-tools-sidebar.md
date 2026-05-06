# AI Tools Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "AI Tools" section to the dashboard sidebar that surfaces contextual AI panels per page, and wire the three existing Google Ads tools (Account Brief, Audit, Ad Copy) to it via URL query params.

**Architecture:** A route-based config file maps each tool to the pages where it appears. `DashboardSidebar` reads the current pathname and renders a filtered tool list. Clicking a tool sets `?panel=<key>` in the URL; each host page reads the param via `useSearchParams` and opens the matching panel.

**Tech Stack:** Next.js App Router, React, `usePathname` / `useSearchParams` / `useRouter` from `next/navigation`

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/aiToolsConfig.js` | Create | Tool registry + route filter function |
| `src/app/dashboard/components/DashboardSidebar.jsx` | Modify | Add AI Tools section below Data Tools |
| `src/app/dashboard/google/ads/components/AccountBriefCard.jsx` | Create | Extract AccountBriefCard + helpers from page.js |
| `src/app/dashboard/google/ads/components/AccountBriefPanel.jsx` | Create | Slide-in panel wrapping AccountBriefCard |
| `src/app/dashboard/google/ads/page.js` | Modify | Import AccountBriefCard from new file; read `?panel` param; open audit/ad-copy/brief panels |

---

## Task 1: Tool config

**Files:**
- Create: `src/lib/aiToolsConfig.js`

- [ ] **Step 1: Create the config file**

```js
// src/lib/aiToolsConfig.js
export const AI_TOOLS = [
  { key: 'brief',      label: 'Account Brief',   icon: '📋', routes: ['/dashboard/google/ads'] },
  { key: 'audit',      label: 'Ads Audit',        icon: '🔍', routes: ['/dashboard/google/ads'] },
  { key: 'ad-copy',    label: 'Ad Copy Strategy', icon: '✏️', routes: ['/dashboard/google/ads'] },
  { key: 'meta-copy',  label: 'Meta Ad Copy',     icon: '✏️', routes: ['/dashboard/meta'] },
  { key: 'seo-meta',   label: 'SEO Meta',         icon: '📝', routes: ['*'] },
];

export function getToolsForRoute(pathname) {
  return AI_TOOLS.filter(
    (t) => t.routes.includes('*') || t.routes.some((r) => pathname.startsWith(r))
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/aiToolsConfig.js
git commit -m "feat: add AI tools route config"
```

---

## Task 2: Sidebar AI Tools section

**Files:**
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx`

- [ ] **Step 1: Add imports at the top of DashboardSidebar.jsx**

Find this line (currently line 5):
```js
import { usePathname } from "next/navigation";
```

Replace with:
```js
import { usePathname, useRouter } from "next/navigation";
import { getToolsForRoute } from "../../../lib/aiToolsConfig";
```

- [ ] **Step 2: Add `useRouter` and tools derivation inside the component**

Find this line inside `DashboardSidebar()` (currently around line 42):
```js
const isActive = (href) => pathname?.startsWith(href) ?? false;
```

Add directly after it:
```js
  const router = useRouter();
  const aiTools = getToolsForRoute(pathname || "");
```

- [ ] **Step 3: Add the AI Tools section to the nav JSX**

Find this closing tag in the nav section (currently around line 166):
```jsx
        {sections.map((section) => (
          <div key={section.label}>
```

The `sections.map` block ends with a closing `</div>` and then `</div>` closing the nav scroll area. Find the closing `</div>` that ends the `{sections.map(...)}` block — it looks like:
```jsx
        ))}
      </div>
```

Insert the AI Tools section between the end of `sections.map` and the closing `</div>` of the scroll container. The exact insertion point is after the last `})}` of sections.map and before the `</div>` that closes `style={{ flex: 1, overflowY: "auto"...}}`.

Add this block:

```jsx
        {/* ── AI Tools ── */}
        {aiTools.length > 0 && (
          <div>
            <div style={{ height: 1, background: "var(--sb-divider)", margin: "6px 10px 4px" }} />
            <div className="sb-label" style={{ ...expandLabel, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "var(--sb-section-label)", padding: "8px 14px 4px", minWidth: 216, display: "flex", alignItems: "center", gap: 6 }}>
              AI Tools
              <span style={{ background: "rgba(129,140,248,0.18)", color: "#818cf8", borderRadius: 999, fontSize: 9, fontWeight: 800, padding: "1px 6px" }}>{aiTools.length}</span>
            </div>
            {aiTools.map((tool) => (
              <button
                key={tool.key}
                title={tool.label}
                onClick={() => {
                  const params = new URLSearchParams(window.location.search);
                  params.set("panel", tool.key);
                  router.push(`${window.location.pathname}?${params.toString()}`);
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "0 12px", height: 44, borderRadius: 12,
                  margin: "1px 6px", cursor: "pointer",
                  transition: "background 0.15s", flexShrink: 0, minWidth: 200,
                  border: "none", background: "transparent",
                  color: "var(--sb-text)", textAlign: "left", width: "calc(100% - 12px)",
                }}
              >
                <div style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 16 }}>
                  {tool.icon}
                </div>
                <span className="sb-label" style={{ ...expandLabel, fontSize: 13, fontWeight: 600 }}>{tool.label}</span>
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 4: Verify the sidebar renders without errors**

Start the dev server and open any dashboard page. The sidebar should show an "AI Tools" section with the appropriate tools for that page. On Google Ads it should show 3 tools; on Meta it should show 1; on other pages it should show the SEO Meta tool only.

```bash
npm run dev
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/components/DashboardSidebar.jsx
git commit -m "feat: add AI Tools section to sidebar"
```

---

## Task 3: Extract AccountBriefCard + create AccountBriefPanel

**Files:**
- Create: `src/app/dashboard/google/ads/components/AccountBriefCard.jsx`
- Create: `src/app/dashboard/google/ads/components/AccountBriefPanel.jsx`

- [ ] **Step 1: Create AccountBriefCard.jsx**

This extracts the `AccountBriefCard` component and its helpers out of `page.js`. Create `src/app/dashboard/google/ads/components/AccountBriefCard.jsx`:

```jsx
"use client";
import { useState, useEffect, useRef } from "react";

const DATE_BRIEF_OPTIONS = [
  { value: 'LAST_7_DAYS',  label: 'Last 7 days'  },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
  { value: 'THIS_MONTH',   label: 'This month'   },
];

const accountBriefRequests = new Map();

function getAccountBriefCacheKey(customerId, dateLabel) {
  return `accountBrief:${customerId}:${dateLabel}:${new Date().toISOString().slice(0, 10)}`;
}

function safeSetItem(storage, key, value) {
  try { storage.setItem(key, value); } catch {}
}
function safeGetItem(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

export default function AccountBriefCard({ selectedCustomer, currentDateRange }) {
  const [briefRange, setBriefRange] = useState(
    DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange) ? currentDateRange : 'LAST_30_DAYS'
  );
  const [state, setState] = useState({ status: 'idle', briefing: null, generatedAt: null, error: null, code: null });
  const [collapsed, setCollapsed] = useState(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; fetchingRef.current = false; };
  }, []);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const customerName = selectedCustomer?.customer?.customer_client?.descriptive_name || '';
  const campaigns = selectedCustomer?.campaigns || [];
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0) / 1_000_000;

  async function fetchBrief(rangeOverride = null) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const activeRange = rangeOverride ?? briefRange;
    const cacheKey = getAccountBriefCacheKey(customerId, activeRange);
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const cached = safeGetItem(sessionStorage, cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (!mountedRef.current) return;
        setState({ status: 'done', briefing: parsed.briefing, generatedAt: parsed.generatedAt, error: null });
        setCollapsed(false);
        return;
      }

      let requestPromise = accountBriefRequests.get(cacheKey);
      if (!requestPromise) {
        requestPromise = fetch('/api/claude/account-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, customerName, campaigns, dateLabel: activeRange }),
        }).then(async (res) => ({ res, json: await res.json() }));
        accountBriefRequests.set(cacheKey, requestPromise);
      }

      const { res, json } = await requestPromise;
      if (!mountedRef.current) return;
      if (json.skipped) {
        setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      } else if (!res.ok || json.error) {
        setState({ status: 'error', briefing: null, generatedAt: null, error: json.error || `Error ${res.status}`, code: json.code || null });
      } else {
        safeSetItem(sessionStorage, cacheKey, JSON.stringify({ briefing: json.briefing, generatedAt: json.generatedAt }));
        setState({ status: 'done', briefing: json.briefing, generatedAt: json.generatedAt, error: null });
        setCollapsed(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setState({ status: 'error', briefing: null, generatedAt: null, error: err.message });
    } finally {
      fetchingRef.current = false;
      accountBriefRequests.delete(cacheKey);
    }
  }

  useEffect(() => {
    if (!customerId || totalSpend === 0) {
      setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      return;
    }
    fetchingRef.current = false;
    fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    if (DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange)) {
      setBriefRange(currentDateRange);
    }
  }, [currentDateRange]);

  if (totalSpend === 0 || state.status === 'no_spend') return null;

  const { status, briefing, generatedAt, error } = state;
  const genTime = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const hasTop = (briefing?.topPerformers || []).length > 0;
  const hasBottom = (briefing?.bottomPerformers || []).length > 0;

  return (
    <section style={{ margin: '0 0 22px 0', borderRadius: 18, border: '1px solid #dbe4ff', background: '#fff', overflow: 'hidden', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderBottom: collapsed ? 'none' : '1px solid #e8eefc', background: 'linear-gradient(135deg, #eef4ff 0%, #ffffff 55%, #f8fbff 100%)', flexWrap: 'wrap' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: '#1d4ed8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>AI</div>
        <div style={{ minWidth: 190 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, lineHeight: 1.2, fontWeight: 800, color: '#111827', margin: 0 }}>Google Ads briefing</h2>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 999, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Daily</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
            {genTime ? `Generated ${genTime}` : 'Runs once per user, account, range, and day.'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={briefRange} onChange={(e) => { const r = e.target.value; setBriefRange(r); fetchBrief(r); }} disabled={status === 'loading'} style={{ fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', background: '#fff', color: '#334155', minHeight: 34, outline: 'none' }}>
            {DATE_BRIEF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => fetchBrief()} disabled={status === 'loading'} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: status === 'loading' ? '#93c5fd' : '#2563eb', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 34, boxShadow: status === 'loading' ? 'none' : '0 8px 18px rgba(37,99,235,0.22)' }}>
            {status === 'loading' ? 'Checking...' : 'Refresh'}
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} style={{ fontSize: 12, fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, cursor: 'pointer', padding: '7px 11px', minHeight: 34 }}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ padding: 18 }}>
          {status === 'loading' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ height: 18, width: '58%', background: '#e5edff', borderRadius: 8, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {[0, 1].map((i) => (
                  <div key={i} style={{ border: '1px solid #edf2f7', borderRadius: 14, padding: 14 }}>
                    <div style={{ height: 11, width: '34%', background: '#f1f5f9', borderRadius: 6, marginBottom: 12, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 13, width: '72%', background: '#eef2f7', borderRadius: 6, marginBottom: 8, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 11, width: '92%', background: '#f1f5f9', borderRadius: 6, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {status === 'error' && (
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
              {state.code === 'NO_CREDITS' ? 'AI briefing is temporarily unavailable. Check back soon or contact your admin.' : error}
            </p>
          )}
          {status === 'done' && briefing && (
            <BriefingContent briefing={briefing} />
          )}
        </div>
      )}
    </section>
  );
}

function BriefingContent({ briefing }) {
  const hasTop = (briefing?.topPerformers || []).length > 0;
  const hasBottom = (briefing?.bottomPerformers || []).length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ borderRadius: 14, background: '#0f172a', color: '#fff', padding: '15px 16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Executive readout</p>
        <p style={{ fontSize: 15, lineHeight: 1.55, fontWeight: 700, color: '#f8fafc', margin: 0 }}>{briefing.headline}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#15803d', margin: 0 }}>Top performers</p>
            <span style={{ fontSize: 11, color: '#166534', background: '#dcfce7', borderRadius: 999, padding: '3px 8px', fontWeight: 700 }}>{hasTop ? briefing.topPerformers.length : 0}</span>
          </div>
          {(briefing.topPerformers || []).map((p, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #dcfce7', borderRadius: 12, padding: 12, marginBottom: i === briefing.topPerformers.length - 1 ? 0 : 10 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.3 }}>{p.name}</p>
              <p style={{ fontSize: 12, color: '#15803d', margin: '0 0 5px 0', fontWeight: 700, lineHeight: 1.4 }}>{p.metric}</p>
              <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}>{p.insight}</p>
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid #fecaca', background: '#fff7ed', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b91c1c', margin: 0 }}>Needs attention</p>
            <span style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', borderRadius: 999, padding: '3px 8px', fontWeight: 700 }}>{hasBottom ? briefing.bottomPerformers.length : 0}</span>
          </div>
          {(briefing.bottomPerformers || []).map((p, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 12, padding: 12, marginBottom: i === briefing.bottomPerformers.length - 1 ? 0 : 10 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.3 }}>{p.name}</p>
              <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 5px 0', fontWeight: 700, lineHeight: 1.4 }}>{p.issue}</p>
              <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}><span style={{ fontWeight: 800, color: '#9a3412' }}>Recommended:</span> {p.recommendation}</p>
            </div>
          ))}
        </div>
      </div>
      {(briefing.actions || []).length > 0 && (
        <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#3730a3', margin: '0 0 10px' }}>Priority actions</p>
          {briefing.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i === briefing.actions.length - 1 ? 0 : 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
              <p style={{ fontSize: 12, color: '#1e1b4b', margin: 0, lineHeight: 1.5, fontWeight: 600 }}>{a}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create AccountBriefPanel.jsx**

Create `src/app/dashboard/google/ads/components/AccountBriefPanel.jsx`:

```jsx
"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import AccountBriefCard from "./AccountBriefCard";

export default function AccountBriefPanel({ open, onClose, selectedCustomer, currentDateRange }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  if (!mounted || !open) return null;

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 560, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#1d4ed8", margin: "0 0 4px" }}>AI — Account Intelligence</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>Account Brief</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {selectedCustomer ? (
            <AccountBriefCard selectedCustomer={selectedCustomer} currentDateRange={currentDateRange} />
          ) : (
            <p style={{ fontSize: 13, color: "#6b7280" }}>Select an account to view its brief.</p>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
```

- [ ] **Step 3: Commit**

```bash
git add src/app/dashboard/google/ads/components/AccountBriefCard.jsx src/app/dashboard/google/ads/components/AccountBriefPanel.jsx
git commit -m "feat: extract AccountBriefCard and add AccountBriefPanel"
```

---

## Task 4: Wire URL params into Google Ads page.js

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

- [ ] **Step 1: Add useSearchParams and useRouter imports**

Find the existing import at the top of page.js:
```js
import { useRouter } from "next/navigation";
```

Replace with:
```js
import { useRouter, useSearchParams } from "next/navigation";
```

- [ ] **Step 2: Import AccountBriefCard from its new file and AccountBriefPanel**

Find the existing import for `AdCopyPanel`:
```js
import AdCopyPanel from "./components/AdCopyPanel";
```

Add directly after it:
```js
import AccountBriefCard from "./components/AccountBriefCard";
import AccountBriefPanel from "./components/AccountBriefPanel";
```

- [ ] **Step 3: Remove the inline AccountBriefCard definition from page.js**

Delete the following blocks from `page.js` (they are now in `AccountBriefCard.jsx`):
- `const DATE_BRIEF_OPTIONS = [...]` (4 lines, around line 427)
- `const accountBriefRequests = new Map();` (1 line, around line 434)
- `function getAccountBriefCacheKey(...)` (3 lines, around line 436)
- `function AccountBriefCard(...)` — the entire component (around lines 440–700, ends before `export default function GoogleAdsDashboard`)

**Important:** `safeSetSessionStorageItem` and `safeGetSessionStorageItem` are used elsewhere in `page.js` — do NOT delete those.

- [ ] **Step 4: Add panel state driven by URL params**

Inside `GoogleAdsDashboard()`, find the existing state line:
```js
const [adCopyPanelOpen, setAdCopyPanelOpen] = useState(false);
```

Replace it with:
```js
const searchParams = useSearchParams();
const panelParam = searchParams.get("panel");
const [adCopyPanelOpen, setAdCopyPanelOpen] = useState(false);
const [auditPanelOpen, setAuditPanelOpen] = useState(false);
const [briefPanelOpen, setBriefPanelOpen] = useState(false);
```

- [ ] **Step 5: Sync panel open state with URL param**

Find the existing `const [filterOpen, setFilterOpen]` line inside the component. Add this `useEffect` block after the existing panel state declarations (after `briefPanelOpen`):

```js
useEffect(() => {
  setAdCopyPanelOpen(panelParam === "ad-copy");
  setAuditPanelOpen(panelParam === "audit");
  setBriefPanelOpen(panelParam === "brief");
}, [panelParam]);
```

- [ ] **Step 6: Add a closePanel helper**

Add this function inside the component, after the useEffect above:

```js
const closePanel = () => {
  const params = new URLSearchParams(window.location.search);
  params.delete("panel");
  const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
  router.replace(newUrl);
};
```

- [ ] **Step 7: Update existing audit panel trigger**

Find where `AuditPanel` is currently opened (search for `setAuditOpen` or the audit button — it uses its own open state). Update the existing audit button's `onClick` to set the URL param instead:

Find:
```jsx
onClick={() => setAuditOpen(true)}
```
Replace with:
```jsx
onClick={() => { const p = new URLSearchParams(window.location.search); p.set("panel","audit"); router.push(`${window.location.pathname}?${p.toString()}`); }}
```

And update `AuditPanel`'s `open` and `onClose` props:
- `open={auditPanelOpen}`
- `onClose={closePanel}`

- [ ] **Step 8: Update AdCopyPanel trigger and props**

Find the existing "Generate Ad Copy Strategy" button:
```jsx
onClick={() => setAdCopyPanelOpen(true)}
```
Replace with:
```jsx
onClick={() => { const p = new URLSearchParams(window.location.search); p.set("panel","ad-copy"); router.push(`${window.location.pathname}?${p.toString()}`); }}
```

Update `AdCopyPanel` props:
- `open={adCopyPanelOpen}`
- `onClose={closePanel}`

- [ ] **Step 9: Add AccountBriefPanel mount**

Find the existing `<AdCopyPanel ... />` JSX. Add `AccountBriefPanel` directly after it, inside the same fragment:

```jsx
<AccountBriefPanel
  open={briefPanelOpen}
  onClose={closePanel}
  selectedCustomer={selectedCustomer}
  currentDateRange={dateRange}
/>
```

- [ ] **Step 10: Verify the page works**

```bash
npm run dev
```

1. Open `/dashboard/google/ads`, select an account
2. Click "Ads Audit" in the sidebar → URL becomes `?panel=audit`, panel opens
3. Click "Ad Copy Strategy" in sidebar → `?panel=ad-copy`, panel opens
4. Click "Account Brief" in sidebar → `?panel=brief`, panel opens
5. Close any panel → URL param clears

- [ ] **Step 11: Run tests**

```bash
npx vitest run
```

Expected: all existing tests pass.

- [ ] **Step 12: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: wire panel URL params into Google Ads page"
```
