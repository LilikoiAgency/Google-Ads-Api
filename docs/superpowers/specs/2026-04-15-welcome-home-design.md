# Welcome / Home Screen Design
**Date:** 2026-04-15
**File:** `src/app/dashboard/page.js` (replaces the current redirect)

---

## Overview

Replace the `/dashboard` redirect-to-Google-Ads with a permanent home screen. It serves as both a welcome page and living documentation of what each tool does. Accessible any time via a Home icon at the top of the sidebar.

---

## Route

`/dashboard` — rendered inside the existing `DashboardLayout` (sidebar + main area). No new routes needed.

---

## Sidebar Addition

Add a **Home nav item** at the very top of the nav section in `DashboardSidebar.jsx`, above the "Paid Media" section label:

```js
{ href: "/dashboard", label: "Home", icon: <HomeIcon /> }  // pinned above sections
```

The `HomeIcon` is a house SVG from Font Awesome free-solid: `faHouse`. It highlights when `pathname === "/dashboard"` (exact match, not `startsWith`, to avoid matching all dashboard routes).

---

## Page Structure (`src/app/dashboard/page.js`)

### 1. DashboardToolHeader
```jsx
<DashboardToolHeader
  icon={<span style={{ fontSize: 14 }}>🏠</span>}
  title="Home"
  subtitle="Tools & documentation"
>
  {/* What's New badge — right slot */}
  <span style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 20, padding: "4px 12px", fontSize: 10, fontWeight: 700, color: "#c084fc", letterSpacing: "0.5px" }}>
    ✦ WHAT'S NEW
  </span>
</DashboardToolHeader>
```

### 2. Hero
- Personalised greeting: `"Welcome back, {firstName} 👋"` — gradient text on the name
- One-line description: *"Everything you need to manage paid media, organic search, and audience data — all in one place."*

### 3. What's New Banner
A dismissible purple-tinted card below the hero. Contains:
- `NEW` badge pill
- Title (editable string constant at top of file)
- Body text (editable string constant)

**Not** persisted — shows every visit. Simple and low-maintenance.

### 4. Tool Cards Grid

Three sections, each with a `section-label` and a 3-column grid of cards:

| Section | Tools |
|---------|-------|
| Paid Media | Google Ads, Meta Ads, Microsoft Advertising |
| Organic & Reports | Google Organic, Paid vs. Organic, SEO Audit, Client Portals |
| Data Tools | Audience Lab, Targeted Streaming |

Each card contains:
- **Icon** — imported from `DashboardIcons.jsx` (same icon as sidebar)
- **Tag badge** — matching the icon's accent color
- **Tool name** — bold
- **Description** — 1–2 sentence plain-English explanation of what the tool does
- **"Open tool →"** — subtle link text at the bottom, navigates to the tool

Cards are `<Link>` elements with the same glassmorphism glass-tile style as the dashboard home tiles.

---

## Tool Descriptions (copy)

| Tool | Description |
|------|-------------|
| Google Ads | Campaigns, keyword spend, conversions, ROAS, search terms, landing page performance, and device breakdown across all MCC accounts. |
| Meta Ads | Facebook & Instagram campaign performance — reach, frequency, conversions, and creative-level reporting. |
| Microsoft Advertising | Bing Ads performance — clicks, CTR, CPC, conversions, and campaign breakdown. |
| Google Search Organic | Search Console data — top queries, clicks, impressions, CTR, and average position by property. |
| Paid vs. Organic Report | Cross-channel keyword overlap — find gaps, double-coverage, and opportunities between paid and organic. |
| SEO / GEO / AEO Audit | AI-powered site audit. Enter any domain to get scored recommendations for SEO, generative engine, and answer engine optimization. |
| Audience Lab | Manage Audience Lab segment syncs to BigQuery. Monitor sync health, trigger manual runs, and track slot usage. |
| Targeted Streaming | Trade Desk path-to-conversion attribution. Upload report files and analyze impression-to-conversion journeys. |
| Client Portals | Manage client-facing reporting portals. Each portal exposes ad and audience data for a specific client account. |

---

## What's New (initial content)

**Title:** SEO / GEO / AEO Audit is now live  
**Body:** Run AI-powered site audits powered by Claude. Get prioritized fixes for on-page SEO, generative engine optimization, and answer engine optimization. Crawls up to 50 pages per audit.

Stored as constants at the top of `page.js` so any team member can update them without touching JSX.

---

## Icons

All tool icons imported from `src/app/dashboard/components/DashboardIcons.jsx` — the same source used by the sidebar. The Home nav item uses `faHouse` from `@fortawesome/free-solid-svg-icons`.

---

## Auth

Page uses `useSession()`. If unauthenticated, redirects to login. If loading, shows `<DashboardLoader />`. No new API calls needed.

---

## Out of Scope

- Dismissing / remembering "What's New" seen state
- Per-user onboarding checklists
- Admin-only tools section (Client Portals is visible to all; Usage Analytics is sidebar-only for admins)
