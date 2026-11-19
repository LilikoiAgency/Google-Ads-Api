// PageSpeed Insights v5 (mobile, performance only): lab score and Core Web
// Vitals, plus real-user (CrUX) field data when Google has it. Runs keyless
// unless PAGESPEED_API_KEY is set. Never throws: status ok | timeout | error.

const ENDPOINT = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed';

const roundOrNull = (n, d = 0) => (Number.isFinite(n) ? Math.round(n * 10 ** d) / 10 ** d : null);

export function mapPageSpeed(apiJson) {
  const lh = apiJson?.lighthouseResult || {};
  const audits = lh.audits || {};
  const perf = lh.categories?.performance?.score;
  const inpAudit = audits['interaction-to-next-paint'] || audits['experimental-interaction-to-next-paint'];
  const m = apiJson?.loadingExperience?.metrics;
  const pct = (k) => m?.[k]?.percentile;
  const field = m && Object.keys(m).length
    ? {
      lcp_ms: roundOrNull(pct('LARGEST_CONTENTFUL_PAINT_MS')),
      inp_ms: roundOrNull(pct('INTERACTION_TO_NEXT_PAINT')),
      cls: Number.isFinite(pct('CUMULATIVE_LAYOUT_SHIFT_SCORE')) ? roundOrNull(pct('CUMULATIVE_LAYOUT_SHIFT_SCORE') / 100, 3) : null,
      origin_fallback: !!apiJson.loadingExperience.origin_fallback,
    }
    : null;
  return {
    score: Number.isFinite(perf) ? Math.round(perf * 100) : null,
    lcp_ms: roundOrNull(audits['largest-contentful-paint']?.numericValue),
    inp_ms: roundOrNull(inpAudit?.numericValue),
    cls: roundOrNull(audits['cumulative-layout-shift']?.numericValue, 3),
    field,
  };
}

const empty = { score: null, lcp_ms: null, inp_ms: null, cls: null, field: null };

export async function fetchPageSpeed(url, { apiKey = process.env.PAGESPEED_API_KEY, timeoutMs = 60000 } = {}) {
  const qs = new URLSearchParams({ url, strategy: 'mobile', category: 'performance' });
  if (apiKey) qs.set('key', apiKey);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT}?${qs}`, { signal: controller.signal });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error?.message || ''; } catch { /* body not JSON */ }
      return { status: 'error', url, ...empty, error: `PageSpeed HTTP ${res.status}${detail ? `: ${detail}` : ''}` };
    }
    return { status: 'ok', url, ...mapPageSpeed(await res.json()) };
  } catch (err) {
    if (err?.name === 'AbortError' || controller.signal.aborted) return { status: 'timeout', url, ...empty };
    return { status: 'error', url, ...empty, error: err?.message || String(err) };
  } finally {
    clearTimeout(timer);
  }
}
