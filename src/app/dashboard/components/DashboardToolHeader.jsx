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

      {/* Mobile grid button — hidden on desktop via .mobile-only CSS */}
      <button
        className="mobile-only"
        onClick={() => setNavOpen(true)}
        aria-label="Open navigation"
        style={{
          width: 34, height: 34, borderRadius: 9, flexShrink: 0,
          background: "rgba(255,255,255,0.07)", border: "1px solid rgba(255,255,255,0.1)",
          cursor: "pointer",
          display: "none", /* overridden to flex by .mobile-only on small screens */
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
