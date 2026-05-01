import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { google } from "googleapis";
import { authOptions, allowedEmailDomain } from "../../../lib/auth";
import { createAuthedGscClient } from "../../../lib/gscClient";
import dbConnect from "../../../lib/mongoose";

const DB = "tokensApi";

function normalizeId(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeDomain(value) {
  return String(value || "")
    .replace(/^sc-domain:/i, "")
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
}

function normalizeSiteUrl(value) {
  return String(value || "").replace(/\/$/, "");
}

function getClientDomains(client) {
  return [
    client.domain,
    client.website,
    client.siteUrl,
    client.gscSiteUrl,
    ...(Array.isArray(client.domains) ? client.domains : []),
  ].filter(Boolean).map(normalizeDomain).filter(Boolean);
}

function daysSince(value, now = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

function normalizeGrade(value) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase() : null;
}

function gradeSeverity(grade) {
  if (!grade) return 1;
  if (["A", "A+", "A-"].includes(grade)) return 0;
  if (["B", "B+", "B-"].includes(grade)) return 1;
  return 2;
}

function freshnessSeverity(days) {
  if (days == null) return 1;
  if (days <= 14) return 0;
  if (days <= 45) return 1;
  return 2;
}

function buildChannelSignal({ label, href, audit, accountCount, now }) {
  const days = daysSince(audit?.lastSavedAt, now);
  const grade = normalizeGrade(audit?.lastGrade);
  const severity = audit
    ? Math.max(gradeSeverity(grade), freshnessSeverity(days))
    : accountCount > 0 ? 1 : 0;

  let status = "Not connected";
  if (accountCount > 0 && !audit) status = "No saved audit";
  if (audit) status = `${grade || "Ungraded"} audit`;
  if (audit && days != null && days > 45) status = "Audit stale";

  return {
    label,
    href,
    connected: accountCount > 0,
    accountCount,
    status,
    grade,
    lastSavedAt: audit?.lastSavedAt || null,
    lastDateLabel: audit?.lastDateLabel || null,
    daysSinceAudit: days,
    severity,
  };
}

function getSearchConsoleSignal(domains, searchConsoleByDomain) {
  for (const domain of domains) {
    const signal = searchConsoleByDomain.get(domain);
    if (signal) return signal;
  }
  return null;
}

export async function fetchSearchConsoleSignals(clients = []) {
  const auth = await createAuthedGscClient();
  if (!auth) return { connected: false, byDomain: new Map() };

  const webmasters = google.webmasters({ version: "v3", auth });
  const sitesRes = await webmasters.sites.list();
  const sites = (sitesRes.data.siteEntry || [])
    .filter((site) => ["siteOwner", "siteFullUser", "siteRestrictedUser"].includes(site.permissionLevel))
    .map((site) => ({ ...site, normalizedDomain: normalizeDomain(site.siteUrl), siteUrl: normalizeSiteUrl(site.siteUrl) }));

  const wantedDomains = Array.from(new Set(clients.flatMap(getClientDomains)));
  const matchedSites = wantedDomains
    .map((domain) => {
      const exact = sites.find((site) => site.normalizedDomain === domain);
      if (exact) return { domain, siteUrl: exact.siteUrl, permissionLevel: exact.permissionLevel };
      const suffix = sites.find((site) => domain.endsWith(`.${site.normalizedDomain}`) || site.normalizedDomain.endsWith(`.${domain}`));
      return suffix ? { domain, siteUrl: suffix.siteUrl, permissionLevel: suffix.permissionLevel } : null;
    })
    .filter(Boolean);

  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 28);
  const toYmd = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const startDate = toYmd(start);
  const endDate = toYmd(end);

  const entries = await Promise.all(matchedSites.map(async (site) => {
    try {
      const [totalRes, queryRes] = await Promise.all([
        webmasters.searchanalytics.query({
          siteUrl: site.siteUrl,
          requestBody: { startDate, endDate, rowLimit: 1 },
        }),
        webmasters.searchanalytics.query({
          siteUrl: site.siteUrl,
          requestBody: { startDate, endDate, dimensions: ["query"], rowLimit: 1 },
        }),
      ]);
      const total = totalRes.data.rows?.[0] || {};
      const topQuery = queryRes.data.rows?.[0] || null;
      return [site.domain, {
        connected: true,
        siteUrl: site.siteUrl,
        startDate,
        endDate,
        clicks: Math.round(total.clicks || 0),
        impressions: Math.round(total.impressions || 0),
        ctr: total.ctr != null ? Number((total.ctr * 100).toFixed(2)) : null,
        position: total.position != null ? Number(total.position.toFixed(1)) : null,
        topQuery: topQuery?.keys?.[0] || null,
      }];
    } catch (err) {
      return [site.domain, {
        connected: true,
        siteUrl: site.siteUrl,
        startDate,
        endDate,
        error: err.message || "Search Console fetch failed",
      }];
    }
  }));

  return { connected: true, byDomain: new Map(entries) };
}

export function buildCommandCenter({ clients = [], googleAudits = [], metaAudits = [], seoAudits = [], searchConsoleByDomain = new Map(), searchConsoleConnected = false, pacing = null, now = new Date() }) {
  const googleById = new Map(googleAudits.map((audit) => [normalizeId(audit.customerId), audit]));
  const metaById = new Map(metaAudits.map((audit) => [normalizeId(audit.accountId), audit]));
  const seoByDomain = new Map(seoAudits.map((audit) => [normalizeDomain(audit.domain), audit]));

  const clientCards = clients.map((client) => {
    const googleAccounts = client.adAccounts?.google || [];
    const metaAccounts = client.adAccounts?.meta || [];
    const bingAccounts = client.adAccounts?.bing || [];
    const domains = getClientDomains(client);

    const googleAudit = googleAccounts
      .map((account) => googleById.get(normalizeId(account.accountId)))
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastSavedAt || 0) - new Date(a.lastSavedAt || 0))[0] || null;
    const metaAudit = metaAccounts
      .map((account) => metaById.get(normalizeId(account.accountId)))
      .filter(Boolean)
      .sort((a, b) => new Date(b.lastSavedAt || 0) - new Date(a.lastSavedAt || 0))[0] || null;
    const seoAudit = domains
      .map((domain) => seoByDomain.get(domain))
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))[0] || null;
    const searchConsole = getSearchConsoleSignal(domains, searchConsoleByDomain);

    const channels = [
      buildChannelSignal({
        label: "Google",
        href: "/dashboard/google/ads",
        audit: googleAudit,
        accountCount: googleAccounts.length,
        now,
      }),
      buildChannelSignal({
        label: "Meta",
        href: "/dashboard/meta/audit",
        audit: metaAudit,
        accountCount: metaAccounts.length,
        now,
      }),
      {
        label: "Bing",
        href: "/dashboard/bing",
        connected: bingAccounts.length > 0,
        accountCount: bingAccounts.length,
        status: bingAccounts.length > 0 ? "Connected" : "Not connected",
        severity: bingAccounts.length > 0 ? 0 : 0,
      },
      {
        label: "GSC",
        href: "/dashboard/google/organic",
        connected: domains.length > 0 && searchConsoleConnected,
        accountCount: domains.length,
        status: searchConsole?.error
          ? "Fetch error"
          : searchConsole
            ? `${searchConsole.clicks.toLocaleString("en-US")} clicks`
            : domains.length > 0 && searchConsoleConnected
              ? "Property not matched"
              : "Not connected",
        metric: searchConsole && !searchConsole.error ? {
          clicks: searchConsole.clicks,
          impressions: searchConsole.impressions,
          ctr: searchConsole.ctr,
          position: searchConsole.position,
          topQuery: searchConsole.topQuery,
        } : null,
        siteUrl: searchConsole?.siteUrl || null,
        severity: searchConsole?.error ? 1 : searchConsole ? 0 : domains.length > 0 && searchConsoleConnected ? 1 : 0,
      },
      {
        label: "SEO Audit",
        href: "/dashboard/seo-audit",
        connected: domains.length > 0 || !!seoAudit,
        accountCount: domains.length,
        status: seoAudit ? "Audit saved" : domains.length > 0 ? "No saved audit" : "No domain",
        grade: seoAudit?.scores?.combined ?? seoAudit?.score ?? null,
        lastSavedAt: seoAudit?.createdAt || null,
        daysSinceAudit: daysSince(seoAudit?.createdAt, now),
        severity: seoAudit ? freshnessSeverity(daysSince(seoAudit.createdAt, now)) : domains.length > 0 ? 1 : 0,
      },
    ];

    const severity = Math.max(...channels.map((channel) => channel.severity || 0));
    const connectedChannels = channels.filter((channel) => channel.connected).length;
    const staleCount = channels.filter((channel) => (channel.daysSinceAudit || 0) > 45).length;
    const missingAuditCount = channels.filter((channel) => channel.connected && channel.status === "No saved audit").length;

    return {
      slug: client.slug,
      name: client.name,
      active: client.active !== false,
      href: `/dashboard/admin/clients`,
      portalHref: client.slug ? `/portal/${client.slug}` : null,
      connectedChannels,
      channels,
      staleCount,
      missingAuditCount,
      severity,
      updatedAt: client.updatedAt || client.createdAt || null,
    };
  }).sort((a, b) => {
    if (b.severity !== a.severity) return b.severity - a.severity;
    if (b.missingAuditCount !== a.missingAuditCount) return b.missingAuditCount - a.missingAuditCount;
    return a.name.localeCompare(b.name);
  });

  const totals = {
    clients: clientCards.length,
    activeClients: clientCards.filter((client) => client.active).length,
    needsAttention: clientCards.filter((client) => client.severity >= 2 || client.missingAuditCount > 0).length,
    connectedChannels: clientCards.reduce((sum, client) => sum + client.connectedChannels, 0),
    googleAudits: googleAudits.length,
    metaAudits: metaAudits.length,
    seoAudits: seoAudits.length,
    searchConsoleConnected,
  };

  return {
    generatedAt: now.toISOString(),
    totals,
    clients: clientCards.slice(0, 12),
    pacing,
  };
}

export async function GET() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email?.toLowerCase() || "";
  if (!email.endsWith(`@${allowedEmailDomain}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const client = await dbConnect();
  const db = client.db(DB);

  const [clients, googleAudits, metaAudits, seoAudits, pacing] = await Promise.all([
    db.collection("ClientPortals").find({}, { projection: { accessToken: 0 } }).sort({ name: 1 }).toArray(),
    db.collection("GoogleAdsAudits").aggregate([
      { $sort: { savedAt: -1 } },
      { $group: { _id: "$customerId", customerId: { $first: "$customerId" }, accountName: { $first: "$accountName" }, lastSavedAt: { $first: "$savedAt" }, lastGrade: { $first: "$summary.accountGrade" }, lastDateLabel: { $first: "$dateLabel" }, auditCount: { $sum: 1 } } },
    ]).toArray(),
    db.collection("MetaAudits").aggregate([
      { $sort: { savedAt: -1 } },
      { $group: { _id: "$accountId", accountId: { $first: "$accountId" }, accountName: { $first: "$accountName" }, lastSavedAt: { $first: "$savedAt" }, lastGrade: { $first: "$summary.accountGrade" }, lastDateLabel: { $first: "$dateLabel" }, auditCount: { $sum: 1 } } },
    ]).toArray(),
    db.collection("SeoAudits").find({}, { projection: { crawlData: 0, auditResult: 0 } }).sort({ createdAt: -1 }).limit(100).toArray(),
    db.collection("PacingReports").find({ dryRun: { $ne: true } }).sort({ createdAt: -1 }).project({ html: 0, parsedData: 0 }).limit(1).next(),
  ]);
  const searchConsole = await fetchSearchConsoleSignals(clients).catch((err) => {
    console.warn("[command-center/gsc]", err.message);
    return { connected: false, byDomain: new Map() };
  });

  return NextResponse.json({
    data: buildCommandCenter({
      clients,
      googleAudits,
      metaAudits,
      seoAudits,
      searchConsoleByDomain: searchConsole.byDomain,
      searchConsoleConnected: searchConsole.connected,
      pacing: pacing ? {
        _id: pacing._id,
        reportDate: pacing.reportDate,
        createdAt: pacing.createdAt,
        summary: pacing.summary,
        status: pacing.status,
      } : null,
    }),
  });
}
