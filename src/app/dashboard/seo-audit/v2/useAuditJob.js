"use client";
// Drives a v2 audit job: reads its state, then calls /advance one request at a time
// until the job is done or failed. Each advance runs one phase on the server.

import { useCallback, useEffect, useRef, useState } from "react";

const BASE = "/api/seo-audit/v2/jobs";
const FINISHED = new Set(["done", "failed"]);

// Readable message for a non-OK response from the v2 routes.
export function friendlyError(status, body = {}) {
  if (status === 401) return "Your session has expired. Sign in again and retry.";
  if (status === 404) return "This audit no longer exists. Start a new audit.";
  if (status === 429) {
    if (body.retryAfterSeconds) return `Too many audits started at once. Wait ${body.retryAfterSeconds}s and try again.`;
    return body.error || "Audit limit reached. Try again later.";
  }
  if (status === 400) return body.error || "Check the domain and try again.";
  return body.error ? `Something went wrong: ${body.error} (${status})` : `Something went wrong (${status}). Try again.`;
}

async function call(url, method) {
  let res;
  try {
    res = await fetch(url, { method, headers: { "Content-Type": "application/json" } });
  } catch {
    return { error: "Couldn't reach the server. Check your connection and retry." };
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return { error: friendlyError(res.status, body), status: res.status, body };
  return { body };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// minIntervalMs: when an advance returns quickly (another tab holds the running step),
// wait this long before the next call instead of hammering the server.
export function useAuditJob(jobId, { minIntervalMs = 3000 } = {}) {
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  const [runId, setRunId] = useState(0);
  const progressRef = useRef(null);
  const loadedJobRef = useRef(null);

  const update = (p) => {
    progressRef.current = p;
    setProgress(p);
  };

  useEffect(() => {
    if (!jobId) {
      loadedJobRef.current = null;
      return undefined;
    }
    let cancelled = false;
    setError(null);

    (async () => {
      const id = encodeURIComponent(jobId);
      if (loadedJobRef.current !== jobId) {
        progressRef.current = null;
        setProgress(null);
        const first = await call(`${BASE}/${id}`, "GET");
        if (cancelled) return;
        if (first.error) { setError(first.error); return; }
        loadedJobRef.current = jobId;
        update(first.body);
        if (FINISHED.has(first.body.status)) return;
      }
      while (!cancelled) {
        const started = Date.now();
        const res = await call(`${BASE}/${id}/advance`, "POST");
        if (cancelled) return;
        if (res.error) { setError(res.error); return; }
        update(res.body);
        if (FINISHED.has(res.body.status)) return;
        const wait = minIntervalMs - (Date.now() - started);
        if (wait > 0) await sleep(wait);
      }
    })();

    return () => { cancelled = true; };
  }, [jobId, runId, minIntervalMs]);

  // Failed job: reset it on the server first. Request error: just resume advancing.
  const retry = useCallback(async () => {
    setError(null);
    if (progressRef.current?.status === "failed") {
      const res = await call(`${BASE}/${encodeURIComponent(jobId)}/retry`, "POST");
      if (res.error && res.status !== 409) { setError(res.error); return; }
      // 409: the job was already reset (another tab); its progress comes back in the body.
      if (res.body?.steps) update(res.body);
    }
    setRunId((n) => n + 1);
  }, [jobId]);

  const result = progress?.status === "done" ? progress.result || null : null;
  return { progress, result, error, retry };
}
