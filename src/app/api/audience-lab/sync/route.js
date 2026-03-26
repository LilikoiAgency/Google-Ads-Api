import { google } from "googleapis";
import { getSegmentBySlot, updateSyncStatus, writeSyncLog, seedFromEnvIfEmpty } from "../../../../lib/audienceLabSegments";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const DEFAULT_BASE_URL = "https://api.audiencelab.io";
const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_TEST_ROW_LIMIT = 10;
const MAX_PAGE_SIZE = 500;
const MAX_TEST_ROW_LIMIT = 100;
const MIN_FALLBACK_PAGE_SIZE = 100;
const BIGQUERY_INSERT_BATCH_SIZE = 500;
const AUDIENCE_LAB_MAX_FETCH_ATTEMPTS = 8;
const AUDIENCE_LAB_RETRY_DELAY_MS = 1000;
const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const REQUIRED_ENV_VARS = [
  "AUDIENCE_LAB_API_KEY",
  "GOOGLE_CLOUD_PROJECT_ID",
  "BQ_DATASET_ID",
  "GOOGLE_SERVICE_ACCOUNT_EMAIL",
  "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY",
];

const SEGMENT_TABLE_CONFIG = [
  {
    key: "bbt_turf",
    tableId: "bbt_interested_turf_segment",
    envVar: "AUDIENCE_LAB_BBT_TURF_SEGMENT_ID",
    queryParam: "bbtTurfSegmentId",
  },
  {
    key: "cmk_kitchen_bath",
    tableId: "cmk_interested_kitchen_bath_remodel_segment",
    envVar: "AUDIENCE_LAB_CMK_KITCHEN_BATH_SEGMENT_ID",
    queryParam: "cmkKitchenBathSegmentId",
  },
  {
    key: "smp_roofing",
    tableId: "smp_interested_roofing_segment",
    envVar: "AUDIENCE_LAB_SMP_ROOFING_SEGMENT_ID",
    queryParam: "smpRoofingSegmentId",
  },
  {
    key: "smp_solar",
    tableId: "smp_interested_solar_segment",
    envVar: "AUDIENCE_LAB_SMP_SOLAR_SEGMENT_ID",
    queryParam: "smpSolarSegmentId",
  },
  {
    key: "smp_windows_sd_sf",
    tableId: "smp_interested_windows_sd_sf_segment",
    envVar: "AUDIENCE_LAB_SMP_WINDOWS_SD_SF_SEGMENT_ID",
    queryParam: "smpWindowsSdSfSegmentId",
  },
  {
    key: "cmk_kitchen_bath_sar",
    tableId: "cmk_interested_kitchen_bath_remodel_sar_segment",
    envVar: "AUDIENCE_LAB_CMK_KITCHEN_BATH_SAR_SEGMENT_ID",
    queryParam: "cmkKitchenBathSarSegmentId",
  },
  {
    key: "ranger_electric",
    tableId: "ranger_interested_electric_segment",
    envVar: "AUDIENCE_LAB_RANGER_ELECTRIC_SEGMENT_ID",
    queryParam: "rangerElectricSegmentId",
  },
];

const TARGET_ALIASES = {
  bbt: "bbt_turf",
  cmk: "cmk_kitchen_bath",
  smp: "smp_roofing",
  smp_windows: "smp_windows_sd_sf",
};

const TABLE_SCHEMA_FIELDS = [
  { name: "date", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "segment_name", type: "STRING", mode: "NULLABLE" },
  { name: "first_name", type: "STRING", mode: "NULLABLE" },
  { name: "last_name", type: "STRING", mode: "NULLABLE" },
  { name: "email", type: "STRING", mode: "NULLABLE" },
  { name: "phone", type: "STRING", mode: "NULLABLE" },
  { name: "address", type: "STRING", mode: "NULLABLE" },
  { name: "city", type: "STRING", mode: "NULLABLE" },
  { name: "state", type: "STRING", mode: "NULLABLE" },
  { name: "zip", type: "STRING", mode: "NULLABLE" },
  { name: "country", type: "STRING", mode: "NULLABLE" },
];

function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function generateRunId() {
  return `al_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function shouldIncludeLogs(searchParams) {
  const value = (searchParams.get("include_logs") || "").toLowerCase();
  return value === "1" || value === "true" || value === "yes";
}

function toLogEntry(level, runId, step, details = {}) {
  return {
    ts: new Date().toISOString(),
    level,
    runId,
    step,
    details,
  };
}

function logInfo(logState, step, details = {}) {
  const entry = toLogEntry("info", logState.runId, step, details);
  logState.entries.push(entry);
  console.log("[audience-lab-sync]", JSON.stringify(entry));
}

function logError(logState, step, details = {}) {
  const entry = toLogEntry("error", logState.runId, step, details);
  logState.entries.push(entry);
  console.error("[audience-lab-sync]", JSON.stringify(entry));
}

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function isSyncApiKeyValid(request) {
  const expectedKey = process.env.AUDIENCE_LAB_SYNC_API_KEY;
  if (!expectedKey) return true;

  const headerKey = request.headers.get("x-api-key");
  if (headerKey && headerKey === expectedKey) return true;

  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  return Boolean(bearerToken && bearerToken === expectedKey);
}

function getMissingEnvVars() {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function toPositiveInt(value, fallback, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function toNonNegativeInt(value, fallback = 0, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function isWriteEnabledByEnv() {
  return String(process.env.AUDIENCE_LAB_BQ_WRITE_ENABLED || "").toLowerCase() === "true";
}

function buildAudienceLabHeaders() {
  const apiKey = process.env.AUDIENCE_LAB_API_KEY;
  const apiKeyHeader = process.env.AUDIENCE_LAB_API_KEY_HEADER || "X-Api-Key";
  return {
    Accept: "application/json",
    [apiKeyHeader]: apiKey,
  };
}

function getAudienceLabBaseUrl() {
  return trimTrailingSlash(process.env.AUDIENCE_LAB_BASE_URL || DEFAULT_BASE_URL);
}

async function parseResponseBody(response) {
  const rawText = await response.text();
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
}

function isRetriableAudienceLabStatus(status) {
  return status === 429 || status >= 500;
}

async function fetchAudienceLabJson(url, headers, logRetry) {
  let lastError = null;

  for (let attempt = 1; attempt <= AUDIENCE_LAB_MAX_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "GET",
        headers,
        cache: "no-store",
      });

      const body = await parseResponseBody(response);

      if (!response.ok) {
        const errorDetails = {
          endpoint: url,
          status: response.status,
          response: body,
          attempt,
        };

        if (
          attempt < AUDIENCE_LAB_MAX_FETCH_ATTEMPTS &&
          isRetriableAudienceLabStatus(response.status)
        ) {
          if (logRetry) {
            logRetry({
              attempt,
              maxAttempts: AUDIENCE_LAB_MAX_FETCH_ATTEMPTS,
              retryable: true,
              ...errorDetails,
            });
          }
          await sleep(AUDIENCE_LAB_RETRY_DELAY_MS * attempt);
          continue;
        }

        throw new Error(JSON.stringify(errorDetails));
      }

      return body;
    } catch (error) {
      lastError = error;

      if (attempt < AUDIENCE_LAB_MAX_FETCH_ATTEMPTS) {
        if (logRetry) {
          logRetry({
            attempt,
            maxAttempts: AUDIENCE_LAB_MAX_FETCH_ATTEMPTS,
            retryable: true,
            details: safeErrorDetails(error),
          });
        }
        await sleep(AUDIENCE_LAB_RETRY_DELAY_MS * attempt);
        continue;
      }
    }
  }

  throw lastError;
}

function splitFirstValue(value) {
  if (value === undefined || value === null) return null;
  const first = String(value)
    .split(",")
    .map((v) => v.trim())
    .find(Boolean);
  return first || null;
}

function normalizePrivateKey(value) {
  let key = String(value || "").trim();

  if (key.startsWith('"') && key.endsWith('"')) {
    key = key.slice(1, -1);
  }

  return key.replace(/\\n/g, "\n");
}

function isNotFoundError(error) {
  const status = error?.code || error?.response?.status;
  return status === 404;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getBigQueryClient() {
  const auth = new google.auth.JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: normalizePrivateKey(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY),
    scopes: ["https://www.googleapis.com/auth/bigquery"],
  });

  return google.bigquery({
    version: "v2",
    auth,
  });
}

async function waitForTableReady(
  bigquery,
  projectId,
  datasetId,
  tableId,
  maxAttempts = 8,
  delayMs = 1500
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await bigquery.tables.get({
        projectId,
        datasetId,
        tableId,
      });
      return { ready: true, attempts: attempt };
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }

      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }

  return { ready: false, attempts: maxAttempts };
}

async function ensureTableExists(bigquery, projectId, datasetId, tableId) {
  try {
    const table = await bigquery.tables.get({
      projectId,
      datasetId,
      tableId,
    });
    const existingFields = table?.data?.schema?.fields || [];
    const existingFieldNames = new Set(existingFields.map((field) => field.name));
    const missingFields = TABLE_SCHEMA_FIELDS.filter(
      (field) => !existingFieldNames.has(field.name)
    );

    if (missingFields.length) {
      await bigquery.tables.patch({
        projectId,
        datasetId,
        tableId,
        requestBody: {
          schema: {
            fields: [...existingFields, ...missingFields],
          },
        },
      });
    }

    return { created: false, addedColumns: missingFields.map((field) => field.name) };
  } catch (error) {
    if (!isNotFoundError(error)) throw error;

    await bigquery.tables.insert({
      projectId,
      datasetId,
      requestBody: {
        tableReference: {
          projectId,
          datasetId,
          tableId,
        },
        schema: {
          fields: TABLE_SCHEMA_FIELDS,
        },
      },
    });

    const readyCheck = await waitForTableReady(bigquery, projectId, datasetId, tableId);
    if (!readyCheck.ready) {
      throw new Error(
        `Table ${projectId}:${datasetId}.${tableId} creation did not become readable after ${readyCheck.attempts} attempts.`
      );
    }

    return { created: true, readyAttempts: readyCheck.attempts, addedColumns: [] };
  }
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function toBigQueryRow(rawRow, segmentName, batchTimestamp) {
  return {
    date: batchTimestamp,
    segment_name: segmentName || null,
    first_name: rawRow?.FIRST_NAME || null,
    last_name: rawRow?.LAST_NAME || null,
    email: splitFirstValue(
      rawRow?.PERSONAL_VERIFIED_EMAILS ||
        rawRow?.PERSONAL_EMAILS ||
        rawRow?.BUSINESS_VERIFIED_EMAILS ||
        rawRow?.BUSINESS_EMAIL
    ),
    phone: splitFirstValue(
      rawRow?.PERSONAL_PHONE ||
        rawRow?.MOBILE_PHONE ||
        rawRow?.DIRECT_NUMBER ||
        rawRow?.VALID_PHONES
    ),
    address: rawRow?.PERSONAL_ADDRESS || null,
    city: rawRow?.PERSONAL_CITY || null,
    state: rawRow?.PERSONAL_STATE || null,
    zip: splitFirstValue(rawRow?.PERSONAL_ZIP || rawRow?.SKIPTRACE_ZIP) || null,
    country: "US",
  };
}

function normalizeInsertErrors(insertErrors) {
  if (!insertErrors) return [];
  if (Array.isArray(insertErrors)) return insertErrors;
  if (typeof insertErrors === "object") return Object.values(insertErrors);
  return [];
}

async function insertRows(bigquery, projectId, datasetId, tableId, rows) {
  if (!rows.length) return { inserted: 0 };

  let inserted = 0;
  const rowChunks = chunkArray(rows, BIGQUERY_INSERT_BATCH_SIZE);

  for (const chunk of rowChunks) {
    let chunkInserted = false;

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const response = await bigquery.tabledata.insertAll({
          projectId,
          datasetId,
          tableId,
          requestBody: {
            skipInvalidRows: false,
            ignoreUnknownValues: true,
            rows: chunk.map((row) => ({ json: row })),
          },
        });

        const insertErrors = normalizeInsertErrors(response?.data?.insertErrors);
        if (insertErrors.length) {
          const sample = insertErrors.slice(0, 3);
          throw new Error(
            `BigQuery insertAll returned ${insertErrors.length} row error(s) for ${tableId}. Sample: ${JSON.stringify(sample)}`
          );
        }

        inserted += chunk.length;
        chunkInserted = true;
        break;
      } catch (error) {
        const message = String(error?.message || "");
        const isNotFoundMessage =
          message.includes(" not found") ||
          message.toLowerCase().includes("not found.");

        if (attempt < 3 && isNotFoundMessage) {
          await sleep(1500);
          continue;
        }

        throw error;
      }
    }

    if (!chunkInserted) {
      throw new Error(`Failed to insert chunk for ${tableId}.`);
    }
  }

  return { inserted };
}

async function queryBatchRowCount(bigquery, projectId, datasetId, tableId, batchTimestamp) {
  const query = `
    SELECT COUNT(*) AS total_rows
    FROM \`${projectId}.${datasetId}.${tableId}\`
    WHERE date = TIMESTAMP(@batch_ts)
  `;

  const response = await bigquery.jobs.query({
    projectId,
    requestBody: {
      useLegacySql: false,
      parameterMode: "NAMED",
      query,
      queryParameters: [
        {
          name: "batch_ts",
          parameterType: { type: "TIMESTAMP" },
          parameterValue: { value: batchTimestamp },
        },
      ],
    },
  });

  const rowValue = response?.data?.rows?.[0]?.f?.[0]?.v;
  return Number(rowValue || 0);
}

async function verifyBatchRowCountWithRetry({
  bigquery,
  projectId,
  datasetId,
  tableId,
  batchTimestamp,
  expectedRows,
  maxAttempts = 5,
  delayMs = 2000,
}) {
  let observedRows = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    observedRows = await queryBatchRowCount(
      bigquery,
      projectId,
      datasetId,
      tableId,
      batchTimestamp
    );

    if (observedRows >= expectedRows) {
      return {
        matched: true,
        attempts: attempt,
        observedRows,
      };
    }

    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return {
    matched: false,
    attempts: maxAttempts,
    observedRows,
  };
}

function resolveTargets(searchParams) {
  return SEGMENT_TABLE_CONFIG.map((cfg) => {
    const legacyQueryParam =
      cfg.key === "bbt_turf"
        ? "bbtSegmentId"
        : cfg.key === "cmk_kitchen_bath"
          ? "cmkSegmentId"
          : cfg.key === "smp_roofing"
            ? "smpSegmentId"
            : null;
    const segmentId =
      searchParams.get(cfg.queryParam) ||
      (legacyQueryParam ? searchParams.get(legacyQueryParam) : null) ||
      process.env[cfg.envVar] ||
      null;
    return {
      key: cfg.key,
      tableId: cfg.tableId,
      segmentId,
      source: segmentId ? (searchParams.get(cfg.queryParam) ? "query" : "env") : null,
    };
  });
}

function resolveRequestedTarget(searchParams) {
  const raw = (searchParams.get("target") || "all").toLowerCase();
  if (raw === "all") return raw;
  const mapped = TARGET_ALIASES[raw] || raw;
  const allowed = new Set(SEGMENT_TABLE_CONFIG.map((cfg) => cfg.key));
  if (!allowed.has(mapped)) return null;
  return mapped;
}

function summarizeDryRunPayload(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const first = rows[0] || null;
  return {
    segmentId: payload?.segment_id || null,
    segmentName: payload?.segment_name || null,
    page: payload?.page ?? null,
    pageSize: payload?.page_size ?? null,
    totalPages: payload?.total_pages ?? null,
    totalRecords: payload?.total_records ?? null,
    hasMore: payload?.has_more ?? null,
    previewRowCount: rows.length,
    previewFields: first ? Object.keys(first) : [],
  };
}

function buildFallbackPageSizes(initialPageSize) {
  const sizes = [initialPageSize];

  if (initialPageSize > 250) {
    sizes.push(250);
  }

  if (initialPageSize > MIN_FALLBACK_PAGE_SIZE) {
    sizes.push(MIN_FALLBACK_PAGE_SIZE);
  }

  return [...new Set(sizes)];
}

function buildSyncFailureError(error, partialResult, extraDetails = {}) {
  const message = String(error?.message || "Audience Lab sync failed.");
  const wrappedError = new Error(message);
  wrappedError.partialResult = partialResult;
  wrappedError.syncDetails = {
    ...extraDetails,
    details: safeErrorDetails(error),
  };
  return wrappedError;
}

function safeErrorDetails(error) {
  if (error?.syncDetails) {
    return error.syncDetails;
  }

  try {
    return JSON.parse(error.message);
  } catch {
    return error.message;
  }
}

function extractStatusCode(error) {
  const details = safeErrorDetails(error);
  if (typeof details === "object" && details !== null) {
    return (
      details.status ||
      details?.details?.status ||
      error?.code ||
      error?.response?.status ||
      null
    );
  }

  return error?.code || error?.response?.status || null;
}

async function syncSingleTarget({
  target,
  baseUrl,
  headers,
  pageSize,
  startOffset,
  writeEnabled,
  maxPages,
  includePreviewRows,
  previewRowLimit,
  batchTimestamp,
  bigquery,
  projectId,
  datasetId,
  logState,
}) {
  const result = {
    tableId: target.tableId,
    segmentId: target.segmentId,
    segmentName: null,
    tableCreated: false,
    pagesFetched: 0,
    sourceRecords: 0,
    rowsPrepared: 0,
    rowsInserted: 0,
    rowsInTableForBatch: null,
    batchCountMatched: null,
    preview: null,
    testRows: [],
    startOffset,
    nextOffset: startOffset,
    initialPageSize: pageSize,
    activePageSize: pageSize,
  };

  if (!target.segmentId) {
    result.skipped = true;
    result.reason = "Missing segment ID";
    return result;
  }

  if (writeEnabled) {
    const tableResult = await ensureTableExists(
      bigquery,
      projectId,
      datasetId,
      target.tableId
    );
    result.tableCreated = tableResult.created;
    logInfo(logState, "target.table.ready", {
      target: target.key,
      tableId: target.tableId,
      tableCreated: tableResult.created,
      addedColumns: tableResult.addedColumns || [],
      readyAttempts: tableResult.readyAttempts || 1,
    });
  }

  const fallbackPageSizes = buildFallbackPageSizes(pageSize);
  let fallbackPageSizeIndex = 0;
  let activePageSize = fallbackPageSizes[fallbackPageSizeIndex];
  let rowOffset = startOffset;
  let hasMore = true;
  logInfo(logState, "target.start", {
    target: target.key,
    tableId: target.tableId,
    segmentId: target.segmentId,
    writeEnabled,
    pageSize,
    startOffset,
    fallbackPageSizes,
  });

  while (hasMore) {
    const page = Math.floor(rowOffset / activePageSize) + 1;
    const segmentUrl = new URL(`${baseUrl}/segments/${target.segmentId}`);
    segmentUrl.searchParams.set("page", String(page));
    segmentUrl.searchParams.set("page_size", String(activePageSize));

    let payload;
    try {
      payload = await fetchAudienceLabJson(
        segmentUrl.toString(),
        headers,
        (retryDetails) => {
          logInfo(logState, "target.page.retry", {
            target: target.key,
            tableId: target.tableId,
            page,
            pageSize: activePageSize,
            offset: rowOffset,
            ...retryDetails,
          });
        }
      );
    } catch (error) {
      const status = Number(extractStatusCode(error));
      const hasFallbackPageSize = fallbackPageSizeIndex < fallbackPageSizes.length - 1;
      const shouldFallback =
        hasFallbackPageSize && (status === 429 || (Number.isFinite(status) && status >= 500));

      if (shouldFallback) {
        const previousPageSize = activePageSize;
        fallbackPageSizeIndex += 1;
        activePageSize = fallbackPageSizes[fallbackPageSizeIndex];
        result.activePageSize = activePageSize;
        logInfo(logState, "target.page_size.fallback", {
          target: target.key,
          tableId: target.tableId,
          failedPage: page,
          offset: rowOffset,
          previousPageSize,
          nextPageSize: activePageSize,
          status,
          details: safeErrorDetails(error),
        });
        continue;
      }

      result.failed = true;
      result.failedPage = page;
      result.failedPageSize = activePageSize;
      result.nextOffset = rowOffset;
      throw buildSyncFailureError(error, result, {
        failedPage: page,
        failedPageSize: activePageSize,
        lastCompletedPage: result.lastCompletedPage || 0,
        rowsInsertedBeforeFailure: result.rowsInserted,
        pagesFetchedBeforeFailure: result.pagesFetched,
        nextOffset: rowOffset,
      });
    }

    const dataRows = Array.isArray(payload?.data) ? payload.data : [];

    result.segmentName = payload?.segment_name || result.segmentName;
    result.pagesFetched += 1;
    result.sourceRecords += dataRows.length;
    result.lastCompletedPage = page;
    result.lastCompletedPageSize = activePageSize;
    if (!result.preview) {
      result.preview = summarizeDryRunPayload(payload);
    }

    const preparedRows = dataRows.map((rawRow) =>
      toBigQueryRow(rawRow, result.segmentName, batchTimestamp)
    );
    result.rowsPrepared += preparedRows.length;
    logInfo(logState, "target.page.fetched", {
      target: target.key,
      tableId: target.tableId,
      page,
      pageSize: activePageSize,
      offset: rowOffset,
      rows: dataRows.length,
      totalRecords: payload?.total_records ?? null,
      totalPages: payload?.total_pages ?? null,
    });

    if (includePreviewRows && result.testRows.length < previewRowLimit) {
      const remaining = previewRowLimit - result.testRows.length;
      result.testRows.push(...preparedRows.slice(0, remaining));
    }

    if (writeEnabled && preparedRows.length) {
      const insertResult = await insertRows(
        bigquery,
        projectId,
        datasetId,
        target.tableId,
        preparedRows
      );
      result.rowsInserted += insertResult.inserted;
      logInfo(logState, "target.page.inserted", {
        target: target.key,
        tableId: target.tableId,
        page,
        pageSize: activePageSize,
        offset: rowOffset,
        inserted: insertResult.inserted,
        cumulativeInserted: result.rowsInserted,
      });
    }

    rowOffset += dataRows.length;
    result.nextOffset = rowOffset;
    result.activePageSize = activePageSize;

    const totalRecords = Number(payload?.total_records || 0);
    const totalPages = Number(payload?.total_pages || 1);
    const payloadHasMore = Boolean(payload?.has_more);
    hasMore =
      payloadHasMore ||
      (Number.isFinite(totalRecords) && totalRecords > 0
        ? rowOffset < totalRecords
        : dataRows.length > 0 && page < totalPages);

    if (!writeEnabled && result.pagesFetched >= maxPages) {
      hasMore = false;
    }

    if (dataRows.length < activePageSize && !payloadHasMore && (!totalRecords || rowOffset >= totalRecords)) {
      hasMore = false;
    }

    if (dataRows.length === 0) {
      hasMore = false;
    }
  }

  logInfo(logState, "target.complete", {
    target: target.key,
    tableId: target.tableId,
    pagesFetched: result.pagesFetched,
    sourceRecords: result.sourceRecords,
    rowsPrepared: result.rowsPrepared,
    rowsInserted: result.rowsInserted,
  });

  if (writeEnabled) {
    const verification = await verifyBatchRowCountWithRetry({
      bigquery,
      projectId,
      datasetId,
      tableId: target.tableId,
      batchTimestamp,
      expectedRows: result.rowsInserted,
    });

    result.rowsInTableForBatch = verification.observedRows;
    result.batchCountMatched = verification.matched;
    logInfo(logState, "target.verify", {
      target: target.key,
      tableId: target.tableId,
      rowsInserted: result.rowsInserted,
      rowsInTableForBatch: verification.observedRows,
      matched: verification.matched,
      attempts: verification.attempts,
    });
  }

  return result;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const logState = {
    runId: generateRunId(),
    entries: [],
    includeLogs: shouldIncludeLogs(searchParams),
  };

  if (!isSyncApiKeyValid(request)) {
    logError(logState, "auth.unauthorized");
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: NO_STORE_HEADERS,
    });
  }

  const missingEnvVars = getMissingEnvVars();
  if (missingEnvVars.length) {
    logError(logState, "env.missing", { missing: missingEnvVars });
    return new Response(
      JSON.stringify({
        error: "Missing sync configuration.",
        missing: missingEnvVars,
        runId: logState.runId,
      }),
      {
        status: 500,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  const mode = (searchParams.get("mode") || "dry-run").toLowerCase();
  const isTestMode = mode === "test";
  const writeEnabled = mode === "write";
  const previewRowLimit = toPositiveInt(
    searchParams.get("test_rows"),
    DEFAULT_TEST_ROW_LIMIT,
    MAX_TEST_ROW_LIMIT
  );
  const writesAllowed = isWriteEnabledByEnv();
  const dryRunMaxPages = toPositiveInt(searchParams.get("dry_run_pages"), 1, 3);
  const pageSize = toPositiveInt(
    searchParams.get("page_size"),
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );
  const startPage = toPositiveInt(searchParams.get("start_page"), 1);
  const startOffset = searchParams.has("start_offset")
    ? toNonNegativeInt(searchParams.get("start_offset"), 0)
    : (startPage - 1) * pageSize;

  if (writeEnabled && !writesAllowed) {
    logError(logState, "write.blocked", { mode, writesAllowed });
    return new Response(
      JSON.stringify({
        error:
          "Write mode is disabled. Set AUDIENCE_LAB_BQ_WRITE_ENABLED=true to allow BigQuery writes.",
        runId: logState.runId,
      }),
      {
        status: 403,
        headers: NO_STORE_HEADERS,
      }
    );
  }
  // ── Slot-based routing (MongoDB-driven) ──────────────────────────────────────
  const slotParam = searchParams.get("slot");
  if (slotParam !== null) {
    const slot = Number(slotParam);
    if (!Number.isFinite(slot) || slot < 0) {
      return new Response(JSON.stringify({ error: "Invalid slot number.", runId: logState.runId }), { status: 400, headers: NO_STORE_HEADERS });
    }

    // Seed from env vars if first run
    await seedFromEnvIfEmpty().catch(() => {});

    const segDoc = await getSegmentBySlot(slot).catch(() => null);
    if (!segDoc) {
      logInfo(logState, "slot.empty", { slot });
      return new Response(JSON.stringify({ ok: true, slot, message: "No segment assigned to this slot.", runId: logState.runId }), { status: 200, headers: NO_STORE_HEADERS });
    }
    if (!segDoc.active) {
      logInfo(logState, "slot.inactive", { slot, key: segDoc.key });
      return new Response(JSON.stringify({ ok: true, slot, key: segDoc.key, message: "Segment is inactive — skipped.", runId: logState.runId }), { status: 200, headers: NO_STORE_HEADERS });
    }

    // Build a single target from the MongoDB document
    const slotTarget = { key: segDoc.key, tableId: segDoc.tableId, segmentId: segDoc.segmentId, source: "mongodb" };
    logInfo(logState, "slot.resolved", { slot, key: segDoc.key, tableId: segDoc.tableId });

    const auth = new google.auth.GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
        private_key:  (process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
      },
      scopes: ["https://www.googleapis.com/auth/bigquery"],
    });
    const bigquery   = google.bigquery({ version: "v2", auth });
    const projectId  = process.env.GOOGLE_CLOUD_PROJECT_ID;
    const datasetId  = process.env.BQ_DATASET_ID;
    const baseUrl    = trimTrailingSlash(process.env.AUDIENCE_LAB_BASE_URL || DEFAULT_BASE_URL);
    const apiKey     = process.env.AUDIENCE_LAB_API_KEY;
    const headers    = { "x-api-key": apiKey, "Content-Type": "application/json" };
    const batchTimestamp = new Date().toISOString();

    const syncStarted = Date.now();
    const triggeredBy = slotParam !== null ? (writeEnabled ? "cron" : "manual") : "manual";

    let syncResult;
    try {
      syncResult = await syncSingleTarget({
        target:             slotTarget,
        baseUrl, headers, pageSize, startOffset,
        writeEnabled,
        maxPages:           dryRunMaxPages,
        includePreviewRows: isTestMode,
        previewRowLimit,
        batchTimestamp,
        bigquery,
        projectId,
        datasetId,
        logState,
      });

      const syncStatus = syncResult.failed ? "error" : "success";
      const durationMs = Date.now() - syncStarted;

      // Update segment's last-sync fields
      await updateSyncStatus(segDoc.key, {
        status:  syncStatus,
        message: syncResult.failed ? `Failed on page ${syncResult.failedPage}` : null,
        count:   syncResult.rowsInserted ?? 0,
      }).catch((e) => console.warn("[sync] MongoDB status update failed:", e.message));

      // Write detailed log entry
      await writeSyncLog({
        segmentKey:    segDoc.key,
        segmentName:   segDoc.name,
        slot,
        runId:         logState.runId,
        mode:          writeEnabled ? "write" : isTestMode ? "test" : "dry-run",
        startedAt:     new Date(syncStarted),
        status:        syncStatus,
        rowsInserted:  syncResult.rowsInserted  ?? 0,
        sourceRecords: syncResult.sourceRecords ?? 0,
        pagesFetched:  syncResult.pagesFetched  ?? 0,
        durationMs,
        errorMessage:  syncResult.failed ? `Failed on page ${syncResult.failedPage}` : null,
        triggeredBy,
      }).catch((e) => console.warn("[sync] MongoDB log write failed:", e.message));

    } catch (err) {
      const durationMs = Date.now() - syncStarted;
      await updateSyncStatus(segDoc.key, { status: "error", message: err.message, count: 0 }).catch(() => {});
      await writeSyncLog({
        segmentKey: segDoc.key, segmentName: segDoc.name, slot,
        runId: logState.runId, mode: writeEnabled ? "write" : "dry-run",
        startedAt: new Date(syncStarted), status: "error",
        rowsInserted: 0, sourceRecords: 0, pagesFetched: 0,
        durationMs, errorMessage: err.message, triggeredBy,
      }).catch(() => {});
      logError(logState, "slot.sync.error", { slot, key: segDoc.key, error: err.message });
      return new Response(JSON.stringify({ error: err.message, slot, key: segDoc.key, runId: logState.runId }), { status: 500, headers: NO_STORE_HEADERS });
    }

    return new Response(JSON.stringify({ ok: true, slot, key: segDoc.key, result: syncResult, runId: logState.runId, logs: logState.includeLogs ? logState.entries : undefined }), { status: 200, headers: NO_STORE_HEADERS });
  }
  // ── End slot-based routing ───────────────────────────────────────────────────

  const requestedTarget = resolveRequestedTarget(searchParams);
  if (!requestedTarget) {
    logError(logState, "target.invalid", {
      requested: searchParams.get("target"),
    });
    return new Response(
      JSON.stringify({
        error:
          "Invalid target. Use slot=N, or target=all/bbt_turf/cmk_kitchen_bath/smp_roofing/smp_solar/smp_windows_sd_sf.",
        runId: logState.runId,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  const allTargets = resolveTargets(searchParams);
  const targets =
    requestedTarget === "all"
      ? allTargets
      : allTargets.filter((target) => target.key === requestedTarget);
  const missingTargets = targets.filter((target) => !target.segmentId).map((target) => ({
    key: target.key,
    tableId: target.tableId,
    expectedEnvVar: SEGMENT_TABLE_CONFIG.find((cfg) => cfg.tableId === target.tableId)?.envVar,
    queryParam: SEGMENT_TABLE_CONFIG.find((cfg) => cfg.tableId === target.tableId)?.queryParam,
  }));

  // For targeted writes (e.g. target=smp), require that one target's segment ID exists.
  if (writeEnabled && requestedTarget !== "all" && missingTargets.length) {
    logError(logState, "target.missing.for.write", {
      requestedTarget,
      missingTargets,
    });
    return new Response(
      JSON.stringify({
        error:
          "Missing segment ID for requested target. Set env var or pass query param.",
        target: requestedTarget,
        missing: missingTargets,
        runId: logState.runId,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  const selectedTargets = targets.filter((target) => target.segmentId);
  if (!selectedTargets.length) {
    logError(logState, "target.none.selected", {
      requestedTarget,
    });
    return new Response(
      JSON.stringify({
        error:
          "No segment IDs provided. Configure segment env vars (AUDIENCE_LAB_BBT_TURF_SEGMENT_ID, AUDIENCE_LAB_CMK_KITCHEN_BATH_SEGMENT_ID, AUDIENCE_LAB_SMP_ROOFING_SEGMENT_ID, AUDIENCE_LAB_SMP_SOLAR_SEGMENT_ID, AUDIENCE_LAB_SMP_WINDOWS_SD_SF_SEGMENT_ID) or pass target query params.",
        target: requestedTarget,
        runId: logState.runId,
      }),
      {
        status: 400,
        headers: NO_STORE_HEADERS,
      }
    );
  }

  const headers = buildAudienceLabHeaders();
  const baseUrl = getAudienceLabBaseUrl();
  const projectId = process.env.GOOGLE_CLOUD_PROJECT_ID;
  const datasetId = process.env.BQ_DATASET_ID;
  const batchTimestamp = new Date().toISOString();
  logInfo(logState, "run.start", {
    mode: writeEnabled ? "write" : isTestMode ? "test" : "dry-run",
    target: requestedTarget,
    selectedTargets: selectedTargets.map((target) => target.key),
    pageSize,
    startPage,
    startOffset,
    batchTimestamp,
    projectId,
    datasetId,
  });
  const results = [];
  const errors = [];
  let bigquery = null;

  if (writeEnabled) {
    bigquery = getBigQueryClient();
  }

  for (const target of selectedTargets) {
    try {
      const targetResult = await syncSingleTarget({
        target,
        baseUrl,
        headers,
        pageSize,
        startOffset,
        writeEnabled,
        maxPages: writeEnabled ? Number.MAX_SAFE_INTEGER : dryRunMaxPages,
        includePreviewRows: !writeEnabled && isTestMode,
        previewRowLimit,
        batchTimestamp,
        bigquery,
        projectId,
        datasetId,
        logState,
      });

      results.push(targetResult);
    } catch (error) {
      if (error?.partialResult) {
        results.push(error.partialResult);
      }
      logError(logState, "target.failed", {
        target: target.key,
        tableId: target.tableId,
        segmentId: target.segmentId,
        details: safeErrorDetails(error),
      });
      errors.push({
        tableId: target.tableId,
        segmentId: target.segmentId,
        details: safeErrorDetails(error),
      });
    }
  }

  const completedResults = results.filter((item) => !item.failed);
  const partialResults = results.filter((item) => item.failed);
  const summary = {
    tablesRequested: targets.length,
    tablesProcessed: completedResults.length,
    tablesFailed: errors.length,
    tablesWithPartialProgress: partialResults.length,
    sourceRecords: results.reduce((sum, item) => sum + (item.sourceRecords || 0), 0),
    rowsPrepared: results.reduce((sum, item) => sum + (item.rowsPrepared || 0), 0),
    rowsInserted: results.reduce((sum, item) => sum + (item.rowsInserted || 0), 0),
    rowsInTableForBatch: results.reduce(
      (sum, item) => sum + (item.rowsInTableForBatch || 0),
      0
    ),
    verificationMismatches: results.filter(
      (item) => item.batchCountMatched === false
    ).length,
  };

  const status = errors.length ? 207 : 200;
  logInfo(logState, "run.complete", {
    status,
    summary,
    errors: errors.length,
  });

  return new Response(
    JSON.stringify({
      ok: errors.length === 0,
      runId: logState.runId,
      mode: writeEnabled ? "write" : isTestMode ? "test" : "dry-run",
      writeEnabled,
      target: requestedTarget,
      activeTargets: selectedTargets.map((target) => target.key),
      batchTimestamp,
      projectId,
      datasetId,
      tableSchema: TABLE_SCHEMA_FIELDS,
      missingSegmentTargets: missingTargets,
      summary,
      results,
      errors,
      logs: logState.includeLogs ? logState.entries : undefined,
    }),
    {
      status,
      headers: NO_STORE_HEADERS,
    }
  );
}
