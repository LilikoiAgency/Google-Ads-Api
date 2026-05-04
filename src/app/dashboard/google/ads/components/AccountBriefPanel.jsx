"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import AccountBriefCard from "./AccountBriefCard";

export default function AccountBriefPanel({ open, onClose, selectedCustomer, currentDateRange }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
    }
  }, [open]);

  if (!mounted || !open) return null;

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 560, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }}>
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#1d4ed8", margin: "0 0 4px" }}>AI — Account Intelligence</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>Account Brief</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>
          {selectedCustomer ? (
            <AccountBriefCard selectedCustomer={selectedCustomer} currentDateRange={currentDateRange} />
          ) : (
            <p style={{ fontSize: 13, color: "#6b7280" }}>Select an account to view its brief.</p>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
