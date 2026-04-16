# Mobile Layout Design
**Date:** 2026-04-15
**Breakpoint:** `< 768px` switches to mobile layout

---

## Overview

The desktop sidebar is hidden on mobile. A compact top bar replaces it, with a grid-icon button that opens a full-screen tool picker. Tool-specific controls (account picker, date range, status) move into a bottom sheet triggered by a "Filters" pill.

---

## Breakpoint

- **≥ 768px** — desktop: sidebar visible, `DashboardToolHeader` with controls in right slot
- **< 768px** — mobile: sidebar hidden, `MobileTopBar` shown, filter controls in bottom sheet

Implemented via CSS media query in `DashboardLayout` and `DashboardSidebar`.

---

## New Components

### `src/app/dashboard/components/MobileTopBar.jsx`

Shown only on mobile (hidden on desktop via CSS). Sticky, glass style matching the dashboard theme.

**Structure (left → right):**
- Tool icon box (28px, purple-tinted, same as DashboardToolHeader)
- Tool name (bold) + subtitle line showing active account + date range
- Grid button (⊞) — 32px icon button, opens the nav grid sheet

**Props:**
```js
<MobileTopBar
  icon={<GoogleAdsIcon />}
  title="Google Ads"
  subtitle="Semper Solaris · Last 7 days"   // dynamic, updated on filter change
  onOpenNav={() => setNavOpen(true)}
>
  {/* optional filter pill slot */}
</MobileTopBar>
```

**Filter pills** — two small pills beneath (or inside) the top bar:
- `"Filters ▾"` — opens the filter bottom sheet
- `"Last 7 days ▾"` — shortcut to open date range section of filter sheet directly

### `src/app/dashboard/components/MobileNavSheet.jsx`

Full-screen overlay. Opens when the ⊞ grid button is tapped.

**Structure:**
- Logo row (L dot + "Lilikoi Agency") + ✕ close button
- Sections: "Paid Media", "Organic & Reports", "Data Tools", "Admin" (admin-only)
- 3-column grid of tool tiles per section — brand icon + tool name
- Active tool tile highlighted (purple tint + border)
- Tapping a tile navigates and closes the sheet

**State:** `useState(false)` in `DashboardLayout`, passed down as prop.

### `src/app/dashboard/components/MobileFilterSheet.jsx`

Bottom sheet that slides up from the bottom. Contains all tool-specific controls that were in the `DashboardToolHeader` right slot on desktop.

**Structure:**
- Drag handle (32px pill)
- "Filters" title
- Sections for each control group (Account, Date Range, Status)
- Purple "Apply Filters" button — closes sheet and triggers data refresh

**Props:**
```js
<MobileFilterSheet
  open={filterOpen}
  onClose={() => setFilterOpen(false)}
  onApply={(filters) => { applyFilters(filters); setFilterOpen(false); }}
>
  {/* page-specific filter controls passed as children */}
</MobileFilterSheet>
```

---

## Layout Changes

### `src/app/dashboard/layout.js`
- Add `MobileTopBar` hidden on desktop, shown on mobile
- `DashboardSidebar` hidden on mobile via CSS (`@media (max-width: 767px) { .sb-desktop { display: none; } }`)
- `MobileNavSheet` rendered at layout level (portal-style, z-index 50)
- State: `navOpen` managed in layout

### `src/app/globals.css`
```css
@media (max-width: 767px) {
  .sb-desktop { display: none !important; }
  .mobile-topbar { display: flex !important; }
}
@media (min-width: 768px) {
  .mobile-topbar { display: none !important; }
}
```

### Each tool page
- `DashboardToolHeader` right-slot controls (account picker, date range, etc.) wrapped in a `<div className="desktop-controls">` hidden on mobile
- Page adds `<MobileFilterSheet>` with the same controls for mobile
- The `DashboardToolHeader` itself stays on all screen sizes (title/icon always visible)

---

## Per-Page Filter Sheet Content

| Page | Filter sheet contains |
|------|----------------------|
| Google Ads | Account dropdown, Campaign dropdown, Date range, Status filter |
| Meta Ads | Account dropdown, Campaign dropdown, Date range |
| Bing Ads | Account dropdown, Campaign dropdown, Date range |
| Google Organic | Site picker, Date range preset |
| SEO Audit | No filter sheet needed (domain input is in content) |
| Audience Lab | No filter sheet needed |
| Streaming | No filter sheet needed |
| Report | GSC site picker, Date range |
| Admin pages | No filter sheet needed |

---

## Content Responsiveness

Beyond navigation, these content adjustments are needed:
- KPI card grids: `grid-cols-2` on mobile (currently `grid-cols-3` or `grid-cols-4`)
- Data tables: horizontal scroll wrapper (`overflow-x: auto`) already on most, verify all
- Charts (Recharts/Plotly): already use `ResponsiveContainer` — verify on narrow viewports
- `max-w-7xl` containers: add `px-4` on mobile instead of `px-6`

---

## Out of Scope
- Mobile-specific data density changes (charts simplification)
- Touch gesture swipe-to-open nav
- PWA / install prompt
