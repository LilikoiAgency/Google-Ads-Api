# Welcome Home Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `/dashboard` redirect with a permanent welcome/home screen showing tool docs, and add a Home icon to the sidebar.

**Architecture:** Two targeted changes — (1) add a pinned Home nav item to `DashboardSidebar` above the existing sections, (2) replace the redirect in `src/app/dashboard/page.js` with a full welcome page that uses `DashboardIcons` for consistent icons. No new routes, no new components, no API calls.

**Tech Stack:** Next.js 14 App Router, React 18, Font Awesome (`faHouse`), `DashboardIcons.jsx`, `DashboardToolHeader`, `DashboardLoader`, Tailwind + inline styles

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Modify | `src/app/dashboard/components/DashboardSidebar.jsx` | Add Home nav item pinned above sections |
| Modify | `src/app/dashboard/page.js` | Replace redirect with welcome page |

---

## Task 1: Home Nav Item in Sidebar

**Files:**
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx`

- [ ] **Step 1: Add faHouse import**

Read `src/app/dashboard/components/DashboardSidebar.jsx`. Find the existing FA solid import line:
```js
import {
  faFileLines, faMagnifyingGlassChart,
  faBriefcase, faPeopleGroup, faTv, faChartLine,
} from "@fortawesome/free-solid-svg-icons";
```

Add `faHouse` to it:
```js
import {
  faHouse, faFileLines, faMagnifyingGlassChart,
  faBriefcase, faPeopleGroup, faTv, faChartLine,
} from "@fortawesome/free-solid-svg-icons";
```

- [ ] **Step 2: Add Home item in the nav render**

In the sidebar JSX, find the nav section — the `<div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }}>` that maps over `sections`. Add a pinned Home item BEFORE that div's `{sections.map(...)}` call:

```jsx
      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="sidebar-scrollbar">
        {/* ── Pinned Home item ── */}
        {(() => {
          const homeActive = pathname === "/dashboard";
          return (
            <Link
              href="/dashboard"
              title="Home"
              className={`sb-nav-item${homeActive ? " sb-nav-item-active" : ""}`}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "0 10px", height: 38, borderRadius: 10,
                margin: "1px 6px 6px", cursor: "pointer",
                transition: "background 0.15s", flexShrink: 0, minWidth: 188,
                textDecoration: "none",
                background: homeActive ? "rgba(168,85,247,0.18)" : "transparent",
                color: homeActive ? "#c084fc" : "rgba(255,255,255,0.45)",
                position: "relative",
              }}
            >
              <div
                className="sb-nav-icon"
                style={{
                  width: 32, height: 32, borderRadius: 9,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  background: homeActive ? "rgba(168,85,247,0.25)" : "transparent",
                  color: homeActive ? "#c084fc" : "rgba(255,255,255,0.45)",
                  transition: "filter 0.2s",
                }}
              >
                <FontAwesomeIcon icon={faHouse} style={{ width: 15, height: 15 }} />
              </div>
              <span className="sb-label" style={{ opacity: 0, transition: "opacity 0.15s 0.06s", whiteSpace: "nowrap", fontSize: 12, fontWeight: 600 }}>
                Home
              </span>
              {homeActive && (
                <div className="sb-active-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "#a855f7", position: "absolute", right: 10 }} />
              )}
            </Link>
          );
        })()}

        {/* ── Divider below Home ── */}
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "2px 10px 8px" }} />

        {sections.map((section) => (
          /* ... existing section mapping unchanged ... */
```

**Important:** Keep all existing `{sections.map(...)}` code exactly as-is. Only add the Home item and divider ABOVE it.

- [ ] **Step 3: Verify sidebar tests still pass**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- DashboardSidebar 2>&1 | tail -10
```
Expected: all existing sidebar tests still green.

- [ ] **Step 4: Run full suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/components/DashboardSidebar.jsx
git commit -m "feat: add pinned Home nav item to sidebar"
```

---

## Task 2: Welcome Home Page

**Files:**
- Modify: `src/app/dashboard/page.js`

- [ ] **Step 1: Replace the entire file**

The current `src/app/dashboard/page.js` is just a redirect. Replace its entire contents with:

```js
// src/app/dashboard/page.js
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import DashboardToolHeader from "./components/DashboardToolHeader";
import DashboardLoader from "./components/DashboardLoader";
import {
  GoogleAdsIcon, MetaAdsIcon, MicrosoftAdsIcon, SearchConsoleIcon,
  ReportIcon, SEOAuditIcon, ClientPortalsIcon,
  AudienceLabIcon, StreamingIcon,
} from "./components/DashboardIcons";

// ── Editable "What's New" content ────────────────────────────────────────────
const WHATS_NEW_TITLE = "SEO / GEO / AEO Audit is now live";
const WHATS_NEW_BODY  = "Run AI-powered site audits powered by Claude. Get prioritized fixes for on-page SEO, generative engine optimization, and answer engine optimization. Crawls up to 50 pages per audit.";

// ── Tool catalogue ────────────────────────────────────────────────────────────
const TOOLS = [
  {
    section: "Paid Media",
    items: [
      { href: "/dashboard/google/ads",     Icon: GoogleAdsIcon,     name: "Google Ads",              tag: "Paid",     tagColor: "rgba(66,133,244,0.12)",  tagText: "#4285F4",  tagBorder: "rgba(66,133,244,0.3)",  desc: "Campaigns, keyword spend, conversions, ROAS, search terms, landing page performance, and device breakdown across all MCC accounts." },
      { href: "/dashboard/meta",           Icon: MetaAdsIcon,       name: "Meta Ads",                tag: "Paid",     tagColor: "rgba(24,119,242,0.12)",  tagText: "#1877F2",  tagBorder: "rgba(24,119,242,0.3)",  desc: "Facebook & Instagram campaign performance — reach, frequency, conversions, and creative-level reporting." },
      { href: "/dashboard/bing",           Icon: MicrosoftAdsIcon,  name: "Microsoft Advertising",   tag: "Paid",     tagColor: "rgba(0,120,212,0.12)",   tagText: "#0078D4",  tagBorder: "rgba(0,120,212,0.3)",   desc: "Bing Ads performance — clicks, CTR, CPC, conversions, and campaign breakdown." },
    ],
  },
  {
    section: "Organic & Reports",
    items: [
      { href: "/dashboard/google/organic", Icon: SearchConsoleIcon, name: "Google Search Organic",   tag: "Organic",  tagColor: "rgba(52,168,83,0.12)",   tagText: "#34A853",  tagBorder: "rgba(52,168,83,0.3)",   desc: "Search Console data — top queries, clicks, impressions, CTR, and average position by property." },
      { href: "/dashboard/report",         Icon: ReportIcon,        name: "Paid vs. Organic Report", tag: "Report",   tagColor: "rgba(245,158,11,0.12)",  tagText: "#f59e0b",  tagBorder: "rgba(245,158,11,0.3)",  desc: "Cross-channel keyword overlap — find gaps, double-coverage, and opportunities between paid and organic." },
      { href: "/dashboard/seo-audit",      Icon: SEOAuditIcon,      name: "SEO / GEO / AEO Audit",  tag: "AI Audit", tagColor: "rgba(13,148,136,0.12)",  tagText: "#0d9488",  tagBorder: "rgba(13,148,136,0.3)",  desc: "AI-powered site audit. Enter any domain to get scored recommendations for SEO, generative engine, and answer engine optimization." },
      { href: "/dashboard/admin/clients",  Icon: ClientPortalsIcon, name: "Client Portals",          tag: "Portals",  tagColor: "rgba(168,85,247,0.12)",  tagText: "#a855f7",  tagBorder: "rgba(168,85,247,0.3)",  desc: "Manage client-facing reporting portals. Each portal exposes ad and audience data for a specific client account." },
    ],
  },
  {
    section: "Data Tools",
    items: [
      { href: "/dashboard/audience-lab",   Icon: AudienceLabIcon,   name: "Audience Lab",            tag: "Segments", tagColor: "rgba(168,85,247,0.12)",  tagText: "#a855f7",  tagBorder: "rgba(168,85,247,0.3)",  desc: "Manage Audience Lab segment syncs to BigQuery. Monitor sync health, trigger manual runs, and track slot usage." },
      { href: "/dashboard/streaming",      Icon: StreamingIcon,     name: "Targeted Streaming",      tag: "Streaming",tagColor: "rgba(14,165,233,0.12)",  tagText: "#0ea5e9",  tagBorder: "rgba(14,165,233,0.3)",  desc: "Trade Desk path-to-conversion attribution. Upload report files and analyze impression-to-conversion journeys." },
    ],
  },
];

// ── Card ──────────────────────────────────────────────────────────────────────
function ToolCard({ href, Icon, name, tag, tagColor, tagText, tagBorder, desc }) {
  return (
    <Link
      href={href}
      style={{
        background: "rgba(255,255,255,0.05)",
        border: "1px solid rgba(255,255,255,0.09)",
        borderRadius: 14, padding: 18,
        display: "flex", flexDirection: "column", gap: 10,
        textDecoration: "none",
        transition: "background 0.15s, border-color 0.15s",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.09)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.16)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.05)"; e.currentTarget.style.borderColor = "rgba(255,255,255,0.09)"; }}
    >
      {/* Top row: icon + tag */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,0.06)" }}>
          <Icon />
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", padding: "3px 8px", borderRadius: 12, border: "1px solid", background: tagColor, color: tagText, borderColor: tagBorder }}>
          {tag}
        </span>
      </div>
      {/* Name */}
      <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.88)", margin: 0 }}>{name}</p>
      {/* Description */}
      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.4)", lineHeight: 1.55, margin: 0, flex: 1 }}>{desc}</p>
      {/* Link */}
      <p style={{ fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.3)", margin: 0 }}>Open tool →</p>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardHome() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
    }
  }, [status, router]);

  if (status === "loading") {
    return <DashboardLoader label="Loading..." />;
  }

  const firstName = session?.user?.name?.split(" ")[0] || "there";

  return (
    <div className="flex flex-col flex-1">
      {/* Tool header */}
      <DashboardToolHeader
        icon={<span style={{ fontSize: 14 }}>🏠</span>}
        title="Home"
        subtitle="Tools & documentation"
      >
        <span style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 20, padding: "4px 12px", fontSize: 10, fontWeight: 700, color: "#c084fc", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
          ✦ WHAT'S NEW
        </span>
      </DashboardToolHeader>

      {/* Content */}
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "36px 28px 60px", width: "100%" }}>

        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: "#fff", letterSpacing: "-0.5px", margin: "0 0 10px" }}>
            Welcome back,{" "}
            <span style={{ background: "linear-gradient(135deg,#a855f7,#6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {firstName}
            </span>{" "}
            👋
          </h1>
          <p style={{ fontSize: 15, color: "rgba(255,255,255,0.45)", lineHeight: 1.6, margin: 0, maxWidth: 520 }}>
            Everything you need to manage paid media, organic search, and audience data — all in one place. Use the sidebar or pick a tool below to get started.
          </p>
        </div>

        {/* What's New banner */}
        <div style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 14, padding: "16px 20px", marginBottom: 40, display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span style={{ background: "rgba(168,85,247,0.25)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 800, color: "#c084fc", letterSpacing: "0.5px", whiteSpace: "nowrap", flexShrink: 0 }}>NEW</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "rgba(255,255,255,0.85)", margin: "0 0 4px" }}>{WHATS_NEW_TITLE}</p>
            <p style={{ fontSize: 12, color: "rgba(255,255,255,0.45)", lineHeight: 1.55, margin: 0 }}>{WHATS_NEW_BODY}</p>
          </div>
        </div>

        {/* Tool sections */}
        {TOOLS.map(({ section, items }) => (
          <div key={section} style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: "rgba(255,255,255,0.3)", margin: "0 0 12px" }}>{section}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {items.map((tool) => <ToolCard key={tool.href} {...tool} />)}
            </div>
          </div>
        ))}

      </div>
    </div>
  );
}
```

- [ ] **Step 2: Run full test suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```
Expected: all tests green.

- [ ] **Step 3: Build check**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm run build 2>&1 | tail -10
```
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/app/dashboard/page.js
git commit -m "feat: replace dashboard redirect with welcome home screen and tool docs"
```
