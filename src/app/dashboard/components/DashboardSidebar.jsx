// src/app/dashboard/components/DashboardSidebar.jsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faScaleBalanced, faMagnifyingGlassChart,
  faBriefcase, faPeopleGroup, faTv, faChartLine,
} from "@fortawesome/free-solid-svg-icons";
import { useTheme } from "../../../lib/useTheme";
import { isAdmin } from "../../../lib/admins";

// ── Brand icons — actual colored logos ───────────────────────────────────────

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" width="16" height="16">
    <path fill="#4285F4" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
    <path fill="#34A853" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
    <path fill="#EA4335" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
  </svg>
);

const MetaIcon = () => (
  <svg width="16" height="16" viewBox="0 0 36 36" fill="none">
    <rect width="36" height="36" rx="8" fill="#1877F2"/>
    <path d="M26 12c-1.1 0-2 .45-2.7 1.2C21.95 11.44 20.1 10 18 10c-2.1 0-3.95 1.44-5.3 3.2C11.99 12.45 11.1 12 10 12c-2.2 0-4 1.8-4 4 0 .9.3 1.72.8 2.38C8.1 21.66 12.8 26 18 26s9.9-4.34 11.2-7.62c.5-.66.8-1.48.8-2.38 0-2.2-1.8-4-4-4z" fill="white"/>
  </svg>
);

const MicrosoftIcon = () => (
  <svg width="16" height="16" viewBox="0 0 21 21">
    <rect x="1" y="1" width="9" height="9" fill="#F25022" rx="1"/>
    <rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="1"/>
    <rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="1"/>
    <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1"/>
  </svg>
);

const SearchConsoleIcon = () => (
  <svg viewBox="0 0 64 64" width="16" height="16">
    <circle cx="26" cy="26" r="18" fill="none" stroke="#4285F4" strokeWidth="6"/>
    <circle cx="26" cy="26" r="9" fill="#34A853"/>
    <line x1="39" y1="39" x2="57" y2="57" stroke="#EA4335" strokeWidth="6" strokeLinecap="round"/>
    <circle cx="26" cy="26" r="4" fill="#FBBC04"/>
  </svg>
);

// ── Colored FA icons for non-brand tools ─────────────────────────────────────
const FA = (icon, color) => (
  <FontAwesomeIcon icon={icon} style={{ width: 15, height: 15, color }} />
);

const NAV = [
  { label: "Paid Media", items: [
    { href: "/dashboard/google/ads",     label: "Google Ads",      icon: <GoogleIcon />                                  },
    { href: "/dashboard/meta",           label: "Meta Ads",        icon: <MetaIcon />                                    },
    { href: "/dashboard/bing",           label: "Microsoft Ads",   icon: <MicrosoftIcon />                               },
  ]},
  { label: "Organic & Reports", items: [
    { href: "/dashboard/google/organic", label: "Google Organic",  icon: <SearchConsoleIcon />                           },
    { href: "/dashboard/report",         label: "Paid vs Organic", icon: FA(faScaleBalanced,        "#f59e0b")           },
    { href: "/dashboard/seo-audit",      label: "SEO Audit",       icon: FA(faMagnifyingGlassChart, "#0d9488")           },
    { href: "/dashboard/admin/clients",  label: "Client Portals",  icon: FA(faBriefcase,            "#a855f7")           },
  ]},
  { label: "Data Tools", items: [
    { href: "/dashboard/audience-lab",   label: "Audience Lab",    icon: FA(faPeopleGroup,          "#4285F4")           },
    { href: "/dashboard/streaming",      label: "Streaming",       icon: FA(faTv,                   "#0ea5e9")           },
  ]},
];

const ADMIN_SECTION = { label: "Admin", items: [
  { href: "/dashboard/admin/usage", label: "Usage Analytics", icon: FA(faChartLine, "#ec4899") },
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
                  style={{ display: "flex", alignItems: "center", gap: 10, padding: "0 10px", height: 38, borderRadius: 10, margin: "1px 6px", cursor: "pointer", transition: "background 0.15s", flexShrink: 0, minWidth: 188, textDecoration: "none", background: active ? "rgba(168,85,247,0.18)" : "transparent", color: active ? "#c084fc" : "rgba(255,255,255,0.45)", position: "relative" }}>
                  <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: active ? "rgba(168,85,247,0.25)" : "transparent", color: active ? "#c084fc" : "rgba(255,255,255,0.45)" }}>
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
