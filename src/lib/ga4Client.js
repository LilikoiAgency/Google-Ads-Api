// src/lib/ga4Client.js
// Service-account GA4 client: lists visible properties and fetches the web
// traffic report. googleapis errors propagate with their `code` intact.

import { google } from 'googleapis';
import { compareRange as computeCompareRange } from './ga4Dates';
import { buildReportRequests, normalizeTrafficReport } from './ga4Report';

const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

export function getGa4Auth() {
  const raw = process.env.GA4_SA_KEY;
  if (!raw) throw new Error('GA4_SA_KEY env var not set');
  let creds;
  try { creds = JSON.parse(raw); }
  catch { throw new Error('GA4_SA_KEY is not valid JSON'); }
  return new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: SCOPES,
  });
}

export async function listProperties() {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: getGa4Auth() });
  const out = [];
  let pageToken;
  do {
    const res = await admin.accountSummaries.list({ pageSize: 200, pageToken });
    for (const acct of res.data.accountSummaries || []) {
      for (const p of acct.propertySummaries || []) {
        out.push({ id: p.property, name: p.displayName, account: acct.displayName });
      }
    }
    pageToken = res.data.nextPageToken || undefined;
  } while (pageToken);
  return out.sort((a, b) =>
    String(a.account).localeCompare(String(b.account)) || String(a.name).localeCompare(String(b.name)));
}

export async function fetchTrafficReport({ property, startDate, endDate, compare, granularity }) {
  const range = { startDate, endDate };
  const cmp = computeCompareRange(range, compare);
  const requests = buildReportRequests({ startDate, endDate, compareRange: cmp, granularity });
  const data = google.analyticsdata({ version: 'v1beta', auth: getGa4Auth() });
  const batch = (reqs) => data.properties
    .batchRunReports({ property: property.id, requestBody: { requests: reqs } })
    .then((res) => res.data.reports || []);
  // batchRunReports takes at most 5 requests.
  const chunks = [];
  for (let i = 0; i < requests.length; i += 5) chunks.push(requests.slice(i, i + 5));
  const results = await Promise.all(chunks.map(batch));
  return normalizeTrafficReport(results.flat(), { property, range, compareRange: cmp, granularity });
}

// Web data streams for the given properties, so a website domain can be matched
// to its GA4 property. One Admin API call per property. onError(property) is
// called for each property whose streams could not be listed.
export async function listWebStreams(properties, { onError } = {}) {
  const admin = google.analyticsadmin({ version: 'v1beta', auth: getGa4Auth() });
  const out = [];
  for (const p of properties) {
    try {
      const res = await admin.properties.dataStreams.list({ parent: p.id });
      for (const s of res.data.dataStreams || []) {
        if (s.type === 'WEB_DATA_STREAM' && s.webStreamData?.defaultUri) {
          out.push({ propertyId: p.id, propertyName: p.name, account: p.account, uri: s.webStreamData.defaultUri });
        }
      }
    } catch (err) {
      console.warn('[ga4] could not list streams for', p.id, err?.message || err);
      onError?.(p);
    }
  }
  return out;
}
