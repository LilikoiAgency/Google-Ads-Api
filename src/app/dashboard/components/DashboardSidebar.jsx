// src/app/dashboard/components/DashboardSidebar.jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "../../../lib/useTheme";
import { isAdmin } from "../../../lib/admins";
import { useEffect, useRef } from "react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse } from "@fortawesome/free-solid-svg-icons";
import {
  GoogleAdsIcon, MetaAdsIcon, MicrosoftAdsIcon, SearchConsoleIcon,
  ReportIcon, SEOAuditIcon, ClientPortalsIcon, AudienceLabIcon,
  StreamingIcon, UsageAnalyticsIcon,
} from "./DashboardIcons";

const NAV = [
  { label: "Paid Media", items: [
    { href: "/dashboard/google/ads",     label: "Google Ads",      icon: <GoogleAdsIcon />      },
    { href: "/dashboard/meta",           label: "Meta Ads",        icon: <MetaAdsIcon />        },
    { href: "/dashboard/bing",           label: "Microsoft Ads",   icon: <MicrosoftAdsIcon />   },
  ]},
  { label: "Organic & Reports", items: [
    { href: "/dashboard/google/organic", label: "Google Organic",  icon: <SearchConsoleIcon />  },
    { href: "/dashboard/report",         label: "Paid vs Organic", icon: <ReportIcon />         },
    { href: "/dashboard/pacing",         label: "Pacing Reports",  icon: <ReportIcon />         },
    { href: "/dashboard/seo-audit",      label: "SEO Audit",       icon: <SEOAuditIcon />       },
    { href: "/dashboard/admin/clients",  label: "Client Portals",  icon: <ClientPortalsIcon />  },
  ]},
  { label: "Data Tools", items: [
    { href: "/dashboard/audience-lab",   label: "Audience Lab",    icon: <AudienceLabIcon />    },
    { href: "/dashboard/streaming",      label: "Streaming",       icon: <StreamingIcon />      },
  ]},
];

const ADMIN_SECTION = { label: "Admin", items: [
  { href: "/dashboard/admin/usage", label: "Usage Analytics", icon: <UsageAnalyticsIcon /> },
]};

export default function DashboardSidebar() {
  const pathname = usePathname();
  const { data: session } = useSession();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const email = session?.user?.email?.toLowerCase() || "";
  const firstName = session?.user?.name?.split(" ")[0] || "You";
  const adminUser = isAdmin(email);
  const sections = adminUser ? [...NAV, ADMIN_SECTION] : NAV;
  const isActive = (href) => pathname?.startsWith(href) ?? false;

  // ── Client-side page view logging ──
  const lastLoggedPath = useRef(null);
  useEffect(() => {
    if (!email || !pathname) return;
    if (pathname === lastLoggedPath.current) return;
    lastLoggedPath.current = pathname;
    fetch("/api/admin/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, path: pathname }),
    }).catch(() => {});
  }, [pathname, email]);

  const sidebarStyle = {
    width: 68, height: "100vh",
    position: "fixed", top: 0, left: 0,
    background: "var(--sb-bg)",
    backdropFilter: isDark ? "blur(20px)" : "none",
    WebkitBackdropFilter: isDark ? "blur(20px)" : "none",
    borderRight: "1px solid var(--sb-border)",
    display: "flex", flexDirection: "column",
    padding: "14px 0",
    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
    overflow: "hidden", zIndex: 20,
  };

  const expandLabel = { opacity: 0, transition: "opacity 0.15s 0.06s", whiteSpace: "nowrap" };

  return (
    <nav
      className="sb-desktop"
      style={sidebarStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.width = "216px";
        e.currentTarget.querySelectorAll(".sb-label").forEach(el => (el.style.opacity = "1"));
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.width = "68px";
        e.currentTarget.querySelectorAll(".sb-label").forEach(el => (el.style.opacity = "0"));
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 15px 14px", borderBottom: "1px solid var(--sb-divider)", marginBottom: 8, flexShrink: 0, minWidth: 216 }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #7c3aed, #a855f7)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16, fontWeight: 800, color: "white" }}>L</div>
        <span className="sb-label" style={{ ...expandLabel, fontSize: 13, fontWeight: 800, color: "var(--sb-logo-text)" }}>Lilikoi Agency</span>
      </div>

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
                padding: "0 12px", height: 46, borderRadius: 12,
                margin: "1px 6px 6px", cursor: "pointer",
                transition: "background 0.15s", flexShrink: 0, minWidth: 200,
                textDecoration: "none",
                background: homeActive ? "var(--sb-active-bg)" : "transparent",
                color: homeActive ? "var(--sb-active-text)" : "var(--sb-text)",
                position: "relative",
              }}
            >
              <div
                className="sb-nav-icon"
                style={{
                  width: 38, height: 38, borderRadius: 10,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  flexShrink: 0,
                  background: homeActive ? "var(--sb-icon-active-bg)" : "transparent",
                  color: homeActive ? "var(--sb-active-text)" : "var(--sb-text)",
                  transition: "filter 0.2s",
                }}
              >
                <FontAwesomeIcon icon={faHouse} style={{ width: 18, height: 18 }} />
              </div>
              <span className="sb-label" style={{ opacity: 0, transition: "opacity 0.15s 0.06s", whiteSpace: "nowrap", fontSize: 13, fontWeight: 600 }}>
                Home
              </span>
              {homeActive && (
                <div className="sb-active-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "#a855f7", position: "absolute", right: 10 }} />
              )}
            </Link>
          );
        })()}

        {/* ── Divider below Home ── */}
        <div style={{ height: 1, background: "var(--sb-divider)", margin: "2px 10px 8px" }} />

        {sections.map((section) => (
          <div key={section.label}>
            <div className="sb-label" style={{ ...expandLabel, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "var(--sb-section-label)", padding: "8px 14px 4px", minWidth: 216 }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} title={item.label}
                  className={`sb-nav-item${active ? " sb-nav-item-active" : ""}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 46, borderRadius: 12, margin: "1px 6px", cursor: "pointer", transition: "background 0.15s", flexShrink: 0, minWidth: 200, textDecoration: "none", background: active ? "var(--sb-active-bg)" : "transparent", color: active ? "var(--sb-active-text)" : "var(--sb-text)", position: "relative" }}>
                  <div className="sb-nav-icon" style={{ width: 38, height: 38, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: active ? "var(--sb-icon-active-bg)" : "transparent", color: active ? "var(--sb-active-text)" : "var(--sb-text)", transition: "filter 0.2s" }}>
                    {item.icon}
                  </div>
                  <span className="sb-label" style={{ ...expandLabel, fontSize: 13, fontWeight: 600 }}>{item.label}</span>
                  {active && <div className="sb-active-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "#a855f7", position: "absolute", right: 10 }} />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div>
        <div style={{ height: 1, background: "var(--sb-divider)", margin: "8px 10px" }} />
        {/* suppressHydrationWarning: server/client theme emoji mismatch is intentional */}
        <div onClick={toggleTheme} suppressHydrationWarning style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 42, margin: "2px 6px", borderRadius: 12, flexShrink: 0, minWidth: 200, cursor: "pointer" }}>
          <div suppressHydrationWarning style={{ width: 36, height: 36, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 18 }}>{isDark ? "🌙" : "☀️"}</div>
          <span className="sb-label" suppressHydrationWarning style={{ ...expandLabel, fontSize: 13, color: "var(--sb-text-muted)" }}>{isDark ? "Dark mode" : "Light mode"}</span>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 12px", height: 48, margin: "2px 6px", borderRadius: 12, cursor: "pointer", flexShrink: 0, minWidth: 200, border: "none", background: "transparent", textAlign: "left", width: "calc(100% - 12px)" }}>
          <div style={{ width: 36, height: 36, borderRadius: 10, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, fontWeight: 800, color: "white", flexShrink: 0 }}>{firstName[0]}</div>
          <div className="sb-label" style={{ ...expandLabel, textAlign: "left" }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: "var(--sb-user-name)", whiteSpace: "nowrap" }}>{firstName}</div>
            <div style={{ fontSize: 11, color: "var(--sb-user-sub)", whiteSpace: "nowrap" }}>{adminUser ? "Admin · " : ""}Sign out</div>
          </div>
        </button>
      </div>
    </nav>
  );
}
