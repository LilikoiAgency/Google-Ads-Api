# Mobile Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the dashboard fully usable on mobile by replacing the desktop sidebar with a grid-icon nav sheet and moving tool controls into a filter bottom sheet below 768px.

**Architecture:** A `MobileNavContext` provides `{navOpen, setNavOpen}` to the component tree. `DashboardLayout` becomes a client component wrapping everything with the context provider and rendering `MobileNavSheet` as a fixed overlay. `DashboardToolHeader` adds a grid button (mobile-only) that opens the nav. CSS utility classes (`mobile-only`, `desktop-only`, `sb-desktop`) control visibility at the 768px breakpoint. Each tool page wraps its header controls in `.desktop-only` and adds a `MobileFilterSheet` for mobile.

**Tech Stack:** React context, Next.js App Router, CSS media queries, Tailwind, inline styles (matching existing patterns)

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| Create | `src/app/dashboard/components/MobileNavContext.jsx` | Context + provider for nav open state |
| Create | `src/app/dashboard/components/MobileNavSheet.jsx` | Full-screen tool grid overlay |
| Create | `src/app/dashboard/components/MobileFilterSheet.jsx` | Bottom sheet for filter controls |
| Create | `src/__tests__/dashboard/MobileNavContext.test.jsx` | Context tests |
| Create | `src/__tests__/dashboard/MobileNavSheet.test.jsx` | Nav sheet tests |
| Create | `src/__tests__/dashboard/MobileFilterSheet.test.jsx` | Filter sheet tests |
| Modify | `src/app/globals.css` | Add breakpoint utility classes |
| Modify | `src/app/dashboard/layout.js` | Add "use client", context provider, MobileNavSheet |
| Modify | `src/app/dashboard/components/DashboardSidebar.jsx` | Add `sb-desktop` className |
| Modify | `src/app/dashboard/components/DashboardToolHeader.jsx` | Add mobile grid button |
| Modify | `src/app/dashboard/google/ads/page.js` | Desktop-only controls + mobile filter sheet |
| Modify | `src/app/dashboard/meta/page.js` | Desktop-only controls + mobile filter sheet |
| Modify | `src/app/dashboard/bing/page.js` | Desktop-only controls + mobile filter sheet |
| Modify | `src/app/dashboard/google/organic/page.js` | Desktop-only controls + mobile filter sheet |
| Modify | `src/app/dashboard/report/page.js` | Desktop-only controls + mobile filter sheet |

---

## Task 1: MobileNavContext + MobileNavSheet

**Files:**
- Create: `src/app/dashboard/components/MobileNavContext.jsx`
- Create: `src/app/dashboard/components/MobileNavSheet.jsx`
- Create: `src/__tests__/dashboard/MobileNavContext.test.jsx`
- Create: `src/__tests__/dashboard/MobileNavSheet.test.jsx`

- [ ] **Step 1: Write failing tests**

Create `src/__tests__/dashboard/MobileNavContext.test.jsx`:
```jsx
// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { MobileNavProvider, useMobileNav } from '@/app/dashboard/components/MobileNavContext.jsx';

function Consumer() {
  const { navOpen, setNavOpen } = useMobileNav();
  return (
    <div>
      <span data-testid="state">{navOpen ? 'open' : 'closed'}</span>
      <button onClick={() => setNavOpen(true)}>open</button>
      <button onClick={() => setNavOpen(false)}>close</button>
    </div>
  );
}

describe('MobileNavContext', () => {
  it('starts closed', () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });

  it('opens when setNavOpen(true) is called', async () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    await act(async () => { screen.getByText('open').click(); });
    expect(screen.getByTestId('state').textContent).toBe('open');
  });

  it('closes when setNavOpen(false) is called', async () => {
    render(<MobileNavProvider><Consumer /></MobileNavProvider>);
    await act(async () => { screen.getByText('open').click(); });
    await act(async () => { screen.getByText('close').click(); });
    expect(screen.getByTestId('state').textContent).toBe('closed');
  });
});
```

Create `src/__tests__/dashboard/MobileNavSheet.test.jsx`:
```jsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('next/navigation', () => ({ usePathname: vi.fn(() => '/dashboard/google/ads') }));
vi.mock('next-auth/react', () => ({ useSession: vi.fn(() => ({ data: { user: { name: 'Frank', email: 'frank@lilikoiagency.com' } } })) }));
vi.mock('@/lib/admins', () => ({ isAdmin: vi.fn(() => true) }));

import { MobileNavProvider } from '@/app/dashboard/components/MobileNavContext.jsx';
import MobileNavSheet from '@/app/dashboard/components/MobileNavSheet.jsx';

function OpenSheet() {
  const { MobileNavProvider: Ctx } = require('@/app/dashboard/components/MobileNavContext.jsx');
  return null;
}

describe('MobileNavSheet', () => {
  it('renders nothing when navOpen is false', () => {
    render(<MobileNavProvider><MobileNavSheet /></MobileNavProvider>);
    expect(screen.queryByText('Google Ads')).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm they fail**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- MobileNav 2>&1 | tail -15
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Create MobileNavContext.jsx**

```jsx
// src/app/dashboard/components/MobileNavContext.jsx
"use client";
import { createContext, useContext, useState } from "react";

const MobileNavContext = createContext({ navOpen: false, setNavOpen: () => {} });

export function MobileNavProvider({ children }) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <MobileNavContext.Provider value={{ navOpen, setNavOpen }}>
      {children}
    </MobileNavContext.Provider>
  );
}

export function useMobileNav() {
  return useContext(MobileNavContext);
}
```

- [ ] **Step 4: Create MobileNavSheet.jsx**

```jsx
// src/app/dashboard/components/MobileNavSheet.jsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMobileNav } from "./MobileNavContext";
import { isAdmin } from "../../../lib/admins";
import {
  GoogleAdsIcon, MetaAdsIcon, MicrosoftAdsIcon, SearchConsoleIcon,
  ReportIcon, SEOAuditIcon, ClientPortalsIcon,
  AudienceLabIcon, StreamingIcon, UsageAnalyticsIcon,
} from "./DashboardIcons";

const MOBILE_NAV = [
  { label: "Paid Media", items: [
    { href: "/dashboard/google/ads",     label: "Google Ads",      Icon: GoogleAdsIcon      },
    { href: "/dashboard/meta",           label: "Meta Ads",        Icon: MetaAdsIcon        },
    { href: "/dashboard/bing",           label: "Microsoft Ads",   Icon: MicrosoftAdsIcon   },
  ]},
  { label: "Organic & Reports", items: [
    { href: "/dashboard/google/organic", label: "Google Organic",  Icon: SearchConsoleIcon  },
    { href: "/dashboard/report",         label: "Paid vs Organic", Icon: ReportIcon         },
    { href: "/dashboard/seo-audit",      label: "SEO Audit",       Icon: SEOAuditIcon       },
    { href: "/dashboard/admin/clients",  label: "Client Portals",  Icon: ClientPortalsIcon  },
  ]},
  { label: "Data Tools", items: [
    { href: "/dashboard/audience-lab",   label: "Audience Lab",    Icon: AudienceLabIcon    },
    { href: "/dashboard/streaming",      label: "Streaming",       Icon: StreamingIcon      },
  ]},
];

const ADMIN_SECTION = {
  label: "Admin",
  items: [{ href: "/dashboard/admin/usage", label: "Usage Analytics", Icon: UsageAnalyticsIcon }],
};

export default function MobileNavSheet() {
  const { navOpen, setNavOpen } = useMobileNav();
  const pathname = usePathname();
  const { data: session } = useSession();
  const email = session?.user?.email?.toLowerCase() || "";
  const sections = isAdmin(email) ? [...MOBILE_NAV, ADMIN_SECTION] : MOBILE_NAV;

  if (!navOpen) return null;

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50, overflowY: "auto",
      background: "radial-gradient(ellipse at 25% 15%, #3b1278 0%, #1e0a38 50%, #0d0520 100%)",
      padding: 16, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#7c3aed,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "white" }}>L</div>
          <span style={{ fontSize: 15, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>Lilikoi Agency</span>
        </div>
        <button
          onClick={() => setNavOpen(false)}
          aria-label="Close navigation"
          style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,255,255,0.1)", border: "none", color: "rgba(255,255,255,0.7)", fontSize: 16, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >✕</button>
      </div>

      {/* Tool sections */}
      {sections.map((section) => (
        <div key={section.label} style={{ marginBottom: 20 }}>
          <p style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "rgba(255,255,255,0.3)", margin: "0 0 10px" }}>{section.label}</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            {section.items.map(({ href, label, Icon }) => {
              const active = pathname?.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setNavOpen(false)}
                  style={{
                    background: active ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.06)",
                    border: `1px solid ${active ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 14, padding: "12px 8px",
                    display: "flex", flexDirection: "column", alignItems: "center", gap: 7,
                    textDecoration: "none",
                  }}
                >
                  <div style={{ width: 36, height: 36, borderRadius: 10, background: active ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <Icon />
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 600, color: active ? "#c084fc" : "rgba(255,255,255,0.5)", textAlign: "center", lineHeight: 1.3 }}>{label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to confirm they pass**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- MobileNav 2>&1 | tail -15
```
Expected: PASS — all tests green.

- [ ] **Step 6: Run full suite**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 7: Commit**
```bash
git add src/app/dashboard/components/MobileNavContext.jsx src/app/dashboard/components/MobileNavSheet.jsx src/__tests__/dashboard/MobileNavContext.test.jsx src/__tests__/dashboard/MobileNavSheet.test.jsx
git commit -m "feat: add MobileNavContext and MobileNavSheet for mobile grid navigation"
```

---

## Task 2: MobileFilterSheet

**Files:**
- Create: `src/app/dashboard/components/MobileFilterSheet.jsx`
- Create: `src/__tests__/dashboard/MobileFilterSheet.test.jsx`

- [ ] **Step 1: Write failing test**

Create `src/__tests__/dashboard/MobileFilterSheet.test.jsx`:
```jsx
// @vitest-environment jsdom
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import MobileFilterSheet from '@/app/dashboard/components/MobileFilterSheet.jsx';

describe('MobileFilterSheet', () => {
  it('renders nothing when open is false', () => {
    render(<MobileFilterSheet open={false} onClose={vi.fn()} onApply={vi.fn()}>content</MobileFilterSheet>);
    expect(screen.queryByText('Filters')).toBeNull();
  });

  it('renders children when open is true', () => {
    render(<MobileFilterSheet open={true} onClose={vi.fn()} onApply={vi.fn()}><span>my filter</span></MobileFilterSheet>);
    expect(screen.getByText('my filter')).toBeTruthy();
    expect(screen.getByText('Filters')).toBeTruthy();
  });

  it('calls onClose when ✕ is clicked', async () => {
    const onClose = vi.fn();
    render(<MobileFilterSheet open={true} onClose={onClose} onApply={vi.fn()}>content</MobileFilterSheet>);
    await act(async () => { screen.getByLabelText('Close filters').click(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onApply when Apply button is clicked', async () => {
    const onApply = vi.fn();
    render(<MobileFilterSheet open={true} onClose={vi.fn()} onApply={onApply}>content</MobileFilterSheet>);
    await act(async () => { screen.getByText('Apply Filters').click(); });
    expect(onApply).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run to confirm fail**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- MobileFilter 2>&1 | tail -15
```

- [ ] **Step 3: Create MobileFilterSheet.jsx**

```jsx
// src/app/dashboard/components/MobileFilterSheet.jsx
"use client";
import { useEffect } from "react";

export default function MobileFilterSheet({ open, onClose, onApply, children }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }}
      />
      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 41,
        background: "#1a0a30",
        borderTop: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "20px 20px 0 0",
        padding: "16px 16px 36px",
        maxHeight: "80vh", overflowY: "auto",
      }}>
        {/* Handle */}
        <div style={{ width: 32, height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto 18px" }} />
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Filters</p>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >✕</button>
        </div>
        {/* Filter controls (page-provided) */}
        {children}
        {/* Apply */}
        <button
          onClick={onApply}
          style={{ width: "100%", background: "#7c3aed", border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer", marginTop: 16 }}
        >
          Apply Filters
        </button>
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run tests to confirm pass**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test -- MobileFilter 2>&1 | tail -15
```

- [ ] **Step 5: Run full suite**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
```

- [ ] **Step 6: Commit**
```bash
git add src/app/dashboard/components/MobileFilterSheet.jsx src/__tests__/dashboard/MobileFilterSheet.test.jsx
git commit -m "feat: add MobileFilterSheet bottom sheet component"
```

---

## Task 3: CSS, Layout, Sidebar, ToolHeader Integration

**Files:**
- Modify: `src/app/globals.css`
- Modify: `src/app/dashboard/layout.js`
- Modify: `src/app/dashboard/components/DashboardSidebar.jsx`
- Modify: `src/app/dashboard/components/DashboardToolHeader.jsx`

- [ ] **Step 1: Add breakpoint CSS to globals.css**

Append to `src/app/globals.css`:
```css
/* ── Mobile / desktop visibility ── */
@media (max-width: 767px) {
  .sb-desktop  { display: none !important; }
  .desktop-only { display: none !important; }
  .mobile-only  { display: flex !important; }
}
@media (min-width: 768px) {
  .mobile-only  { display: none !important; }
}
```

- [ ] **Step 2: Update DashboardLayout**

Replace the entire contents of `src/app/dashboard/layout.js` with:

```js
// src/app/dashboard/layout.js
"use client";
import DashboardSidebar from "./components/DashboardSidebar";
import MobileNavSheet from "./components/MobileNavSheet";
import { MobileNavProvider } from "./components/MobileNavContext";

export default function DashboardLayout({ children }) {
  return (
    <MobileNavProvider>
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
        <div style={{ position: "fixed", top: -100, left: -100, width: 550, height: 550, borderRadius: "50%", background: "rgba(139,92,246,0.12)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", bottom: -80, right: -80, width: 450, height: 450, borderRadius: "50%", background: "rgba(79,70,229,0.09)", filter: "blur(90px)", pointerEvents: "none", zIndex: 0 }} />

        {/* Sidebar — hidden on mobile via CSS */}
        <DashboardSidebar />

        {/* Main content area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1, minWidth: 0 }}>
          {children}
        </main>

        {/* Mobile full-screen nav overlay */}
        <MobileNavSheet />
      </div>
    </MobileNavProvider>
  );
}
```

- [ ] **Step 3: Add sb-desktop class to DashboardSidebar nav element**

Read `src/app/dashboard/components/DashboardSidebar.jsx`. Find the `<nav` opening tag (around line 87–89). Add `className="sb-desktop"` to it:

```jsx
      <nav
        className="sb-desktop"
        style={sidebarStyle}
        onMouseEnter={...}
        onMouseLeave={...}
      >
```

- [ ] **Step 4: Add mobile grid button to DashboardToolHeader**

Read `src/app/dashboard/components/DashboardToolHeader.jsx`. Update the file to import `useMobileNav` and add a grid button visible only on mobile:

```jsx
// src/app/dashboard/components/DashboardToolHeader.jsx
"use client";
import { useMobileNav } from "./MobileNavContext";

export default function DashboardToolHeader({ icon, title, subtitle, children }) {
  const { setNavOpen } = useMobileNav();

  return (
    <header
      style={{
        height: 56, flexShrink: 0,
        background: "rgba(14,8,28,0.65)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 16px", gap: 12, position: "sticky", top: 0, zIndex: 10,
      }}
    >
      {/* Left: icon + title + subtitle */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1 }}>
        {icon && (
          <div style={{ width: 28, height: 28, borderRadius: 8, background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.92)", margin: 0, lineHeight: 1.2 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 2, lineHeight: 1 }}>{subtitle}</p>}
        </div>
      </div>

      {/* Desktop controls slot */}
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {children}
        </div>
      )}

      {/* Mobile grid button — hidden on desktop */}
      <button
        className="mobile-only"
        onClick={() => setNavOpen(true)}
        aria-label="Open navigation"
        style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
          cursor: "pointer", display: "none", /* overridden by .mobile-only */
          alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 3 }}>
          {[0,1,2,3].map(i => <div key={i} style={{ width: 6, height: 6, background: "rgba(255,255,255,0.6)", borderRadius: 1.5 }} />)}
        </div>
      </button>
    </header>
  );
}
```

- [ ] **Step 5: Run full suite + build check**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
npm run build 2>&1 | tail -10
```
Expected: all tests green, build passes.

- [ ] **Step 6: Commit**
```bash
git add src/app/globals.css src/app/dashboard/layout.js src/app/dashboard/components/DashboardSidebar.jsx src/app/dashboard/components/DashboardToolHeader.jsx
git commit -m "feat: add mobile breakpoint CSS, integrate MobileNavSheet into layout, add grid button to tool header"
```

---

## Task 4: Google Ads Page Mobile Filters

**Files:**
- Modify: `src/app/dashboard/google/ads/page.js`

The Google Ads page has the most complex controls: AccountDropdown, CampaignDropdown, date range, and status filter. Read the file before editing.

- [ ] **Step 1: Add MobileFilterSheet import**

At the top of `src/app/dashboard/google/ads/page.js`, after existing imports:
```js
import MobileFilterSheet from "../../components/MobileFilterSheet";
```

- [ ] **Step 2: Add filterOpen state**

Inside `GoogleAdsDashboard`, after the existing state declarations, add:
```js
const [filterOpen, setFilterOpen] = useState(false);
```

- [ ] **Step 3: Wrap desktop controls in desktop-only div**

Find the `<DashboardToolHeader ...>` block. Its children currently have `AccountDropdown` and `CampaignDropdown` directly. Wrap them:

```jsx
      <DashboardToolHeader
        icon={<GoogleAdsIcon />}
        title="Google Ads"
        subtitle="Campaign Dashboard"
      >
        {selectedCustomerId && allCampaignData.length > 0 && (
          <div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
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
          </div>
        )}
      </DashboardToolHeader>
```

- [ ] **Step 4: Add mobile filter row + MobileFilterSheet**

Immediately after the `</DashboardToolHeader>` closing tag, add:

```jsx
      {/* Mobile filter row */}
      <div className="mobile-only" style={{ display: "flex", gap: 8, padding: "8px 16px", background: "rgba(14,8,28,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button
          onClick={() => setFilterOpen(true)}
          style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}
        >
          Filters <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
        {selectedCustomerId && (
          <span style={{ display: "flex", alignItems: "center", fontSize: 11, color: "rgba(255,255,255,0.4)", padding: "0 4px" }}>
            {allCampaignData.find(d => String(d.customer.customer_client.id) === String(selectedCustomerId))?.customer?.customer_client?.descriptive_name || ""}
          </span>
        )}
      </div>

      {/* Mobile filter sheet */}
      <MobileFilterSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        onApply={() => setFilterOpen(false)}
      >
        {selectedCustomerId && allCampaignData.length > 0 && (
          <>
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Account</p>
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
            </div>
            <div style={{ marginBottom: 18 }}>
              <p style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px", color: "rgba(255,255,255,0.4)", margin: "0 0 8px" }}>Campaign</p>
              <CampaignDropdown
                campaigns={allCampaignData.find((d) => String(d.customer.customer_client.id) === String(selectedCustomerId))?.campaigns || []}
                selectedCampaign={selectedCampaign}
                onChange={handleCampaignSelect}
                onClear={() => setSelectedCampaign(null)}
              />
            </div>
          </>
        )}
      </MobileFilterSheet>
```

- [ ] **Step 5: Run tests + build**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -8
```

- [ ] **Step 6: Commit**
```bash
git add src/app/dashboard/google/ads/page.js
git commit -m "feat: add mobile filter sheet to Google Ads page"
```

---

## Task 5: Remaining Pages Mobile Filters

**Files:**
- Modify: `src/app/dashboard/meta/page.js`
- Modify: `src/app/dashboard/bing/page.js`
- Modify: `src/app/dashboard/google/organic/page.js`
- Modify: `src/app/dashboard/report/page.js`

For each page: read the file, then apply the same pattern as Task 4. Read the file to find the actual variable names for the pickers.

- [ ] **Step 1: Update Meta Ads page**

Import: `import MobileFilterSheet from "../components/MobileFilterSheet";`

Add `filterOpen` state: `const [filterOpen, setFilterOpen] = useState(false);`

Wrap the DashboardToolHeader children in `<div className="desktop-only" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>`.

After `</DashboardToolHeader>`, add the mobile filter row + MobileFilterSheet:
```jsx
      <div className="mobile-only" style={{ display: "flex", gap: 8, padding: "8px 16px", background: "rgba(14,8,28,0.4)", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <button onClick={() => setFilterOpen(true)} style={{ background: "rgba(255,255,255,0.08)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 20, padding: "6px 14px", fontSize: 11, fontWeight: 600, color: "rgba(255,255,255,0.65)", cursor: "pointer", display: "flex", alignItems: "center", gap: 5 }}>
          Filters <span style={{ fontSize: 9, opacity: 0.6 }}>▾</span>
        </button>
      </div>
      <MobileFilterSheet open={filterOpen} onClose={() => setFilterOpen(false)} onApply={() => setFilterOpen(false)}>
        {/* Use the same AccountPicker and CampaignPicker components from the desktop slot, with the same props */}
        {/* Read the file to get exact variable names for accounts, selected, onChange props */}
      </MobileFilterSheet>
```

- [ ] **Step 2: Update Bing Ads page** — same pattern as Meta. Read file for variable names.

- [ ] **Step 3: Update Google Organic page** — same pattern. The filter sheet contains only `SitePicker` and date range presets. Read file for exact variable names.

- [ ] **Step 4: Update Report page** — the report page has minimal controls (no account picker). Add the mobile filter row but the sheet can be minimal or omitted if there are no interactive controls.

- [ ] **Step 5: Run tests + build**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8 && npm run build 2>&1 | tail -8
```

- [ ] **Step 6: Commit**
```bash
git add src/app/dashboard/meta/page.js src/app/dashboard/bing/page.js src/app/dashboard/google/organic/page.js src/app/dashboard/report/page.js
git commit -m "feat: add mobile filter sheets to Meta, Bing, Organic, and Report pages"
```

---

## Task 6: Content Responsiveness

**Files:**
- Modify: `src/app/globals.css`
- Spot-check: KPI grids in all dashboard pages

- [ ] **Step 1: Add responsive content CSS to globals.css**

Append to `src/app/globals.css`:
```css
/* ── Responsive content ── */
@media (max-width: 767px) {
  /* Container padding */
  .mx-auto { padding-left: 16px !important; padding-right: 16px !important; }

  /* KPI grids — 2 columns on mobile */
  .kpi-grid-4 { grid-template-columns: repeat(2, 1fr) !important; }
  .kpi-grid-3 { grid-template-columns: repeat(2, 1fr) !important; }

  /* Table scroll */
  .table-scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }

  /* Max width full on mobile */
  .max-w-7xl, .max-w-6xl, .max-w-5xl { max-width: 100% !important; }
}
```

- [ ] **Step 2: Add className="kpi-grid-4" to KPI grids in Google Ads ContentArea**

Check `src/app/dashboard/components/ContentArea.js` for the KPI grid container. Add `className="kpi-grid-4"` to any 4-column grid divs that use inline `gridTemplateColumns: "repeat(4, 1fr)"`. Also add `className="table-scroll"` to table wrapper divs.

- [ ] **Step 3: Run full test suite + build**
```bash
cd /c/Users/frank/Documents/GitHub/Google-Ads-Api && npm test 2>&1 | tail -8
npm run build 2>&1 | tail -10
```
Expected: all green.

- [ ] **Step 4: Commit**
```bash
git add src/app/globals.css src/app/dashboard/components/ContentArea.js
git commit -m "feat: responsive content CSS for mobile — 2-col KPI grids, table scroll, full-width containers"
```
