import { describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("googleapis", () => ({ google: { webmasters: vi.fn() } }));
vi.mock("@/lib/auth", () => ({ authOptions: {}, allowedEmailDomain: "lilikoiagency.com" }));
vi.mock("@/lib/mongoose", () => ({ default: vi.fn() }));
vi.mock("@/lib/gscClient", () => ({ createAuthedGscClient: vi.fn() }));

const { buildCommandCenter } = await import("@/app/api/command-center/route.js");

describe("buildCommandCenter", () => {
  it("joins client portal accounts to latest saved channel audits", () => {
    const now = new Date("2026-04-30T12:00:00.000Z");
    const result = buildCommandCenter({
      now,
      clients: [{
        slug: "big-bully-turf",
        name: "Big Bully Turf",
        active: true,
        domain: "https://www.bigbullyturf.com",
        adAccounts: {
          google: [{ accountId: "696-262-1280", label: "Google" }],
          meta: [{ accountId: "act_12345", label: "Meta" }],
          bing: [],
        },
      }],
      googleAudits: [{
        customerId: "6962621280",
        accountName: "BBT Google",
        lastSavedAt: new Date("2026-04-20T00:00:00.000Z"),
        lastGrade: "B",
        lastDateLabel: "Last 30 days",
      }],
      metaAudits: [{
        accountId: "12345",
        accountName: "BBT Meta",
        lastSavedAt: new Date("2026-03-01T00:00:00.000Z"),
        lastGrade: "C",
      }],
      seoAudits: [{
        domain: "bigbullyturf.com",
        createdAt: new Date("2026-04-29T00:00:00.000Z"),
        scores: { combined: 82 },
      }],
      searchConsoleConnected: true,
      searchConsoleByDomain: new Map([["bigbullyturf.com", {
        connected: true,
        siteUrl: "sc-domain:bigbullyturf.com",
        clicks: 1200,
        impressions: 42000,
        ctr: 2.86,
        position: 8.4,
        topQuery: "artificial turf",
      }]]),
    });

    expect(result.totals.clients).toBe(1);
    expect(result.totals.connectedChannels).toBe(4);
    expect(result.clients[0].name).toBe("Big Bully Turf");
    expect(result.clients[0].channels.find((c) => c.label === "Google").grade).toBe("B");
    expect(result.clients[0].channels.find((c) => c.label === "Meta").status).toBe("Audit stale");
    expect(result.clients[0].channels.find((c) => c.label === "GSC").metric.clicks).toBe(1200);
    expect(result.clients[0].channels.find((c) => c.label === "SEO Audit").status).toBe("Audit saved");
  });

  it("flags connected channels without saved audits", () => {
    const result = buildCommandCenter({
      now: new Date("2026-04-30T12:00:00.000Z"),
      clients: [{
        slug: "example",
        name: "Example",
        adAccounts: { google: [{ accountId: "111" }], meta: [], bing: [] },
      }],
    });

    expect(result.totals.needsAttention).toBe(1);
    expect(result.clients[0].missingAuditCount).toBe(1);
    expect(result.clients[0].channels.find((c) => c.label === "Google").status).toBe("No saved audit");
  });
});
