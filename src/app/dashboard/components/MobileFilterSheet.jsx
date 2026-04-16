// src/app/dashboard/components/MobileFilterSheet.jsx
"use client";
import { useEffect } from "react";

export default function MobileFilterSheet({ open, onClose, onApply, children }) {
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <>
      {/* Scrim */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 40 }}
      />
      {/* Sheet */}
      <div style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 41,
        background: "#1a0a30",
        borderTop: "1px solid rgba(255,255,255,0.1)",
        borderRadius: "20px 20px 0 0",
        padding: "16px 16px 36px",
        maxHeight: "80vh", overflowY: "auto",
      }}>
        {/* Handle */}
        <div style={{ width: 32, height: 3, background: "rgba(255,255,255,0.2)", borderRadius: 2, margin: "0 auto 18px" }} />
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "rgba(255,255,255,0.9)", margin: 0 }}>Filters</p>
          <button
            onClick={onClose}
            aria-label="Close filters"
            style={{ background: "none", border: "none", color: "rgba(255,255,255,0.5)", fontSize: 18, cursor: "pointer", lineHeight: 1 }}
          >✕</button>
        </div>
        {/* Filter controls (page-provided) */}
        {children}
        {/* Apply */}
        <button
          onClick={onApply}
          style={{ width: "100%", background: "#7c3aed", border: "none", borderRadius: 12, padding: 13, fontSize: 14, fontWeight: 700, color: "#fff", cursor: "pointer", marginTop: 16 }}
        >
          Apply Filters
        </button>
      </div>
    </>
  );
}
