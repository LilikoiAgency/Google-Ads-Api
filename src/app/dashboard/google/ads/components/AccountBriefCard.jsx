"use client";
import { useState, useEffect, useRef } from "react";

const DATE_BRIEF_OPTIONS = [
  { value: 'LAST_7_DAYS',  label: 'Last 7 days'  },
  { value: 'LAST_30_DAYS', label: 'Last 30 days' },
  { value: 'LAST_90_DAYS', label: 'Last 90 days' },
  { value: 'THIS_MONTH',   label: 'This month'   },
];

const accountBriefRequests = new Map();

function getAccountBriefCacheKey(customerId, dateLabel) {
  return `accountBrief:${customerId}:${dateLabel}:${new Date().toISOString().slice(0, 10)}`;
}

function safeSetItem(storage, key, value) {
  try { storage.setItem(key, value); } catch {}
}
function safeGetItem(storage, key) {
  try { return storage.getItem(key); } catch { return null; }
}

export default function AccountBriefCard({ selectedCustomer, currentDateRange }) {
  const [briefRange, setBriefRange] = useState(
    DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange) ? currentDateRange : 'LAST_30_DAYS'
  );
  const [state, setState] = useState({ status: 'idle', briefing: null, generatedAt: null, error: null, code: null });
  const [collapsed, setCollapsed] = useState(false);
  const fetchingRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; fetchingRef.current = false; };
  }, []);

  const customerId = String(selectedCustomer?.customer?.customer_client?.id || '');
  const customerName = selectedCustomer?.customer?.customer_client?.descriptive_name || '';
  const campaigns = selectedCustomer?.campaigns || [];
  const totalSpend = campaigns.reduce((sum, c) => sum + (c.cost || 0), 0) / 1_000_000;

  async function fetchBrief(rangeOverride = null) {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    const activeRange = rangeOverride ?? briefRange;
    const cacheKey = getAccountBriefCacheKey(customerId, activeRange);
    setState((s) => ({ ...s, status: 'loading', error: null }));
    try {
      const cached = safeGetItem(sessionStorage, cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (!mountedRef.current) return;
        setState({ status: 'done', briefing: parsed.briefing, generatedAt: parsed.generatedAt, error: null });
        setCollapsed(false);
        return;
      }

      let requestPromise = accountBriefRequests.get(cacheKey);
      if (!requestPromise) {
        requestPromise = fetch('/api/claude/account-brief', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ customerId, customerName, campaigns, dateLabel: activeRange }),
        }).then(async (res) => ({ res, json: await res.json() }));
        accountBriefRequests.set(cacheKey, requestPromise);
      }

      const { res, json } = await requestPromise;
      if (!mountedRef.current) return;
      if (json.skipped) {
        setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      } else if (!res.ok || json.error) {
        setState({ status: 'error', briefing: null, generatedAt: null, error: json.error || `Error ${res.status}`, code: json.code || null });
      } else {
        safeSetItem(sessionStorage, cacheKey, JSON.stringify({ briefing: json.briefing, generatedAt: json.generatedAt }));
        setState({ status: 'done', briefing: json.briefing, generatedAt: json.generatedAt, error: null });
        setCollapsed(false);
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setState({ status: 'error', briefing: null, generatedAt: null, error: err.message });
    } finally {
      fetchingRef.current = false;
      accountBriefRequests.delete(cacheKey);
    }
  }

  useEffect(() => {
    if (!customerId || totalSpend === 0) {
      setState({ status: 'no_spend', briefing: null, generatedAt: null, error: null });
      return;
    }
    fetchingRef.current = false;
    fetchBrief();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerId]);

  useEffect(() => {
    if (DATE_BRIEF_OPTIONS.some((o) => o.value === currentDateRange)) {
      setBriefRange(currentDateRange);
    }
  }, [currentDateRange]);

  if (totalSpend === 0 || state.status === 'no_spend') return null;

  const { status, briefing, generatedAt, error } = state;
  const genTime = generatedAt ? new Date(generatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <section style={{ margin: '0 0 22px 0', borderRadius: 18, border: '1px solid #dbe4ff', background: '#fff', overflow: 'hidden', boxShadow: '0 18px 45px rgba(15, 23, 42, 0.08)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderBottom: collapsed ? 'none' : '1px solid #e8eefc', background: 'linear-gradient(135deg, #eef4ff 0%, #ffffff 55%, #f8fbff 100%)', flexWrap: 'wrap' }}>
        <div style={{ width: 38, height: 38, borderRadius: 12, background: '#1d4ed8', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800 }}>AI</div>
        <div style={{ minWidth: 190 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 15, lineHeight: 1.2, fontWeight: 800, color: '#111827', margin: 0 }}>Google Ads briefing</h2>
            <span style={{ fontSize: 10, fontWeight: 800, color: '#1d4ed8', background: '#dbeafe', border: '1px solid #bfdbfe', borderRadius: 999, padding: '3px 8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Daily</span>
          </div>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: '#64748b', lineHeight: 1.4 }}>
            {genTime ? `Generated ${genTime}` : 'Runs once per user, account, range, and day.'}
          </p>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <select value={briefRange} onChange={(e) => { const r = e.target.value; setBriefRange(r); fetchBrief(r); }} disabled={status === 'loading'} style={{ fontSize: 12, border: '1px solid #cbd5e1', borderRadius: 10, padding: '7px 10px', background: '#fff', color: '#334155', minHeight: 34, outline: 'none' }}>
            {DATE_BRIEF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <button type="button" onClick={() => fetchBrief()} disabled={status === 'loading'} style={{ fontSize: 12, fontWeight: 800, color: '#fff', background: status === 'loading' ? '#93c5fd' : '#2563eb', border: 'none', borderRadius: 10, padding: '8px 12px', cursor: status === 'loading' ? 'not-allowed' : 'pointer', minHeight: 34, boxShadow: status === 'loading' ? 'none' : '0 8px 18px rgba(37,99,235,0.22)' }}>
            {status === 'loading' ? 'Checking...' : 'Refresh'}
          </button>
          <button type="button" onClick={() => setCollapsed((c) => !c)} style={{ fontSize: 12, fontWeight: 700, color: '#475569', background: '#fff', border: '1px solid #cbd5e1', borderRadius: 10, cursor: 'pointer', padding: '7px 11px', minHeight: 34 }}>
            {collapsed ? 'Show' : 'Hide'}
          </button>
        </div>
      </div>
      {!collapsed && (
        <div style={{ padding: 18 }}>
          {status === 'loading' && (
            <div style={{ display: 'grid', gap: 12 }}>
              <div style={{ height: 18, width: '58%', background: '#e5edff', borderRadius: 8, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                {[0, 1].map((i) => (
                  <div key={i} style={{ border: '1px solid #edf2f7', borderRadius: 14, padding: 14 }}>
                    <div style={{ height: 11, width: '34%', background: '#f1f5f9', borderRadius: 6, marginBottom: 12, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 13, width: '72%', background: '#eef2f7', borderRadius: 6, marginBottom: 8, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                    <div style={{ height: 11, width: '92%', background: '#f1f5f9', borderRadius: 6, animation: 'briefPulse 1.5s ease-in-out infinite' }} />
                  </div>
                ))}
              </div>
            </div>
          )}
          {status === 'error' && (
            <p style={{ fontSize: 13, color: '#64748b', margin: 0, background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: 12 }}>
              {state.code === 'NO_CREDITS' ? 'AI briefing is temporarily unavailable. Check back soon or contact your admin.' : error}
            </p>
          )}
          {status === 'done' && briefing && (
            <BriefingContent briefing={briefing} />
          )}
        </div>
      )}
    </section>
  );
}

function BriefingContent({ briefing }) {
  const hasTop = (briefing?.topPerformers || []).length > 0;
  const hasBottom = (briefing?.bottomPerformers || []).length > 0;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ borderRadius: 14, background: '#0f172a', color: '#fff', padding: '15px 16px', boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.08)' }}>
        <p style={{ fontSize: 11, fontWeight: 800, color: '#93c5fd', margin: '0 0 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Executive readout</p>
        <p style={{ fontSize: 15, lineHeight: 1.55, fontWeight: 700, color: '#f8fafc', margin: 0 }}>{briefing.headline}</p>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
        <div style={{ border: '1px solid #bbf7d0', background: '#f0fdf4', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#15803d', margin: 0 }}>Top performers</p>
            <span style={{ fontSize: 11, color: '#166534', background: '#dcfce7', borderRadius: 999, padding: '3px 8px', fontWeight: 700 }}>{hasTop ? briefing.topPerformers.length : 0}</span>
          </div>
          {(briefing.topPerformers || []).map((p, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #dcfce7', borderRadius: 12, padding: 12, marginBottom: i === briefing.topPerformers.length - 1 ? 0 : 10 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.3 }}>{p.name}</p>
              <p style={{ fontSize: 12, color: '#15803d', margin: '0 0 5px 0', fontWeight: 700, lineHeight: 1.4 }}>{p.metric}</p>
              <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}>{p.insight}</p>
            </div>
          ))}
        </div>
        <div style={{ border: '1px solid #fecaca', background: '#fff7ed', borderRadius: 14, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
            <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#b91c1c', margin: 0 }}>Needs attention</p>
            <span style={{ fontSize: 11, color: '#991b1b', background: '#fee2e2', borderRadius: 999, padding: '3px 8px', fontWeight: 700 }}>{hasBottom ? briefing.bottomPerformers.length : 0}</span>
          </div>
          {(briefing.bottomPerformers || []).map((p, i) => (
            <div key={i} style={{ background: '#fff', border: '1px solid #fed7aa', borderRadius: 12, padding: 12, marginBottom: i === briefing.bottomPerformers.length - 1 ? 0 : 10 }}>
              <p style={{ fontSize: 13, fontWeight: 800, color: '#111827', margin: '0 0 4px 0', lineHeight: 1.3 }}>{p.name}</p>
              <p style={{ fontSize: 12, color: '#dc2626', margin: '0 0 5px 0', fontWeight: 700, lineHeight: 1.4 }}>{p.issue}</p>
              <p style={{ fontSize: 12, color: '#475569', margin: 0, lineHeight: 1.5 }}><span style={{ fontWeight: 800, color: '#9a3412' }}>Recommended:</span> {p.recommendation}</p>
            </div>
          ))}
        </div>
      </div>
      {(briefing.actions || []).length > 0 && (
        <div style={{ border: '1px solid #e0e7ff', background: '#f8faff', borderRadius: 14, padding: 14 }}>
          <p style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#3730a3', margin: '0 0 10px' }}>Priority actions</p>
          {briefing.actions.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, marginBottom: i === briefing.actions.length - 1 ? 0 : 10 }}>
              <span style={{ width: 22, height: 22, borderRadius: 6, background: '#4f46e5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0 }}>{i + 1}</span>
              <p style={{ fontSize: 12, color: '#1e1b4b', margin: 0, lineHeight: 1.5, fontWeight: 600 }}>{a}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
