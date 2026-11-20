import { NextResponse } from "next/server";
import { getAllowedSession } from "@/lib/routeAuth";
import { getCached, setCached } from "@/lib/serverCache";
import { getSearchConsole, inspectUrls } from "@/lib/gscClient";
import { isValidSite } from "@/lib/gscSettings";
import { mapGscError } from "@/lib/gscErrors";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_URLS = 10;
const TTL = 24 * 60 * 60 * 1000;
const fail = (status, error, message) => NextResponse.json({ error, message }, { status });

// URL Inspection quota is ~2,000/day per site: results cache 24h per URL and
// the page only calls this on demand.
export async function POST(request) {
  const auth = await getAllowedSession();
  if (auth.error) return fail(401, "unauthorized", auth.error);
  let body;
  try { body = await request.json(); } catch { return fail(400, "bad_params", "Invalid JSON"); }
  const site = body?.siteUrl || "";
  const urls = Array.isArray(body?.urls) ? [...new Set(body.urls.map(String))] : [];
  const force = body?.refresh === true;
  if (!isValidSite(site)) return fail(400, "bad_params", "Invalid site");
  if (!urls.length || urls.length > MAX_URLS || urls.some((u) => !/^https?:\/\/\S+$/.test(u) || u.length > 2000)) {
    return fail(400, "bad_params", `Send 1-${MAX_URLS} page URLs`);
  }
  try {
    const sc = await getSearchConsole();
    if (!sc) return fail(401, "gsc_not_connected", "Search Console isn't connected");
    const keyOf = (u) => `gsc:v1:inspect:${site}:${u}`;
    const results = {};
    const todo = [];
    for (const u of urls) {
      const hit = force ? null : await getCached(keyOf(u));
      if (hit) results[u] = hit;
      else todo.push(u);
    }
    if (todo.length) {
      for (const r of await inspectUrls(sc, site, todo)) {
        results[r.url] = r;
        if (!r.error) await setCached(keyOf(r.url), r, TTL);
      }
    }
    return NextResponse.json({ results: urls.map((u) => results[u]) });
  } catch (err) {
    const { status, error, message } = mapGscError(err, "gsc/inspect");
    return fail(status, error, message);
  }
}
