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
  const segmentParam     = searchParams.get("segment") || "";      // comma-separated keys, empty = all
  const pageSize         = 50;

  const client = await validateClientAccess(slug, token);
  if (!client) return NextResponse.json({ error: "Invalid or expired link." }, { status: 401 });

  const segmentKeys = client.audienceLabSegments || [];
  if (segmentKeys.length === 0) {
    return NextResponse.json({ total: 0, byState: [], records: [], lastUpdated: null, page, pageSize });
  }

  // Look up table IDs for the segment keys
  const allSegments      = await getSegments();
  const clientSegments   = allSegments.filter((s) => segmentKeys.includes(s.key) && s.tableId);

  console.log("[portal/audience] client segmentKeys:", segmentKeys);
  console.log("[portal/audience] matched segments:", clientSegments.map((s) => ({ key: s.key, name: s.name, tableId: s.tableId })));
  console.log("[portal/audience] unmatched keys:", segmentKeys.filter((k) => !allSegments.find((s) => s.key === k)));

  if (clientSegments.length === 0) {
    return NextResponse.json({ total: 0, byState: [], records: [], lastUpdated: null, page, pageSize, availableSegments: [] });
  }

  // Filter to only the requested segment(s) — validate keys against client's allowed list
  const requestedKeys = segmentParam
    ? segmentParam.split(",").map((k) => k.trim()).filter((k) => segmentKeys.includes(k))
    : [];
  const segments = requestedKeys.length > 0
    ? clientSegments.filter((s) => requestedKeys.includes(s.key))
    : clientSegments;

  const availableSegments = clientSegments.map((s) => ({ key: s.key, name: s.name }));

  if (segments.length === 0) {
    return NextResponse.json({ total: 0, byState: [], records: [], lastUpdated: null, page, pageSize, availableSegments });
  }

  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const datasetId = process.env.BQ_DATASET_ID;

  try {
    // "Latest" UNION — each table pre-filtered to its own MAX date so every
    // segment contributes its most recent sync even if they ran on different weeks
    const latestTableParts = segments.map((s) =>
      `SELECT
        first_name, last_name, city, state, zip,
        DATE(date) AS sync_date,
        CAST(DATE(date) AS STRING) AS synced_at,
        '${s.key}' AS segment_key,
        '${s.name}' AS segment_name
       FROM \`${projectId}.${datasetId}.${s.tableId}\`
       WHERE DATE(date) = (SELECT MAX(DATE(date)) FROM \`${projectId}.${datasetId}.${s.tableId}\`)`
    );
    const latestUnionSql = latestTableParts.join("\nUNION ALL\n");

    // "Period" UNION — no per-table date filter; outer WHERE applies the cutoff
    const periodTableParts = segments.map((s) =>
      `SELECT
        first_name, last_name, city, state, zip,
        DATE(date) AS sync_date,
        CAST(DATE(date) AS STRING) AS synced_at,
        '${s.key}' AS segment_key,
        '${s.name}' AS segment_name
       FROM \`${projectId}.${datasetId}.${s.tableId}\``
    );
    const periodUnionSql = periodTableParts.join("\nUNION ALL\n");

    // Choose which union + where to use
    const periodWhere =
      period === "mtd"  ? `WHERE sync_date >= DATE_TRUNC(CURRENT_DATE(), MONTH)`
      : period === "week" ? `WHERE sync_date >= DATE_TRUNC(CURRENT_DATE(), WEEK(MONDAY))`
      : null;

    let unionSql  = latestUnionSql;
    let outerWhere = ""; // latestUnionSql already pre-filtered per segment

    if (periodWhere) {
      // Check if the period has any rows across all segments
      const checkRows = await runQuery(`
        WITH combined AS (${periodUnionSql})
        SELECT COUNT(*) AS n FROM combined ${periodWhere}
      `);
      const hasRows = parseInt(checkRows[0]?.n || "0", 10) > 0;
      if (hasRows) {
        unionSql   = periodUnionSql;
        outerWhere = periodWhere;
      }
      // else fall back to latestUnionSql with no outerWhere
    }

    // Get total count, state breakdown, and detail records in parallel
    const [totalRows, summaryRows, detailRows] = await Promise.all([
      // Total count — no state filter so everyone is counted
      runQuery(`
        WITH combined AS (${unionSql})
        SELECT COUNT(*) AS total, MAX(synced_at) AS last_synced
        FROM combined ${outerWhere}
      `),
      // State breakdown — only rows that have a state value
      runQuery(`
        WITH combined AS (${unionSql})
        SELECT state, COUNT(*) AS count
        FROM combined
        ${outerWhere ? outerWhere + " AND state IS NOT NULL AND state != ''" : "WHERE state IS NOT NULL AND state != ''"}
        GROUP BY state
        ORDER BY count DESC
      `),
      runQuery(`
        WITH combined AS (${unionSql})
        SELECT
          first_name, last_name, city, state, zip,
          segment_name, synced_at
        FROM combined ${outerWhere}
        ORDER BY state, city, last_name
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
      `),
    ]);

    console.log("[portal/audience] totalRows raw:", JSON.stringify(totalRows));
    console.log("[portal/audience] detailRows count:", detailRows.length);
    const total       = parseInt(totalRows[0]?.total || "0", 10);
    const lastUpdated = totalRows[0]?.last_synced || "";

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

    return NextResponse.json({ total, byState, records, lastUpdated, page, pageSize, totalPages: Math.ceil(total / pageSize), period, availableSegments });

  } catch (err) {
    console.error("[portal/audience] BigQuery error:", err.message);
    return NextResponse.json({ error: "Failed to load audience data.", detail: err.message }, { status: 500 });
  }
}
