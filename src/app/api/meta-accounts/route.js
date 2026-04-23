import { NextResponse } from "next/server";
import { getCredentials } from "../../../lib/dbFunctions";
import { apiCache } from "../../../lib/apiCache";

const ACCOUNTS_TTL = 30 * 60 * 1000; // 30 minutes

export const dynamic = "force-dynamic";
export const revalidate = 0;

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

const ACCOUNT_STATUS = {
  1:   "Active",
  2:   "Disabled",
  3:   "Unsettled",
  7:   "Pending Review",
  8:   "Pending Closure",
  9:   "In Grace Period",
  100: "Temporarily Unavailable",
  101: "Closed",
};

// Statuses to hide from the picker
const EXCLUDED_STATUSES = new Set([2, 3, 101]); // Disabled, Unsettled, Closed

// Priority clients — shown first in every account list (order matters)
const PRIORITY_KEYWORDS = ["semper solaris", "big bully turf", "cmk"];

function priorityIndex(name) {
  const lower = (name || "").toLowerCase();
  const idx = PRIORITY_KEYWORDS.findIndex((kw) => lower.includes(kw));
  return idx === -1 ? PRIORITY_KEYWORDS.length : idx;
}

// Follow Meta's pagination cursors to fetch ALL pages
async function fetchAllPages(firstUrl) {
  const all  = [];
  let nextUrl = firstUrl;

  while (nextUrl) {
    const res  = await fetch(nextUrl, { cache: "no-store" });
    const json = await res.json();

    if (json.error) throw new Error(json.error.message || "Meta API error");

    if (Array.isArray(json.data)) all.push(...json.data);

    // Meta returns paging.next when there are more pages
    nextUrl = json.paging?.next || null;
  }

  return all;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  // Pull token from MongoDB first, fall back to env var
  let token = process.env.META_ACCESS_TOKEN;
  try {
    const creds = await getCredentials();
    if (creds.meta_access_token) token = creds.meta_access_token;
  } catch {}

  if (!token) {
    return NextResponse.json({ error: "Meta access token not configured. Add META_ACCESS_TOKEN to the Tokens collection in MongoDB." }, { status: 500 });
  }

  // Pass ?debug=1 to see which accounts were filtered and why
  const debug = searchParams.get("debug") === "1";

  // Serve from cache unless debug mode requested
  if (!debug) {
    const cached = await apiCache.get('meta-accounts');
    if (cached) return NextResponse.json(cached);
  }

  try {
    const firstUrl = new URL(`${GRAPH_BASE}/me/adaccounts`);
    firstUrl.searchParams.set("fields", "id,name,currency,account_status,business");
    firstUrl.searchParams.set("limit", "200");
    firstUrl.searchParams.set("access_token", token);

    const raw = await fetchAllPages(firstUrl.toString());

    console.log(`[meta-accounts] Raw accounts from Meta: ${raw.length}`);

    const filtered = [];
    const excluded = [];

    for (const a of raw) {
      const entry = {
        accountId:  a.id.replace(/^act_/, ""),
        actId:      a.id,
        name:       a.name || `Account ${a.id}`,
        currency:   a.currency || "USD",
        status:     ACCOUNT_STATUS[a.account_status] || `Unknown (${a.account_status})`,
        statusCode: a.account_status,
        business:   a.business?.name || null,
      };
      filtered.push(entry);
    }

    // Sort: priority clients first, then active, then alphabetically
    filtered.sort((a, b) => {
      const pa = priorityIndex(a.name), pb = priorityIndex(b.name);
      if (pa !== pb) return pa - pb;
      if (a.statusCode === 1 && b.statusCode !== 1) return -1;
      if (a.statusCode !== 1 && b.statusCode === 1) return  1;
      return a.name.localeCompare(b.name);
    });

    console.log(`[meta-accounts] Showing ${filtered.length}, filtered out ${excluded.length} (disabled/unsettled/closed)`);
    if (excluded.length > 0) {
      console.log(`[meta-accounts] Excluded:`, excluded.map((a) => `${a.name} (${a.status})`).join(", "));
    }

    if (debug) {
      return NextResponse.json({ accounts: filtered, excluded, raw: raw.length });
    }

    const payload = { accounts: filtered };
    apiCache.setBackground('meta-accounts', payload, ACCOUNTS_TTL);
    return NextResponse.json(payload);

  } catch (err) {
    console.error("[meta-accounts] Error:", err.message);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
