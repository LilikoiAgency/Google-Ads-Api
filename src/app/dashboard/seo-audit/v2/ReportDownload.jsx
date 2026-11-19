"use client";
// "Download report" button: pick the client report or the full action plan,
// saved as one standalone HTML file to email.

import { useEffect, useRef, useState } from "react";
import { REPORT_KINDS, downloadSeoReport } from "../../../../lib/seoAuditReportHtml";

export default function ReportDownload({ result }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!result) return null;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.25)", background: "#fff", color: "#0f3460", fontSize: 13, fontWeight: 700, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}
      >
        Download report <span aria-hidden>▾</span>
      </button>
      {open && (
        <div
          role="menu"
          style={{ position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 20, width: 300, background: "#fff", borderRadius: 12, boxShadow: "0 10px 30px rgba(0,0,0,0.25)", padding: 6 }}
        >
          {REPORT_KINDS.map((k) => (
            <button
              key={k.key}
              role="menuitem"
              type="button"
              onClick={() => { downloadSeoReport(result, { kind: k.key }); setOpen(false); }}
              style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "transparent", padding: "10px 12px", borderRadius: 8, cursor: "pointer" }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#f3f6fb"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ display: "block", fontSize: 13, fontWeight: 700, color: "#1a1a2e" }}>{k.label}</span>
              <span style={{ display: "block", fontSize: 12, color: "#666", marginTop: 2, lineHeight: 1.4 }}>{k.hint}</span>
            </button>
          ))}
          <p style={{ fontSize: 11, color: "#999", padding: "6px 12px 4px", margin: 0 }}>Saves one HTML file you can attach to an email.</p>
        </div>
      )}
    </div>
  );
}
