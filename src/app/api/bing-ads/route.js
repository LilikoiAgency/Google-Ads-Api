import { inflateRawSync } from "zlib";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TOKEN_TENANT = process.env.BING_ADS_TENANT || "consumers";
const TOKEN_ENDPOINT = `https://login.microsoftonline.com/${TOKEN_TENANT}/oauth2/v2.0/token`;
const REPORTING_ENDPOINT =
  "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";
const CAMPAIGN_MANAGEMENT_ENDPOINT =
  "https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc";

const REQUIRED_ENV_VARS = [
  "BING_ADS_CLIENT_ID",
  "BING_ADS_CLIENT_SECRET",
  "BING_ADS_REFRESH_TOKEN",
  "BING_ADS_DEVELOPER_TOKEN",
  "BING_ADS_API_KEY",
];

const POLL_INTERVAL_MS = 3000;
const MAX_POLL_ATTEMPTS = 10;
const NO_STORE_HEADERS = {
  "Content-Type": "application/json",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function getMissingEnvVars() {
  return REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
}

function resolveClientContext(customerIdParam, accountIdParam) {
  const customerId = customerIdParam || process.env.BING_ADS_CUSTOMER_ID;
  const accountId = accountIdParam || process.env.BING_ADS_ACCOUNT_ID;
  return { customerId, accountId };
}

function isNumericId(value) {
  return /^\d+$/.test(String(value || ""));
}

function extractBearerToken(authHeader) {
  if (!authHeader) return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function isValidApiKey(request) {
  const expectedKey = process.env.BING_ADS_API_KEY;
  if (!expectedKey) return false;

  const headerKey = request.headers.get("x-api-key");
  if (headerKey && headerKey === expectedKey) return true;

  const bearerToken = extractBearerToken(request.headers.get("authorization"));
  return Boolean(bearerToken && bearerToken === expectedKey);
}

function formatDateParts(date) {
  return {
    day: String(date.getUTCDate()),
    month: String(date.getUTCMonth() + 1),
    year: String(date.getUTCFullYear()),
  };
}

function formatUsDate(date) {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const year = String(date.getUTCFullYear());
  return `${month}-${day}-${year}`;
}

function parseUsDate(value) {
  const raw = String(value || "").trim();
  const match = raw.match(/^(\d{2})-(\d{2})-(\d{4})$/);
  if (!match) return null;

  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));

  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date;
}

function buildDateRange({ days, range, startDate, endDate }) {
  const now = new Date();
  let start;
  let end;
  let computedDays;

  if (startDate || endDate) {
    if (!startDate || !endDate) {
      throw new Error(
        "Both startDate and endDate are required when using a custom date range."
      );
    }

    const parsedStart = parseUsDate(startDate);
    const parsedEnd = parseUsDate(endDate);

    if (!parsedStart || !parsedEnd) {
      throw new Error(
        "Invalid date format. Use MM-DD-YYYY for startDate and endDate."
      );
    }

    if (parsedStart > parsedEnd) {
      throw new Error("startDate must be less than or equal to endDate.");
    }

    start = parsedStart;
    end = parsedEnd;
    computedDays =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  } else if (range === "mtd") {
    start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    end = new Date(now);
    end.setUTCDate(end.getUTCDate() - 1);

    // On the 1st day of month, avoid invalid range by clamping start to end.
    if (end < start) {
      start = new Date(end);
    }

    computedDays =
      Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  } else {
    end = new Date(now);
    start = new Date(end);
    start.setUTCDate(end.getUTCDate() - Math.max(days - 1, 0));
    computedDays = Math.max(days, 1);
  }

  return {
    start: formatDateParts(start),
    end: formatDateParts(end),
    rangeDays: Math.max(computedDays, 1),
    startDate: formatUsDate(start),
    endDate: formatUsDate(end),
  };
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(value) {
  return String(value)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function extractXmlTagValue(xml, tagName) {
  const regex = new RegExp(
    `<(?:\\w+:)?${tagName}>([\\s\\S]*?)<\\/(?:\\w+:)?${tagName}>`,
    "i"
  );
  const match = xml.match(regex);
  return match ? unescapeXml(match[1].trim()) : null;
}

function stripBom(value) {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function parseCsv(text) {
  const lines = stripBom(text)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function extractTextFromZipBuffer(zipBuffer) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;

  for (let i = zipBuffer.length - 22; i >= 0; i -= 1) {
    if (zipBuffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) {
    throw new Error("Invalid ZIP: end of central directory not found.");
  }

  const centralDirOffset = zipBuffer.readUInt32LE(eocdOffset + 16);
  if (zipBuffer.readUInt32LE(centralDirOffset) !== 0x02014b50) {
    throw new Error("Invalid ZIP: central directory header not found.");
  }

  const compressionMethod = zipBuffer.readUInt16LE(centralDirOffset + 10);
  const compressedSize = zipBuffer.readUInt32LE(centralDirOffset + 20);
  const fileNameLength = zipBuffer.readUInt16LE(centralDirOffset + 28);
  const extraFieldLength = zipBuffer.readUInt16LE(centralDirOffset + 30);
  const fileCommentLength = zipBuffer.readUInt16LE(centralDirOffset + 32);
  const localHeaderOffset = zipBuffer.readUInt32LE(centralDirOffset + 42);

  const centralFileNameStart = centralDirOffset + 46;
  const centralFileNameEnd = centralFileNameStart + fileNameLength;
  const fileName = zipBuffer.toString("utf8", centralFileNameStart, centralFileNameEnd);

  const nextCentralOffset =
    centralFileNameEnd + extraFieldLength + fileCommentLength;
  if (nextCentralOffset > zipBuffer.length) {
    throw new Error("Invalid ZIP: central directory bounds exceeded.");
  }

  if (zipBuffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
    throw new Error("Invalid ZIP: local file header not found.");
  }

  const localNameLength = zipBuffer.readUInt16LE(localHeaderOffset + 26);
  const localExtraLength = zipBuffer.readUInt16LE(localHeaderOffset + 28);
  const compressedDataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
  const compressedDataEnd = compressedDataStart + compressedSize;

  if (compressedDataEnd > zipBuffer.length) {
    throw new Error("Invalid ZIP: compressed payload out of bounds.");
  }

  const compressedPayload = zipBuffer.subarray(compressedDataStart, compressedDataEnd);
  let plainBuffer;

  if (compressionMethod === 0) {
    plainBuffer = compressedPayload;
  } else if (compressionMethod === 8) {
    plainBuffer = inflateRawSync(compressedPayload);
  } else {
    throw new Error(
      `Unsupported ZIP compression method (${compressionMethod}) for ${fileName}`
    );
  }

  return plainBuffer.toString("utf8");
}

function firstNonEmptyValue(row, keys) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return null;
}

async function fetchAccessToken() {
  const body = new URLSearchParams({
    client_id: process.env.BING_ADS_CLIENT_ID,
    client_secret: process.env.BING_ADS_CLIENT_SECRET,
    refresh_token: process.env.BING_ADS_REFRESH_TOKEN,
    grant_type: "refresh_token",
    scope: "https://ads.microsoft.com/msads.manage offline_access",
  });

  const response = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get Bing access token: ${errorText}`);
  }

  const tokenPayload = await response.json();
  return tokenPayload.access_token;
}

async function fetchCampaignBudgetMap(accessToken, clientContext) {
  const accountId = escapeXml(clientContext.accountId);
  const customerId = escapeXml(clientContext.customerId);
  const developerToken = escapeXml(process.env.BING_ADS_DEVELOPER_TOKEN);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
    <Action mustUnderstand="1">GetCampaignsByAccountId</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      accessToken
    )}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${accountId}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${customerId}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${developerToken}</DeveloperToken>
  </s:Header>
  <s:Body>
    <GetCampaignsByAccountIdRequest xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
      <AccountId>${accountId}</AccountId>
      <CampaignType i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
      <ReturnAdditionalFields i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
    </GetCampaignsByAccountIdRequest>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(CAMPAIGN_MANAGEMENT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "GetCampaignsByAccountId",
    },
    body: envelope,
    cache: "no-store",
  });

  const xml = await response.text();
  if (!response.ok) {
    throw new Error(`Failed to get Bing campaign budgets: ${xml}`);
  }

  const campaignRegex = /<(?:\w+:)?Campaign>([\s\S]*?)<\/(?:\w+:)?Campaign>/g;
  const budgetMap = new Map();
  let match = campaignRegex.exec(xml);

  while (match) {
    const campaignXml = match[1];
    const campaignId = extractXmlTagValue(campaignXml, "Id");
    if (campaignId) {
      budgetMap.set(campaignId, {
        campaign: extractXmlTagValue(campaignXml, "Name"),
        status: extractXmlTagValue(campaignXml, "Status"),
        budget: extractXmlTagValue(campaignXml, "DailyBudget"),
        budgetType: extractXmlTagValue(campaignXml, "BudgetType"),
      });
    }
    match = campaignRegex.exec(xml);
  }

  return budgetMap;
}

async function submitCampaignPerformanceReport(accessToken, dateRange, clientContext) {
  const { start, end } = dateRange;
  const accountId = escapeXml(clientContext.accountId);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">SubmitGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      accessToken
    )}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${accountId}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      clientContext.customerId
    )}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      process.env.BING_ADS_DEVELOPER_TOKEN
    )}</DeveloperToken>
  </s:Header>
  <s:Body>
    <SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
      <ReportRequest i:type="CampaignPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <ExcludeColumnHeaders>false</ExcludeColumnHeaders>
        <ExcludeReportFooter>true</ExcludeReportFooter>
        <ExcludeReportHeader>true</ExcludeReportHeader>
        <Format>Csv</Format>
        <ReportName>CampaignPerformance</ReportName>
        <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
        <Aggregation>Daily</Aggregation>
        <Columns>
          <CampaignPerformanceReportColumn>TimePeriod</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>CampaignId</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>CampaignName</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>CampaignStatus</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>Clicks</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>Impressions</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>Spend</CampaignPerformanceReportColumn>
        </Columns>
        <Scope>
          <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
            <a:long>${accountId}</a:long>
          </AccountIds>
        </Scope>
        <Time>
          <CustomDateRangeEnd>
            <Day>${end.day}</Day>
            <Month>${end.month}</Month>
            <Year>${end.year}</Year>
          </CustomDateRangeEnd>
          <CustomDateRangeStart>
            <Day>${start.day}</Day>
            <Month>${start.month}</Month>
            <Year>${start.year}</Year>
          </CustomDateRangeStart>
          <ReportTimeZone>PacificTimeUSCanadaTijuana</ReportTimeZone>
        </Time>
      </ReportRequest>
    </SubmitGenerateReportRequest>
  </s:Body>
</s:Envelope>`;

  const response = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      SOAPAction: "SubmitGenerateReport",
    },
    body: envelope,
    cache: "no-store",
  });

  const xml = await response.text();
  const reportRequestId = extractXmlTagValue(xml, "ReportRequestId");

  if (!response.ok || !reportRequestId) {
    throw new Error(`Failed to submit Bing report request: ${xml}`);
  }

  return reportRequestId;
}

async function pollReportDownloadUrl(accessToken, reportRequestId, clientContext) {
  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">PollGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      accessToken
    )}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      clientContext.accountId
    )}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      clientContext.customerId
    )}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(
      process.env.BING_ADS_DEVELOPER_TOKEN
    )}</DeveloperToken>
  </s:Header>
  <s:Body>
    <PollGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
      <ReportRequestId>${escapeXml(reportRequestId)}</ReportRequestId>
    </PollGenerateReportRequest>
  </s:Body>
</s:Envelope>`;

    const response = await fetch(REPORTING_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=utf-8",
        SOAPAction: "PollGenerateReport",
      },
      body: envelope,
      cache: "no-store",
    });

    const xml = await response.text();

    if (!response.ok) {
      throw new Error(`Failed to poll Bing report request: ${xml}`);
    }

    const status = extractXmlTagValue(xml, "Status");
    const downloadUrl = extractXmlTagValue(xml, "ReportDownloadUrl");

    if (status === "Success") {
      // Bing can return Success with no URL when there is no report payload.
      return { downloadUrl: downloadUrl || null };
    }

    if (status === "Error") {
      throw new Error(`Bing report generation failed: ${xml}`);
    }

    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error("Timed out waiting for Bing report generation.");
}

async function downloadReportRows(downloadUrl) {
  const response = await fetch(downloadUrl, { cache: "no-store" });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to download Bing report: ${errorText}`);
  }

  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/zip") || downloadUrl.toLowerCase().includes(".zip")) {
    const arrayBuffer = await response.arrayBuffer();
    const csv = extractTextFromZipBuffer(Buffer.from(arrayBuffer));
    return parseCsv(csv);
  }

  const csv = await response.text();
  return parseCsv(csv);
}

function buildCampaignResponse(budgetMap, reportRows) {
  const spendByCampaignId = new Map();

  for (const row of reportRows) {
    const campaignId = firstNonEmptyValue(row, [
      "CampaignId",
      "Campaign ID",
      "CampaignId ",
    ]);
    const spendRaw = firstNonEmptyValue(row, ["Spend"]) || "0";
    const spendValue = Number(String(spendRaw).replace(/,/g, ""));
    if (campaignId) {
      const current = spendByCampaignId.get(campaignId) || 0;
      spendByCampaignId.set(campaignId, current + (Number.isFinite(spendValue) ? spendValue : 0));
    }
  }

  const campaigns = [];

  for (const [campaignId, meta] of budgetMap.entries()) {
    campaigns.push({
      campaign: meta.campaign || campaignId,
      status: meta.status || null,
      budget: meta.budget || null,
      budgetType: meta.budgetType || null,
      spend: (spendByCampaignId.get(campaignId) || 0).toFixed(2),
    });
  }

  // If report contains campaigns not returned by CampaignManagement, include them.
  for (const row of reportRows) {
    const campaignId = firstNonEmptyValue(row, [
      "CampaignId",
      "Campaign ID",
      "CampaignId ",
    ]);
    if (!campaignId || budgetMap.has(campaignId)) continue;
    campaigns.push({
      campaign:
        firstNonEmptyValue(row, ["CampaignName", "Campaign Name"]) || campaignId,
      status: firstNonEmptyValue(row, ["CampaignStatus", "Campaign Status"]),
      budget: null,
      budgetType: null,
      spend: (
        Number(String(firstNonEmptyValue(row, ["Spend"]) || "0").replace(/,/g, "")) || 0
      ).toFixed(2),
    });
  }

  return campaigns;
}

export async function GET(request) {
  const missing = getMissingEnvVars();
  if (missing.length) {
    return new Response(
      JSON.stringify({
        error: "Missing Bing Ads configuration.",
        missing,
      }),
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }

  if (!isValidApiKey(request)) {
    return new Response(
      JSON.stringify({
        error: "Unauthorized",
      }),
      { status: 401, headers: NO_STORE_HEADERS }
    );
  }

  const { searchParams } = new URL(request.url);
  const customerIdParam = searchParams.get("customerId");
  const accountIdParam = searchParams.get("accountId");
  const clientContext = resolveClientContext(customerIdParam, accountIdParam);

  if (!clientContext.customerId || !clientContext.accountId) {
    return new Response(
      JSON.stringify({
        error:
          "Missing Bing client context. Provide customerId/accountId query params or set BING_ADS_CUSTOMER_ID/BING_ADS_ACCOUNT_ID in .env.",
      }),
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  if (!isNumericId(clientContext.customerId) || !isNumericId(clientContext.accountId)) {
    return new Response(
      JSON.stringify({
        error: "Invalid customerId/accountId. Both must be numeric.",
      }),
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  const range = (searchParams.get("range") || "").toLowerCase();
  const isMtd = range === "mtd";
  const startDate = searchParams.get("startDate")?.trim() || null;
  const endDate = searchParams.get("endDate")?.trim() || null;
  const requestedDays = Number(searchParams.get("days"));
  const days =
    Number.isFinite(requestedDays) && requestedDays > 0 ? requestedDays : 7;
  let dateRange;
  let rangeLabel;

  try {
    dateRange = buildDateRange({
      days,
      range: isMtd ? "mtd" : null,
      startDate,
      endDate,
    });
    rangeLabel = startDate || endDate ? "custom" : isMtd ? "mtd" : "days";
  } catch (error) {
    return new Response(
      JSON.stringify({
        error: error.message,
      }),
      { status: 400, headers: NO_STORE_HEADERS }
    );
  }

  try {
    const accessToken = await fetchAccessToken();
    const budgetMap = await fetchCampaignBudgetMap(accessToken, clientContext);
    const reportRequestId = await submitCampaignPerformanceReport(
      accessToken,
      dateRange,
      clientContext
    );
    const pollResult = await pollReportDownloadUrl(
      accessToken,
      reportRequestId,
      clientContext
    );
    const reportRows = pollResult.downloadUrl
      ? await downloadReportRows(pollResult.downloadUrl)
      : [];
    const campaigns = buildCampaignResponse(budgetMap, reportRows);

    return new Response(
      JSON.stringify({
        campaigns,
        rangeDays: dateRange.rangeDays,
        range: rangeLabel,
        startDate: dateRange.startDate,
        endDate: dateRange.endDate,
        customerId: clientContext.customerId,
        accountId: clientContext.accountId,
      }),
      {
        status: 200,
        headers: NO_STORE_HEADERS,
      }
    );
  } catch (error) {
    console.error("Bing Ads API error:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to fetch Bing Ads campaigns.",
      }),
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}
