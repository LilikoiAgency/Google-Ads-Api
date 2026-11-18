"use client";
// Fetches one TrafficReport per key (property|start|end|compare|granularity).
// - A module-level Map caches responses for the browser session.
// - A key change aborts the in-flight request, so a slow earlier response
//   can never overwrite a newer one.
import { useEffect, useState } from "react";

const reportCache = new Map();

export function makeReportKey({ property, startDate, endDate, compare, granularity }) {
  return [property, startDate, endDate, compare, granularity].join("|");
}

export async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error(body?.message || `Request failed (${res.status})`);
    err.code = body?.error || "ga_error";
    throw err;
  }
  return body;
}

// Returns { key, report, error, loading }. `key`/`report`/`error` describe the
// last settled request, which may be for an older key while `loading`.
export function useTrafficReport(fetchKey, retryNonce = 0) {
  const [result, setResult] = useState({ key: null, report: null, error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!fetchKey) return undefined;
    const cached = reportCache.get(fetchKey);
    if (cached) {
      setResult({ key: fetchKey, report: cached, error: null });
      setLoading(false);
      return undefined;
    }
    const ctrl = new AbortController();
    const [property, startDate, endDate, compare, granularity] = fetchKey.split("|");
    const qs = new URLSearchParams({ property, startDate, endDate, compare, granularity });
    setLoading(true);
    fetchJson(`/api/ga4/report?${qs.toString()}`, ctrl.signal)
      .then((report) => {
        reportCache.set(fetchKey, report);
        if (ctrl.signal.aborted) return;
        setResult({ key: fetchKey, report, error: null });
        setLoading(false);
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.name === "AbortError") return;
        setResult({ key: fetchKey, report: null, error: err });
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [fetchKey, retryNonce]);

  return { ...result, loading };
}

// Test hook only.
export function _clearReportCache() {
  reportCache.clear();
}
