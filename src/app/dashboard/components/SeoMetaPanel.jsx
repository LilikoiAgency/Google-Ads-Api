"use client";
import { useState, useEffect } from "react";
import { createPortal } from "react-dom";

const PAGE_TYPES = ["Page", "Homepage", "Product", "Service", "Blog Post", "Category"];

function charColor(len, min, max) {
  if (len >= min && len <= max) return "#16a34a";
  if (len >= min - 10 && len < min) return "#d97706";
  return "#dc2626";
}

export default function SeoMetaPanel({ open, onClose }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [view, setView] = useState("form"); // "form" | "results"

  const [pageTitle, setPageTitle] = useState("");
  const [keyword, setKeyword] = useState("");
  const [pageType, setPageType] = useState("Page");

  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [copied, setCopied] = useState({});

  useEffect(() => { setMounted(true); return () => setMounted(false); }, []);

  useEffect(() => {
    if (open) {
      const t = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(t);
    } else {
      setVisible(false);
      const tid = setTimeout(() => {
        setView("form");
        setResults(null);
        setErrorMsg(null);
        setPageTitle("");
        setKeyword("");
        setPageType("Page");
        setCopied({});
      }, 220);
      return () => clearTimeout(tid);
    }
  }, [open]);

  const canGenerate = pageTitle.trim().length > 0 && !loading;

  const handleGenerate = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch("/api/claude/seo-meta", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pageTitle: pageTitle.trim(), keyword: keyword.trim() || undefined, pageType: pageType !== "Page" ? pageType : undefined }),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        setErrorMsg(json.error || `Error ${res.status}`);
        return;
      }
      setResults(json.data);
      setView("results");
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = (text, id) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied((prev) => ({ ...prev, [id]: true }));
      setTimeout(() => setCopied((prev) => ({ ...prev, [id]: false })), 1500);
    });
  };

  if (!mounted || !open) return null;

  const inputStyle = { width: "100%", padding: "10px 12px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 10, outline: "none", boxSizing: "border-box", background: "#fff", color: "#111827" };
  const labelStyle = { fontSize: 12, fontWeight: 700, color: "#374151", display: "block", marginBottom: 6 };

  const content = (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", backdropFilter: "blur(2px)", opacity: visible ? 1 : 0, transition: "opacity 0.2s" }} />
      <div style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 41, width: 560, maxWidth: "100vw", background: "#fff", borderLeft: "1px solid #e5e7eb", display: "flex", flexDirection: "column", transform: visible ? "translateX(0)" : "translateX(100%)", transition: "transform 0.22s cubic-bezier(0.4,0,0.2,1)", boxShadow: "-8px 0 40px rgba(0,0,0,0.12)" }}>

        {/* Header */}
        <div style={{ padding: "20px 24px", borderBottom: "1px solid #e5e7eb", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: "uppercase", letterSpacing: "1.5px", color: "#7c3aed", margin: "0 0 4px" }}>AI — SEO Tools</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: "#111827", margin: 0 }}>SEO Meta Generator</h2>
          </div>
          <button onClick={onClose} aria-label="Close panel" style={{ background: "#f3f4f6", border: "none", borderRadius: "50%", width: 32, height: 32, cursor: "pointer", fontSize: 14, display: "flex", alignItems: "center", justifyContent: "center", color: "#6b7280" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "20px 24px" }}>

          {/* ── Form view ── */}
          {view === "form" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
              <div>
                <label htmlFor="seo-page-title" style={labelStyle}>Page title or URL <span style={{ color: "#dc2626" }}>*</span></label>
                <input
                  id="seo-page-title"
                  type="text"
                  value={pageTitle}
                  onChange={(e) => setPageTitle(e.target.value)}
                  placeholder="e.g. HVAC Repair Services in Phoenix, AZ"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="seo-keyword" style={labelStyle}>Target keyword <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <input
                  id="seo-keyword"
                  type="text"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="e.g. HVAC repair Phoenix"
                  style={inputStyle}
                />
              </div>
              <div>
                <label htmlFor="seo-page-type" style={labelStyle}>Page type <span style={{ color: "#9ca3af", fontWeight: 400 }}>(optional)</span></label>
                <select
                  id="seo-page-type"
                  value={pageType}
                  onChange={(e) => setPageType(e.target.value)}
                  style={{ ...inputStyle, background: "#fff" }}
                >
                  {PAGE_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>

              {errorMsg && (
                <p style={{ fontSize: 13, color: "#dc2626", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "10px 14px", margin: 0 }}>{errorMsg}</p>
              )}

              <button
                onClick={handleGenerate}
                disabled={!canGenerate}
                style={{ padding: "12px 20px", fontSize: 13, fontWeight: 800, background: canGenerate ? "#7c3aed" : "#e5e7eb", color: canGenerate ? "#fff" : "#9ca3af", border: "none", borderRadius: 12, cursor: canGenerate ? "pointer" : "not-allowed", transition: "background 0.15s" }}
              >
                {loading ? "Generating…" : "Generate meta tags"}
              </button>
            </div>
          )}

          {/* ── Results view ── */}
          {view === "results" && results && (
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Title tags <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>50–60 chars</span></p>
                {(results.titles || []).map((title, i) => {
                  const len = title.length;
                  const color = charColor(len, 50, 60);
                  return (
                    <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "#111827", margin: "0 0 10px", lineHeight: 1.4 }}>{title}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{len} / 60 chars</span>
                        <button
                          onClick={() => handleCopy(title, `title-${i}`)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[`title-${i}`] ? "#d1fae5" : "#ede9fe", color: copied[`title-${i}`] ? "#065f46" : "#6d28d9", border: "none", borderRadius: 8, cursor: "pointer" }}
                        >
                          {copied[`title-${i}`] ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div>
                <p style={{ fontSize: 12, fontWeight: 800, color: "#374151", textTransform: "uppercase", letterSpacing: "0.06em", margin: "0 0 12px" }}>Meta descriptions <span style={{ fontWeight: 400, fontSize: 11, color: "#9ca3af" }}>150–160 chars</span></p>
                {(results.descriptions || []).map((desc, i) => {
                  const len = desc.length;
                  const color = charColor(len, 150, 160);
                  return (
                    <div key={i} style={{ background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, marginBottom: 10 }}>
                      <p style={{ fontSize: 13, color: "#374151", margin: "0 0 10px", lineHeight: 1.5 }}>{desc}</p>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color }}>{len} / 160 chars</span>
                        <button
                          onClick={() => handleCopy(desc, `desc-${i}`)}
                          style={{ fontSize: 11, fontWeight: 700, padding: "5px 12px", background: copied[`desc-${i}`] ? "#d1fae5" : "#ede9fe", color: copied[`desc-${i}`] ? "#065f46" : "#6d28d9", border: "none", borderRadius: 8, cursor: "pointer" }}
                        >
                          {copied[`desc-${i}`] ? "Copied!" : "Copy"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                onClick={() => setView("form")}
                style={{ padding: "11px 20px", fontSize: 13, fontWeight: 700, background: "#f3f4f6", color: "#374151", border: "1px solid #e5e7eb", borderRadius: 12, cursor: "pointer" }}
              >
                Regenerate
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
