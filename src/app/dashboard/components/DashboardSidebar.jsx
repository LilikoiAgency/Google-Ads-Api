// src/app/dashboard/components/DashboardSidebar.jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "../../../lib/useTheme";
import { isAdmin } from "../../../lib/admins";
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

  const sidebarStyle = {
    width: 56, height: "100vh",
    position: "sticky", top: 0,
    background: "rgba(8,5,18,0.88)",
    backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    display: "flex", flexDirection: "column",
    padding: "14px 0", flexShrink: 0,
    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
    overflow: "hidden", zIndex: 20,
  };

  const expandLabel = { opacity: 0, transition: "opacity 0.15s 0.06s", whiteSpace: "nowrap" };

  return (
    <nav
      style={sidebarStyle}
      onMouseEnter={(e) => {
        e.currentTarget.style.width = "200px";
        e.currentTarget.querySelectorAll(".sb-label").forEach(el => (el.style.opacity = "1"));
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.width = "56px";
        e.currentTarget.querySelectorAll(".sb-label").forEach(el => (el.style.opacity = "0"));
      }}
    >
      {/* Logo */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 13px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)", marginBottom: 8, flexShrink: 0, minWidth: 200 }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #7c3aed, #a855f7)", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, color: "white" }}>L</div>
        <span className="sb-label" style={{ ...expandLabel, fontSize: 13, fontWeight: 800, color: "rgba(255,255,255,0.9)" }}>Lilikoi Agency</span>
      </div>

      {/* Nav */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden" }} className="sidebar-scrollbar">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="sb-label" style={{ ...expandLabel, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1px", color: "rgba(255,255,255,0.2)", padding: "8px 14px 4px", minWidth: 200 }}>
              {section.label}
            </div>
            {section.items.map((item) => {
              const active = isActive(item.href);
              return (
                <Link key={item.href} href={item.href} title={item.label}
                  className={`sb-nav-item${active ? " sb-nav-item-active" : ""}`}
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 38, borderRadius: 10, margin: "1px 6px", cursor: "pointer", transition: "background 0.15s", flexShrink: 0, minWidth: 188, textDecoration: "none", background: active ? "rgba(168,85,247,0.18)" : "transparent", color: active ? "#c084fc" : "rgba(255,255,255,0.45)", position: "relative" }}>
                  <div className="sb-nav-icon" style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: active ? "rgba(168,85,247,0.25)" : "transparent", color: active ? "#c084fc" : "rgba(255,255,255,0.45)", transition: "filter 0.2s" }}>
                    {item.icon}
                  </div>
                  <span className="sb-label" style={{ ...expandLabel, fontSize: 12, fontWeight: 600 }}>{item.label}</span>
                  {active && <div className="sb-active-dot" style={{ width: 4, height: 4, borderRadius: "50%", background: "#a855f7", position: "absolute", right: 10 }} />}
                </Link>
              );
            })}
          </div>
        ))}
      </div>

      {/* Bottom */}
      <div>
        <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "8px 10px" }} />
        <div onClick={toggleTheme} style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 36, margin: "2px 6px", borderRadius: 10, flexShrink: 0, minWidth: 188, cursor: "pointer" }}>
          <div style={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, fontSize: 15 }}>{isDark ? "🌙" : "☀️"}</div>
          <span className="sb-label" style={{ ...expandLabel, fontSize: 12, color: "rgba(255,255,255,0.35)" }}>{isDark ? "Dark mode" : "Light mode"}</span>
        </div>
        <button onClick={() => signOut({ callbackUrl: "/" })}
          style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 42, margin: "2px 6px", borderRadius: 10, cursor: "pointer", flexShrink: 0, minWidth: 188, border: "none", background: "transparent", textAlign: "left", width: "calc(100% - 12px)" }}>
          <div style={{ width: 30, height: 30, borderRadius: 9, background: "linear-gradient(135deg, #4f46e5, #7c3aed)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, fontWeight: 800, color: "white", flexShrink: 0 }}>{firstName[0]}</div>
          <div className="sb-label" style={{ ...expandLabel, textAlign: "left" }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.8)", whiteSpace: "nowrap" }}>{firstName}</div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.35)", whiteSpace: "nowrap" }}>{adminUser ? "Admin · " : ""}Sign out</div>
          </div>
        </button>
      </div>
    </nav>
  );
}
