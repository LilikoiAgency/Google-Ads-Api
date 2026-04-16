# Dashboard Sidebar Layout Design
**Date:** 2026-04-15
**Scope:** Full architectural change — shared sidebar shell replaces individual page headers across all dashboard tools.

---

## Overview

Replace the current "each page has its own header" pattern with a persistent sidebar shell that wraps all dashboard pages. The sidebar is the navigation. Individual tool pages no longer need back buttons or standalone headers — they get a slim shared tool header at the top of their content area.

---

## Layout Structure

```
┌─────────────────────────────────────────────────┐
│  56px sidebar (collapsed)  │  Tool header 56px  │
│  ──────────────────────    │  ─────────────────  │
│  [Logo]                    │  [Icon] Tool name   │
│  [Icon] ← active           │  subtitle           │
│  [Icon]                    │  [Controls...]      │
│  [Icon]                    │  ─────────────────  │
│  [Icon]                    │                     │
│  [Icon]                    │  Tool content area  │
│  [Icon]                    │  (page-specific)    │
│  ...                       │                     │
│  ─────────────             │                     │
│  [🌙] [User]               │                     │
└─────────────────────────────────────────────────┘
```

On hover, the sidebar expands to 200px showing labels, section headings, and user name.

---

## New Files

### `src/app/dashboard/layout.js`
Next.js App Router shared layout for the entire `/dashboard` route tree. Renders the sidebar alongside `{children}`. Replaces the need for individual headers on every page.

```jsx
// "use client" — sidebar needs usePathname for active state and useSession for user
export default function DashboardLayout({ children }) {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'radial-gradient(...)' }}>
      <DashboardSidebar />
      <main style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {children}
      </main>
    </div>
  );
}
```

### `src/app/dashboard/components/DashboardSidebar.js`
The sidebar component. Self-contained: reads `usePathname()` for active state, `useSession()` for user info, `useTheme()` for the toggle.

**Sidebar structure (top to bottom):**
1. Logo row — Lilikoi icon + "Lilikoi Agency" brand text (visible on expand)
2. Nav sections (visible labels on expand only):
   - **Paid Media**: Google Ads, Meta Ads, Microsoft Advertising
   - **Organic & Reports**: Google Organic, Paid vs. Organic, SEO Audit, Client Portals
   - **Data Tools**: Audience Lab, Targeted Streaming
   - **Admin** (admin-only): Usage Analytics
3. Spacer
4. Divider
5. Theme toggle (🌙/☀️ icon + mini iOS toggle pill — label visible on expand)
6. User row — avatar + name + "Admin · Sign out" (visible on expand, click to sign out)

**Hover behavior:**
- Default width: 56px
- Hovered width: 200px
- Transition: `width 0.22s cubic-bezier(0.4, 0, 0.2, 1)`
- Labels, section headings, brand name, user info all have `opacity: 0` collapsed → `opacity: 1` on expand with a short delay
- Active item shows a 4px purple dot indicator (right side) when collapsed; the full row highlight when expanded

**Active state:** `usePathname()` determines which nav item is highlighted. Exact match on path prefix (e.g. `/dashboard/google/ads` → Google Ads active).

### `src/app/dashboard/components/DashboardToolHeader.js`
Slim 56px reusable header used by each tool page. Takes props:

```js
<DashboardToolHeader
  icon={<GoogleAdsIcon />}   // brand icon, 28px
  title="Google Ads"         // tool name
  subtitle="Campaign Dashboard"  // optional, tool-specific subtitle
>
  {/* right-side controls slot — account picker, date range, etc. */}
  <AccountDropdown ... />
  <CampaignDropdown ... />
</DashboardToolHeader>
```

**Structure:** `flex`, `height: 56px`, `background: rgba(14,8,28,0.6)`, `backdropFilter: blur(16px)`, `borderBottom: 1px solid rgba(255,255,255,0.06)`. Icon + title/subtitle on the left, `children` slot on the right.

---

## Modified Files

### `src/app/dashboard/page.js` (Hub)
The tile grid is removed. The dashboard hub becomes a redirect to `/dashboard/google/ads` since the sidebar now provides all navigation. Alternatively, a minimal "home" welcome screen with quick stats. **Simplest approach: redirect.**

```js
// src/app/dashboard/page.js
import { redirect } from 'next/navigation';
export default function DashboardHub() {
  redirect('/dashboard/google/ads');
}
```

### All 8 tool pages
Each page loses its standalone `<header>` block and gains a `<DashboardToolHeader>` at the top of its returned JSX. Back buttons removed. Max-width inconsistencies resolved (all content areas use `max-w-7xl`).

| Page | Old header | New header |
|------|-----------|------------|
| Google Ads | Custom `<header>` with back btn, acct dropdown, campaign dropdown | `<DashboardToolHeader>` with acct + campaign dropdowns in right slot |
| Google Organic | Custom `<header>` with back btn, site picker | `<DashboardToolHeader>` with site picker in right slot |
| Meta Ads | Custom `<header>` with back btn, acct + campaign dropdowns | `<DashboardToolHeader>` with acct + campaign in right slot |
| Microsoft Ads | Custom `<header>` with back btn, acct + campaign dropdowns | `<DashboardToolHeader>` with acct + campaign in right slot |
| SEO Audit | Lilikoi logo as back link + Dashboard text link | `<DashboardToolHeader>` no right-side controls |
| Streaming | Inline `StreamingHeader` component (step-aware subtitle) | `<DashboardToolHeader>` with dynamic subtitle prop |
| Audience Lab | Custom header + tab bar baked in | `<DashboardToolHeader>` — tab bar moves below the header into page content |
| Client Portals | TBD (follows same pattern) | `<DashboardToolHeader>` |

### `src/app/dashboard/google/ads/page.js`
The **account picker** (full-screen modal that shows before campaign data loads) currently replaces the entire page. With a sidebar layout, this becomes an **overlay modal** over the content area instead of replacing the layout. The sidebar stays visible; a semi-transparent overlay covers only the `<main>` content area.

---

## Auth & Session

- `DashboardLayout` does NOT handle auth redirects (each page keeps its own `useSession` check).
- `DashboardSidebar` reads `useSession()` to show user name and conditionally show admin-only nav items.
- Sign out button moves from individual pages to the sidebar user row.

---

## Theme Toggle

- `useTheme()` hook is imported in `DashboardSidebar` — one source of truth.
- Removed from `DashboardHub` (it no longer exists as a page).
- Individual pages no longer manage theme state.

---

## What Goes Away

- All standalone `<header>` blocks in all 8 tool pages
- All `←` back buttons
- `DashboardHub` tile grid page
- `StreamingHeader` inline component (replaced by `DashboardToolHeader`)
- Per-page sign out buttons
- Per-page inconsistent `max-w-*` values on headers

---

## What Stays the Same

- All tool logic, data fetching, state management inside each page
- All dropdowns and pickers (just moved into `DashboardToolHeader` right slot)
- Tailwind classes and CSS custom properties
- `useTheme`, `useSession`, `isAdmin` hooks
- The Audience Lab tab bar (moves below the tool header, stays in the page)
- Google Ads account picker (becomes overlay modal, not full-page replace)
- All API routes unchanged

---

## Out of Scope

- Mobile/responsive sidebar (hamburger menu) — desktop-only for now
- Animated route transitions
- Collapsible sidebar via click-to-pin (hover-only for now)
- Breadcrumbs or secondary nav
