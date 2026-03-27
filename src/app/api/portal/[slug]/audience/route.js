import { NextResponse } from "next/server";
import { google } from "googleapis";
import { validateClientAccess } from "../../../../../lib/clientPortal";
import { getSegments } from "../../../../../lib/audienceLabSegments";

export const dynamic = "force-dynamic";

// ── BigQuery helpers ───────────────────────────────────────────────────────────

function getBigQueryAuth() {
  return new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key:  (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/bigquery"],
  });
}

async function runQuery(sql) {
  const auth      = getBigQueryAuth();
  const bigquery  = google.bigquery({ version: "v2", auth });
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const datasetId = process.env.BQ_DATASET_ID;

  // Replace dataset placeholder
  const finalSql = sql.replace(/\{dataset\}/g, `\`${projectId}.${datasetId}\``);

  // jobs.query runs synchronously — no insert/poll/getResults dance needed
  const res    = await bigquery.jobs.query({
    projectId,
    requestBody: {
      query:        finalSql,
      useLegacySql: false,
      timeoutMs:    30000,
      maxResults:   5000,
      ...(process.env.BQ_LOCATION ? { location: process.env.BQ_LOCATION } : {}),
    },
  });

  const schema = res.data.schema?.fields || [];
  const rows   = res.data.rows           || [];

  return rows.map((row) => {
    const obj = {};
    schema.forEach((field, i) => {
      obj[field.name] = row.f[i]?.v ?? null;
    });
    return obj;
  });
}

// ── main route ─────────────────────────────────────────────────────────────────

export async function GET(request, { params }) {
  const { slug }         = params;
  const { searchParams } = new URL(request.url);
  const token            = searchParams.get("token");
  const page             = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const period           = searchParams.get("period") || "latest"; // "latest" | "week" | "mtd"
  const pageSize         = 50;

  const client = await validateClientAccess(slug, token);
  if (!client) return NextResponse.json({ error: "Invalid or expired link." }, { status: 401 });

  const segmentKeys = client.audienceLabSegments || [];
  if (segmentKeys.length === 0) {
    return NextResponse.json({ total: 0, byState: [], records: [], lastUpdated: null, page, pageSize });
  }

  // Look up table IDs for the segment keys
  const allSegments = await getSegments();
  const segments    = allSegments.filter((s) => segmentKeys.includes(s.key) && s.tableId);

  if (segments.length === 0) {
    return NextResponse.json({ total: 0, byState: [], records: [], lastUpdated: null, page, pageSize });
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const datasetId = process.env.BQ_DATASET_ID;

  try {
    // Build UNION ALL — no date filter here, applied in outer query so the
    // cutoff date is consistent across all segments
    const tableParts = segments.map((s) =>
      `SELECT
        first_name, last_name, city, state, zip,
        DATE(date) AS sync_date,
        CAST(DATE(date) AS STRING) AS synced_at,
        '${s.key}' AS segment_key,
        '${s.name}' AS segment_name
       FROM \`${projectId}.${datasetId}.${s.tableId}\``
    );

    const unionSql = tableParts.join("\nUNION ALL\n");

    // Determine the date filter — always fall back to latest sync if period
    // returns no rows (e.g. sync ran last Monday, not yet this Monday)
    const periodWhere =
      period === "mtd"  ? `AND sync_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)`
      : period === "week" ? `AND sync_date >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))`
      : null; // null = latest only

    // Check whether the period filter has any data; if not, fall back to latest
    const latestWhere = `AND sync_date = (SELECT MAX(sync_date) FROM combined)`;

    let dateWhere = latestWhere; // default: latest sync
    if (periodWhere) {
      const checkRows = await runQuery(`
        WITH combined AS (${unionSql})
        SELECT COUNT(*) AS n FROM combined WHERE TRUE ${periodWhere}
      `);
      const hasRows = parseInt(checkRows[0]?.n || "0", 10) > 0;
      dateWhere = hasRows ? periodWhere : latestWhere;
    }

    // Get summary stats (count + state breakdown + last sync)
    const [summaryRows, detailRows] = await Promise.all([
      runQuery(`
        WITH combined AS (${unionSql})
        SELECT
          state,
          COUNT(*) AS count,
          MAX(synced_at) AS last_synced
        FROM combined
        WHERE state IS NOT NULL AND state != ''
          ${dateWhere}
        GROUP BY state
        ORDER BY count DESC
      `),
      runQuery(`
        WITH combined AS (${unionSql})
        SELECT
          first_name,
          last_name,
          city,
          state,
          zip,
          segment_name,
          synced_at
        FROM combined
        WHERE TRUE ${dateWhere}
        ORDER BY state, city, last_name
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `),
    ]);

    const total       = summaryRows.reduce((s, r) => s + parseInt(r.count || 0, 10), 0);
    const lastUpdated = summaryRows.reduce((max, r) => (r.last_synced > max ? r.last_synced : max), "");

    const byState = summaryRows.map((r) => ({
      state: r.state,
      count: parseInt(r.count || 0, 10),
    }));

    // Mask PII: show first name + last initial only, no email/phone
    const records = detailRows.map((r) => ({
      name:        `${r.first_name || ""} ${r.last_name ? r.last_name[0] + "." : ""}`.trim(),
      city:        r.city         || "",
      state:       r.state        || "",
      zip:         r.zip          || "",
      segment:     r.segment_name || "",
      syncedAt:    r.synced_at    || "",
    }));

    return NextResponse.json({ total, byState, records, lastUpdated, page, pageSize, totalPages: Math.ceil(total / pageSize), period });

  } catch (err) {
    console.error("[portal/audience] BigQuery error:", err.message);
    return NextResponse.json({ error: "Failed to load audience data.", detail: err.message }, { status: 500 });
  }
}
