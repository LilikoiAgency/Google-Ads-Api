# SEO Meta Description Generator — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the SEO Meta Description Generator — a slide-in panel accessible from every dashboard page that takes a page title/URL, optional keyword, and optional page type, then returns 3 title variants and 3 meta description variants from Claude.

**Architecture:** Claude system prompt in `src/lib/seoMetaPrompt.js`. API route at `POST /api/claude/seo-meta` mirrors the ad-copy-strategy pattern (auth, budget cap, logApiUsage). `SeoMetaPanel` is a portal-based slide-in panel mounted in the dashboard layout so it's reachable from every page. Layout reads `?panel=seo-meta` via `useSearchParams` and opens/closes the panel.

**Tech Stack:** Next.js App Router, React, `@anthropic-ai/sdk`, `next/navigation`, `react-dom/createPortal`, Vitest + React Testing Library

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/lib/seoMetaPrompt.js` | Create | Claude system prompt for SEO meta generation |
| `src/app/api/claude/seo-meta/route.js` | Create | POST API route — validate, call Claude, return JSON |
| `src/__tests__/api/seo-meta.test.js` | Create | Node-env tests: 400 validation, 401 auth, 429 budget |
| `src/app/dashboard/components/SeoMetaPanel.jsx` | Create | Slide-in panel: form → results with copy buttons |
| `src/__tests__/dashboard/SeoMetaPanel.test.jsx` | Create | jsdom tests: render, form state, close button |
| `src/app/dashboard/layout.js` | Modify | Mount SeoMetaPanel, read `?panel=seo-meta` from URL |

---

## Task 1: Prompt + API route + tests

**Files:**
- Create: `src/lib/seoMetaPrompt.js`
- Create: `src/app/api/claude/seo-meta/route.js`
- Create: `src/__tests__/api/seo-meta.test.js`

- [ ] **Step 1: Create the system prompt**

```js
// src/lib/seoMetaPrompt.js
export function getSeoMetaSystemPrompt() {
  return `You are an expert SEO copywriter specialising in writing click-worthy, search-optimised page titles and meta descriptions.

Rules:
- Titles MUST be 50–60 characters including spaces — never shorter, never longer
- Descriptions MUST be 150–160 characters including spaces — never shorter, never longer
- If a target keyword is provided, include it naturally in every title and at least once in each description
- Never keyword-stuff — only include the keyword where it reads naturally
- Each variant must take a different angle: e.g., question-based, benefit-led, urgency/curiosity, social proof
- Never repeat the same phrase or opener across variants
- Never invent facts not implied by the page title or page type

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON object.

Response schema:
{
  "titles": ["string (50-60 chars)", "string (50-60 chars)", "string (50-60 chars)"],
  "descriptions": ["string (150-160 chars)", "string (150-160 chars)", "string (150-160 chars)"]
}`;
}
```

- [ ] **Step 2: Create the API route**

```js
// src/app/api/claude/seo-meta/route.js
export const maxDuration = 60;

import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';
import { getCredentials } from '../../../../lib/dbFunctions';
import { getSeoMetaSystemPrompt } from '../../../../lib/seoMetaPrompt';
import { logApiUsage, estimateClaudeCost, getMonthlyClaudeCost, getClaudeBudgetCap } from '../../../../lib/usageLogger';

function buildUserPrompt(pageTitle, keyword, pageType) {
  const lines = [`Page title / URL: ${pageTitle}`];
  if (keyword) lines.push(`Target keyword: ${keyword}`);
  if (pageType) lines.push(`Page type: ${pageType}`);
  return lines.join('\n');
}

export async function POST(request) {
  const requestId = crypto.randomUUID();

  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized', requestId }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body', requestId }, { status: 400 }); }

  const { pageTitle, keyword, pageType } = body;

  if (!pageTitle?.trim()) {
    return NextResponse.json({ error: 'pageTitle is required', requestId }, { status: 400 });
  }

  const [monthlyCost, budgetCap] = await Promise.all([getMonthlyClaudeCost(), getClaudeBudgetCap()]);
  if (monthlyCost >= budgetCap) {
    return NextResponse.json(
      { error: `Monthly AI budget cap of $${budgetCap} reached. Contact an admin.`, code: 'NO_CREDITS', limitReached: true, requestId },
      { status: 429 }
    );
  }

  const credentials = await getCredentials();
  const apiKey = credentials.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Anthropic API key not configured.', requestId }, { status: 500 });
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = getSeoMetaSystemPrompt();
  const userPrompt = buildUserPrompt(pageTitle.trim(), keyword?.trim() || '', pageType?.trim() || '');

  let response;
  try {
    response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
  } catch (err) {
    console.error('[claude/seo-meta] Claude error:', err?.message);
    return NextResponse.json({ error: 'Claude API error', requestId }, { status: 502 });
  }

  if (response.stop_reason === 'max_tokens') {
    return NextResponse.json({ error: 'AI response was truncated. Please try again.', requestId }, { status: 500 });
  }

  const rawText = (response.content || [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('');

  let result;
  try {
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) throw new Error('No JSON object found');
    result = JSON.parse(rawText.slice(start, end + 1));
  } catch {
    console.error('[claude/seo-meta] JSON parse failed:', rawText.slice(0, 300));
    return NextResponse.json({ error: 'Failed to parse AI response', requestId }, { status: 500 });
  }

  const inputTokens = response.usage?.input_tokens || 0;
  const outputTokens = response.usage?.output_tokens || 0;
  logApiUsage({
    type: 'claude_tokens',
    feature: 'seo_meta',
    email,
    model: 'claude-sonnet-4-6',
    inputTokens,
    outputTokens,
    estimatedCostUsd: estimateClaudeCost('claude-sonnet-4-6', inputTokens, outputTokens),
  }).catch(() => {});

  return NextResponse.json({ data: result, requestId });
}
```

- [ ] **Step 3: Write the failing tests**

```js
// src/__tests__/api/seo-meta.test.js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { email: 'test@lilikoiagency.com' },
  }),
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.001),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));

import { POST } from '@/app/api/claude/seo-meta/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

describe('POST /api/claude/seo-meta', () => {
  it('returns 400 when pageTitle is missing', async () => {
    const res = await POST(makeRequest({}));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle/);
  });

  it('returns 400 when pageTitle is empty string', async () => {
    const res = await POST(makeRequest({ pageTitle: '   ' }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle/);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'user@other.com' } });
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 429 when budget cap is reached', async () => {
    const { getMonthlyClaudeCost } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.code).toBe('NO_CREDITS');
    expect(data.limitReached).toBe(true);
  });
});
```

- [ ] **Step 4: Run the tests and verify they fail for the right reasons**

```bash
npx vitest run src/__tests__/api/seo-meta.test.js
```

Expected: Tests fail because the route file doesn't exist yet (import error). After creating the route file in Step 2, re-run — the 400 and 401 tests should pass; the 429 test passes once mock is wired correctly.

- [ ] **Step 5: Run tests with files in place and confirm all pass**

```bash
npx vitest run src/__tests__/api/seo-meta.test.js
```

Expected: 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/seoMetaPrompt.js src/app/api/claude/seo-meta/route.js src/__tests__/api/seo-meta.test.js
git commit -m "feat: add SEO meta API route and prompt"
```

---

## Task 2: SeoMetaPanel component + tests

**Files:**
- Create: `src/app/dashboard/components/SeoMetaPanel.jsx`
- Create: `src/__tests__/dashboard/SeoMetaPanel.test.jsx`

- [ ] **Step 1: Write the failing tests**

```jsx
// src/__tests__/dashboard/SeoMetaPanel.test.jsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import SeoMetaPanel from '@/app/dashboard/components/SeoMetaPanel.jsx';

vi.mock('react-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, createPortal: (children) => children };
});

global.fetch = vi.fn();

beforeEach(() => {
  global.fetch.mockResolvedValue({
    ok: true,
    json: async () => ({
      data: {
        titles: ['Title one is fifty chars of great seo content here', 'Title two is also fifty chars and well optimized ok', 'Title three here is fifty chars of seo text yes ok'],
        descriptions: [
          'Description one is one hundred and fifty characters of well-written search-optimised meta description text here.',
          'Description two is one hundred and fifty characters of well-written search-optimised meta description text here.',
          'Description three is one hundred and fifty chars of well-written search-optimised meta description text here.',
        ],
      },
      requestId: 'test-id',
    }),
  });
});

describe('SeoMetaPanel', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<SeoMetaPanel open={false} onClose={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the form when open', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    expect(screen.getByLabelText(/page title/i)).toBeTruthy();
    expect(screen.getByLabelText(/target keyword/i)).toBeTruthy();
    expect(screen.getByLabelText(/page type/i)).toBeTruthy();
  });

  it('disables Generate button when page title is empty', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(true);
  });

  it('enables Generate button when page title has text', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/page title/i), { target: { value: 'My Home Page' } });
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(false);
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<SeoMetaPanel open={true} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /✕/i }));
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — confirm they fail because component does not exist**

```bash
npx vitest run src/__tests__/dashboard/SeoMetaPanel.test.jsx
```

Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Create SeoMetaPanel.jsx**

```jsx
// src/app/dashboard/components/SeoMetaPanel.jsx
"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const PAGE_TYPES = ["Page", "Homepage", "Product", "Service", "Blog Post", "Category"];

function charColor(len, min, max) {
  if (len >= min && len <= max) return "#16a34a";
  if (len >= min - 10 && len < min) return "#d97706";
  return "#dc2626";
}

export default function SeoMetaPanel({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState("form"); // "form" | "results"

  const [pageTitle, setPageTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pageType, setPageType] = useState("Page");

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState({});

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      const tid = setTimeout(() => {
        setView("form");
        setResults(null);
        setErrorMsg(null);
        setPageTitle("");
        setKeyword("");
        setPageType("Page");
        setCopied({});
      }, 220);
      return () => clearTimeout(tid);
    }
  }, [open]);

  const canGenerate = pageTitle.trim().length > 0 && !loading;

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/claude/seo-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageTitle: pageTitle.trim(), keyword: keyword.trim() || undefined, pageType: pageType !== "Page" ? pageType : undefined }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setErrorMsg(json.error || `Error ${res.status}`);
        return;
      }
      setResults(json.data);
      setView("results");
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 1500);
    });
  };

  if (!mounted || !open) return null;

  const inputStyle = { width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 10, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 560, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7c3aed", margin: "0 0 4px" }}>AI — SEO Tools</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>SEO Meta Generator</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── Form view ── */}
          {view === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label htmlFor="seo-page-title" style={labelStyle}>Page title or URL <span style={{ color: "#dc2626" }}>*</span></label>
                <input
                  id="seo-page-title"
                  type="text"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="e.g. HVAC Repair Services in Phoenix, AZ"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="seo-keyword" style={labelStyle}>Target keyword <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <input
                  id="seo-keyword"
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. HVAC repair Phoenix"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="seo-page-type" style={labelStyle}>Page type <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <select
                  id="seo-page-type"
                  value={pageType}
                  onChange={(e) => setPageType(e.target.value)}
                  style={{ ...inputStyle, background: "#fff" }}
                >
                  {PAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {errorMsg && (
                <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", margin: 0 }}>{errorMsg}</p>
              )}

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                style={{ padding: "12px 20px", fontSize: 13, fontWeight: 800, background: canGenerate ? "#7c3aed" : "#e5e7eb", color: canGenerate ? "#fff" : "#9ca3af", border: "none", borderRadius: 12, cursor: canGenerate ? "pointer" : "not-allowed", transition: "background 0.15s" }}
              >
                {loading ? "Generating…" : "Generate meta tags"}
              </button>
            </div>
          )}

          {/* ── Results view ── */}
          {view === "results" && results && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Title tags <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>50–60 chars</span></p>
                {(results.titles || []).map((title, i) => {
                  const len = title.length;
                  const color = charColor(len, 50, 60);
                  return (
                    <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: "0 0 10px", lineHeight: 1.4 }}>{title}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{len} / 60 chars</span>
                        <button
                          onClick={() => handleCopy(title, `title-${i}`)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[`title-${i}`] ? "#d1fae5" : "#ede9fe", color: copied[`title-${i}`] ? "#065f46" : "#6d28d9", border: "none", borderRadius: 8, cursor: "pointer" }}
                        >
                          {copied[`title-${i}`] ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Meta descriptions <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>150–160 chars</span></p>
                {(results.descriptions || []).map((desc, i) => {
                  const len = desc.length;
                  const color = charColor(len, 150, 160);
                  return (
                    <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <p style={{ fontSize: 13, color: "#374151", margin: "0 0 10px", lineHeight: 1.5 }}>{desc}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{len} / 160 chars</span>
                        <button
                          onClick={() => handleCopy(desc, `desc-${i}`)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[`desc-${i}`] ? "#d1fae5" : "#ede9fe", color: copied[`desc-${i}`] ? "#065f46" : "#6d28d9", border: "none", borderRadius: 8, cursor: "pointer" }}
                        >
                          {copied[`desc-${i}`] ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setView("form")}
                style={{ padding: "11px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
```

- [ ] **Step 4: Run tests — confirm all 5 pass**

```bash
npx vitest run src/__tests__/dashboard/SeoMetaPanel.test.jsx
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/components/SeoMetaPanel.jsx src/__tests__/dashboard/SeoMetaPanel.test.jsx
git commit -m "feat: add SeoMetaPanel component"
```

---

## Task 3: Wire SeoMetaPanel into the dashboard layout

**Files:**
- Modify: `src/app/dashboard/layout.js`

- [ ] **Step 1: Add imports**

Find the top of `layout.js`:
```js
// src/app/dashboard/layout.js
"use client";
import DashboardSidebar from "./components/DashboardSidebar";
import MobileNavSheet from "./components/MobileNavSheet";
import { MobileNavProvider } from "./components/MobileNavContext";
```

Replace with:
```js
// src/app/dashboard/layout.js
"use client";
import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DashboardSidebar from "./components/DashboardSidebar";
import MobileNavSheet from "./components/MobileNavSheet";
import { MobileNavProvider } from "./components/MobileNavContext";
import SeoMetaPanel from "./components/SeoMetaPanel";
```

- [ ] **Step 2: Add panel state inside DashboardLayout**

Find:
```js
export default function DashboardLayout({ children }) {
  return (
```

Replace with:
```js
export default function DashboardLayout({ children }) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const panelParam = searchParams.get("panel");
  const [seoMetaOpen, setSeoMetaOpen] = useState(false);

  useEffect(() => {
    setSeoMetaOpen(panelParam === "seo-meta");
  }, [panelParam]);

  const closeSeoMeta = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("panel");
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    router.replace(newUrl);
  };

  return (
```

- [ ] **Step 3: Mount the panel inside the layout JSX**

Find the closing `</div>` that closes `<MobileNavProvider>`:
```jsx
        {/* Mobile full-screen nav overlay */}
        <MobileNavSheet />
      </div>
    </MobileNavProvider>
  );
}
```

Replace with:
```jsx
        {/* Mobile full-screen nav overlay */}
        <MobileNavSheet />

        {/* SEO Meta panel — available on all pages */}
        <SeoMetaPanel open={seoMetaOpen} onClose={closeSeoMeta} />
      </div>
    </MobileNavProvider>
  );
}
```

- [ ] **Step 4: Verify end-to-end**

```bash
npm run dev
```

1. Open any dashboard page
2. Click "SEO Meta" in the AI Tools sidebar section
3. URL becomes `?panel=seo-meta`
4. Panel slides in
5. Fill in page title, click Generate
6. Results appear with copy buttons
7. Click "Regenerate" — returns to form with previous values
8. Close panel — URL param clears

- [ ] **Step 5: Run all tests**

```bash
npx vitest run
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/layout.js
git commit -m "feat: wire SeoMetaPanel into dashboard layout"
```
