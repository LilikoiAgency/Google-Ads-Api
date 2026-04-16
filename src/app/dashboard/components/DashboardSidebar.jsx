// src/app/dashboard/components/DashboardSidebar.js
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { useTheme } from "../../../lib/useTheme";
import { isAdmin } from "../../../lib/admins";

function IconGrid() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>;
}
function IconMeta() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>;
}
function IconMicrosoft() {
  return <svg width="15" height="15" viewBox="0 0 21 21" fill="none"><rect x="1" y="1" width="9" height="9" fill="#F25022" rx="1"/><rect x="11" y="1" width="9" height="9" fill="#7FBA00" rx="1"/><rect x="1" y="11" width="9" height="9" fill="#00A4EF" rx="1"/><rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1"/></svg>;
}
function IconSearch() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
}
function IconBars() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>;
}
function IconAudit() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/><line x1="8" y1="11" x2="14" y2="11"/><line x1="11" y1="8" x2="11" y2="14"/></svg>;
}
function IconUsers() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>;
}
function IconVideo() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>;
}
function IconPortals() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>;
}
function IconChart() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M18 20V10"/><path d="M12 20V4"/><path d="M6 20v-6"/></svg>;
}

const NAV = [
  { label: "Paid Media", items: [
    { href: "/dashboard/google/ads",  label: "Google Ads",       icon: <IconGrid />      },
    { href: "/dashboard/meta",        label: "Meta Ads",         icon: <IconMeta />      },
    { href: "/dashboard/bing",        label: "Microsoft Ads",    icon: <IconMicrosoft /> },
  ]},
  { label: "Organic & Reports", items: [
    { href: "/dashboard/google/organic", label: "Google Organic",  icon: <IconSearch />  },
    { href: "/report",                   label: "Paid vs Organic", icon: <IconBars />    },
    { href: "/dashboard/seo-audit",      label: "SEO Audit",       icon: <IconAudit />   },
    { href: "/dashboard/admin/clients",  label: "Client Portals",  icon: <IconPortals /> },
  ]},
  { label: "Data Tools", items: [
    { href: "/dashboard/audience-lab", label: "Audience Lab", icon: <IconUsers /> },
    { href: "/dashboard/streaming",    label: "Streaming",    icon: <IconVideo />  },
  ]},
];

const ADMIN_SECTION = { label: "Admin", items: [
  { href: "/dashboard/admin/usage", label: "Usage Analytics", icon: <IconChart /> },
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
    width: 56, minHeight: "100vh",
    background: "rgba(8,5,18,0.88)",
    backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    borderRight: "1px solid rgba(255,255,255,0.07)",
    display: "flex", flexDirection: "column",
    padding: "14px 0", flexShrink: 0,
    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1)",
    overflow: "hidden", position: "relative", zIndex: 20,
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
