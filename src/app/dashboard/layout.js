// src/app/dashboard/layout.js
"use client";
import { Suspense, useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import DashboardSidebar from "./components/DashboardSidebar";
import MobileNavSheet from "./components/MobileNavSheet";
import { MobileNavProvider } from "./components/MobileNavContext";
import SeoMetaPanel from "./components/SeoMetaPanel";

function PanelWatcher() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const panelParam = searchParams.get("panel");
  const [seoMetaOpen, setSeoMetaOpen] = useState(false);

  useEffect(() => {
    setSeoMetaOpen(panelParam === "seo-meta");
  }, [panelParam]);

  const closeSeoMeta = () => {
    const params = new URLSearchParams(window.location.search);
    params.delete("panel");
    const newUrl = params.toString()
      ? `${window.location.pathname}?${params.toString()}`
      : window.location.pathname;
    router.replace(newUrl);
  };

  return <SeoMetaPanel open={seoMetaOpen} onClose={closeSeoMeta} />;
}

export default function DashboardLayout({ children }) {
  return (
    <MobileNavProvider>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--dash-bg)",
          position: "relative",
          overflowX: "hidden",
        }}
      >
        {/* Ambient orbs */}
        <div style={{ position: "fixed", top: -100, left: -100, width: 550, height: 550, borderRadius: "50%", background: "var(--dash-orb1)", filter: "blur(100px)", pointerEvents: "none", zIndex: 0 }} />
        <div style={{ position: "fixed", bottom: -80, right: -80, width: 450, height: 450, borderRadius: "50%", background: "var(--dash-orb2)", filter: "blur(90px)", pointerEvents: "none", zIndex: 0 }} />

        {/* Sidebar — hidden on mobile via .sb-desktop CSS class */}
        <DashboardSidebar />

        {/* Main content area — sb-content-offset applies margin-left: 68px on desktop only */}
        <main className="sb-content-offset" style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", zIndex: 1, minWidth: 0 }}>
          {children}
        </main>

        {/* Mobile full-screen nav overlay */}
        <MobileNavSheet />

        {/* SEO Meta panel — available on all pages */}
        <Suspense fallback={null}>
          <PanelWatcher />
        </Suspense>
      </div>
    </MobileNavProvider>
  );
}
