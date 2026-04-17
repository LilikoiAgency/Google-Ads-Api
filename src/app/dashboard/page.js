// src/app/dashboard/page.js
"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useTheme } from "../../lib/useTheme";
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
      { href: "/dashboard/google/ads",     Icon: GoogleAdsIcon,     name: "Google Ads",              tag: "Paid",      tagColor: "rgba(66,133,244,0.12)",  tagText: "#4285F4",  tagBorder: "rgba(66,133,244,0.3)",  desc: "Campaigns, keyword spend, conversions, ROAS, search terms, landing page performance, and device breakdown across all MCC accounts." },
      { href: "/dashboard/meta",           Icon: MetaAdsIcon,       name: "Meta Ads",                tag: "Paid",      tagColor: "rgba(24,119,242,0.12)",  tagText: "#1877F2",  tagBorder: "rgba(24,119,242,0.3)",  desc: "Facebook & Instagram campaign performance — reach, frequency, conversions, and creative-level reporting." },
      { href: "/dashboard/bing",           Icon: MicrosoftAdsIcon,  name: "Microsoft Advertising",   tag: "Paid",      tagColor: "rgba(0,120,212,0.12)",   tagText: "#0078D4",  tagBorder: "rgba(0,120,212,0.3)",   desc: "Bing Ads performance — clicks, CTR, CPC, conversions, and campaign breakdown." },
    ],
  },
  {
    section: "Organic & Reports",
    items: [
      { href: "/dashboard/google/organic", Icon: SearchConsoleIcon, name: "Google Search Organic",   tag: "Organic",   tagColor: "rgba(52,168,83,0.12)",   tagText: "#34A853",  tagBorder: "rgba(52,168,83,0.3)",   desc: "Search Console data — top queries, clicks, impressions, CTR, and average position by property." },
      { href: "/dashboard/report",         Icon: ReportIcon,        name: "Paid vs. Organic Report", tag: "Report",    tagColor: "rgba(245,158,11,0.12)",  tagText: "#f59e0b",  tagBorder: "rgba(245,158,11,0.3)",  desc: "Cross-channel keyword overlap — find gaps, double-coverage, and opportunities between paid and organic." },
      { href: "/dashboard/seo-audit",      Icon: SEOAuditIcon,      name: "SEO / GEO / AEO Audit",  tag: "AI Audit",  tagColor: "rgba(13,148,136,0.12)",  tagText: "#0d9488",  tagBorder: "rgba(13,148,136,0.3)",  desc: "AI-powered site audit. Enter any domain to get scored recommendations for SEO, generative engine, and answer engine optimization." },
      { href: "/dashboard/admin/clients",  Icon: ClientPortalsIcon, name: "Client Portals",          tag: "Portals",   tagColor: "rgba(168,85,247,0.12)",  tagText: "#a855f7",  tagBorder: "rgba(168,85,247,0.3)",  desc: "Manage client-facing reporting portals. Each portal exposes ad and audience data for a specific client account." },
    ],
  },
  {
    section: "Data Tools",
    items: [
      { href: "/dashboard/audience-lab",   Icon: AudienceLabIcon,   name: "Audience Lab",            tag: "Segments",  tagColor: "rgba(168,85,247,0.12)",  tagText: "#a855f7",  tagBorder: "rgba(168,85,247,0.3)",  desc: "Manage Audience Lab segment syncs to BigQuery. Monitor sync health, trigger manual runs, and track slot usage." },
      { href: "/dashboard/streaming",      Icon: StreamingIcon,     name: "Targeted Streaming",      tag: "Streaming", tagColor: "rgba(14,165,233,0.12)",  tagText: "#0ea5e9",  tagBorder: "rgba(14,165,233,0.3)",  desc: "Trade Desk path-to-conversion attribution. Upload report files and analyze impression-to-conversion journeys." },
    ],
  },
];

// ── Tool card ─────────────────────────────────────────────────────────────────
function ToolCard({ href, Icon, name, tag, tagColor, tagText, tagBorder, desc, isDark }) {
  const cardBg    = isDark ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)";
  const cardBdr   = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.10)";
  const hoverBg   = isDark ? "rgba(255,255,255,0.09)" : "rgba(0,0,0,0.07)";
  const hoverBdr  = isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.16)";
  const iconBg    = isDark ? "rgba(255,255,255,0.06)" : "rgba(0,0,0,0.05)";
  const nameColor = isDark ? "rgba(255,255,255,0.88)" : "rgba(0,0,0,0.85)";
  const descColor = isDark ? "rgba(255,255,255,0.4)"  : "rgba(0,0,0,0.45)";
  const linkColor = isDark ? "rgba(255,255,255,0.3)"  : "rgba(0,0,0,0.3)";

  return (
    <Link
      href={href}
      style={{ background: cardBg, border: `1px solid ${cardBdr}`, borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 10, textDecoration: "none", transition: "background 0.15s, border-color 0.15s" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = hoverBg; e.currentTarget.style.borderColor = hoverBdr; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = cardBg;  e.currentTarget.style.borderColor = cardBdr;  }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", background: iconBg }}>
          <Icon />
        </div>
        <span style={{ fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.7px", padding: "3px 8px", borderRadius: 12, border: "1px solid", background: tagColor, color: tagText, borderColor: tagBorder }}>
          {tag}
        </span>
      </div>
      <p style={{ fontSize: 13, fontWeight: 700, color: nameColor, margin: 0 }}>{name}</p>
      <p style={{ fontSize: 11, color: descColor, lineHeight: 1.55, margin: 0, flex: 1 }}>{desc}</p>
      <p style={{ fontSize: 11, fontWeight: 600, color: linkColor, margin: 0 }}>Open tool →</p>
    </Link>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function DashboardHome() {
  const router = useRouter();
  const { data: session, status } = useSession();
  const { theme } = useTheme();
  const isDark = theme === "dark";

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
    }
  }, [status, router]);

  if (status === "loading") {
    return <DashboardLoader label="Loading..." />;
  }

  const firstName = session?.user?.name?.split(" ")[0] || "there";

  const headingColor  = isDark ? "#fff"                   : "rgba(0,0,0,0.88)";
  const bodyColor     = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.5)";
  const sectionColor  = isDark ? "rgba(255,255,255,0.3)"  : "rgba(0,0,0,0.35)";
  const bannerTitle   = isDark ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.8)";
  const bannerBody    = isDark ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.5)";

  return (
    <div className="flex flex-col flex-1">
      <DashboardToolHeader
        icon={<span style={{ fontSize: 14 }}>🏠</span>}
        title="Home"
        subtitle="Tools & documentation"
      >
        <span style={{ background: "rgba(168,85,247,0.2)", border: "1px solid rgba(168,85,247,0.35)", borderRadius: 20, padding: "4px 12px", fontSize: 10, fontWeight: 700, color: "#c084fc", letterSpacing: "0.5px", whiteSpace: "nowrap" }}>
          ✦ WHAT&apos;S NEW
        </span>
      </DashboardToolHeader>

      <div style={{ maxWidth: 900, margin: "0 auto", padding: "36px 28px 60px", width: "100%" }}>
        {/* Hero */}
        <div style={{ marginBottom: 36 }}>
          <h1 style={{ fontSize: 28, fontWeight: 800, color: headingColor, letterSpacing: "-0.5px", margin: "0 0 10px" }}>
            Welcome back,{" "}
            <span style={{ background: "linear-gradient(135deg,#a855f7,#6366f1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", backgroundClip: "text" }}>
              {firstName}
            </span>{" "}
            👋
          </h1>
          <p style={{ fontSize: 15, color: bodyColor, lineHeight: 1.6, margin: 0, maxWidth: 520 }}>
            Everything you need to manage paid media, organic search, and audience data — all in one place. Use the sidebar or pick a tool below to get started.
          </p>
        </div>

        {/* What's New banner */}
        <div style={{ background: "rgba(168,85,247,0.08)", border: "1px solid rgba(168,85,247,0.2)", borderRadius: 14, padding: "16px 20px", marginBottom: 40, display: "flex", alignItems: "flex-start", gap: 14 }}>
          <span style={{ background: "rgba(168,85,247,0.25)", borderRadius: 8, padding: "6px 10px", fontSize: 11, fontWeight: 800, color: "#c084fc", letterSpacing: "0.5px", whiteSpace: "nowrap", flexShrink: 0 }}>NEW</span>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: bannerTitle, margin: "0 0 4px" }}>{WHATS_NEW_TITLE}</p>
            <p style={{ fontSize: 12, color: bannerBody, lineHeight: 1.55, margin: 0 }}>{WHATS_NEW_BODY}</p>
          </div>
        </div>

        {/* Tool sections */}
        {TOOLS.map(({ section, items }) => (
          <div key={section} style={{ marginBottom: 36 }}>
            <p style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "1.2px", color: sectionColor, margin: "0 0 12px" }}>{section}</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>
              {items.map((tool) => <ToolCard key={tool.href} {...tool} isDark={isDark} />)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
