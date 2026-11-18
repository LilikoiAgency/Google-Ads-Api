// Maps an error from the GA4 client (googleapis / gaxios) to an API response
// shape: { status, error, message }. Shared by the /api/ga4 routes.
// Never return or log the whole error: a GaxiosError carries the bearer token.

const httpStatusOf = (err) => {
  for (const v of [err?.code, err?.status, err?.response?.status]) {
    const n = Number(v);
    if (Number.isInteger(n) && n >= 100 && n < 600) return n;
  }
  return null;
};

export function mapGa4Error(err, tag = "ga4") {
  const message = String(err?.message || "GA4 error");
  const http = httpStatusOf(err);
  console.error(`[${tag}]`, http ?? err?.code, message);

  if (message.startsWith("GA4_SA_KEY")) return { status: 500, error: "missing_key", message };
  const quota = http === 429
    || err?.code === 8 // gRPC RESOURCE_EXHAUSTED
    || err?.response?.data?.error?.status === "RESOURCE_EXHAUSTED";
  if (quota) return { status: 429, error: "quota", message };
  if (http === 403) return { status: 403, error: "no_access", message };
  return { status: 502, error: "ga_error", message };
}
