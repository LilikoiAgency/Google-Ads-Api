import { NextResponse } from "next/server";
import { getAllowedSession } from "@/lib/routeAuth";
import { getCached, setCached } from "@/lib/serverCache";
import { listProperties, fetchTrafficReport } from "@/lib/ga4Client";
import { isValidRange } from "@/lib/ga4Dates";

export const dynamic = "force-dynamic";

const PROPS_KEY = "ga4:properties";
const PROPS_TTL = 60 * 60 * 1000;
const COMPARES = ["prev", "yoy", "none"];
const GRANULARITIES = ["day", "week", "month"];

const fail = (status, error, message) => NextResponse.json({ error, message }, { status });

export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);

  const sp = new URL(request.url).searchParams;
  const property = sp.get("property") || "";
  const startDate = sp.get("startDate") || "";
  const endDate = sp.get("endDate") || "";
  const compare = sp.get("compare") || "";
  const granularity = sp.get("granularity") || "";

  if (!/^properties\/\d+$/.test(property)) return fail(400, "bad_params", "Invalid property");
  if (!COMPARES.includes(compare)) return fail(400, "bad_params", "Invalid compare");
  if (!GRANULARITIES.includes(granularity)) return fail(400, "bad_params", "Invalid granularity");
  if (!isValidRange({ startDate, endDate })) return fail(400, "bad_params", "Invalid date range");

  try {
    let properties = await getCached(PROPS_KEY);
    let fresh = false;
    if (!properties) {
      properties = await listProperties();
      fresh = true;
      await setCached(PROPS_KEY, properties, PROPS_TTL);
    }
    let match = properties.find((p) => p.id === property);
    if (!match && !fresh) {
      properties = await listProperties();
      await setCached(PROPS_KEY, properties, PROPS_TTL);
      match = properties.find((p) => p.id === property);
    }
    if (!match) return fail(403, "no_access", "Property is not visible to the service account");

    const key = `ga4:v1:report:${property}:${startDate}:${endDate}:${compare}:${granularity}`;
    const cached = await getCached(key);
    if (cached) return NextResponse.json(cached);

    const report = await fetchTrafficReport({ property: match, startDate, endDate, compare, granularity });
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const ttl = endDate >= yesterday ? 15 * 60 * 1000 : 6 * 60 * 60 * 1000;
    await setCached(key, report, ttl);
    return NextResponse.json(report);
  } catch (err) {
    // Never return/log the whole error: GaxiosError carries a bearer token.
    const message = String(err?.message || "GA4 error");
    const code = err?.code;
    console.error("[ga4/report]", code, message);
    if (message.startsWith("GA4_SA_KEY")) return fail(500, "missing_key", message);
    if (code === 429 || code === 8 || err?.status === "RESOURCE_EXHAUSTED") return fail(429, "quota", message);
    if (code === 403) return fail(403, "no_access", message);
    return fail(502, "ga_error", message);
  }
}
