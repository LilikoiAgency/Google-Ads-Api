// src/app/dashboard/components/DashboardToolHeader.js
"use client";

export default function DashboardToolHeader({ icon, title, subtitle, children }) {
  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        background: "rgba(14,8,28,0.65)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderBottom: "1px solid rgba(255,255,255,0.06)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        gap: 12,
        position: "sticky",
        top: 0,
        zIndex: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        {icon && (
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "rgba(168,85,247,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center",
            flexShrink: 0,
          }}>
            {icon}
          </div>
        )}
        <div style={{ minWidth: 0 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: "rgba(255,255,255,0.92)", margin: 0, lineHeight: 1.2 }}>
            {title}
          </p>
          {subtitle && (
            <p style={{ fontSize: 11, color: "rgba(255,255,255,0.35)", margin: 0, marginTop: 2, lineHeight: 1 }}>
              {subtitle}
            </p>
          )}
        </div>
      </div>
      {children && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          {children}
        </div>
      )}
    </header>
  );
}
