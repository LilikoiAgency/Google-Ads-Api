"use client";
// Fetches one organic search report per key. Same rules as the GA4 hook:
// a module cache for the browser session, and a key change aborts the
// in-flight request so a slow earlier response never wins.
import { useEffect, useState } from "react";

const cache = new Map();

export function makeSearchKey({ site, startDate, endDate, compare, type, brandVersion = 0 }) {
  return JSON.stringify([site, startDate, endDate, compare, type, brandVersion]);
}

export async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const err = new Error(body?.message || `Request failed (${res.status})`);
    err.code = body?.error || "gsc_error";
    throw err;
  }
  return body;
}

export function useSearchReport(key, { refreshNonce = 0 } = {}) {
  const [result, setResult] = useState({ key: null, report: null, error: null });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!key) return undefined;
    const refresh = refreshNonce > 0 && result.key === key;
    if (!refresh && cache.has(key)) {
      setResult({ key, report: cache.get(key), error: null });
      setLoading(false);
      return undefined;
    }
    const [site, startDate, endDate, compare, type] = JSON.parse(key);
    const qs = new URLSearchParams({ siteUrl: site, startDate, endDate, compare, type });
    if (refresh) qs.set("refresh", "1");
    const ctrl = new AbortController();
    setLoading(true);
    fetchJson(`/api/gsc/report?${qs.toString()}`, { signal: ctrl.signal })
      .then((report) => {
        cache.set(key, report);
        if (ctrl.signal.aborted) return;
        setResult({ key, report, error: null });
        setLoading(false);
      })
      .catch((err) => {
        if (ctrl.signal.aborted || err?.name === "AbortError") return;
        setResult({ key, report: null, error: err });
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [key, refreshNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  return { ...result, loading };
}

export function _clearSearchCache() {
  cache.clear();
}
