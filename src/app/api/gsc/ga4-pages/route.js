import { NextResponse } from "next/server";
import { google } from "googleapis";
import { getAllowedSession } from "@/lib/routeAuth";
import { getCached, setCached } from "@/lib/serverCache";
import { getGa4Auth, listProperties, listWebStreams } from "@/lib/ga4Client";
import { mapGa4Error } from "@/lib/ga4Errors";
import { getSiteSettings, isValidSite } from "@/lib/gscSettings";
import { matchProperty } from "@/lib/gscGa4Join";
import { isValidRange } from "@/lib/ga4Dates";

export const dynamic = "force-dynamic";

const PROPS_KEY = "ga4:properties";
const STREAMS_KEY = "ga4:streams:v1";
const HOUR = 60 * 60 * 1000;
const fail = (status, error, message) => NextResponse.json({ error, message }, { status });

async function cachedProperties() {
  let props = await getCached(PROPS_KEY);
  if (!props) {
    props = await listProperties();
    await setCached(PROPS_KEY, props, HOUR);
  }
  return props;
}

async function cachedStreams(props) {
  let streams = await getCached(STREAMS_KEY);
  if (!streams) {
    let failed = 0;
    streams = await listWebStreams(props, { onError: () => { failed += 1; } });
    // A partial list could match the wrong property: keep it only briefly.
    await setCached(STREAMS_KEY, streams, failed ? 5 * 60 * 1000 : 6 * HOUR);
  }
  return streams;
}

// GA4 organic (google / organic) landing-page sessions and key events for the
// property that belongs to a Search Console site.
export async function GET(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);
  const sp = new URL(request.url).searchParams;
  const site = sp.get("siteUrl") || "";
  const startDate = sp.get("startDate") || "";
  const endDate = sp.get("endDate") || "";
  if (!isValidSite(site)) return fail(400, "bad_params", "Invalid site");
  if (!isValidRange({ startDate, endDate })) return fail(400, "bad_params", "Invalid date range");

  try {
    const settings = await getSiteSettings(site);
    const props = await cachedProperties();
    let property = null;
    let matchedBy = null;
    if (settings.ga4Property) {
      const p = props.find((x) => x.id === settings.ga4Property);
      if (p) { property = p; matchedBy = "saved"; }
    }
    if (!property) {
      const m = matchProperty(site, await cachedStreams(props));
      if (m) { property = m; matchedBy = "stream"; }
    }
    if (!property) return NextResponse.json({ property: null, rows: [] });

    const key = `gsc:v1:ga4pages:${site}:${property.id}:${startDate}:${endDate}`;
    const cached = await getCached(key);
    if (cached) return NextResponse.json(cached);

    const data = google.analyticsdata({ version: "v1beta", auth: getGa4Auth() });
    const res = await data.properties.runReport({
      property: property.id,
      requestBody: {
        dateRanges: [{ startDate, endDate }],
        dimensions: [{ name: "landingPage" }],
        metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "keyEvents" }],
        dimensionFilter: { filter: { fieldName: "sessionSourceMedium", stringFilter: { matchType: "EXACT", value: "google / organic" } } },
        orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
        limit: 10000,
      },
    });
    const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
    const rows = (res.data.rows || []).map((r) => ({
      path: r.dimensionValues?.[0]?.value || "",
      sessions: num(r.metricValues?.[0]?.value),
      engagedSessions: num(r.metricValues?.[1]?.value),
      keyEvents: num(r.metricValues?.[2]?.value),
    }));
    const out = { property: { id: property.id, name: property.name }, matchedBy, rows };
    const recent = new Date(Date.now() - 2 * 24 * HOUR).toISOString().slice(0, 10);
    await setCached(key, out, endDate >= recent ? 30 * 60 * 1000 : 12 * HOUR);
    return NextResponse.json(out);
  } catch (err) {
    const { status, error, message } = mapGa4Error(err, "gsc/ga4-pages");
    return fail(status, error, message);
  }
}
