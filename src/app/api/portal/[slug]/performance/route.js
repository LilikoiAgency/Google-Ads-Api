import { NextResponse } from "next/server";
import { validateClientAccess } from "../../../../../lib/clientPortal";
import { getCredentials } from "../../../../../lib/dbFunctions";
import { fetchAccessToken, submitReport, pollReport, downloadReport, normalizeDate, toDateParts } from "../../../../../lib/bingReporting";

export const dynamic    = "force-dynamic";
export const maxDuration = 60;

const GRAPH_BASE = "https://graph.facebook.com/v19.0";

// ── date helpers ───────────────────────────────────────────────────────────────

/** Return ISO Monday of the week containing `date` */
function weekStart(date) {
  const d   = new Date(date);
  const day = d.getUTCDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function fmt(d) { return new Date(d).toISOString().slice(0, 10); }

function weeksAgo(n) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n * 7);
  return fmt(d);
}

/** Build an array of weekly buckets (last N weeks, Monday–Sunday) */
function buildWeekBuckets(n) {
  const buckets = {};
  const today   = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const mon = new Date(today);
    mon.setUTCDate(today.getUTCDate() - today.getUTCDay() - (i * 7) + (today.getUTCDay() === 0 ? -6 : 1));
    const sun = new Date(mon);
    sun.setUTCDate(mon.getUTCDate() + 6);
    const key = fmt(mon);
    buckets[key] = {
      weekStart: fmt(mon), weekEnd: fmt(sun),
      spend: 0, conversions: 0, platforms: [],
      byPlatform: {
        google: { spend: 0, conversions: 0 },
        bing:   { spend: 0, conversions: 0 },
        meta:   { spend: 0, conversions: 0 },
      },
    };
  }
  return buckets;
}

// ── platform fetchers ──────────────────────────────────────────────────────────

/** Meta: fetch weekly spend+conversions for one account */
async function fetchMetaWeekly(accountId, token, since, until) {
  try {
    const CONVERSION_TYPES = ["purchase", "lead", "complete_registration", "offsite_conversion"];
    function sumActions(actions, ...keys) {
      if (!Array.isArray(actions)) return 0;
      return actions.filter((a) => keys.some((k) => (a.action_type || "").includes(k)))
        .reduce((s, a) => s + parseFloat(a.value || 0), 0);
    }

    const url = new URL(`${GRAPH_BASE}/act_${accountId.replace(/^act_/, "")}/insights`);
    url.searchParams.set("access_token", token);
    url.searchParams.set("fields",         "spend,actions,date_start,date_stop");
    url.searchParams.set("time_range",      JSON.stringify({ since, until }));
    url.searchParams.set("time_increment",  "1");
    url.searchParams.set("limit",           "365");

    const res  = await fetch(url.toString(), { cache: "no-store" });
    const json = await res.json();
    if (json.error) throw new Error(json.error.message);

    return (json.data || []).map((d) => ({
      date:        d.date_start,
      spend:       parseFloat(d.spend || 0),
      conversions: sumActions(d.actions, ...CONVERSION_TYPES),
    }));
  } catch (e) {
    console.warn(`[portal/performance] Meta ${accountId} error:`, e.message);
    return [];
  }
}

/** Google Ads: fetch daily spend+conversions for one customer */
async function fetchGoogleWeekly(customerId, creds, since, until) {
  try {
    const { GoogleAdsApi } = await import("google-ads-api");
    const client  = new GoogleAdsApi({
      client_id:     creds.client_id,
      client_secret: creds.client_secret,
      developer_token: creds.developer_token,
    });
    const customer = client.Customer({
      customer_id:   String(customerId).replace(/-/g, ""),
      refresh_token: creds.refresh_token,
    });

    const rows = await customer.query(`
      SELECT
        segments.date,
        metrics.cost_micros,
        metrics.conversions
      FROM campaign
      WHERE segments.date BETWEEN '${since}' AND '${until}'
        AND campaign.status != 'REMOVED'
      ORDER BY segments.date ASC
    `);

    const daily = {};
    for (const row of rows) {
      const date = row.segments?.date;
      if (!date) continue;
      if (!daily[date]) daily[date] = { date, spend: 0, conversions: 0 };
      daily[date].spend       += (row.metrics?.cost_micros || 0) / 1_000_000;
      daily[date].conversions += row.metrics?.conversions || 0;
    }
    return Object.values(daily);
  } catch (e) {
    console.warn(`[portal/performance] Google ${customerId} error:`, e.message);
    return [];
  }
}

/** Bing: fetch daily spend+conversions for one account */
async function fetchBingWeekly(accountId, customerId, since, until) {
  try {
    const range = {
      startParts: toDateParts(since),
      endParts:   toDateParts(until),
    };
    const COLUMNS = ["TimePeriod", "Spend", "Conversions"];
    const accessToken = await fetchAccessToken();
    const reportId    = await submitReport(accessToken, range, accountId, customerId, COLUMNS);
    const downloadUrl = await pollReport(accessToken, reportId, accountId, customerId);
    const rows        = await downloadReport(downloadUrl);

    // Aggregate by date
    const daily = {};
    for (const row of rows) {
      const date = normalizeDate(row["TimePeriod"] || row["Gregorian date"]);
      if (!date) continue;
      if (!daily[date]) daily[date] = { date, spend: 0, conversions: 0 };
      daily[date].spend       += Number(String(row["Spend"]       || "0").replace(/,/g, "")) || 0;
      daily[date].conversions += Number(String(row["Conversions"] || "0").replace(/,/g, "")) || 0;
    }
    return Object.values(daily);
  } catch (e) {
    console.warn(`[portal/performance] Bing ${accountId} error:`, e.message);
    return [];
  }
}

// ── main route ─────────────────────────────────────────────────────────────────

export async function GET(request, { params }) {
  const { slug }       = params;
  const { searchParams } = new URL(request.url);
  const token          = searchParams.get("token");
  const weeks          = Math.min(parseInt(searchParams.get("weeks") || "12", 10), 52);

  const client = await validateClientAccess(slug, token);
  if (!client) return NextResponse.json({ error: "Invalid or expired link." }, { status: 401 });

  const since = weeksAgo(weeks);
  const until = fmt(new Date());

  // Build empty weekly buckets
  const buckets = buildWeekBuckets(weeks);

  function addToBuckets(rows, platform) {
    for (const row of rows) {
      const ws = weekStart(row.date);
      if (buckets[ws]) {
        buckets[ws].spend       += row.spend;
        buckets[ws].conversions += row.conversions;
        buckets[ws].byPlatform[platform].spend       += row.spend;
        buckets[ws].byPlatform[platform].conversions += row.conversions;
        if (!buckets[ws].platforms.includes(platform)) {
          buckets[ws].platforms.push(platform);
        }
      }
    }
  }

  // Fetch credentials
  const creds = await getCredentials().catch(() => ({}));
  const metaToken = creds.meta_access_token || process.env.META_ACCESS_TOKEN;

  // Fetch all platforms in parallel — each account within a platform in parallel
  const { google: googleAccounts = [], bing: bingAccounts = [], meta: metaAccounts = [] } = client.adAccounts || {};

  const [googleRows, bingRows, metaRows] = await Promise.all([
    Promise.all(googleAccounts.map((a) => fetchGoogleWeekly(a.accountId, creds, since, until))).then((r) => r.flat()),
    Promise.all(bingAccounts.map((a)   => fetchBingWeekly(a.accountId, a.customerId || "", since, until))).then((r) => r.flat()),
    metaToken
      ? Promise.all(metaAccounts.map((a) => fetchMetaWeekly(a.accountId, metaToken, since, until))).then((r) => r.flat())
      : Promise.resolve([]),
  ]);

  addToBuckets(googleRows, "google");
  addToBuckets(bingRows,   "bing");
  addToBuckets(metaRows,   "meta");

  // Round spend
  const weekly = Object.values(buckets).map((b) => ({
    ...b,
    spend:       parseFloat(b.spend.toFixed(2)),
    cpl:         b.conversions > 0 ? parseFloat((b.spend / b.conversions).toFixed(2)) : null,
    byPlatform: {
      google: { spend: parseFloat(b.byPlatform.google.spend.toFixed(2)), conversions: b.byPlatform.google.conversions },
      bing:   { spend: parseFloat(b.byPlatform.bing.spend.toFixed(2)),   conversions: b.byPlatform.bing.conversions   },
      meta:   { spend: parseFloat(b.byPlatform.meta.spend.toFixed(2)),   conversions: b.byPlatform.meta.conversions   },
    },
  })).sort((a, b) => a.weekStart.localeCompare(b.weekStart));

  // Totals for current (most recent complete) week
  const current = weekly[weekly.length - 1] || {};

  return NextResponse.json({
    weekly,
    current,
    clientName: client.name,
    clientLogo: client.logo || null,
    connectedPlatforms: {
      google: googleAccounts.length > 0,
      bing:   bingAccounts.length   > 0,
      meta:   metaAccounts.length   > 0,
    },
  });
}
