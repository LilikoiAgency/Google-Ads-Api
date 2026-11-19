import { NextResponse } from "next/server";
import { getAllowedSession } from "../../../../../lib/routeAuth";
import { searchPlaces, matchesDomain, PlacesError } from "../../../../../lib/seoAuditV2/places";
import { getSavedLocations } from "../../../../../lib/seoAuditV2/reputationStore";

export const dynamic = "force-dynamic";

const MAX_FOUND = 10;
const HOST_RE = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

function normalizeDomain(raw) {
  return String(raw || "").trim().toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split(/[/?#]/)[0]
    .replace(/:\d+$/, "")
    .replace(/^www\./, "");
}

// The homepage brand: og:site_name, else the <title> text before a separator.
async function homepageBrand(domain) {
  try {
    const res = await fetch(`https://${domain}/`, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 200000);
    const og = html.match(/<meta[^>]+property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:site_name["']/i);
    const raw = og?.[1] || html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || "";
    const brand = raw.split(/\s+[|\u2014-]\s+/)[0].replace(/\s+/g, " ").trim();
    return brand || null;
  } catch {
    return null;
  }
}

/**
 * GET /api/seo-audit/v2/locations?domain=acme.com
 * Returns { saved, found, status }: saved picks for the domain and Places
 * listings whose website matches it. status: 'ok' | 'not_connected' | 'error'.
 */
export async function GET(request) {
  const { error, status } = await getAllowedSession();
  if (error) return NextResponse.json({ error }, { status });

  const domain = normalizeDomain(new URL(request.url).searchParams.get("domain"));
  if (!domain || !HOST_RE.test(domain)) {
    return NextResponse.json({ error: "Enter a valid domain" }, { status: 400 });
  }

  const saved = await getSavedLocations(domain).catch((err) => {
    console.error("[seo-audit/v2/locations] saved picks failed:", err?.message);
    return null;
  });

  const label = domain.split(".")[0];
  const queries = new Set([label]);
  if (label.includes("-")) queries.add(label.split("-").filter(Boolean).join(" "));
  const brand = await homepageBrand(domain);
  if (brand) queries.add(brand);

  try {
    const results = await Promise.all([...queries].map((q) => searchPlaces(q)));
    const seen = new Set();
    const found = [];
    for (const place of results.flat()) {
      if (seen.has(place.id) || !matchesDomain(place.website, domain)) continue;
      seen.add(place.id);
      found.push(place);
    }
    return NextResponse.json({ saved, found: found.slice(0, MAX_FOUND), status: "ok" });
  } catch (err) {
    if (err instanceof PlacesError && err.code === "not_connected") {
      return NextResponse.json({ saved, found: [], status: "not_connected" });
    }
    console.error("[seo-audit/v2/locations] search failed:", err?.message);
    return NextResponse.json({ saved, found: [], status: "error" });
  }
}
