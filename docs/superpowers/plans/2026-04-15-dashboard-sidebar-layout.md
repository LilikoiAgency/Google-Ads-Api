# Dashboard Sidebar Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-page headers with a persistent icon-sidebar that expands on hover, a shared layout shell, and a slim per-tool header — eliminating all back buttons and inconsistent headers across the 9 dashboard pages.

**Architecture:** A new `src/app/dashboard/layout.js` (Next.js App Router shared layout) renders `DashboardSidebar` + wraps `{children}` in a `<main>` block. Each page removes its old `<header>` and adds a `<DashboardToolHeader>` at the top of its returned JSX. The background gradient and ambient orbs move into the layout and are removed from individual pages.

**Tech Stack:** Next.js 14 App Router, React 18, `usePathname` for active nav, `useSession` + `useTheme` + `isAdmin` in sidebar, Tailwind CSS + inline styles (matching existing page patterns)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/app/dashboard/layout.js` | Shared shell: background, sidebar, main wrapper |
| Create | `src/app/dashboard/components/DashboardSidebar.js` | Collapsing icon sidebar with nav, theme toggle, user |
| Create | `src/app/dashboard/components/DashboardToolHeader.js` | Slim 56px tool header used by all pages |
| Create | `src/__tests__/dashboard/DashboardSidebar.test.js` | Active nav, admin-only visibility |
| Create | `src/__tests__/dashboard/DashboardToolHeader.test.js` | Props rendering |
| Modify | `src/app/dashboard/page.js` | Redirect to /dashboard/google/ads |
| Modify | `src/app/dashboard/google/ads/page.js` | Remove header, add tool header, picker → overlay |
| Modify | `src/app/dashboard/google/organic/page.js` | Remove header, add tool header |
| Modify | `src/app/dashboard/meta/page.js` | Remove header, add tool header |
| Modify | `src/app/dashboard/bing/page.js` | Remove header, add tool header |
| Modify | `src/app/dashboard/seo-audit/page.js` | Remove header, add tool header |
| Modify | `src/app/dashboard/streaming/page.js` | Remove StreamingHeader, add tool header |
| Modify | `src/app/dashboard/audience-lab/page.js` | Remove header, tab bar moves below tool header |
| Modify | `src/app/dashboard/admin/clients/page.js` | Remove header, add tool header |
| Modify | `src/app/dashboard/admin/usage/page.js` | Remove header, add tool header |

---

## Task 1: DashboardSidebar + DashboardToolHeader (TDD)

**Files:**
- Create: `src/app/dashboard/components/DashboardSidebar.js`
- Create: `src/app/dashboard/components/DashboardToolHeader.js`
- Create: `src/__tests__/dashboard/DashboardSidebar.test.js`
- Create: `src/__tests__/dashboard/DashboardToolHeader.test.js`

- [ ] **Step 1: Create test directory**

```bash
mkdir -p /c/Users/frank/Documents/GitHub/Google-Ads-Api/src/__tests__/dashboard
```

- [ ] **Step 2: Write DashboardToolHeader tests**

Create `src/__tests__/dashboard/DashboardToolHeader.test.js`:

```js
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import DashboardToolHeader from '@/app/dashboard/components/DashboardToolHeader.js';

describe('DashboardToolHeader', () => {
  it('renders the title', () => {
    render(<DashboardToolHeader title="Google Ads" />);
    expect(screen.getByText('Google Ads')).toBeTruthy();
  });

  it('renders the subtitle when provided', () => {
    render(<DashboardToolHeader title="Google Ads" subtitle="Campaign Dashboard" />);
    expect(screen.getByText('Campaign Dashboard')).toBeTruthy();
  });

  it('renders children in the right slot', () => {
    render(
      <DashboardToolHeader title="Google Ads">
        <button>My Control</button>
      </DashboardToolHeader>
    );
    expect(screen.getByText('My Control')).toBeTruthy();
  });

  it('renders without subtitle or children without crashing', () => {
    render(<DashboardToolHeader title="SEO Audit" />);
    expect(screen.getByText('SEO Audit')).toBeTruthy();
  });
});
```

- [ ] **Step 3: Write DashboardSidebar tests**

Create `src/__tests__/dashboard/DashboardSidebar.test.js`:

```js
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  usePathname: vi.fn(() => '/dashboard/google/ads'),
  useRouter: vi.fn(() => ({ replace: vi.fn() })),
}));
vi.mock('next-auth/react', () => ({
  useSession: vi.fn(() => ({ data: { user: { name: 'Frank', email: 'frank@lilikoiagency.com' } }, status: 'authenticated' })),
  signOut: vi.fn(),
}));
vi.mock('@/lib/useTheme', () => ({
  useTheme: vi.fn(() => ({ theme: 'dark', toggleTheme: vi.fn() })),
}));
vi.mock('@/lib/admins', () => ({
  isAdmin: vi.fn((email) => email === 'frank@lilikoiagency.com'),
}));

import DashboardSidebar from '@/app/dashboard/components/DashboardSidebar.js';

describe('DashboardSidebar', () => {
  it('renders nav links for all main tools', () => {
    render(<DashboardSidebar />);
    expect(screen.getByTitle('Google Ads')).toBeTruthy();
    expect(screen.getByTitle('Meta Ads')).toBeTruthy();
    expect(screen.getByTitle('SEO Audit')).toBeTruthy();
  });

  it('shows Usage Analytics for admins', () => {
    render(<DashboardSidebar />);
    expect(screen.getByTitle('Usage Analytics')).toBeTruthy();
  });

  it('shows user name', () => {
    render(<DashboardSidebar />);
    expect(screen.getByText('Frank')).toBeTruthy();
  });
});
```

- [ ] **Step 4: Run tests to confirm they fail**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- dashboard 2>&1 | tail -15
```
Expected: FAIL — modules not found.

- [ ] **Step 5: Create DashboardToolHeader**

Create `src/app/dashboard/components/DashboardToolHeader.js`:

```js
// src/app/dashboard/components/DashboardToolHeader.js
"use client";

/**
 * Slim 56px tool header used by every dashboard page.
 * Props:
 *   icon     — optional JSX, rendered in a 28px purple-tinted box
 *   title    — required string, tool name
 *   subtitle — optional string, shown below title in muted text
 *   children — optional, rendered right-aligned (account pickers, date range, etc.)
 */
export default function DashboardToolHeader({ icon, title, subtitle, children }) {
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        background: "rgba(14,8,28,0.65)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        gap: 12,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      {/* Left: icon + title + subtitle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {icon && (
          <div
            style={{
              width: 28, height: 28, borderRadius: 8,
              background: "rgba(168,85,247,0.2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.92)", margin: 0, lineHeight: 1.2 }}>
            {title}
          </p>
          {subtitle && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 2, lineHeight: 1 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>

      {/* Right: tool-specific controls */}
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {children}
        </div>
      )}
    </header>
  );
}
```

- [ ] **Step 6: Create DashboardSidebar**

Create `src/app/dashboard/components/DashboardSidebar.js`:

```js
// src/app/dashboard/components/DashboardSidebar.js
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "../../../lib/useTheme";
import { isAdmin } from "../../../lib/admins";

// ── Inline SVG icons (16×16 viewBox, stroke-based) ───────────────────────────

function IconGrid() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
      <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
    </svg>
  );
}
function IconMeta() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>
    </svg>
  );
}
function IconMicrosoft() {
  return (
    <svg width="15" height="15" viewBox="0 0 21 21" fill="none">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" rx="1"/>
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="1"/>
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="1"/>
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1"/>
    </svg>
  );
}
function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
  );
}
function IconBars() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
    </svg>
  );
}
function IconAudit() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      <line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/>
    </svg>
  );
}
function IconUsers() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
      <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  );
}
function IconVideo() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>
    </svg>
  );
}
function IconPortals() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
    </svg>
  );
}
function IconChart() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/>
    </svg>
  );
}
function IconUser() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
    </svg>
  );
}

// ── Nav config ────────────────────────────────────────────────────────────────

const NAV = [
  {
    label: "Paid Media",
    items: [
      { href: "/dashboard/google/ads",  label: "Google Ads",        icon: <IconGrid />      },
      { href: "/dashboard/meta",        label: "Meta Ads",          icon: <IconMeta />      },
      { href: "/dashboard/bing",        label: "Microsoft Ads",     icon: <IconMicrosoft /> },
    ],
  },
  {
    label: "Organic & Reports",
    items: [
      { href: "/dashboard/google/organic", label: "Google Organic",  icon: <IconSearch />  },
      { href: "/report",                   label: "Paid vs Organic", icon: <IconBars />    },
      { href: "/dashboard/seo-audit",      label: "SEO Audit",       icon: <IconAudit />   },
      { href: "/dashboard/admin/clients",  label: "Client Portals",  icon: <IconPortals /> },
    ],
  },
  {
    label: "Data Tools",
    items: [
      { href: "/dashboard/audience-lab", label: "Audience Lab", icon: <IconUsers /> },
      { href: "/dashboard/streaming",    label: "Streaming",    icon: <IconVideo />  },
    ],
  },
];

const ADMIN_NAV = {
  label: "Admin",
  items: [
    { href: "/dashboard/admin/usage", label: "Usage Analytics", icon: <IconChart /> },
  ],
};

// ── Styles ────────────────────────────────────────────────────────────────────

const S = {
  sidebar: {
    width: 56,
    background: "rgba(8,5,18,0.88)",
    backdropFilter: "blur(20px)",
    WebkitBackdropFilter: "blur(20px)",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    display: "flex",
    flexDirection: "column",
    padding: "14px 0",
    flexShrink: 0,
    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
    overflow: "hidden",
    position: "relative",
    zIndex: 20,
    minHeight: "100vh",
  },
  logoRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "0 13px 14px",
    borderBottom: "1px solid rgba(255,255,255,0.06)",
    marginBottom: 8, flexShrink: 0, minWidth: 200,
  },
  logoImg: {
    width: 30, height: 30, borderRadius: 9,
    background: "linear-gradient(135deg, #7c3aed, #a855f7)",
    flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 14, fontWeight: 800, color: "white",
  },
  sectionLabel: {
    fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px",
    color: "rgba(255,255,255,0.2)", padding: "8px 14px 4px",
    whiteSpace: "nowrap", minWidth: 200,
    transition: "opacity 0.1s",
  },
  navItem: (active) => ({
    display: "flex", alignItems: "center", gap: 10,
    padding: "0 10px", height: 38, borderRadius: 10,
    margin: "1px 6px", cursor: "pointer",
    transition: "background 0.15s", flexShrink: 0, minWidth: 188,
    textDecoration: "none",
    background: active ? "rgba(168,85,247,0.18)" : "transparent",
    color: active ? "#c084fc" : "rgba(255,255,255,0.45)",
    position: "relative",
  }),
  navIcon: (active) => ({
    width: 32, height: 32, borderRadius: 9,
    display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
    background: active ? "rgba(168,85,247,0.25)" : "transparent",
    color: active ? "#c084fc" : "rgba(255,255,255,0.45)",
  }),
  navLabel: {
    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
    transition: "opacity 0.15s 0.06s",
  },
  activeDot: {
    width: 4, height: 4, borderRadius: "50%", background: "#a855f7",
    position: "absolute", right: 10,
  },
  divider: { height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 10px" },
  userRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "0 10px", height: 42, margin: "2px 6px",
    borderRadius: 10, cursor: "pointer",
    transition: "background 0.15s", flexShrink: 0, minWidth: 188,
    border: "none", background: "transparent", textAlign: "left",
    color: "inherit",
  },
  userAvatar: {
    width: 30, height: 30, borderRadius: 9,
    background: "linear-gradient(135deg, #4f46e5, #7c3aed)",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 11, fontWeight: 800, color: "white", flexShrink: 0,
  },
  toggleRow: {
    display: "flex", alignItems: "center", gap: 10,
    padding: "0 10px", height: 36, margin: "2px 6px",
    borderRadius: 10, flexShrink: 0, minWidth: 188,
    cursor: "pointer",
  },
  toggleIcon: {
    width: 30, height: 30, display: "flex", alignItems: "center",
    justifyContent: "center", flexShrink: 0, fontSize: 15,
  },
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const email = session?.user?.email?.toLowerCase() || "";
  const firstName = session?.user?.name?.split(" ")[0] || "You";
  const adminUser = isAdmin(email);

  const isActive = (href) => pathname?.startsWith(href) ?? false;

  const sections = adminUser ? [...NAV, ADMIN_NAV] : NAV;

  return (
    <nav
      style={S.sidebar}
      onMouseEnter={(e) => (e.currentTarget.style.width = "200px")}
      onMouseLeave={(e) => (e.currentTarget.style.width = "56px")}
    >
      {/* Logo */}
      <div style={S.logoRow}>
        <div style={S.logoImg}>L</div>
        <span style={{ fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.9)", whiteSpace: "nowrap", opacity: 0, transition: "opacity 0.15s 0.05s" }}
          className="sidebar-expand-label">
          Lilikoi Agency
        </span>
      </div>

      {/* Nav sections */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="sidebar-scrollbar">
        {sections.map((section) => (
          <div key={section.label}>
            <div style={S.sectionLabel} className="sidebar-expand-label">{section.label}</div>
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} style={S.navItem(active)} title={item.label}>
                  <div style={S.navIcon(active)}>{item.icon}</div>
                  <span style={{ ...S.navLabel, opacity: 0 }} className="sidebar-expand-label">{item.label}</span>
                  {active && <div style={S.activeDot} className="sidebar-active-dot" />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom: theme toggle + user */}
      <div>
        <div style={S.divider} />
        <div style={S.toggleRow} onClick={toggleTheme}>
          <div style={S.toggleIcon}>{isDark ? "🌙" : "☀️"}</div>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap", opacity: 0 }}
            className="sidebar-expand-label">
            {isDark ? "Dark mode" : "Light mode"}
          </span>
        </div>
        <button style={S.userRow} onClick={() => signOut({ callbackUrl: "/" })}>
          <div style={S.userAvatar}>{firstName[0]}</div>
          <div style={{ opacity: 0, textAlign: "left" }} className="sidebar-expand-label">
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap" }}>{firstName}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>
              {adminUser ? "Admin · " : ""}Sign out
            </div>
          </div>
        </button>
      </div>
    </nav>
  );
}
```

- [ ] **Step 7: Add sidebar expand CSS to globals.css**

Open `src/app/globals.css` and append at the end:

```css
/* Sidebar expand-on-hover labels */
nav:hover .sidebar-expand-label {
  opacity: 1 !important;
  transition-delay: 0.06s;
}
nav:hover .sidebar-active-dot {
  opacity: 0 !important;
}
```

- [ ] **Step 8: Run the tests to confirm they pass**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- dashboard 2>&1 | tail -20
```
Expected: PASS — 7 tests green.

- [ ] **Step 9: Run full suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 10: Commit**

```bash
git add src/app/dashboard/components/DashboardSidebar.js src/app/dashboard/components/DashboardToolHeader.js src/__tests__/dashboard/DashboardSidebar.test.js src/__tests__/dashboard/DashboardToolHeader.test.js src/app/globals.css
git commit -m "feat: add DashboardSidebar and DashboardToolHeader components"
```

---

## Task 2: Dashboard Layout + Hub Redirect

**Files:**
- Create: `src/app/dashboard/layout.js`
- Modify: `src/app/dashboard/page.js`

- [ ] **Step 1: Create src/app/dashboard/layout.js**

```js
// src/app/dashboard/layout.js
// Server component — DashboardSidebar is the "use client" part.
import DashboardSidebar from "./components/DashboardSidebar";

export default function DashboardLayout({ children }) {
  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "radial-gradient(ellipse at 25% 15%, #2d1060 0%, #1a0a30 45%, #0d0520 100%)",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* Ambient orbs */}
      <div style={{
        position: "fixed", top: -100, left: -100, width: 550, height: 550,
        borderRadius: "50%", background: "rgba(139,92,246,0.12)",
        filter: "blur(100px)", pointerEvents: "none", zIndex: 0,
      }} />
      <div style={{
        position: "fixed", bottom: -80, right: -80, width: 450, height: 450,
        borderRadius: "50%", background: "rgba(79,70,229,0.09)",
        filter: "blur(90px)", pointerEvents: "none", zIndex: 0,
      }} />

      {/* Sidebar */}
      <DashboardSidebar />

      {/* Main content area */}
      <main style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        zIndex: 1,
        minWidth: 0,
      }}>
        {children}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Replace hub page with redirect**

Open `src/app/dashboard/page.js`. Replace the entire file with:

```js
// src/app/dashboard/page.js
import { redirect } from "next/navigation";

export default function DashboardHub() {
  redirect("/dashboard/google/ads");
}
```

- [ ] **Step 3: Build check to catch layout wiring issues**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm run build 2>&1 | tail -20
```
Expected: build succeeds. If you see "useSession must be used within a SessionProvider" — the layout needs the `SessionProvider`. Check that `src/app/layout.js` (root layout) already wraps everything with `SessionProvider`. If it does, the dashboard layout inherits it.

- [ ] **Step 4: Run dev server and verify**

```bash
npm run dev
```
Open `http://localhost:3000/dashboard` — should redirect to `/dashboard/google/ads`. The sidebar should be visible on the left. The old Google Ads page will still have its old header (that's fine — it gets removed in Task 3).

- [ ] **Step 5: Commit**

```bash
git add src/app/dashboard/layout.js src/app/dashboard/page.js
git commit -m "feat: add dashboard shell layout and redirect hub to Google Ads"
```

---

## Task 3: Update Google Ads Page

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

This is the most complex page. It has:
1. A standalone `<header>` block (lines ~615–636) — **remove**
2. A full-screen loading state — **wrap in overlay-safe container**
3. A full-screen account picker (`if (showPicker === true)`) — **convert to overlay modal**
4. Root div `<div className="min-h-screen bg-customPurple-dark">` — **remove background, keep as flex column**

Read the file before editing. Make each change separately.

- [ ] **Step 1: Add DashboardToolHeader import**

At the top of `src/app/dashboard/google/ads/page.js`, add after the existing imports:
```js
import DashboardToolHeader from "../../components/DashboardToolHeader";
```

Also add the Google Ads icon as a small inline component near the top of the file (before `GoogleAdsDashboard`):

```js
function GAdsHeaderIcon() {
  return (
    <svg viewBox="0 0 192 192" width="16" height="16">
      <circle cx="40" cy="148" r="40" fill="#FBBC04"/>
      <path d="M96 4L56 72l40 68 40-68z" fill="#4285F4"/>
      <circle cx="152" cy="148" r="40" fill="#34A853"/>
    </svg>
  );
}
```

- [ ] **Step 2: Remove root wrapper background, update loading state**

Find the loading state return (currently):
```jsx
  if (showPicker === null || status === "loading" || (showPicker === false && isFetching && allCampaignData.length === 0 && !error)) {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-white">
```

Replace with (no min-h-screen bg, fills the main area):
```jsx
  if (showPicker === null || status === "loading" || (showPicker === false && isFetching && allCampaignData.length === 0 && !error)) {
    return (
      <div className="flex flex-col justify-center items-center flex-1">
```

- [ ] **Step 3: Convert full-screen picker to overlay modal**

Find the account picker block:
```jsx
  if (showPicker === true) {
    return (
      <div className="min-h-screen bg-customPurple-dark flex flex-col">
        <header className="border-b border-white/10 px-6 py-4 flex items-center gap-3">
          <Link href="/dashboard" ...>←</Link>
          ...
        </header>
        ...
      </div>
    );
  }
```

Replace the entire `if (showPicker === true) { return (...); }` block with nothing — delete it. The picker will now be rendered as an overlay inside the main return.

- [ ] **Step 4: Update the main return**

Find the main return's root div:
```jsx
  return (
    <div className="min-h-screen bg-customPurple-dark">
```

Replace with:
```jsx
  return (
    <div className="flex flex-col flex-1" style={{ position: "relative", minHeight: 0, overflow: "hidden" }}>
```

Then immediately inside that div, before the `<header>`, add the picker overlay:

```jsx
      {/* ── Account picker overlay ── */}
      {showPicker === true && (
        <div style={{
          position: "absolute", inset: 0, zIndex: 40,
          background: "rgba(10,5,22,0.96)",
          backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)",
          display: "flex", flexDirection: "column",
          alignItems: "center", paddingTop: 48, overflowY: "auto",
        }}>
          <div style={{ width: "100%", maxWidth: 480, padding: "0 24px" }}>
            <div style={{ textAlign: "center", marginBottom: 32 }}>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 64, height: 64, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)", marginBottom: 16 }}>
                <svg viewBox="0 0 48 48" style={{ width: 32, height: 32 }}><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              </div>
              <h2 style={{ fontSize: 20, fontWeight: 800, color: "rgba(255,255,255,0.95)", margin: 0, marginBottom: 6 }}>Select a Google Ads Account</h2>
              <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", margin: 0 }}>Your selection will be remembered for this session</p>
            </div>
            {pickerLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {[...Array(4)].map((_, i) => <div key={i} style={{ height: 64, borderRadius: 16, background: "rgba(255,255,255,0.06)" }} className="animate-pulse" />)}
              </div>
            ) : (() => {
              const { pinned, unpinned } = sortWithPinned(pickerCustomers, pinnedAccountIds);
              const PickerRow = ({ c, isPinned }) => (
                <div style={{ position: "relative", marginBottom: 8 }}>
                  <button
                    onClick={() => {
                      sessionStorage.setItem("gads_customer_id", c.id);
                      localStorage.setItem(SELECTED_CUSTOMER_KEY, c.id);
                      setPickerShowAll(false);
                      setShowPicker(false);
                    }}
                    style={{ width: "100%", display: "flex", alignItems: "center", gap: 14, borderRadius: 16, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)", padding: "14px 18px", cursor: "pointer", textAlign: "left" }}
                  >
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <svg viewBox="0 0 48 48" style={{ width: 20, height: 20 }}><path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <p style={{ fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0, fontSize: 14 }}>{c.name}</p>
                      <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 2 }}>ID: {c.id}</p>
                    </div>
                    {isPinned && <span style={{ fontSize: 16, flexShrink: 0 }}>⭐</span>}
                  </button>
                  {isAdminUser && (
                    <button onClick={(e) => { e.stopPropagation(); handleTogglePin(c.id); }}
                      title={isPinned ? "Unpin" : "Pin"}
                      style={{ position: "absolute", top: 10, right: 10, fontSize: 14, background: "none", border: "none", cursor: "pointer", opacity: 0.6 }}>
                      {isPinned ? "⭐" : "☆"}
                    </button>
                  )}
                </div>
              );
              return (
                <div>
                  {pinned.map((c) => <PickerRow key={c.id} c={c} isPinned />)}
                  {unpinned.length > 0 && (
                    <>
                      <button onClick={() => setPickerShowAll((v) => !v)}
                        style={{ width: "100%", textAlign: "center", fontSize: 12, color: "rgba(255,255,255,0.35)", background: "none", border: "none", cursor: "pointer", padding: "8px 0" }}>
                        {pickerShowAll ? "▲ Show less" : `▾ Show ${unpinned.length} more account${unpinned.length === 1 ? "" : "s"}`}
                      </button>
                      {pickerShowAll && unpinned.map((c) => <PickerRow key={c.id} c={c} isPinned={false} />)}
                    </>
                  )}
                  {pinned.length === 0 && unpinned.length === 0 && (
                    <div style={{ textAlign: "center", color: "rgba(255,255,255,0.35)", padding: 32 }}>No accounts found.</div>
                  )}
                </div>
              );
            })()}
          </div>
        </div>
      )}
```

- [ ] **Step 5: Replace the old `<header>` with DashboardToolHeader**

Find the current `<header>` block in the main return (the one with `className="border-b border-white/10 bg-customPurple-dark px-6 py-4"`). It contains the back button, Google Ads icon, "Google Ads" title, and account/campaign dropdowns.

Replace the entire `<header>...</header>` block with:

```jsx
      <DashboardToolHeader
        icon={<GAdsHeaderIcon />}
        title="Google Ads"
        subtitle="Campaign Dashboard"
      >
        {selectedCustomerId && allCampaignData.length > 0 && (
          <>
            <AccountDropdown
              accounts={allCampaignData.map((d) => ({
                id: String(d.customer.customer_client.id),
                name: d.customer.customer_client.descriptive_name,
              }))}
              selectedId={String(selectedCustomerId)}
              onChange={(id) => {
                localStorage.setItem(SELECTED_CUSTOMER_KEY, id);
                sessionStorage.setItem("gads_customer_id", id);
                setSelectedCustomerId(id);
                setSelectedCampaign(null);
              }}
              pinnedAccountIds={pinnedAccountIds}
              isAdminUser={isAdminUser}
              onTogglePin={handleTogglePin}
            />
            <CampaignDropdown
              campaigns={allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId))?.campaigns || []}
              selectedCampaign={selectedCampaign}
              onChange={handleCampaignSelect}
              onClear={() => setSelectedCampaign(null)}
            />
          </>
        )}
      </DashboardToolHeader>
```

- [ ] **Step 6: Remove Link import if no longer used**

After edits, check if `import Link from "next/link"` is still referenced. If the only use was the back button (now removed), delete that import line.

- [ ] **Step 7: Run full tests**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 8: Build check**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm run build 2>&1 | tail -15
```

- [ ] **Step 9: Commit**

```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: replace Google Ads header with DashboardToolHeader, picker becomes overlay"
```

---

## Task 4: Update Remaining Pages (Google Organic, Meta, Bing, SEO Audit)

**Files:**
- Modify: `src/app/dashboard/google/organic/page.js`
- Modify: `src/app/dashboard/meta/page.js`
- Modify: `src/app/dashboard/bing/page.js`
- Modify: `src/app/dashboard/seo-audit/page.js`

For each page, the pattern is identical:
1. Add `import DashboardToolHeader from "../../components/DashboardToolHeader";` (or `"../../../components/DashboardToolHeader"` for pages one level deeper)
2. Remove the `<header>...</header>` block entirely
3. Replace with `<DashboardToolHeader>` with appropriate icon, title, subtitle, and right-side controls
4. Remove the root div's `min-h-screen bg-customPurple-dark` (the layout provides the background)
5. Remove `import Link from "next/link"` if the back button was its only use

Read each file before editing.

- [ ] **Step 1: Update Google Organic page**

Import path (file is at `src/app/dashboard/google/organic/page.js`):
```js
import DashboardToolHeader from "../../../components/DashboardToolHeader";
```

Replace the existing `<header>` with:
```jsx
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 64 64" width="16" height="16">
            <circle cx="26" cy="26" r="18" fill="none" stroke="#4285F4" strokeWidth="6"/>
            <circle cx="26" cy="26" r="9" fill="#34A853"/>
            <line x1="39" y1="39" x2="57" y2="57" stroke="#EA4335" strokeWidth="6" strokeLinecap="round"/>
            <circle cx="26" cy="26" r="4" fill="#FBBC04"/>
          </svg>
        }
        title="Google Search Organic"
        subtitle="Search Console Performance"
      >
        {gscConnected && sites.length > 0 && selectedSite && (
          <SitePicker sites={sites} selectedSite={selectedSite} onChange={setSelectedSite} />
        )}
      </DashboardToolHeader>
```

Change root div from `<div className="min-h-screen bg-customPurple-dark">` to `<div className="flex flex-col flex-1">`.

- [ ] **Step 2: Update Meta Ads page**

Import path (file is at `src/app/dashboard/meta/page.js`):
```js
import DashboardToolHeader from "../components/DashboardToolHeader";
```

Replace `<header>` with:
```jsx
      <DashboardToolHeader
        icon={
          <svg width="16" height="16" viewBox="0 0 36 36" fill="none">
            <rect width="36" height="36" rx="8" fill="#1877F2"/>
            <path d="M26 12c-1.1 0-2 .45-2.7 1.2C21.95 11.44 20.1 10 18 10c-2.1 0-3.95 1.44-5.3 3.2C11.99 12.45 11.1 12 10 12c-2.2 0-4 1.8-4 4 0 .9.3 1.72.8 2.38C8.1 21.66 12.8 26 18 26s9.9-4.34 11.2-7.62c.5-.66.8-1.48.8-2.38 0-2.2-1.8-4-4-4z" fill="white"/>
          </svg>
        }
        title="Meta Ads"
        subtitle="Facebook & Instagram Campaigns"
      >
        {accounts.length > 0 && (
          <AccountPicker accounts={accounts} selected={selectedAccount} onChange={setSelectedAccount} loading={accountsLoading} />
        )}
        {data?.campaigns?.length > 0 && (
          <CampaignPicker campaigns={data.campaigns} selected={selectedCampaign} onChange={setSelectedCampaign} onClear={() => setSelectedCampaign(null)} />
        )}
      </DashboardToolHeader>
```

Change root div to `<div className="flex flex-col flex-1">`.

- [ ] **Step 3: Update Bing Ads page**

Import path (file is at `src/app/dashboard/bing/page.js`):
```js
import DashboardToolHeader from "../components/DashboardToolHeader";
```

Replace `<header>` with:
```jsx
      <DashboardToolHeader
        icon={<MicrosoftAdsIcon size={16} />}
        title="Microsoft Advertising"
        subtitle="Bing Ads Dashboard"
      >
        {accounts.length > 0 && (
          <AccountPicker accounts={accounts} selected={selectedAccount} onChange={setSelectedAccount} loading={accountsLoading} />
        )}
        {data?.campaigns?.length > 0 && (
          <CampaignPicker campaigns={data.campaigns} selected={selectedCampaign} onChange={setSelectedCampaign} onClear={() => setSelectedCampaign(null)} />
        )}
      </DashboardToolHeader>
```

Change root div to `<div className="flex flex-col flex-1">`.

- [ ] **Step 4: Update SEO Audit page**

Import path (file is at `src/app/dashboard/seo-audit/page.js`):
```js
import DashboardToolHeader from "../components/DashboardToolHeader";
```

The current header uses the Lilikoi logo as a back link and has a "Dashboard" text link on the right. Replace the entire `<header>` block with:
```jsx
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
            <circle cx="22" cy="22" r="13" stroke="#0d9488" strokeWidth="2.5"/>
            <line x1="31.5" y1="31.5" x2="42" y2="42" stroke="#0d9488" strokeWidth="3.5" strokeLinecap="round"/>
            <rect x="15" y="24" width="3.5" height="7" rx="1" fill="#f59e0b"/>
            <rect x="20.25" y="20" width="3.5" height="11" rx="1" fill="#0d9488"/>
            <rect x="25.5" y="16" width="3.5" height="15" rx="1" fill="#6366f1"/>
          </svg>
        }
        title="SEO / GEO / AEO Audit"
        subtitle="AI-powered site analysis"
      />
```

Change root div to `<div className="flex flex-col flex-1">`.

- [ ] **Step 5: Run full tests + build**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
npm run build 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/google/organic/page.js src/app/dashboard/meta/page.js src/app/dashboard/bing/page.js src/app/dashboard/seo-audit/page.js
git commit -m "feat: replace individual headers with DashboardToolHeader on 4 tool pages"
```

---

## Task 5: Update Streaming, Audience Lab, and Admin Pages

**Files:**
- Modify: `src/app/dashboard/streaming/page.js`
- Modify: `src/app/dashboard/audience-lab/page.js`
- Modify: `src/app/dashboard/admin/clients/page.js`
- Modify: `src/app/dashboard/admin/usage/page.js`

Read each file before editing.

- [ ] **Step 1: Update Streaming page**

Import path (file is at `src/app/dashboard/streaming/page.js`):
```js
import DashboardToolHeader from "../../components/DashboardToolHeader";
```

The streaming page has an inline `StreamingHeader` component with a `subtitle` prop and conditional back button. Remove the `StreamingHeader` component definition entirely and replace all `<StreamingHeader ... />` usages with `<DashboardToolHeader>`.

The `StreamingHeader` is used in multiple places in the page (for different steps). For each usage find the `backFn`, `backLabel`, and `subtitle` props and map them:

- When `backFn` is null (initial state): `<DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle={subtitle} />`
- When `backFn` is set (drill-down): `<DashboardToolHeader icon={<StreamingIconSVG />} title="Targeted Streaming" subtitle={subtitle}><button onClick={backFn} style={{...}}>← Back</button></DashboardToolHeader>`

Add this small icon helper near the top of the file:
```js
function StreamingIconSVG() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
      <rect x="2" y="12" width="44" height="28" rx="4" stroke="#0ea5e9" strokeWidth="2.5"/>
      <polygon points="21,22 21,30 30,26" fill="#0ea5e9"/>
    </svg>
  );
}
```

The streaming page content has a white background (`bg-white`, `bg-gray-50`). Leave the content styling as-is — only change the header. Change root div from its current background to `<div className="flex flex-col flex-1">` but keep inner content divs unchanged.

- [ ] **Step 2: Update Audience Lab page**

Import path (file is at `src/app/dashboard/audience-lab/page.js`):
```js
import DashboardToolHeader from "../components/DashboardToolHeader";
```

The current header has:
- Back button
- Google icon (wrong — should be the Audience Lab circles icon)
- Title "Audience Lab"
- Dynamic subtitle showing slot usage
- Admin "Add" button on the right
- Tab bar below the main header row

Replace the `<header>` block with:
```jsx
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16">
            <circle cx="16" cy="16" r="8" fill="#4285F4"/>
            <circle cx="32" cy="16" r="8" fill="#EA4335" opacity="0.85"/>
            <circle cx="24" cy="30" r="8" fill="#34A853" opacity="0.85"/>
          </svg>
        }
        title="Audience Lab"
        subtitle={`${tabOccupied} of ${tabMax} ${isAudienceTab ? "audience" : "segment"} slots used · Syncs every Monday`}
      >
        {isAdminUser && (
          <button
            onClick={() => openAdd(null)}
            className="flex items-center gap-2 rounded-xl bg-purple-600 hover:bg-purple-500 transition px-4 py-2 text-sm font-semibold text-white"
          >
            <span className="text-base leading-none">+</span> Add {isAudienceTab ? "Audience" : "Segment"}
          </button>
        )}
      </DashboardToolHeader>
```

The tab bar (`Segments / Audiences`) was inside the `<header>` element. Move it to just below the `<DashboardToolHeader>` but still above the main content, as its own `<div>`:
```jsx
      {/* Tab bar */}
      <div className="px-6 py-3 border-b border-white/10">
        <div className="flex gap-1 bg-white/5 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab("segments")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeTab === "segments" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
          >
            Segments
          </button>
          <button
            onClick={() => setActiveTab("audiences")}
            className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${activeTab === "audiences" ? "bg-white/10 text-white" : "text-gray-400 hover:text-white"}`}
          >
            Audiences
          </button>
        </div>
      </div>
```

Note: read the actual tab variable names in the file — they may be named differently. Use whatever the actual state variable is.

Change root div to `<div className="flex flex-col flex-1">`.

Also remove the local `ADMIN_EMAILS` constant from this file (it was `const ADMIN_EMAILS = ["frank@lilikoiagency.com"]`). Add this import instead:
```js
import { isAdmin } from "../../../lib/admins";
```
And replace all `ADMIN_EMAILS.includes(email)` references with `isAdmin(email)`.

- [ ] **Step 3: Update Admin — Client Portals page**

Import path (file is at `src/app/dashboard/admin/clients/page.js`):
```js
import DashboardToolHeader from "../../components/DashboardToolHeader";
```

Find the header and replace with:
```jsx
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
            <circle cx="18" cy="16" r="7" fill="#6d28d9" opacity="0.9"/>
            <circle cx="33" cy="16" r="5" fill="#a78bfa" opacity="0.8"/>
            <ellipse cx="18" cy="34" rx="12" ry="7" fill="#6d28d9" opacity="0.85"/>
            <ellipse cx="34" cy="34" rx="9" ry="6" fill="#a78bfa" opacity="0.7"/>
          </svg>
        }
        title="Client Portals"
        subtitle="Manage client-facing portals"
      />
```

Change root div to `<div className="flex flex-col flex-1">`.

- [ ] **Step 4: Update Admin — Usage Analytics page**

Import path (file is at `src/app/dashboard/admin/usage/page.js`):
```js
import DashboardToolHeader from "../../components/DashboardToolHeader";
```

Find the header and replace with:
```jsx
      <DashboardToolHeader
        icon={
          <svg viewBox="0 0 48 48" width="16" height="16" fill="none">
            <rect x="6" y="28" width="7" height="14" rx="1.5" fill="#ec4899" opacity="0.9"/>
            <rect x="16" y="20" width="7" height="22" rx="1.5" fill="#ec4899"/>
            <rect x="26" y="12" width="7" height="30" rx="1.5" fill="#ec4899" opacity="0.8"/>
            <rect x="36" y="24" width="7" height="18" rx="1.5" fill="#ec4899" opacity="0.6"/>
          </svg>
        }
        title="Usage Analytics"
        subtitle="Dashboard tool adoption"
      />
```

Change root div to `<div className="flex flex-col flex-1">`.

- [ ] **Step 5: Run full tests + build**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
npm run build 2>&1 | tail -15
```

- [ ] **Step 6: Commit**

```bash
git add src/app/dashboard/streaming/page.js src/app/dashboard/audience-lab/page.js src/app/dashboard/admin/clients/page.js src/app/dashboard/admin/usage/page.js
git commit -m "feat: replace headers with DashboardToolHeader on streaming, audience lab, and admin pages"
```

---

## Task 6: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -10
```
Expected: all tests green.

- [ ] **Step 2: Production build**

```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm run build 2>&1 | tail -20
```
Expected: build succeeds with no errors.

- [ ] **Step 3: Start dev server and manually verify each page**

```bash
npm run dev
```

Navigate to each of these URLs and confirm:
- `http://localhost:3000/dashboard` → redirects to `/dashboard/google/ads`
- `http://localhost:3000/dashboard/google/ads` → sidebar visible, slim tool header, no back button
- `http://localhost:3000/dashboard/meta` → same layout
- `http://localhost:3000/dashboard/bing` → same layout
- `http://localhost:3000/dashboard/google/organic` → same layout
- `http://localhost:3000/dashboard/seo-audit` → same layout
- `http://localhost:3000/dashboard/streaming` → sidebar visible, content may be white-bg (expected)
- `http://localhost:3000/dashboard/audience-lab` → tab bar below tool header
- Hover the sidebar → it expands to show labels and sections
- Theme toggle in sidebar bottom → switches dark/light

- [ ] **Step 4: Final commit if cleanup needed**

```bash
git add -A
git status
# commit any remaining changes
git commit -m "chore: dashboard sidebar layout cleanup"
```
