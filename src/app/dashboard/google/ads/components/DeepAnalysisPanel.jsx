"use client";
import { useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";

const CATEGORY_LABELS = {
  conversionTracking: 'Conversion Tracking',
  wastedSpend:        'Wasted Spend',
  accountStructure:   'Account Structure',
  keywords:           'Keywords',
  ads:                'Ads',
  settings:           'Settings',
};

const STATUS_ICON  = { PASS: '✓', WARNING: '⚠', FAIL: '✗' };
const STATUS_COLOR = { PASS: '#15803d', WARNING: '#b45309', FAIL: '#dc2626' };
const STATUS_BG    = { PASS: '#f0fdf4', WARNING: '#fffbeb', FAIL: '#fef2f2' };

function scoreColor(score) {
  if (score >= 75) return '#15803d';
  if (score >= 50) return '#b45309';
  return '#dc2626';
}

function gradeColor(grade) {
  if (grade === 'A') return '#15803d';
  if (grade === 'B') return '#1d4ed8';
  if (grade === 'C') return '#b45309';
  return '#dc2626';
}

function safeGet(key) {
  try { return sessionStorage.getItem(key); } catch { return null; }
}
function safeSet(key, value) {
  try { sessionStorage.setItem(key, value); } catch {}
}
function safeRemove(key) {
  try { sessionStorage.removeItem(key); } catch {}
}

function SkeletonPulse() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
      <style>{`@keyframes briefPulse { 0%,100%{opacity:1} 50%{opacity:.4} }`}</style>
      <div style={{ height: 80, background: '#e5edff', borderRadius: 14, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
      {[0,1,2,3,4,5].map((i) => (
        <div key={i} style={{ height: 36, background: '#f1f5f9', borderRadius: 10, animation: 'briefPulse 1.5s ease-in-out infinite', animationDelay: `${i * 0.1}s` }} />
      ))}
    </div>
  );
}

function CategoryBar({ name, score, weight }) {
  const color = scoreColor(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
      <div style={{ width: 140, fontSize: 12, color: '#374151', fontWeight: 600, flexShrink: 0 }}>
        {CATEGORY_LABELS[name]}
        <span style={{ fontSize: 10, color: '#9ca3af', marginLeft: 4 }}>{weight}%</span>
      </div>
      <div style={{ flex: 1, height: 8, background: '#f1f5f9', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${score}%`, background: color, borderRadius: 4, transition: 'width 0.5s ease' }} />
      </div>
      <div style={{ width: 32, fontSize: 12, fontWeight: 800, color, textAlign: 'right', flexShrink: 0 }}>{score}</div>
    </div>
  );
}

function FindingRow({ finding }) {
  const [expanded, setExpanded] = useState(finding.status !== 'PASS');
  return (
    <div
      onClick={() => setExpanded((e) => !e)}
      style={{ cursor: 'pointer', borderRadius: 8, padding: '8px 10px', marginBottom: 4, background: STATUS_BG[finding.status], border: `1px solid ${STATUS_COLOR[finding.status]}33` }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 800, color: STATUS_COLOR[finding.status], flexShrink: 0 }}>{STATUS_ICON[finding.status]}</span>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#111827', flex: 1 }}>{finding.label}</span>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{expanded ? '▲' : '▼'}</span>
      </div>
      {expanded && finding.detail && (
        <p style={{ fontSize: 11, color: '#6b7280', margin: '6px 0 0 21px', lineHeight: 1.5 }}>{finding.detail}</p>
      )}
    </div>
  );
}

function CategorySection({ name, category }) {
  const findings = category.findings || [];
  const hasIssues = findings.some((f) => f.status !== 'PASS');
  const [open, setOpen] = useState(hasIssues);
  if (findings.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <button
        aria-label={`${CATEGORY_LABELS[name]} ${category.score}/100`}
        onClick={() => setOpen((o) => !o)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0', marginBottom: open ? 8 : 0 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: scoreColor(category.score) }}>{category.score}/100</span>
        </div>
        <span style={{ fontSize: 10, color: '#9ca3af' }}>{open ? '▲' : '▼'}</span>
      </button>
      {open && findings.map((f, i) => <FindingRow key={i} finding={f} />)}
    </div>
  );
}

function useAnalysis(open, customerId, campaigns) {
  const [status, setStatus] = useState('idle');
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const abortRef = useRef(null);

  function cacheKey() {
    return `deepAnalysis:${customerId}:${new Date().toISOString().slice(0, 10)}`;
  }

  async function run(skipCache = false) {
    if (!customerId || campaigns.length === 0) return;
    if (!skipCache) {
      const cached = safeGet(cacheKey());
      if (cached) {
        try { setResult(JSON.parse(cached)); setStatus('done'); return; } catch {}
      }
    }
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setStatus('loading');
    setResult(null);
    setErrorMsg('');
    try {
      const auditRes = await fetch(`/api/googleads/audit?customerId=${encodeURIComponent(customerId)}`, { signal: controller.signal });
      const auditJson = auditRes.ok ? await auditRes.json() : { data: {} };
      const auditData = auditJson.data || {};
      const deepRes = await fetch('/api/claude/google-deep-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customerId, campaigns, auditData }),
        signal: controller.signal,
      });
      const deepJson = await deepRes.json();
      if (!deepRes.ok || deepJson.error) throw new Error(deepJson.error || `Error ${deepRes.status}`);
      safeSet(cacheKey(), JSON.stringify(deepJson.data));
      setResult(deepJson.data);
      setStatus('done');
    } catch (err) {
      if (err.name === 'AbortError') return;
      setErrorMsg(err.message || 'Analysis failed');
      setStatus('error');
    }
  }

  function rerun() {
    safeRemove(cacheKey());
    run(true);
  }

  useEffect(() => {
    if (!open) return;
    run();
    return () => abortRef.current?.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customerId]);

  return { status, result, errorMsg, rerun };
}

export default function DeepAnalysisPanel({ open, onClose, selectedCustomer }) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const campaigns = selectedCustomer?.campaigns || [];
  const { status, result, errorMsg, rerun } = useAnalysis(open, customerId, campaigns);

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
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 40, background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(2px)', opacity: visible ? 1 : 0, transition: 'opacity 0.2s' }} />
      <div style={{ position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 41, width: 600, maxWidth: '100vw', background: '#fff', borderLeft: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', transform: visible ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.22s cubic-bezier(0.4,0,0.2,1)', boxShadow: '-8px 0 40px rgba(0,0,0,0.12)' }}>
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: 10, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#1d4ed8', margin: '0 0 4px' }}>AI — 80-Check Framework</p>
            <h2 style={{ fontSize: 17, fontWeight: 800, color: '#111827', margin: 0 }}>Deep Analysis</h2>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {status === 'done' && (
              <button onClick={rerun} style={{ fontSize: 12, fontWeight: 700, color: '#1d4ed8', background: 'rgba(29,78,216,0.08)', border: '1px solid rgba(29,78,216,0.2)', borderRadius: 8, padding: '6px 12px', cursor: 'pointer' }}>
                Re-run
              </button>
            )}
            <button onClick={onClose} aria-label="✕" style={{ background: '#f3f4f6', border: 'none', borderRadius: '50%', width: 32, height: 32, cursor: 'pointer', fontSize: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6b7280' }}>✕</button>
          </div>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 24px' }}>
          {status === 'loading' && <SkeletonPulse />}

          {status === 'error' && (
            <div style={{ textAlign: 'center', padding: '40px 0' }}>
              <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>{errorMsg}</p>
              <button onClick={rerun} style={{ fontSize: 12, fontWeight: 700, color: '#fff', background: '#1d4ed8', border: 'none', borderRadius: 8, padding: '8px 16px', cursor: 'pointer' }}>Try again</button>
            </div>
          )}

          {status === 'done' && result && (
            <>
              <div style={{ textAlign: 'center', background: 'linear-gradient(135deg,#eef4ff,#fff)', border: '1px solid #dbe4ff', borderRadius: 16, padding: '24px 16px', marginBottom: 24 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 12 }}>
                  <div style={{ fontSize: 56, fontWeight: 900, color: scoreColor(result.healthScore), lineHeight: 1 }}>{result.healthScore}</div>
                  <div style={{ fontSize: 40, fontWeight: 900, color: gradeColor(result.grade), lineHeight: 1, background: `${gradeColor(result.grade)}15`, borderRadius: 12, padding: '4px 14px' }}>{result.grade}</div>
                </div>
                <p style={{ fontSize: 13, color: '#374151', margin: '0 0 20px', lineHeight: 1.5 }}>{result.summary}</p>
                <div style={{ textAlign: 'left' }}>
                  {Object.entries(result.categories || {}).map(([key, cat]) => (
                    <CategoryBar key={key} name={key} score={cat.score} weight={cat.weight} />
                  ))}
                </div>
              </div>

              <div style={{ marginBottom: 24 }}>
                <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>Findings</p>
                {Object.entries(result.categories || {}).map(([key, cat]) => (
                  <CategorySection key={key} name={key} category={cat} />
                ))}
              </div>

              {(result.quickWins || []).length > 0 && (
                <div style={{ marginBottom: 24 }}>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>Quick Wins</p>
                  {result.quickWins.map((w, i) => (
                    <div key={i} style={{ display: 'flex', gap: 12, background: '#f8faff', border: '1px solid #e0e7ff', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <span style={{ fontSize: 10, fontWeight: 800, color: '#fff', background: w.effort === 'low' ? '#15803d' : w.effort === 'medium' ? '#b45309' : '#dc2626', borderRadius: 6, padding: '3px 7px', flexShrink: 0, alignSelf: 'flex-start', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{w.effort}</span>
                      <div>
                        <p style={{ fontSize: 12, fontWeight: 700, color: '#111827', margin: '0 0 3px' }}>{w.action}</p>
                        <p style={{ fontSize: 11, color: '#6366f1', margin: 0 }}>{w.impact}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {(result.aiInsights || []).length > 0 && (
                <div>
                  <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#6b7280', margin: '0 0 12px' }}>AI Insights</p>
                  {result.aiInsights.map((ins, i) => (
                    <div key={i} style={{ background: '#fafafa', border: '1px solid #e5e7eb', borderRadius: 10, padding: 12, marginBottom: 8 }}>
                      <p style={{ fontSize: 12, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>{ins.title}</p>
                      <p style={{ fontSize: 11, color: '#6b7280', margin: 0, lineHeight: 1.5 }}>{ins.detail}</p>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );

  return createPortal(content, document.body);
}
