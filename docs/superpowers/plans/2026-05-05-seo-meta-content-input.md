# SEO Meta — URL Fetch + Content Paste Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users feed page content into the SEO Meta Generator by pasting a URL (backend fetches + strips the HTML) or by pasting raw text directly into a textarea — giving Claude real page content instead of just a title.

**Architecture:** A new API route (`POST /api/fetch-page-content`) handles the server-side URL fetch and HTML stripping. `SeoMetaPanel` gains a URL input + Fetch button + content textarea. The existing `seo-meta` Claude route accepts an optional `pageContent` field and relaxes the `pageTitle` requirement so either one is sufficient. The system prompt is updated to instruct Claude to ground its copy in the provided content.

**Tech Stack:** Next.js App Router, React 18 (`"use client"`), Vitest + React Testing Library, inline styles (no Tailwind/CSS modules in panel components).

---

## File Map

| File | Change |
|---|---|
| `src/app/api/fetch-page-content/route.js` | Create — URL fetch + HTML strip endpoint |
| `src/__tests__/api/fetch-page-content.test.js` | Create — node-environment tests |
| `src/lib/seoMetaPrompt.js` | Modify — instruct Claude to use page content |
| `src/app/api/claude/seo-meta/route.js` | Modify — accept `pageContent`, relax validation |
| `src/__tests__/api/seo-meta.test.js` | Modify — update validation tests |
| `src/app/dashboard/components/SeoMetaPanel.jsx` | Modify — URL + content fields |
| `src/__tests__/dashboard/SeoMetaPanel.test.jsx` | Modify — cover new UI behavior |

---

## Task 1: URL fetch API route + tests

**Files:**
- Create: `src/app/api/fetch-page-content/route.js`
- Create: `src/__tests__/api/fetch-page-content.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/api/fetch-page-content.test.js`:

```js
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('next/server', () => ({
  NextResponse: {
    json: (body, init) => ({ _body: body, status: init?.status ?? 200 }),
  },
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));

import { getServerSession } from 'next-auth';
import { POST } from '@/app/api/fetch-page-content/route.js';

const authorizedSession = { user: { email: 'test@lilikoiagency.com' } };
const makeRequest = (body) => ({ json: async () => body });

beforeEach(() => {
  getServerSession.mockResolvedValue(authorizedSession);
  global.fetch = vi.fn();
});
afterEach(() => { vi.clearAllMocks(); });

describe('POST /api/fetch-page-content', () => {
  it('returns 401 when not authenticated', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'outsider@other.com' } });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(401);
  });

  it('returns 400 when url is missing', async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(res._body.error).toMatch(/url is required/i);
  });

  it('returns 400 when url is not a valid URL', async () => {
    const res = await POST(makeRequest({ url: 'not-a-url' }));
    expect(res.status).toBe(400);
    expect(res._body.error).toMatch(/invalid url/i);
  });

  it('returns 400 for non-http protocols', async () => {
    const res = await POST(makeRequest({ url: 'ftp://example.com' }));
    expect(res.status).toBe(400);
  });

  it('returns 422 when fetched page is not ok', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 404, statusText: 'Not Found', headers: { get: () => 'text/html' }, text: async () => '' });
    const res = await POST(makeRequest({ url: 'https://example.com/missing' }));
    expect(res.status).toBe(422);
    expect(res._body.error).toMatch(/404/);
  });

  it('strips HTML and returns plain text', async () => {
    const html = '<html><head><title>My Page</title><style>body{color:red}</style></head><body><script>alert(1)</script><h1>Hello World</h1><p>This is content.</p></body></html>';
    global.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      text: async () => html,
    });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(res._body.text).toContain('Hello World');
    expect(res._body.text).toContain('This is content.');
    expect(res._body.text).not.toContain('<h1>');
    expect(res._body.text).not.toContain('alert(1)');
    expect(res._body.text).not.toContain('color:red');
  });

  it('truncates content to 5000 characters', async () => {
    const longContent = 'A'.repeat(10000);
    const html = `<body><p>${longContent}</p></body>`;
    global.fetch.mockResolvedValue({
      ok: true,
      headers: { get: () => 'text/html' },
      text: async () => html,
    });
    const res = await POST(makeRequest({ url: 'https://example.com' }));
    expect(res.status).toBe(200);
    expect(res._body.text.length).toBeLessThanOrEqual(5000);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/api/fetch-page-content.test.js --reporter=verbose
```

Expected: All tests FAIL with "Cannot find module" or similar.

- [ ] **Step 3: Create the route**

Create `src/app/api/fetch-page-content/route.js`:

```js
export const maxDuration = 30;

import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions, allowedEmailDomain } from '../../../../lib/auth';

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 5000);
}

export async function POST(request) {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || '';
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid request body' }, { status: 400 }); }

  const { url } = body;
  if (!url?.trim()) {
    return NextResponse.json({ error: 'url is required' }, { status: 400 });
  }

  let parsed;
  try { parsed = new URL(url.trim()); }
  catch { return NextResponse.json({ error: 'Invalid URL' }, { status: 400 }); }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return NextResponse.json({ error: 'Only http and https URLs are supported' }, { status: 400 });
  }

  let html;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(parsed.href, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEOMetaBot/1.0)' },
    });
    clearTimeout(timeout);
    if (!res.ok) {
      return NextResponse.json(
        { error: `Failed to fetch URL: ${res.status} ${res.statusText}` },
        { status: 422 }
      );
    }
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html') && !contentType.includes('text/plain')) {
      return NextResponse.json(
        { error: 'URL does not return HTML content' },
        { status: 422 }
      );
    }
    html = await res.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      return NextResponse.json(
        { error: 'Request timed out. The URL took too long to respond.' },
        { status: 422 }
      );
    }
    return NextResponse.json({ error: `Could not fetch URL: ${err.message}` }, { status: 422 });
  }

  const text = stripHtml(html);
  if (!text) {
    return NextResponse.json({ error: 'No readable content found at this URL' }, { status: 422 });
  }

  return NextResponse.json({ text });
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/api/fetch-page-content.test.js --reporter=verbose
```

Expected: 7 tests PASS.

- [ ] **Step 5: Commit**

```
git add src/app/api/fetch-page-content/route.js src/__tests__/api/fetch-page-content.test.js
git commit -m "feat: add fetch-page-content API route with HTML stripping"
```

---

## Task 2: Update seo-meta route + prompt to accept page content

**Files:**
- Modify: `src/lib/seoMetaPrompt.js`
- Modify: `src/app/api/claude/seo-meta/route.js`
- Modify: `src/__tests__/api/seo-meta.test.js`

- [ ] **Step 1: Write the failing tests**

Read `src/__tests__/api/seo-meta.test.js` first. It currently has 4 tests. Add 2 more to the existing `describe` block:

```js
  it('returns 400 when both pageTitle and pageContent are missing', async () => {
    const req = makePostRequest({});
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/pageTitle or pageContent/i);
  });

  it('returns 200 when pageContent is provided without pageTitle', async () => {
    mockClaudeSuccess();
    const req = makePostRequest({ pageContent: 'We sell premium HVAC systems with 10-year warranties.' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
```

Also update the existing `'returns 400 when pageTitle is missing'` test — it will need to pass `pageContent: ''` explicitly (or remove it, since the new validation is "missing both"). Check the existing test to see what it sends; update it so it sends `{}` (empty body) instead of `{ pageTitle: '' }` if needed. The new rule is: 400 when **both** are absent/empty.

The existing test `'returns 400 when pageTitle is empty string'` should be updated to also pass an empty `pageContent`:

```js
  it('returns 400 when pageTitle is empty and pageContent is empty', async () => {
    const req = makePostRequest({ pageTitle: '', pageContent: '' });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/api/seo-meta.test.js --reporter=verbose
```

Expected: The 2 new tests FAIL (route doesn't accept `pageContent` yet).

- [ ] **Step 3: Update the system prompt**

Replace the contents of `src/lib/seoMetaPrompt.js` with:

```js
export function getSeoMetaSystemPrompt() {
  return `You are an expert SEO copywriter specialising in writing click-worthy, search-optimised page titles and meta descriptions.

Rules:
- Titles MUST be 50–60 characters including spaces — never shorter, never longer
- Descriptions MUST be 150–160 characters including spaces — never shorter, never longer
- If a target keyword is provided, include it naturally in every title and at least once in each description
- Never keyword-stuff — only include the keyword where it reads naturally
- Each variant must take a different angle: e.g., question-based, benefit-led, urgency/curiosity, social proof
- Never repeat the same phrase or opener across variants
- If page content is provided, base your copy on facts and themes from that content — do not invent claims not present in it
- If only a page title is provided, do not invent facts beyond what the title implies

Return ONLY valid JSON — no markdown fences, no explanation outside the JSON object.

Response schema:
{
  "titles": ["string (50-60 chars)", "string (50-60 chars)", "string (50-60 chars)"],
  "descriptions": ["string (150-160 chars)", "string (150-160 chars)", "string (150-160 chars)"]
}`;
}
```

- [ ] **Step 4: Update the seo-meta API route**

Replace the relevant sections of `src/app/api/claude/seo-meta/route.js`:

Change `buildUserPrompt` to:
```js
function buildUserPrompt(pageTitle, keyword, pageType, pageContent) {
  const lines = [];
  if (pageTitle) lines.push(`Page title / URL: ${pageTitle}`);
  if (pageContent) lines.push(`\nPage content (use as primary source of facts):\n${pageContent}`);
  if (keyword) lines.push(`Target keyword: ${keyword}`);
  if (pageType) lines.push(`Page type: ${pageType}`);
  return lines.join('\n');
}
```

Change the destructuring and validation block:
```js
  const { pageTitle, keyword, pageType, pageContent } = body;

  if (!pageTitle?.trim() && !pageContent?.trim()) {
    return NextResponse.json({ error: 'pageTitle or pageContent is required', requestId }, { status: 400 });
  }
```

Change the `buildUserPrompt` call:
```js
  const userPrompt = buildUserPrompt(
    pageTitle?.trim() || '',
    keyword?.trim() || '',
    pageType?.trim() || '',
    pageContent?.trim() || ''
  );
```

- [ ] **Step 5: Run tests to verify they pass**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/api/seo-meta.test.js --reporter=verbose
```

Expected: All tests PASS (original 4 + 2 new = 6 total).

- [ ] **Step 6: Run full suite to check for regressions**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 7: Commit**

```
git add src/lib/seoMetaPrompt.js src/app/api/claude/seo-meta/route.js src/__tests__/api/seo-meta.test.js
git commit -m "feat: accept pageContent in seo-meta route, update prompt to use content"
```

---

## Task 3: Update SeoMetaPanel UI

**Files:**
- Modify: `src/app/dashboard/components/SeoMetaPanel.jsx`
- Modify: `src/__tests__/dashboard/SeoMetaPanel.test.jsx`

**New form layout (top to bottom):**
1. **Fetch from URL** — text input + "Fetch" button inline (entirely optional)
   - Button shows "Fetching…" while loading, "Fetched" on success
   - Error message shown inline if fetch fails
2. **Page content** — textarea (auto-filled from fetch OR user pastes; optional)
3. **Page title** — text input (optional when content is provided; required otherwise)
4. **Target keyword** — (unchanged)
5. **Page type** — (unchanged)

`canGenerate` = `(pageTitle.trim() || pageContent.trim()) && !loading && fetchStatus !== 'fetching'`

- [ ] **Step 1: Write the failing tests**

Read `src/__tests__/dashboard/SeoMetaPanel.test.jsx` first. Add 4 new tests to the existing `describe` block:

```js
  it('renders the URL fetch input and Fetch button', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    expect(screen.getByPlaceholderText(/https:\/\//i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /fetch/i })).toBeTruthy();
  });

  it('renders the page content textarea', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    expect(screen.getByLabelText(/page content/i)).toBeTruthy();
  });

  it('enables Generate button when only page content is provided (no title)', () => {
    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText(/page content/i), { target: { value: 'Some page content here' } });
    const btn = screen.getByRole('button', { name: /generate/i });
    expect(btn.disabled).toBe(false);
  });

  it('calls fetch-page-content API and populates content textarea', async () => {
    global.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ text: 'Fetched page content here' }),
      });

    render(<SeoMetaPanel open={true} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/https:\/\//i), { target: { value: 'https://example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /^fetch$/i }));

    await waitFor(() => {
      const textarea = screen.getByLabelText(/page content/i);
      expect(textarea.value).toBe('Fetched page content here');
    });
  });
```

Also update the existing `'disables Generate button when page title is empty'` test — with the new logic, the button is disabled when **both** title and content are empty. The test currently only has an empty title, so it should still pass since content will also be empty on first render.

- [ ] **Step 2: Run tests to verify the new ones fail**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/dashboard/SeoMetaPanel.test.jsx --reporter=verbose
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Update SeoMetaPanel.jsx**

Replace the full contents of `src/app/dashboard/components/SeoMetaPanel.jsx` with:

```jsx
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

  const [url, setUrl] = useState("");
  const [fetchStatus, setFetchStatus] = useState("idle"); // "idle" | "fetching" | "done" | "error"
  const [fetchError, setFetchError] = useState(null);
  const [pageContent, setPageContent] = useState("");
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
        setUrl("");
        setFetchStatus("idle");
        setFetchError(null);
        setPageContent("");
        setPageTitle("");
        setKeyword("");
        setPageType("Page");
        setCopied({});
      }, 220);
      return () => clearTimeout(tid);
    }
  }, [open]);

  const handleFetch = async () => {
    if (!url.trim()) return;
    setFetchStatus("fetching");
    setFetchError(null);
    try {
      const res = await fetch("/api/fetch-page-content", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setFetchError(json.error || `Error ${res.status}`);
        setFetchStatus("error");
        return;
      }
      setPageContent(json.text);
      setFetchStatus("done");
    } catch (err) {
      setFetchError(err.message);
      setFetchStatus("error");
    }
  };

  const canGenerate = (pageTitle.trim().length > 0 || pageContent.trim().length > 0) && !loading && fetchStatus !== "fetching";

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/claude/seo-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pageTitle: pageTitle.trim() || undefined,
          keyword: keyword.trim() || undefined,
          pageType: pageType !== "Page" ? pageType : undefined,
          pageContent: pageContent.trim() || undefined,
        }),
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
    }).catch(() => {});
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

              {/* URL fetch */}
              <div>
                <label style={labelStyle}>Fetch from URL <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    type="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setFetchStatus("idle"); setFetchError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleFetch(); }}
                    placeholder="https://yoursite.com/page"
                    style={{ ...inputStyle, flex: 1 }}
                  />
                  <button
                    onClick={handleFetch}
                    disabled={!url.trim() || fetchStatus === "fetching"}
                    aria-label="Fetch"
                    style={{
                      padding: "10px 16px", fontSize: 13, fontWeight: 700,
                      background: fetchStatus === "done" ? "#d1fae5" : (!url.trim() || fetchStatus === "fetching") ? "#e5e7eb" : "#ede9fe",
                      color: fetchStatus === "done" ? "#065f46" : (!url.trim() || fetchStatus === "fetching") ? "#9ca3af" : "#6d28d9",
                      border: "none", borderRadius: 10, cursor: (!url.trim() || fetchStatus === "fetching") ? "not-allowed" : "pointer",
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >
                    {fetchStatus === "fetching" ? "Fetching…" : fetchStatus === "done" ? "✓ Fetched" : "Fetch"}
                  </button>
                </div>
                {fetchStatus === "done" && (
                  <p style={{ fontSize: 11, color: "#16a34a", marginTop: 4 }}>
                    {pageContent.length.toLocaleString()} characters loaded
                  </p>
                )}
                {fetchError && (
                  <p style={{ fontSize: 11, color: "#dc2626", marginTop: 4 }}>{fetchError}</p>
                )}
              </div>

              {/* Page content */}
              <div>
                <label htmlFor="seo-page-content" style={labelStyle}>
                  Page content <span style={{ color: "#9ca3af", fontWeight: 400 }}>(paste text or use Fetch above)</span>
                </label>
                <textarea
                  id="seo-page-content"
                  value={pageContent}
                  onChange={(e) => setPageContent(e.target.value)}
                  placeholder="Paste your page copy, product description, or any text you want Claude to use…"
                  rows={5}
                  style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
                />
              </div>

              {/* Page title */}
              <div>
                <label htmlFor="seo-page-title" style={labelStyle}>
                  Page title
                  {pageContent.trim() ? (
                    <span style={{ color: "#9ca3af", fontWeight: 400 }}> (optional when content is provided)</span>
                  ) : (
                    <span style={{ color: "#dc2626" }}> *</span>
                  )}
                </label>
                <input
                  id="seo-page-title"
                  type="text"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="e.g. HVAC Repair Services in Phoenix, AZ"
                  style={inputStyle}
                />
              </div>

              {/* Target keyword */}
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

              {/* Page type */}
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

- [ ] **Step 4: Run tests to verify they pass**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run src/__tests__/dashboard/SeoMetaPanel.test.jsx --reporter=verbose
```

Expected: All tests PASS (original 5 + 4 new = 9 total).

- [ ] **Step 5: Run full suite**

```
cd C:\Users\frank\Documents\GitHub\Google-Ads-Api && npx vitest run --reporter=verbose
```

Expected: All tests pass.

- [ ] **Step 6: Commit**

```
git add src/app/dashboard/components/SeoMetaPanel.jsx src/__tests__/dashboard/SeoMetaPanel.test.jsx
git commit -m "feat: add URL fetch and content paste to SEO Meta panel"
```
