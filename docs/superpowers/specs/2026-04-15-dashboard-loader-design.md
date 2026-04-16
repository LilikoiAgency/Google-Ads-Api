# Dashboard Loader Design
**Date:** 2026-04-15
**Scope:** Replace the external GIF loading screen on all 8 dashboard pages with a shared CSS-animated gradient ring component.

---

## Problem

The current loading state uses an external GIF (`lik-loading-icon-1.gif`) with a white background. It appears in 8 places across the dashboard. With the new dark glassmorphism sidebar layout, the white background clashes badly with the dark content area.

## Solution

A single shared `DashboardLoader` component — an SVG gradient ring that spins via CSS `@keyframes`. Replaces all 8 GIF occurrences.

---

## Component

**File:** `src/app/dashboard/components/DashboardLoader.jsx`

**Props:**
- `label` — optional string, shown below the ring in muted white text

**Visual:**
- 52×52px SVG circle
- Faint track ring: `rgba(168,85,247,0.15)` stroke, 3px
- Spinning arc: `linearGradient` from `#a855f7` (purple) → `#6366f1` (indigo), 3px, rounded `strokeLinecap`
- Arc covers ~75% of the circumference (`strokeDashoffset` leaves a gap)
- Spin animation: `0.9s linear infinite` via `@keyframes dash-spin { to { transform: rotate(360deg) } }`
- Layout: `flex-1`, flex column, centered, `gap: 16px` between ring and label
- Label: `fontSize: 13`, `color: rgba(255,255,255,0.35)`, no margin

---

## Replacement Map

All 8 occurrences of the GIF are replaced with `<DashboardLoader label="..." />`:

| File | Current | New label |
|------|---------|-----------|
| `src/app/dashboard/google/ads/page.js` | GIF + "Pulling Data From Google...." | `"Pulling data from Google..."` |
| `src/app/dashboard/google/organic/page.js` | GIF | `"Loading..."` |
| `src/app/dashboard/meta/page.js` | GIF | `"Loading..."` |
| `src/app/dashboard/bing/page.js` | GIF | `"Loading..."` |
| `src/app/dashboard/seo-audit/page.js` | GIF (auth loading) | `"Loading..."` |
| `src/app/dashboard/audience-lab/page.js` | GIF | `"Loading..."` |
| `src/app/dashboard/admin/clients/page.js` | GIF | `"Loading..."` |
| `src/app/dashboard/admin/usage/page.js` | GIF | `"Loading..."` |

Note: SEO Audit has the GIF in two additional inline spots (crawling step, analyzing step) — those are replaced too.

---

## What Does NOT Change

- Page structure, state management, and data fetching logic
- The wrapper div around the loader (each page already uses `flex flex-col flex-1`)
- Any other loading states (skeleton cards, inline spinners, etc.)
