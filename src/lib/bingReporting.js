/**
 * Shared Bing Ads reporting helpers.
 * Used by both the internal dashboard and the client portal.
 */
import { inflateRawSync } from "zlib";

const TOKEN_TENANT       = process.env.BING_ADS_TENANT || "consumers";
const TOKEN_ENDPOINT     = `https://login.microsoftonline.com/${TOKEN_TENANT}/oauth2/v2.0/token`;
const REPORTING_ENDPOINT = "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";

const POLL_INTERVAL_MS  = 3000;
const MAX_POLL_ATTEMPTS = 20;

// ── xml helpers ───────────────────────────────────────────────────────────────

export function escapeXml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function unescapeXml(v) {
  return String(v)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

export function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return m ? unescapeXml(m[1].trim()) : null;
}

// ── csv helpers ───────────────────────────────────────────────────────────────

function stripBom(v) { return v.charCodeAt(0) === 0xfeff ? v.slice(1) : v; }

function parseCsvLine(line) {
  const cells = []; let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]; const n = line[i + 1];
    if (c === '"' && inQ && n === '"') { cur += '"'; i++; continue; }
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { cells.push(cur); cur = ""; continue; }
    cur += c;
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

export function parseCsv(text) {
  const lines = stripBom(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const vals = parseCsvLine(line);
    const row = {};
    headers.forEach((h, i) => { row[h] = vals[i] ?? ""; });
    return row;
  });
}

export function extractZipText(buf) {
  const eocdSig = 0x06054b50;
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error("Invalid ZIP: EOCD not found.");
  const cdOff = buf.readUInt32LE(eocdOff + 16);
  if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error("Invalid ZIP: CD not found.");
  const comp     = buf.readUInt16LE(cdOff + 10);
  const compSize = buf.readUInt32LE(cdOff + 20);
  const fnLen    = buf.readUInt16LE(cdOff + 28);
  const exLen    = buf.readUInt16LE(cdOff + 30);
  const lhOff    = buf.readUInt32LE(cdOff + 42);
  if (buf.readUInt32LE(lhOff) !== 0x04034b50) throw new Error("Invalid ZIP: LFH not found.");
  const lnLen    = buf.readUInt16LE(lhOff + 26);
  const leLen    = buf.readUInt16LE(lhOff + 28);
  const dataStart = lhOff + 30 + lnLen + leLen;
  const payload  = buf.subarray(dataStart, dataStart + compSize);
  const plain    = comp === 0 ? payload
    : comp === 8 ? inflateRawSync(payload)
    : (() => { throw new Error(`Unsupported ZIP method ${comp}`); })();
  return plain.toString("utf8");
}

// ── date helpers ──────────────────────────────────────────────────────────────

export function normalizeDate(raw) {
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return raw;
}

// ── api calls ─────────────────────────────────────────────────────────────────

export async function fetchAccessToken() {
  const body = new URLSearchParams({
    client_id:     process.env.BING_ADS_CLIENT_ID,
    client_secret: process.env.BING_ADS_CLIENT_SECRET,
    refresh_token: process.env.BING_ADS_REFRESH_TOKEN,
    grant_type:    "refresh_token",
    scope:         "https://ads.microsoft.com/msads.manage offline_access",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body, cache: "no-store",
  });
  if (!res.ok) throw new Error(`Bing token error: ${await res.text()}`);
  return (await res.json()).access_token;
}

/**
 * Submit a campaign performance report.
 * @param {string} accessToken
 * @param {{ startParts, endParts }} range  — each part has {day, month, year}
 * @param {string} accountId
 * @param {string} customerId
 * @param {string[]} columns  — CampaignPerformanceReportColumn values to include
 */
export async function submitReport(accessToken, range, accountId, customerId, columns) {
  const { startParts: s, endParts: e } = range;
  const colXml = columns
    .map((c) => `<CampaignPerformanceReportColumn>${c}</CampaignPerformanceReportColumn>`)
    .join("\n          ");

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">SubmitGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accountId)}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(customerId)}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(process.env.BING_ADS_DEVELOPER_TOKEN)}</DeveloperToken>
  </s:Header>
  <s:Body>
    <SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
      <ReportRequest i:type="CampaignPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <ExcludeColumnHeaders>false</ExcludeColumnHeaders>
        <ExcludeReportFooter>true</ExcludeReportFooter>
        <ExcludeReportHeader>true</ExcludeReportHeader>
        <Format>Csv</Format>
        <ReportName>PortalWeeklyReport</ReportName>
        <ReturnOnlyCompleteData>false</ReturnOnlyCompleteData>
        <Aggregation>Daily</Aggregation>
        <Columns>
          ${colXml}
        </Columns>
        <Scope>
          <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
            <a:long>${escapeXml(accountId)}</a:long>
          </AccountIds>
        </Scope>
        <Time>
          <CustomDateRangeEnd><Day>${e.day}</Day><Month>${e.month}</Month><Year>${e.year}</Year></CustomDateRangeEnd>
          <CustomDateRangeStart><Day>${s.day}</Day><Month>${s.month}</Month><Year>${s.year}</Year></CustomDateRangeStart>
          <ReportTimeZone>PacificTimeUSCanadaTijuana</ReportTimeZone>
        </Time>
      </ReportRequest>
    </SubmitGenerateReportRequest>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(REPORTING_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "SubmitGenerateReport" },
    body: envelope, cache: "no-store",
  });
  const xml = await res.text();
  const id  = xmlTag(xml, "ReportRequestId");
  if (!res.ok || !id) throw new Error(`Failed to submit Bing report: ${xml}`);
  return id;
}

export async function pollReport(accessToken, reportRequestId, accountId, customerId) {
  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">PollGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accountId)}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(customerId)}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(process.env.BING_ADS_DEVELOPER_TOKEN)}</DeveloperToken>
  </s:Header>
  <s:Body>
    <PollGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
      <ReportRequestId>${escapeXml(reportRequestId)}</ReportRequestId>
    </PollGenerateReportRequest>
  </s:Body>
</s:Envelope>`;

    const res = await fetch(REPORTING_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "PollGenerateReport" },
      body: envelope, cache: "no-store",
    });
    const xml    = await res.text();
    if (!res.ok) throw new Error(`Bing poll error: ${xml}`);
    const status = xmlTag(xml, "Status");
    const url    = xmlTag(xml, "ReportDownloadUrl");
    if (status === "Success") return url || null;
    if (status === "Error")   throw new Error(`Bing report failed: ${xml}`);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Bing report.");
}

export async function downloadReport(url) {
  if (!url) return [];
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Bing download error: ${await res.text()}`);
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/zip") || url.toLowerCase().includes(".zip")) {
    const csv = extractZipText(Buffer.from(await res.arrayBuffer()));
    return parseCsv(csv);
  }
  return parseCsv(await res.text());
}

/** Convert "YYYY-MM-DD" date string into {day, month, year} parts for Bing SOAP */
export function toDateParts(iso) {
  const [y, m, d] = iso.split("-");
  return { day: String(parseInt(d, 10)), month: String(parseInt(m, 10)), year: y };
}
