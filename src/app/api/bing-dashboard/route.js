import { NextResponse } from "next/server";
import { inflateRawSync } from "zlib";
import { getBingCreds } from "../../../lib/bingReporting";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ─── constants ────────────────────────────────────────────────────────────────

const TOKEN_TENANT      = process.env.BING_ADS_TENANT || "consumers";
const TOKEN_ENDPOINT    = `https://login.microsoftonline.com/${TOKEN_TENANT}/oauth2/v2.0/token`;
const REPORTING_ENDPOINT = "https://reporting.api.bingads.microsoft.com/Api/Advertiser/Reporting/v13/ReportingService.svc";
const CAMPAIGN_ENDPOINT  = "https://campaign.api.bingads.microsoft.com/Api/Advertiser/CampaignManagement/v13/CampaignManagementService.svc";

const POLL_INTERVAL_MS  = 3000;
const MAX_POLL_ATTEMPTS = 20;

// ─── date helpers ─────────────────────────────────────────────────────────────

function toYMD(d) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function buildDateRange(preset, startParam, endParam) {
  const today = new Date();
  let start, end;

  if (preset === "custom" && startParam && endParam) {
    start = new Date(startParam);
    end   = new Date(endParam);
  } else {
    end = new Date(today);
    switch (preset) {
      case "7d":  start = new Date(today); start.setDate(today.getDate() - 7);   break;
      case "28d": start = new Date(today); start.setDate(today.getDate() - 28);  break;
      case "3m":  start = new Date(today); start.setMonth(today.getMonth() - 3); break;
      case "6m":  start = new Date(today); start.setMonth(today.getMonth() - 6); break;
      case "mtd": start = new Date(today.getFullYear(), today.getMonth(), 1);    break;
      case "ytd": start = new Date(today.getFullYear(), 0, 1);                   break;
      default:    start = new Date(today); start.setDate(today.getDate() - 28);
    }
  }

  const toDateParts = (d) => ({
    day:   String(d.getUTCDate()),
    month: String(d.getUTCMonth() + 1),
    year:  String(d.getUTCFullYear()),
  });

  return {
    startParts: toDateParts(start),
    endParts:   toDateParts(end),
    startDate:  toYMD(start),
    endDate:    toYMD(end),
  };
}

// ─── xml helpers ──────────────────────────────────────────────────────────────

function escapeXml(v) {
  return String(v)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function unescapeXml(v) {
  return String(v)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function xmlTag(xml, tag) {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`, "i"));
  return m ? unescapeXml(m[1].trim()) : null;
}

// ─── csv helpers ──────────────────────────────────────────────────────────────

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

function parseCsv(text) {
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

function extractZipText(buf) {
  const eocdSig = 0x06054b50;
  let eocdOff = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === eocdSig) { eocdOff = i; break; }
  }
  if (eocdOff < 0) throw new Error("Invalid ZIP: EOCD not found.");
  const cdOff = buf.readUInt32LE(eocdOff + 16);
  if (buf.readUInt32LE(cdOff) !== 0x02014b50) throw new Error("Invalid ZIP: CD not found.");
  const comp = buf.readUInt16LE(cdOff + 10);
  const compSize = buf.readUInt32LE(cdOff + 20);
  const fnLen = buf.readUInt16LE(cdOff + 28);
  const exLen = buf.readUInt16LE(cdOff + 30);
  const fcLen = buf.readUInt16LE(cdOff + 32);
  const lhOff = buf.readUInt32LE(cdOff + 42);
  if (buf.readUInt32LE(lhOff) !== 0x04034b50) throw new Error("Invalid ZIP: LFH not found.");
  const lnLen = buf.readUInt16LE(lhOff + 26);
  const leLen = buf.readUInt16LE(lhOff + 28);
  const dataStart = lhOff + 30 + lnLen + leLen;
  const payload = buf.subarray(dataStart, dataStart + compSize);
  const plain = comp === 0 ? payload : comp === 8 ? inflateRawSync(payload) : (() => { throw new Error(`Unsupported ZIP method ${comp}`); })();
  return plain.toString("utf8");
}

function firstVal(row, keys) {
  for (const k of keys) {
    const v = row[k];
    if (v !== undefined && v !== null && String(v).trim() !== "") return String(v).trim();
  }
  return null;
}

// ─── api calls ────────────────────────────────────────────────────────────────

async function fetchAccessToken() {
  const { clientId, clientSecret, refreshToken } = await getBingCreds();
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
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

async function fetchCampaignBudgetMap(accessToken, accountId, customerId) {
  accountId  = escapeXml(accountId  || process.env.BING_ADS_ACCOUNT_ID);
  customerId = escapeXml(customerId || process.env.BING_ADS_CUSTOMER_ID);
  const { devToken: rawDevToken } = await getBingCreds();
  const devToken = escapeXml(rawDevToken);

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
    <Action mustUnderstand="1">GetCampaignsByAccountId</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${accountId}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${customerId}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${devToken}</DeveloperToken>
  </s:Header>
  <s:Body>
    <GetCampaignsByAccountIdRequest xmlns="https://bingads.microsoft.com/CampaignManagement/v13">
      <AccountId>${accountId}</AccountId>
      <CampaignType i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
      <ReturnAdditionalFields i:nil="true" xmlns:i="http://www.w3.org/2001/XMLSchema-instance" />
    </GetCampaignsByAccountIdRequest>
  </s:Body>
</s:Envelope>`;

  const res = await fetch(CAMPAIGN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: "GetCampaignsByAccountId" },
    body: envelope, cache: "no-store",
  });
  const xml = await res.text();
  if (!res.ok) throw new Error(`Bing campaign fetch error: ${xml}`);

  const map = new Map();
  const re = /<(?:\w+:)?Campaign>([\s\S]*?)<\/(?:\w+:)?Campaign>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const id = xmlTag(m[1], "Id");
    if (id) {
      map.set(id, {
        name:       xmlTag(m[1], "Name"),
        status:     xmlTag(m[1], "Status"),
        budget:     xmlTag(m[1], "DailyBudget"),
        budgetType: xmlTag(m[1], "BudgetType"),
      });
    }
  }
  return map;
}

async function submitReport(accessToken, range, accountIdParam, customerIdParam) {
  const { startParts: s, endParts: e } = range;
  const accountId  = escapeXml(accountIdParam  || process.env.BING_ADS_ACCOUNT_ID);
  const customerId = escapeXml(customerIdParam || process.env.BING_ADS_CUSTOMER_ID);
  const { devToken: rawDevToken } = await getBingCreds();

  const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">SubmitGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${accountId}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${customerId}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(rawDevToken)}</DeveloperToken>
  </s:Header>
  <s:Body>
    <SubmitGenerateReportRequest xmlns="https://bingads.microsoft.com/Reporting/v13">
      <ReportRequest i:type="CampaignPerformanceReportRequest" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">
        <ExcludeColumnHeaders>false</ExcludeColumnHeaders>
        <ExcludeReportFooter>true</ExcludeReportFooter>
        <ExcludeReportHeader>true</ExcludeReportHeader>
        <Format>Csv</Format>
        <ReportName>DashboardCampaignReport</ReportName>
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
          <CampaignPerformanceReportColumn>Conversions</CampaignPerformanceReportColumn>
          <CampaignPerformanceReportColumn>Revenue</CampaignPerformanceReportColumn>
        </Columns>
        <Scope>
          <AccountIds xmlns:a="http://schemas.microsoft.com/2003/10/Serialization/Arrays">
            <a:long>${accountId}</a:long>
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
  const id = xmlTag(xml, "ReportRequestId");
  if (!res.ok || !id) throw new Error(`Failed to submit Bing report: ${xml}`);
  return id;
}

async function pollReport(accessToken, reportRequestId, accountIdParam, customerIdParam) {
  const accountId  = escapeXml(accountIdParam  || process.env.BING_ADS_ACCOUNT_ID);
  const customerId = escapeXml(customerIdParam || process.env.BING_ADS_CUSTOMER_ID);
  const { devToken: rawDevToken } = await getBingCreds();

  for (let i = 1; i <= MAX_POLL_ATTEMPTS; i++) {
    const envelope = `<?xml version="1.0" encoding="utf-8"?>
<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/">
  <s:Header xmlns="https://bingads.microsoft.com/Reporting/v13">
    <Action mustUnderstand="1">PollGenerateReport</Action>
    <AuthenticationToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(accessToken)}</AuthenticationToken>
    <CustomerAccountId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${accountId}</CustomerAccountId>
    <CustomerId i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${customerId}</CustomerId>
    <DeveloperToken i:nil="false" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">${escapeXml(rawDevToken)}</DeveloperToken>
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
    const xml = await res.text();
    if (!res.ok) throw new Error(`Bing poll error: ${xml}`);

    const status = xmlTag(xml, "Status");
    const url    = xmlTag(xml, "ReportDownloadUrl");
    if (status === "Success") return url || null;
    if (status === "Error")   throw new Error(`Bing report failed: ${xml}`);

    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error("Timed out waiting for Bing report.");
}

async function downloadReport(url) {
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

// ─── data processing ──────────────────────────────────────────────────────────

function normalizeDate(raw) {
  if (!raw) return null;
  // Bing returns M/D/YYYY or YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const m = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return raw;
}

function numVal(row, keys) {
  const v = firstVal(row, keys);
  const n = Number(String(v || "0").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function buildDashboardData(budgetMap, rows) {
  const campaignAgg = new Map();  // campaignId → {name, status, clicks, impressions, spend, conversions, revenue}
  const trendAgg    = new Map();  // date → {clicks, impressions, spend}

  for (const row of rows) {
    const id   = firstVal(row, ["CampaignId", "Campaign ID"]) || "unknown";
    const name = firstVal(row, ["CampaignName", "Campaign Name"]) || id;
    const date = normalizeDate(firstVal(row, ["TimePeriod", "Gregorian date"]));

    const clicks      = numVal(row, ["Clicks"]);
    const impressions = numVal(row, ["Impressions"]);
    const spend       = numVal(row, ["Spend"]);
    const conversions = numVal(row, ["Conversions"]);
    const revenue     = numVal(row, ["Revenue"]);

    // Campaign aggregation
    const ca = campaignAgg.get(id) || { name, status: firstVal(row, ["CampaignStatus", "Campaign Status"]), clicks: 0, impressions: 0, spend: 0, conversions: 0, revenue: 0 };
    ca.clicks      += clicks;
    ca.impressions += impressions;
    ca.spend       += spend;
    ca.conversions += conversions;
    ca.revenue     += revenue;
    campaignAgg.set(id, ca);

    // Trend aggregation
    if (date) {
      const ta = trendAgg.get(date) || { clicks: 0, impressions: 0, spend: 0 };
      ta.clicks      += clicks;
      ta.impressions += impressions;
      ta.spend       += spend;
      trendAgg.set(date, ta);
    }
  }

  // Build campaigns array merging budget data
  const campaigns = [];
  for (const [id, agg] of campaignAgg.entries()) {
    const meta   = budgetMap.get(id) || {};
    const ctr    = agg.impressions > 0 ? parseFloat(((agg.clicks / agg.impressions) * 100).toFixed(2)) : 0;
    const cpc    = agg.clicks > 0 ? parseFloat((agg.spend / agg.clicks).toFixed(2)) : 0;
    const roas   = agg.spend > 0 ? parseFloat((agg.revenue / agg.spend).toFixed(2)) : 0;
    campaigns.push({
      id,
      name:        meta.name || agg.name,
      status:      meta.status || agg.status,
      budget:      meta.budget ? parseFloat(meta.budget) : null,
      budgetType:  meta.budgetType || null,
      clicks:      agg.clicks,
      impressions: agg.impressions,
      spend:       parseFloat(agg.spend.toFixed(2)),
      conversions: agg.conversions,
      revenue:     parseFloat(agg.revenue.toFixed(2)),
      ctr,
      cpc,
      roas,
    });
  }

  // Campaigns with no rows in the report had $0 spend — skip them entirely.

  // Filter to only campaigns with spend > 0 and sort by spend descending
  const activeWithSpend = campaigns.filter((c) => c.spend > 0);
  activeWithSpend.sort((a, b) => b.spend - a.spend);
  campaigns.length = 0;
  campaigns.push(...activeWithSpend);

  // Trend sorted by date
  const trend = [...trendAgg.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, t]) => ({
      date,
      clicks:      t.clicks,
      impressions: t.impressions,
      spend:       parseFloat(t.spend.toFixed(2)),
    }));

  // Totals
  const totalClicks      = campaigns.reduce((s, c) => s + c.clicks, 0);
  const totalImpressions = campaigns.reduce((s, c) => s + c.impressions, 0);
  const totalSpend       = parseFloat(campaigns.reduce((s, c) => s + c.spend, 0).toFixed(2));
  const totalConversions = campaigns.reduce((s, c) => s + c.conversions, 0);
  const totalRevenue     = parseFloat(campaigns.reduce((s, c) => s + c.revenue, 0).toFixed(2));
  const avgCtr           = totalImpressions > 0 ? parseFloat(((totalClicks / totalImpressions) * 100).toFixed(2)) : 0;
  const avgCpc           = totalClicks > 0 ? parseFloat((totalSpend / totalClicks).toFixed(2)) : 0;
  const overallRoas      = totalSpend > 0 ? parseFloat((totalRevenue / totalSpend).toFixed(2)) : 0;

  return {
    totals: { clicks: totalClicks, impressions: totalImpressions, spend: totalSpend, conversions: totalConversions, revenue: totalRevenue, ctr: avgCtr, cpc: avgCpc, roas: overallRoas },
    campaigns,
    trend,
  };
}

// ─── handler ──────────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const preset      = searchParams.get("preset")     || "28d";
  const startParam  = searchParams.get("startDate")  || null;
  const endParam    = searchParams.get("endDate")    || null;
  const accountId   = searchParams.get("accountId")  || null;
  const customerId  = searchParams.get("customerId") || null;

  const range = buildDateRange(preset, startParam, endParam);

  try {
    const accessToken  = await fetchAccessToken();
    const [budgetMap, reportId] = await Promise.all([
      fetchCampaignBudgetMap(accessToken, accountId, customerId),
      submitReport(accessToken, range, accountId, customerId),
    ]);
    const downloadUrl = await pollReport(accessToken, reportId, accountId, customerId);
    const rows        = await downloadReport(downloadUrl);
    const result      = buildDashboardData(budgetMap, rows);

    return NextResponse.json({
      ...result,
      startDate: range.startDate,
      endDate:   range.endDate,
    });
  } catch (err) {
    console.error("Bing dashboard API error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch Bing data" }, { status: 500 });
  }
}
