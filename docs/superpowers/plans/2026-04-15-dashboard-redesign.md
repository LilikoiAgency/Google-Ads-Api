# Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign `src/app/dashboard/page.js` with glassmorphism tiles, radial gradient background, larger sizing, and a persistent iOS-style dark/light mode toggle.

**Architecture:** Theme state is extracted into a `useTheme` hook (testable in isolation) that reads/writes `localStorage`. The component injects a `<style>` tag for CSS custom properties, hover effects, and pseudo-elements — all other styles are inline. No Tailwind changes required. Icon components and the `SECTIONS` data array are untouched.

**Tech Stack:** React 18, Next.js 14 App Router, Vitest + @testing-library/react, inline styles + injected `<style>` tag

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/lib/useTheme.js` | Theme state + localStorage persistence hook |
| Create | `src/__tests__/lib/useTheme.test.js` | Tests for the hook |
| Modify | `src/app/dashboard/page.js` | Full visual redesign of `DashboardHub` component |

---

## Task 1: Create useTheme Hook

**Files:**
- Create: `src/lib/useTheme.js`
- Create: `src/__tests__/lib/useTheme.test.js`

- [ ] **Step 1: Write the failing tests**

Create `src/__tests__/lib/useTheme.test.js`:

```js
// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach } from 'vitest';
import { useTheme } from '@/lib/useTheme.js';

describe('useTheme', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults to dark when no localStorage value exists', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
  });

  it('reads saved theme from localStorage on mount', async () => {
    localStorage.setItem('lik-theme', 'light');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe('light');
  });

  it('toggles from dark to light and persists to localStorage', async () => {
    const { result } = renderHook(() => useTheme());
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('light');
    expect(localStorage.getItem('lik-theme')).toBe('light');
  });

  it('toggles back to dark from light', async () => {
    localStorage.setItem('lik-theme', 'light');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    await act(async () => { result.current.toggleTheme(); });
    expect(result.current.theme).toBe('dark');
    expect(localStorage.getItem('lik-theme')).toBe('dark');
  });

  it('ignores invalid localStorage values', async () => {
    localStorage.setItem('lik-theme', 'banana');
    const { result } = renderHook(() => useTheme());
    await act(async () => {});
    expect(result.current.theme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- useTheme 2>&1 | tail -15
```
Expected: FAIL — `@/lib/useTheme.js` not found.

- [ ] **Step 3: Create src/lib/useTheme.js**

```js
// src/lib/useTheme.js
import { useState, useEffect } from 'react';

const THEME_KEY = 'lik-theme';

/**
 * Persists and exposes the current UI theme ('dark' | 'light').
 * Reads from localStorage on mount, writes on every change.
 */
export function useTheme() {
  const [theme, setTheme] = useState('dark');

  // Read saved preference on mount
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'light' || saved === 'dark') setTheme(saved);
  }, []);

  // Persist on change
  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return { theme, toggleTheme };
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- useTheme 2>&1 | tail -15
```
Expected: PASS — 5/5 tests green.

- [ ] **Step 5: Run full suite to confirm nothing regressed**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -10
```
Expected: all previously passing tests still green.

- [ ] **Step 6: Commit**

```bash
git add src/lib/useTheme.js src/__tests__/lib/useTheme.test.js
git commit -m "feat: add useTheme hook with localStorage persistence"
```

---

## Task 2: Rewrite DashboardHub Component

**Files:**
- Modify: `src/app/dashboard/page.js` (only the `DashboardHub` function — all icon components and `SECTIONS` array are untouched)

- [ ] **Step 1: Add `useState` and `useTheme` to the imports**

The current import line is:
```js
import { useEffect } from "react";
```
Change it to:
```js
import { useEffect, useState } from "react";
```

Then add the `useTheme` import after the existing imports:
```js
import { useTheme } from "../../lib/useTheme";
```

- [ ] **Step 2: Add the hexToRgb helper and DASH_STYLES constant above the DashboardHub function**

Add this block immediately before the `export default function DashboardHub()` line:

```js
// Converts a hex colour to "R,G,B" for use in CSS rgba() custom properties
function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

const DASH_STYLES = `
  [data-theme="dark"] {
    --bg: radial-gradient(ellipse at 25% 15%, #3b1278 0%, #1e0a38 45%, #0d0520 100%);
    --orb1: rgba(139,92,246,0.13); --orb2: rgba(79,70,229,0.10);
    --header-bg: rgba(14,5,32,0.65); --header-border: rgba(255,255,255,0.08);
    --title-start: #ffffff; --title-end: rgba(196,167,255,0.9);
    --hero-sub: rgba(255,255,255,0.4);
    --section-title: rgba(255,255,255,0.5); --section-desc: rgba(255,255,255,0.25);
    --section-count: rgba(255,255,255,0.2); --section-border: rgba(255,255,255,0.07);
    --tile-bg: rgba(255,255,255,0.06); --tile-border: rgba(255,255,255,0.12);
    --tile-hover-bg: rgba(255,255,255,0.10); --tile-hover-border: rgba(255,255,255,0.22);
    --tile-shine: rgba(255,255,255,0.10); --tile-title: rgba(255,255,255,0.93);
    --tile-desc: rgba(255,255,255,0.42); --tile-arrow: rgba(255,255,255,0.25);
    --shadow: 0 6px 28px rgba(0,0,0,0.30); --shadow-hover: 0 18px 52px rgba(0,0,0,0.42);
    --toggle-label: rgba(255,255,255,0.5);
    --pill-bg: rgba(255,255,255,0.06); --pill-border: rgba(255,255,255,0.10); --pill-text: rgba(255,255,255,0.55);
    --btn-border: rgba(255,255,255,0.20); --btn-text: rgba(255,255,255,0.6);
  }
  [data-theme="light"] {
    --bg: radial-gradient(ellipse at 25% 10%, #ede9fe 0%, #f5f3ff 40%, #faf5ff 70%, #ffffff 100%);
    --orb1: rgba(139,92,246,0.08); --orb2: rgba(109,40,217,0.06);
    --header-bg: rgba(255,255,255,0.72); --header-border: rgba(139,92,246,0.12);
    --title-start: #1e0a38; --title-end: #6d28d9;
    --hero-sub: rgba(30,10,56,0.45);
    --section-title: rgba(30,10,56,0.50); --section-desc: rgba(30,10,56,0.35);
    --section-count: rgba(30,10,56,0.25); --section-border: rgba(109,40,217,0.10);
    --tile-bg: rgba(255,255,255,0.68); --tile-border: rgba(139,92,246,0.15);
    --tile-hover-bg: rgba(255,255,255,0.92); --tile-hover-border: rgba(139,92,246,0.32);
    --tile-shine: rgba(255,255,255,0.85); --tile-title: #1e0a38;
    --tile-desc: rgba(30,10,56,0.50); --tile-arrow: rgba(30,10,56,0.30);
    --shadow: 0 4px 20px rgba(109,40,217,0.08),0 1px 4px rgba(0,0,0,0.04);
    --shadow-hover: 0 16px 44px rgba(109,40,217,0.15),0 2px 8px rgba(0,0,0,0.06);
    --toggle-label: rgba(30,10,56,0.45);
    --pill-bg: rgba(109,40,217,0.06); --pill-border: rgba(109,40,217,0.15); --pill-text: #6d28d9;
    --btn-border: rgba(109,40,217,0.20); --btn-text: #6d28d9;
  }
  .dash-tile {
    transition: transform 0.22s, box-shadow 0.22s, background 0.22s, border-color 0.22s;
  }
  .dash-tile:hover {
    transform: translateY(-5px) scale(1.015);
    background: var(--tile-hover-bg) !important;
    border-color: var(--tile-hover-border) !important;
    box-shadow: var(--shadow-hover), 0 0 28px rgba(var(--c,168,85,247),0.13) !important;
  }
  [data-theme="light"] .dash-tile:hover {
    box-shadow: var(--shadow-hover) !important;
  }
  .dash-tile::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--tile-shine), transparent);
  }
  .dash-tile:hover .dash-arrow {
    color: var(--tile-arrow-hover, rgba(255,255,255,0.7)) !important;
  }
`;
```

- [ ] **Step 3: Replace the entire DashboardHub function body**

Replace everything from `export default function DashboardHub() {` through the closing `}` with:

```js
export default function DashboardHub() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0d0520" }}>
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          style={{ width: 96, height: 96 }}
        />
      </div>
    );
  }

  return (
    <>
      <style>{DASH_STYLES}</style>
      <div data-theme={theme} style={{ minHeight: "100vh", background: "var(--bg)", position: "relative", overflowX: "hidden" }}>

        {/* Ambient orbs */}
        <div style={{ position: "fixed", top: -100, left: -100, width: 550, height: 550, borderRadius: "50%", background: "var(--orb1)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", bottom: -80, right: -80, width: 450, height: 450, borderRadius: "50%", background: "var(--orb2)", filter: "blur(90px)", pointerEvents: "none", zIndex: 0 }} />

        {/* ── Header ── */}
        <header style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--header-bg)", backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)", borderBottom: "1px solid var(--header-border)", padding: "18px 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            {/* Brand */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img
                src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
                alt="Lilikoi Agency"
                style={{ width: 42, height: 42, borderRadius: "50%" }}
              />
              <div>
                <p style={{ fontSize: 17, fontWeight: 700, color: "var(--tile-title)", margin: 0 }}>Lilikoi Agency</p>
                <p style={{ fontSize: 12, color: "var(--section-desc)", margin: 0, marginTop: 2 }}>Internal Tools</p>
              </div>
            </div>

            {/* Right side */}
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* iOS-style toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--toggle-label)", userSelect: "none" }}>
                  {isDark ? "🌙 Dark" : "☀️ Light"}
                </span>
                <div
                  onClick={toggleTheme}
                  style={{ position: "relative", width: 56, height: 30, cursor: "pointer", flexShrink: 0 }}
                  role="switch"
                  aria-checked={!isDark}
                  aria-label="Toggle light/dark mode"
                >
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: 30,
                    background: isDark ? "#3a3a5c" : "#a78bfa",
                    boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,0.12)",
                    transition: "background 0.3s",
                  }} />
                  <div style={{
                    position: "absolute", top: 3, left: 3,
                    width: 24, height: 24, borderRadius: "50%",
                    background: "white",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.28),0 1px 2px rgba(0,0,0,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13,
                    transform: isDark ? "translateX(0px)" : "translateX(26px)",
                    transition: "transform 0.28s cubic-bezier(0.34,1.56,0.64,1)",
                  }}>
                    {isDark ? "🌙" : "☀️"}
                  </div>
                </div>
              </div>

              {/* User pill */}
              {session?.user?.name && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--pill-bg)", border: "1px solid var(--pill-border)", borderRadius: 24, padding: "8px 18px", fontSize: 13, color: "var(--pill-text)" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                  {session.user.name}
                </div>
              )}

              {/* Sign out */}
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                style={{ borderRadius: 12, border: "1px solid var(--btn-border)", padding: "8px 16px", fontSize: 13, fontWeight: 500, color: "var(--btn-text)", background: "transparent", cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* ── Hero ── */}
        <div style={{ textAlign: "center", padding: "64px 40px 44px" }}>
          <h1 style={{
            fontSize: 42, fontWeight: 800, letterSpacing: "-1px", margin: 0,
            background: `linear-gradient(135deg, var(--title-start) 30%, var(--title-end) 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            {session?.user?.name
              ? `Welcome back, ${session.user.name.split(" ")[0]}`
              : "What would you like to do today?"}
          </h1>
          <p style={{ marginTop: 13, color: "var(--hero-sub)", fontSize: 17 }}>
            Choose a tool below to get started.
          </p>
        </div>

        {/* ── Sections ── */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 40px 80px", position: "relative", zIndex: 1 }}>
          {SECTIONS
            .filter((s) => !s.adminOnly || ADMIN_EMAILS.includes((session?.user?.email || "").toLowerCase()))
            .map((section) => (
              <div key={section.title} style={{ marginBottom: 52 }}>
                {/* Section header */}
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--section-border)", paddingBottom: 13, marginBottom: 20 }}>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.4px", color: "var(--section-title)", margin: 0 }}>
                      {section.title}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--section-desc)", margin: 0, marginTop: 3 }}>
                      {section.description}
                    </p>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--section-count)" }}>
                    {section.tiles.length} {section.tiles.length === 1 ? "tool" : "tools"}
                  </span>
                </div>

                {/* Tile grid */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
                  {section.tiles.map((tile) => {
                    const rgb = hexToRgb(tile.tagColor);
                    return (
                      <Link
                        key={tile.href}
                        href={tile.href}
                        className="dash-tile"
                        style={{
                          "--c": rgb,
                          background: "var(--tile-bg)",
                          border: "1px solid var(--tile-border)",
                          borderRadius: 22,
                          padding: 28,
                          backdropFilter: "blur(18px)",
                          WebkitBackdropFilter: "blur(18px)",
                          boxShadow: "var(--shadow)",
                          position: "relative",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: "column",
                          textDecoration: "none",
                          color: "inherit",
                          minHeight: 200,
                        }}
                      >
                        {/* Icon + tag row */}
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
                          <div style={{
                            width: 56, height: 56, borderRadius: 16,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            background: `rgba(${rgb},${isDark ? "0.20" : "0.10"})`,
                            boxShadow: `0 0 ${isDark ? "20px" : "14px"} rgba(${rgb},${isDark ? "0.18" : "0.10"})`,
                          }}>
                            <tile.Icon />
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px",
                            padding: "5px 11px", borderRadius: 20, border: "1px solid",
                            background: `rgba(${rgb},${isDark ? "0.14" : "0.09"})`,
                            color: tile.tagColor,
                            borderColor: `rgba(${rgb},${isDark ? "0.35" : "0.28"})`,
                          }}>
                            {tile.tag}
                          </span>
                        </div>

                        {/* Title */}
                        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--tile-title)", margin: 0, marginBottom: 9, lineHeight: 1.3 }}>
                          {tile.title}
                        </p>

                        {/* Description */}
                        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--tile-desc)", flex: 1, margin: 0 }}>
                          {tile.description}
                        </p>

                        {/* Arrow */}
                        <div className="dash-arrow" style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "var(--tile-arrow)", transition: "color 0.2s, gap 0.2s" }}>
                          Open
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run all tests**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -10
```
Expected: all 31 tests green (26 prior + 5 new useTheme tests).

- [ ] **Step 5: Start dev server and verify visually**

```bash
npm run dev
```
Open `http://localhost:3001/dashboard` (after signing in). Verify:
- Radial gradient background with purple depth
- Glass tiles with backdrop blur
- iOS-style toggle in header — thumb slides with spring animation
- Clicking toggle switches between dark (deep purple) and light (soft lavender) modes
- Refreshing the page restores the last chosen theme (localStorage persistence)
- Hover on a tile: lifts 5px with colored glow
- Admin section visible only when signed in as `frank@lilikoiagency.com`

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/page.js
git commit -m "feat: redesign dashboard with glassmorphism tiles, gradient bg, and iOS dark/light toggle"
```
