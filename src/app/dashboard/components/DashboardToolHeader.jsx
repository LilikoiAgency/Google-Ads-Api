// src/app/dashboard/components/DashboardToolHeader.jsx
"use client";
import { useMobileNav } from "./MobileNavContext";

export default function DashboardToolHeader({ icon, title, subtitle, children }) {
  const { setNavOpen } = useMobileNav();

  return (
    <header
      style={{
        height: 72, flexShrink: 0,
        background: "var(--header-bg)",
        backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid var(--header-border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "0 22px", gap: 16, position: "sticky", top: 0, zIndex: 10,
      }}
    >
      {/* Left: icon + title + subtitle */}
      <div style={{ display: "flex", alignItems: "center", gap: 14, minWidth: 0, flex: 1 }}>
        {icon && (
          <div style={{ width: 40, height: 40, borderRadius: 11, background: "rgba(168,85,247,0.2)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 20, fontWeight: 700, color: "var(--text-primary)", margin: 0, lineHeight: 1.2 }}>{title}</p>
          {subtitle && <p style={{ fontSize: 14, color: "var(--text-secondary)", margin: 0, marginTop: 3, lineHeight: 1 }}>{subtitle}</p>}
        </div>
      </div>

      {/* Desktop controls slot */}
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          {children}
        </div>
      )}

      {/* Mobile grid button — hidden on desktop via .mobile-only CSS */}
      <button
        className="mobile-only"
        onClick={() => setNavOpen(true)}
        aria-label="Open navigation"
        style={{
          width: 44, height: 44, borderRadius: 12, flexShrink: 0,
          background: "var(--btn-bg)", border: "1px solid var(--btn-border)",
          cursor: "pointer",
          display: "none",
          alignItems: "center", justifyContent: "center",
        }}
      >
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
          {[0,1,2,3].map(i => <div key={i} style={{ width: 8, height: 8, background: "var(--dot-color)", borderRadius: 2 }} />)}
        </div>
      </button>
    </header>
  );
}
