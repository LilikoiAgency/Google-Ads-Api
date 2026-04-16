// src/app/dashboard/layout.js
"use client";
import DashboardSidebar from "./components/DashboardSidebar";
import MobileNavSheet from "./components/MobileNavSheet";
import { MobileNavProvider } from "./components/MobileNavContext";

export default function DashboardLayout({ children }) {
  return (
    <MobileNavProvider>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "radial-gradient(ellipse at 25% 15%, #2d1060 0%, #1a0a30 45%, #0d0520 100%)",
          position: "relative",
          overflowX: "hidden",
        }}
      >
        {/* Ambient orbs */}
        <div style={{ position: "fixed", top: -100, left: -100, width: 550, height: 550, borderRadius: "50%", background: "rgba(139,92,246,0.12)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", bottom: -80, right: -80, width: 450, height: 450, borderRadius: "50%", background: "rgba(79,70,229,0.09)", filter: "blur(90px)", pointerEvents: "none", zIndex: 0 }} />

        {/* Sidebar — hidden on mobile via .sb-desktop CSS class */}
        <DashboardSidebar />

        {/* Main content area */}
        <main style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1, minWidth: 0 }}>
          {children}
        </main>

        {/* Mobile full-screen nav overlay */}
        <MobileNavSheet />
      </div>
    </MobileNavProvider>
  );
}
