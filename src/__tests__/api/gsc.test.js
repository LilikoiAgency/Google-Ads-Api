import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {}, allowedEmailDomain: "lilikoiagency.com" }));
vi.mock("@/lib/serverCache", () => ({
  getCached: vi.fn(async () => null), setCached: vi.fn(async () => {}), invalidateCacheByPrefix: vi.fn(async () => 0),
}));
vi.mock("@/lib/gscClient", () => ({ getSearchConsole: vi.fn(), fetchSearchReport: vi.fn(), inspectUrls: vi.fn() }));
vi.mock("@/lib/gscSettings", async () => {
  const real = await vi.importActual("@/lib/gscSettings");
  return { ...real, getSiteSettings: vi.fn(), saveSiteSettings: vi.fn() };
});

const { getServerSession } = await import("next-auth");
const { getCached, setCached } = await import("@/lib/serverCache");
const { getSearchConsole, fetchSearchReport, inspectUrls } = await import("@/lib/gscClient");
const { getSiteSettings, saveSiteSettings } = await import("@/lib/gscSettings");
const { GET: getReport } = await import("@/app/api/gsc/report/route.js");
const { POST: inspect } = await import("@/app/api/gsc/inspect/route.js");
const { PUT: putSettings } = await import("@/app/api/gsc/settings/route.js");

const site = encodeURIComponent("sc-domain:acme.com");
const req = (qs) => ({ url: `http://localhost/api/gsc/report?${qs}` });
const base = `siteUrl=${site}&startDate=2026-10-01&endDate=2026-10-31&compare=prev&type=web`;
const post = (body) => ({ json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: "a@lilikoiagency.com" } });
  getSearchConsole.mockResolvedValue({});
  getCached.mockResolvedValue(null);
  getSiteSettings.mockResolvedValue({ siteUrl: "sc-domain:acme.com", brandTerms: ["acme"], annotations: [], ga4Property: null });
});

describe("gsc routes", () => {
  it("require a lilikoi login (the old /api/organic didn't)", async () => {
    getServerSession.mockResolvedValue({ user: { email: "x@gmail.com" } });
    expect((await getReport(req(base))).init.status).toBe(401);
    expect((await inspect(post({ siteUrl: "sc-domain:acme.com", urls: ["https://acme.com/"] }))).init.status).toBe(401);
    expect((await putSettings(post({ siteUrl: "sc-domain:acme.com", brandTerms: [] }))).init.status).toBe(401);
  });

  it("validate params", async () => {
    expect((await getReport(req(base.replace("type=web", "type=shopping")))).init.status).toBe(400);
    expect((await getReport(req(base.replace(site, "ftp%3A%2F%2Fx")))).init.status).toBe(400);
    expect((await getReport(req(base.replace("2026-10-31", "2026-09-01")))).init.status).toBe(400);
    expect(fetchSearchReport).not.toHaveBeenCalled();
  });

  it("401 gsc_not_connected without a token", async () => {
    getSearchConsole.mockResolvedValue(null);
    const res = await getReport(req(base));
    expect(res.init.status).toBe(401);
    expect(res.body.error).toBe("gsc_not_connected");
  });

  it("fetches with the saved brand terms and caches under a key that includes them", async () => {
    fetchSearchReport.mockResolvedValue({ ok: 1 });
    const res = await getReport(req(base));
    expect(res.body).toEqual({ ok: 1 });
    expect(fetchSearchReport.mock.calls[0][1]).toMatchObject({ site: "sc-domain:acme.com", brandTerms: ["acme"], type: "web" });
    const key = setCached.mock.calls[0][0];
    expect(key).toMatch(/^gsc:v2:report:sc-domain:acme.com:2026-10-01:2026-10-31:prev:web:[0-9a-f]{10}$/);
  });

  it("serves the cache unless refresh=1", async () => {
    getCached.mockResolvedValue({ cached: true });
    expect((await getReport(req(base))).body).toEqual({ cached: true });
    fetchSearchReport.mockResolvedValue({ fresh: true });
    expect((await getReport(req(`${base}&refresh=1`))).body).toEqual({ fresh: true });
  });

  it("maps Google errors", async () => {
    fetchSearchReport.mockRejectedValue(Object.assign(new Error("User does not have sufficient permission"), { code: 403 }));
    const res = await getReport(req(base));
    expect(res.init.status).toBe(403);
    expect(res.body.error).toBe("no_access");
  });

  it("inspect caps the batch and caches successful results", async () => {
    const urls = Array.from({ length: 11 }, (_, i) => `https://acme.com/${i}`);
    expect((await inspect(post({ siteUrl: "sc-domain:acme.com", urls }))).init.status).toBe(400);
    inspectUrls.mockResolvedValue([{ url: "https://acme.com/", verdict: "PASS" }, { url: "https://acme.com/x", error: "boom" }]);
    const res = await inspect(post({ siteUrl: "sc-domain:acme.com", urls: ["https://acme.com/", "https://acme.com/x"] }));
    expect(res.body.results.map((r) => r.verdict || r.error)).toEqual(["PASS", "boom"]);
    expect(setCached).toHaveBeenCalledTimes(1);
  });

  it("settings PUT only passes known fields", async () => {
    saveSiteSettings.mockResolvedValue({ ok: 1 });
    await putSettings(post({ siteUrl: "sc-domain:acme.com", brandTerms: ["a"], evil: 1 }));
    expect(saveSiteSettings.mock.calls[0][1]).toEqual({ brandTerms: ["a"] });
    expect((await putSettings(post({ siteUrl: "sc-domain:acme.com", brandTerms: "a" }))).init.status).toBe(400);
  });
});
