import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {}, allowedEmailDomain: "lilikoiagency.com" }));
vi.mock("@/lib/serverCache", () => ({ getCached: vi.fn(async () => null), setCached: vi.fn(async () => {}) }));
vi.mock("@/lib/ga4Client", () => ({ listProperties: vi.fn(), fetchTrafficReport: vi.fn() }));

const { getServerSession } = await import("next-auth");
const { setCached } = await import("@/lib/serverCache");
const { listProperties, fetchTrafficReport } = await import("@/lib/ga4Client");
const { GET: getReport } = await import("@/app/api/ga4/report/route.js");
const { GET: getProps } = await import("@/app/api/ga4/properties/route.js");

const url = (qs) => ({ url: `http://localhost/api/ga4/report?${qs}` });
const base = "property=properties/1&startDate=2026-10-01&endDate=2026-10-31&compare=prev&granularity=day";
const prop = { id: "properties/1", name: "Acme", account: "Acme Inc" };

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: "a@lilikoiagency.com" } });
  listProperties.mockResolvedValue([prop]);
});

describe("ga4 routes", () => {
  it("401 when session is not lilikoi", async () => {
    getServerSession.mockResolvedValue({ user: { email: "x@gmail.com" } });
    const res = await getReport(url(base));
    expect(res.init.status).toBe(401);
    expect(res.body.error).toBe("unauthorized");
    const p = await getProps(url(""));
    expect(p.init.status).toBe(401);
  });

  it("400 for bad dates", async () => {
    const res = await getReport(url(base.replace("startDate=2026-10-01", "startDate=2026-10-31").replace("endDate=2026-10-31", "endDate=2026-10-01")));
    expect(res.init.status).toBe(400);
    expect(res.body.error).toBe("bad_params");
    expect(fetchTrafficReport).not.toHaveBeenCalled();
  });

  it("400 for bad compare", async () => {
    const res = await getReport(url(base.replace("compare=prev", "compare=lastweek")));
    expect(res.init.status).toBe(400);
  });

  it("400 for malformed property", async () => {
    const res = await getReport(url(base.replace("properties/1", "properties/abc")));
    expect(res.init.status).toBe(400);
  });

  it("403 when property not visible", async () => {
    const res = await getReport(url(base.replace("properties/1", "properties/2")));
    expect(res.init.status).toBe(403);
    expect(res.body.error).toBe("no_access");
    expect(fetchTrafficReport).not.toHaveBeenCalled();
  });

  it("200 passes property name/account into fetchTrafficReport", async () => {
    fetchTrafficReport.mockResolvedValue({ ok: true });
    const res = await getReport(url(base));
    expect(res.body).toEqual({ ok: true });
    expect(fetchTrafficReport).toHaveBeenCalledWith({
      property: prop, startDate: "2026-10-01", endDate: "2026-10-31", compare: "prev", granularity: "day",
    });
    expect(setCached).toHaveBeenCalledWith(
      "ga4:report:properties/1:2026-10-01:2026-10-31:prev:day", { ok: true }, 6 * 60 * 60 * 1000);
  });

  it("429 maps GA quota error", async () => {
    fetchTrafficReport.mockRejectedValue({ code: 429, message: "quota" });
    const res = await getReport(url(base));
    expect(res.init.status).toBe(429);
    expect(res.body.error).toBe("quota");
  });

  it("500 missing_key without leaking details", async () => {
    listProperties.mockRejectedValue(new Error("GA4_SA_KEY env var not set"));
    const res = await getReport(url(base));
    expect(res.init.status).toBe(500);
    expect(res.body.error).toBe("missing_key");
  });

  it("502 ga_error returns only the message", async () => {
    fetchTrafficReport.mockRejectedValue(Object.assign(new Error("boom"), { config: { headers: { Authorization: "Bearer secret" } } }));
    const res = await getReport(url(base));
    expect(res.init.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain("secret");
  });

  it("properties route returns list", async () => {
    const res = await getProps(url(""));
    expect(res.body).toEqual({ properties: [prop] });
  });
});
