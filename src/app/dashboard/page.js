"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { ADMIN_EMAILS } from "../../lib/admins";
import { useTheme } from "../../lib/useTheme";
import "../globals.css";

// ─── Google product SVG icons ──────────────────────────────────────────────
function GoogleAdsIcon() {
  return (
    <svg viewBox="0 0 192 192" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="40" cy="148" r="40" fill="#FBBC04" />
      <path d="M96 4L56 72l40 68 40-68z" fill="#4285F4" />
      <circle cx="152" cy="148" r="40" fill="#34A853" />
    </svg>
  );
}

function SearchConsoleIcon() {
  return (
    <svg viewBox="0 0 64 64" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="26" cy="26" r="18" fill="none" stroke="#4285F4" strokeWidth="6" />
      <circle cx="26" cy="26" r="9" fill="#34A853" />
      <line x1="39" y1="39" x2="57" y2="57" stroke="#EA4335" strokeWidth="6" strokeLinecap="round" />
      <circle cx="26" cy="26" r="4" fill="#FBBC04" />
    </svg>
  );
}

function MicrosoftAdsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 21 21" xmlns="http://www.w3.org/2000/svg">
      <rect x="1"  y="1"  width="9" height="9" fill="#F25022" rx="1" />
      <rect x="11" y="1"  width="9" height="9" fill="#7FBA00" rx="1" />
      <rect x="1"  y="11" width="9" height="9" fill="#00A4EF" rx="1" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" rx="1" />
    </svg>
  );
}

function ReportIcon() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="28" width="10" height="18" rx="2" fill="#4285F4" />
      <rect x="15" y="18" width="10" height="28" rx="2" fill="#34A853" />
      <rect x="28" y="8" width="10" height="38" rx="2" fill="#FBBC04" />
      <rect x="41" y="20" width="5" height="26" rx="2" fill="#EA4335" />
    </svg>
  );
}

function AudienceLabIcon() {
  return (
    <svg viewBox="0 0 48 48" width="48" height="48" xmlns="http://www.w3.org/2000/svg">
      <circle cx="16" cy="16" r="8" fill="#4285F4" />
      <circle cx="32" cy="16" r="8" fill="#EA4335" opacity="0.85" />
      <circle cx="24" cy="30" r="8" fill="#34A853" opacity="0.85" />
    </svg>
  );
}

function MetaAdsIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 36 36" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="36" height="36" rx="8" fill="#1877F2"/>
      <path d="M26 12c-1.1 0-2 .45-2.7 1.2C21.95 11.44 20.1 10 18 10c-2.1 0-3.95 1.44-5.3 3.2C11.99 12.45 11.1 12 10 12c-2.2 0-4 1.8-4 4 0 .9.3 1.72.8 2.38C8.1 21.66 12.8 26 18 26s9.9-4.34 11.2-7.62c.5-.66.8-1.48.8-2.38 0-2.2-1.8-4-4-4zm-8 11.5c-3.58 0-7.5-3.8-7.5-7.5 0-1.38 1.12-2.5 2.5-2.5.78 0 1.47.36 1.94.92C14.51 15.37 16.15 16.5 18 16.5s3.49-1.13 4.06-2.08c.47-.56 1.16-.92 1.94-.92 1.38 0 2.5 1.12 2.5 2.5 0 3.7-3.92 7.5-7.5 7.5z" fill="white"/>
    </svg>
  );
}

// ─── Tile icon components ───────────────────────────────────────────────
function SEOAuditIcon() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="22" cy="22" r="13" stroke="#0d9488" strokeWidth="3" fill="#0d9488" opacity="0.08"/>
      <circle cx="22" cy="22" r="13" stroke="#0d9488" strokeWidth="2.5"/>
      <line x1="31.5" y1="31.5" x2="42" y2="42" stroke="#0d9488" strokeWidth="3.5" strokeLinecap="round"/>
      <rect x="15" y="24" width="3.5" height="7" rx="1" fill="#f59e0b"/>
      <rect x="20.25" y="20" width="3.5" height="11" rx="1" fill="#0d9488"/>
      <rect x="25.5" y="16" width="3.5" height="15" rx="1" fill="#6366f1"/>
    </svg>
  );
}

function StreamingIcon() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="2" y="12" width="44" height="28" rx="4" fill="#0ea5e9" opacity="0.15"/>
      <rect x="2" y="12" width="44" height="28" rx="4" stroke="#0ea5e9" strokeWidth="2.5"/>
      <path d="M16 8l-4 4M32 8l4 4" stroke="#0ea5e9" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="24" cy="26" r="7" fill="#0ea5e9" opacity="0.3"/>
      <polygon points="21,22 21,30 30,26" fill="#0ea5e9"/>
    </svg>
  );
}

function ClientPortalsIcon() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="18" cy="16" r="7" fill="#6d28d9" opacity="0.9"/>
      <circle cx="33" cy="16" r="5" fill="#a78bfa" opacity="0.8"/>
      <ellipse cx="18" cy="34" rx="12" ry="7" fill="#6d28d9" opacity="0.85"/>
      <ellipse cx="34" cy="34" rx="9" ry="6" fill="#a78bfa" opacity="0.7"/>
    </svg>
  );
}

function UsageAnalyticsIcon() {
  return (
    <svg viewBox="0 0 48 48" width="40" height="40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="6" y="28" width="7" height="14" rx="1.5" fill="#ec4899" opacity="0.9"/>
      <rect x="16" y="20" width="7" height="22" rx="1.5" fill="#ec4899"/>
      <rect x="26" y="12" width="7" height="30" rx="1.5" fill="#ec4899" opacity="0.8"/>
      <rect x="36" y="24" width="7" height="18" rx="1.5" fill="#ec4899" opacity="0.6"/>
      <circle cx="9.5" cy="10" r="2.5" fill="#f472b6"/>
    </svg>
  );
}

// ─── Tile categories ────────────────────────────────────────────────────
const SECTIONS = [
  {
    title: "Paid Media",
    description: "Ad platform dashboards",
    tiles: [
      {
        href: "/dashboard/google/ads",
        Icon: GoogleAdsIcon,
        title: "Google Ads",
        description: "Campaigns, keyword spend, conversions, ROAS.",
        tag: "Paid",
        tagColor: "#a855f7",
      },
      {
        href: "/dashboard/meta",
        Icon: MetaAdsIcon,
        title: "Meta Ads",
        description: "Facebook & Instagram spend, reach, conversions, ROAS.",
        tag: "Paid",
        tagColor: "#1877F2",
      },
      {
        href: "/dashboard/bing",
        Icon: MicrosoftAdsIcon,
        title: "Microsoft Advertising",
        description: "Bing Ads spend, clicks, CTR, CPC, conversions.",
        tag: "Paid",
        tagColor: "#0078D4",
      },
    ],
  },
  {
    title: "Organic & Reports",
    description: "Search performance and cross-channel analysis",
    tiles: [
      {
        href: "/dashboard/google/organic",
        Icon: SearchConsoleIcon,
        title: "Google Search Organic",
        description: "Search Console queries, clicks, impressions, CTR, position.",
        tag: "Organic",
        tagColor: "#22c55e",
      },
      {
        href: "/report",
        Icon: ReportIcon,
        title: "Paid vs. Organic Report",
        description: "Cross-channel comparison — keyword overlap, gaps, opportunities.",
        tag: "Report",
        tagColor: "#f59e0b",
      },
      {
        href: "/dashboard/seo-audit",
        Icon: SEOAuditIcon,
        title: "SEO / GEO / AEO Audit",
        description: "AI-powered site audit with prioritized fixes.",
        tag: "AI Audit",
        tagColor: "#0d9488",
      },
      {
        href: "/dashboard/admin/clients",
        Icon: ClientPortalsIcon,
        title: "Client Portals",
        description: "Manage client-facing portals with ad and audience data.",
        tag: "Portals",
        tagColor: "#6d28d9",
      },
    ],
  },
  {
    title: "Data Tools",
    description: "Audience and attribution tools",
    tiles: [
      {
        href: "/dashboard/audience-lab",
        Icon: AudienceLabIcon,
        title: "Audience Lab",
        description: "Manage segment syncs to BigQuery.",
        tag: "Segments",
        tagColor: "#a855f7",
      },
      {
        href: "/dashboard/streaming",
        Icon: StreamingIcon,
        title: "Targeted Streaming",
        description: "Trade Desk path-to-conversion attribution.",
        tag: "Streaming",
        tagColor: "#0ea5e9",
      },
    ],
  },
  {
    title: "Admin",
    description: "Internal management",
    adminOnly: true,
    tiles: [
      {
        href: "/dashboard/admin/usage",
        Icon: UsageAnalyticsIcon,
        title: "Usage Analytics",
        description: "Dashboard tool adoption — who's using what.",
        tag: "Admin",
        tagColor: "#ec4899",
      },
    ],
  },
];

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `${r},${g},${b}`;
}

const DASH_STYLES = `
  [data-theme="dark"] {
    --bg: radial-gradient(ellipse at 25% 15%, #3b1278 0%, #1e0a38 45%, #0d0520 100%);
    --orb1: rgba(139,92,246,0.13); --orb2: rgba(79,70,229,0.10);
    --header-bg: rgba(14,5,32,0.65); --header-border: rgba(255,255,255,0.08);
    --title-start: #ffffff; --title-end: rgba(196,167,255,0.9);
    --hero-sub: rgba(255,255,255,0.4);
    --section-title: rgba(255,255,255,0.5); --section-desc: rgba(255,255,255,0.25);
    --section-count: rgba(255,255,255,0.2); --section-border: rgba(255,255,255,0.07);
    --tile-bg: rgba(255,255,255,0.06); --tile-border: rgba(255,255,255,0.12);
    --tile-hover-bg: rgba(255,255,255,0.10); --tile-hover-border: rgba(255,255,255,0.22);
    --tile-shine: rgba(255,255,255,0.10); --tile-title: rgba(255,255,255,0.93);
    --tile-desc: rgba(255,255,255,0.42); --tile-arrow: rgba(255,255,255,0.25);
    --shadow: 0 6px 28px rgba(0,0,0,0.30); --shadow-hover: 0 18px 52px rgba(0,0,0,0.42);
    --toggle-label: rgba(255,255,255,0.5);
    --pill-bg: rgba(255,255,255,0.06); --pill-border: rgba(255,255,255,0.10); --pill-text: rgba(255,255,255,0.55);
    --btn-border: rgba(255,255,255,0.20); --btn-text: rgba(255,255,255,0.6);
  }
  [data-theme="light"] {
    --bg: radial-gradient(ellipse at 25% 10%, #ede9fe 0%, #f5f3ff 40%, #faf5ff 70%, #ffffff 100%);
    --orb1: rgba(139,92,246,0.08); --orb2: rgba(109,40,217,0.06);
    --header-bg: rgba(255,255,255,0.72); --header-border: rgba(139,92,246,0.12);
    --title-start: #1e0a38; --title-end: #6d28d9;
    --hero-sub: rgba(30,10,56,0.45);
    --section-title: rgba(30,10,56,0.50); --section-desc: rgba(30,10,56,0.35);
    --section-count: rgba(30,10,56,0.25); --section-border: rgba(109,40,217,0.10);
    --tile-bg: rgba(255,255,255,0.68); --tile-border: rgba(139,92,246,0.15);
    --tile-hover-bg: rgba(255,255,255,0.92); --tile-hover-border: rgba(139,92,246,0.32);
    --tile-shine: rgba(255,255,255,0.85); --tile-title: #1e0a38;
    --tile-desc: rgba(30,10,56,0.50); --tile-arrow: rgba(30,10,56,0.30);
    --shadow: 0 4px 20px rgba(109,40,217,0.08),0 1px 4px rgba(0,0,0,0.04);
    --shadow-hover: 0 16px 44px rgba(109,40,217,0.15),0 2px 8px rgba(0,0,0,0.06);
    --toggle-label: rgba(30,10,56,0.45);
    --pill-bg: rgba(109,40,217,0.06); --pill-border: rgba(109,40,217,0.15); --pill-text: #6d28d9;
    --btn-border: rgba(109,40,217,0.20); --btn-text: #6d28d9;
  }
  .dash-tile {
    transition: transform 0.22s, box-shadow 0.22s, background 0.22s, border-color 0.22s;
  }
  .dash-tile:hover {
    transform: translateY(-5px) scale(1.015);
    background: var(--tile-hover-bg) !important;
    border-color: var(--tile-hover-border) !important;
    box-shadow: var(--shadow-hover), 0 0 28px rgba(var(--c,168,85,247),0.13) !important;
  }
  [data-theme="light"] .dash-tile:hover {
    box-shadow: var(--shadow-hover) !important;
  }
  .dash-tile::before {
    content: '';
    position: absolute; top: 0; left: 0; right: 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--tile-shine), transparent);
  }
  .dash-tile:hover .dash-arrow {
    color: var(--tile-arrow-hover, rgba(255,255,255,0.7)) !important;
  }
`;

export default function DashboardHub() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0d0520" }}>
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          style={{ width: 96, height: 96 }}
        />
      </div>
    );
  }

  return (
    <>
      <style>{DASH_STYLES}</style>
      <div data-theme={theme} style={{ minHeight: "100vh", background: "var(--bg)", position: "relative", overflowX: "hidden" }}>

        {/* Ambient orbs */}
        <div style={{ position: "fixed", top: -100, left: -100, width: 550, height: 550, borderRadius: "50%", background: "var(--orb1)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", bottom: -80, right: -80, width: 450, height: 450, borderRadius: "50%", background: "var(--orb2)", filter: "blur(90px)", pointerEvents: "none", zIndex: 0 }} />

        {/* ── Header ── */}
        <header style={{ position: "sticky", top: 0, zIndex: 50, background: "var(--header-bg)", backdropFilter: "blur(28px)", WebkitBackdropFilter: "blur(28px)", borderBottom: "1px solid var(--header-border)", padding: "18px 40px" }}>
          <div style={{ maxWidth: 1200, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              <img
                src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
                alt="Lilikoi Agency"
                style={{ width: 42, height: 42, borderRadius: "50%" }}
              />
              <div>
                <p style={{ fontSize: 17, fontWeight: 700, color: "var(--tile-title)", margin: 0 }}>Lilikoi Agency</p>
                <p style={{ fontSize: 12, color: "var(--section-desc)", margin: 0, marginTop: 2 }}>Internal Tools</p>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
              {/* iOS-style toggle */}
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 13, color: "var(--toggle-label)", userSelect: "none" }}>
                  {isDark ? "🌙 Dark" : "☀️ Light"}
                </span>
                <div
                  onClick={toggleTheme}
                  style={{ position: "relative", width: 56, height: 30, cursor: "pointer", flexShrink: 0 }}
                  role="switch"
                  aria-checked={!isDark}
                  aria-label="Toggle light/dark mode"
                >
                  <div style={{
                    position: "absolute", inset: 0, borderRadius: 30,
                    background: isDark ? "#3a3a5c" : "#a78bfa",
                    boxShadow: "inset 0 0 0 1.5px rgba(0,0,0,0.12)",
                    transition: "background 0.3s",
                  }} />
                  <div style={{
                    position: "absolute", top: 3, left: 3,
                    width: 24, height: 24, borderRadius: "50%",
                    background: "white",
                    boxShadow: "0 2px 6px rgba(0,0,0,0.28),0 1px 2px rgba(0,0,0,0.18)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13,
                    transform: isDark ? "translateX(0px)" : "translateX(26px)",
                    transition: "transform 0.28s cubic-bezier(0.34,1.56,0.64,1)",
                  }}>
                    {isDark ? "🌙" : "☀️"}
                  </div>
                </div>
              </div>
              {session?.user?.name && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--pill-bg)", border: "1px solid var(--pill-border)", borderRadius: 24, padding: "8px 18px", fontSize: 13, color: "var(--pill-text)" }}>
                  <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#4ade80", flexShrink: 0 }} />
                  {session.user.name}
                </div>
              )}
              <button
                onClick={() => signOut({ callbackUrl: "/" })}
                style={{ borderRadius: 12, border: "1px solid var(--btn-border)", padding: "8px 16px", fontSize: 13, fontWeight: 500, color: "var(--btn-text)", background: "transparent", cursor: "pointer", transition: "opacity 0.2s" }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "0.7")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "1")}
              >
                Sign out
              </button>
            </div>
          </div>
        </header>

        {/* ── Hero ── */}
        <div style={{ textAlign: "center", padding: "64px 40px 44px" }}>
          <h1 style={{
            fontSize: 42, fontWeight: 800, letterSpacing: "-1px", margin: 0,
            background: `linear-gradient(135deg, var(--title-start) 30%, var(--title-end) 100%)`,
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text",
          }}>
            {session?.user?.name
              ? `Welcome back, ${session.user.name.split(" ")[0]}`
              : "What would you like to do today?"}
          </h1>
          <p style={{ marginTop: 13, color: "var(--hero-sub)", fontSize: 17 }}>
            Choose a tool below to get started.
          </p>
        </div>

        {/* ── Sections ── */}
        <div style={{ maxWidth: 1200, margin: "0 auto", padding: "0 40px 80px", position: "relative", zIndex: 1 }}>
          {SECTIONS
            .filter((s) => !s.adminOnly || ADMIN_EMAILS.includes((session?.user?.email || "").toLowerCase()))
            .map((section) => (
              <div key={section.title} style={{ marginBottom: 52 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid var(--section-border)", paddingBottom: 13, marginBottom: 20 }}>
                  <div>
                    <p style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.4px", color: "var(--section-title)", margin: 0 }}>
                      {section.title}
                    </p>
                    <p style={{ fontSize: 12, color: "var(--section-desc)", margin: 0, marginTop: 3 }}>
                      {section.description}
                    </p>
                  </div>
                  <span style={{ fontSize: 12, color: "var(--section-count)" }}>
                    {section.tiles.length} {section.tiles.length === 1 ? "tool" : "tools"}
                  </span>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 18 }}>
                  {section.tiles.map((tile) => {
                    const rgb = hexToRgb(tile.tagColor);
                    return (
                      <Link
                        key={tile.href}
                        href={tile.href}
                        className="dash-tile"
                        style={{
                          "--c": rgb,
                          background: "var(--tile-bg)",
                          border: "1px solid var(--tile-border)",
                          borderRadius: 22,
                          padding: 28,
                          backdropFilter: "blur(18px)",
                          WebkitBackdropFilter: "blur(18px)",
                          boxShadow: "var(--shadow)",
                          position: "relative",
                          overflow: "hidden",
                          display: "flex",
                          flexDirection: "column",
                          textDecoration: "none",
                          color: "inherit",
                          minHeight: 200,
                        }}
                      >
                        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 18 }}>
                          <div style={{
                            width: 56, height: 56, borderRadius: 16,
                            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                            background: `rgba(${rgb},${isDark ? "0.20" : "0.10"})`,
                            boxShadow: `0 0 ${isDark ? "20px" : "14px"} rgba(${rgb},${isDark ? "0.18" : "0.10"})`,
                          }}>
                            <tile.Icon />
                          </div>
                          <span style={{
                            fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.8px",
                            padding: "5px 11px", borderRadius: 20, border: "1px solid",
                            background: `rgba(${rgb},${isDark ? "0.14" : "0.09"})`,
                            color: tile.tagColor,
                            borderColor: `rgba(${rgb},${isDark ? "0.35" : "0.28"})`,
                          }}>
                            {tile.tag}
                          </span>
                        </div>
                        <p style={{ fontSize: 17, fontWeight: 700, color: "var(--tile-title)", margin: 0, marginBottom: 9, lineHeight: 1.3 }}>
                          {tile.title}
                        </p>
                        <p style={{ fontSize: 13.5, lineHeight: 1.65, color: "var(--tile-desc)", flex: 1, margin: 0 }}>
                          {tile.description}
                        </p>
                        <div className="dash-arrow" style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 5, fontSize: 13, fontWeight: 600, color: "var(--tile-arrow)", transition: "color 0.2s, gap 0.2s" }}>
                          Open
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <path d="M5 12h14M12 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ))}
        </div>
      </div>
    </>
  );
}
