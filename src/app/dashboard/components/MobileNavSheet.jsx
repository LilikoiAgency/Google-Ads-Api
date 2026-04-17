"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMobileNav } from "./MobileNavContext";
import { isAdmin } from "../../../lib/admins";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faHouse } from "@fortawesome/free-solid-svg-icons";
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

      {/* Home */}
      {(() => {
        const homeActive = pathname === "/dashboard";
        return (
          <Link
            href="/dashboard"
            onClick={() => setNavOpen(false)}
            style={{
              display: "flex", alignItems: "center", gap: 12,
              background: homeActive ? "rgba(168,85,247,0.2)" : "rgba(255,255,255,0.06)",
              border: `1px solid ${homeActive ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.1)"}`,
              borderRadius: 14, padding: "14px 16px", marginBottom: 20, textDecoration: "none",
            }}
          >
            <div style={{ width: 36, height: 36, borderRadius: 10, background: homeActive ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.08)", display: "flex", alignItems: "center", justifyContent: "center", color: homeActive ? "#c084fc" : "rgba(255,255,255,0.6)" }}>
              <FontAwesomeIcon icon={faHouse} style={{ width: 16, height: 16 }} />
            </div>
            <span style={{ fontSize: 14, fontWeight: 700, color: homeActive ? "#c084fc" : "rgba(255,255,255,0.75)" }}>Home</span>
          </Link>
        );
      })()}

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
