"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import Link from "next/link";
import { ADMIN_EMAILS } from "../../lib/admins";
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

export default function DashboardHub() {
  const router = useRouter();
  const { data: session, status } = useSession();

  useEffect(() => {
    if (status === "unauthenticated") {
      router.replace("/?callbackUrl=/dashboard");
    }
  }, [status, router]);

  if (status === "loading") {
    return (
      <div className="flex flex-col justify-center items-center min-h-screen bg-customPurple-dark">
        <img
          src="https://lilikoiagency.com/wp-content/uploads/2024/05/lik-loading-icon-1.gif"
          alt="Loading..."
          className="w-24 h-24"
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-customPurple-dark">
      {/* Header */}
      <header className="border-b border-white/10 bg-customPurple-dark px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src="https://lilikoiagency.com/wp-content/uploads/2020/05/LIK-Logo-Icon-Favicon.png"
              alt="Lilikoi Agency"
              className="h-10 w-10 rounded-full"
            />
            <div>
              <p className="text-lg font-semibold text-white">Lilikoi Agency</p>
              <p className="text-sm text-gray-400">Internal Tools</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {session?.user?.name && (
              <span className="hidden text-sm text-gray-400 sm:block">
                {session.user.name}
              </span>
            )}
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="rounded-xl border border-white/20 px-4 py-2 text-sm font-medium text-gray-300 hover:bg-white/10 transition"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <div className="mx-auto max-w-6xl px-6 pt-12 pb-6 text-center">
        <h1 className="text-3xl font-bold text-white sm:text-4xl">
          {session?.user?.name ? `Welcome, ${session.user.name.split(" ")[0]}` : "What would you like to do today?"}
        </h1>
        <p className="mt-3 text-gray-400 text-base">
          Choose a tool below to get started.
        </p>
      </div>

      {/* Sectioned Tiles */}
      <div className="mx-auto max-w-6xl px-6 pb-16 space-y-10">
        {SECTIONS.filter((s) => !s.adminOnly || ADMIN_EMAILS.includes((session?.user?.email || "").toLowerCase())).map((section) => (
          <section key={section.title}>
            {/* Section header */}
            <div className="mb-4 flex items-baseline justify-between border-b border-white/10 pb-3">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-wider text-white">
                  {section.title}
                </h2>
                <p className="mt-1 text-xs text-gray-500">{section.description}</p>
              </div>
              <span className="text-xs text-gray-600">{section.tiles.length} {section.tiles.length === 1 ? "tool" : "tools"}</span>
            </div>

            {/* Tile grid — 3 columns on desktop, 2 on tablet, 1 on mobile */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {section.tiles.map((tile) => (
                <Link
                  key={tile.href}
                  href={tile.href}
                  className="group relative flex flex-col rounded-xl border border-gray-200 bg-white p-5 transition duration-200 hover:border-gray-300 hover:scale-[1.02] hover:shadow-xl"
                >
                  {/* Top row: icon + tag */}
                  <div className="mb-3 flex items-start justify-between">
                    <span className="flex-shrink-0"><tile.Icon /></span>
                    <span
                      className="inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                      style={{ background: tile.tagColor + "22", color: tile.tagColor }}
                    >
                      {tile.tag}
                    </span>
                  </div>

                  {/* Title */}
                  <h3 className="mb-1.5 text-base font-bold text-gray-900 leading-tight">
                    {tile.title}
                  </h3>

                  {/* Description */}
                  <p className="flex-1 text-xs leading-relaxed text-gray-500">
                    {tile.description}
                  </p>

                  {/* Arrow */}
                  <div className="mt-4 flex items-center text-xs font-semibold text-gray-400 transition group-hover:text-gray-700">
                    Open
                    <svg className="ml-1 h-3.5 w-3.5 transition-transform group-hover:translate-x-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
