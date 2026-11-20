import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/server', () => ({ NextResponse: { json: vi.fn((body, init) => ({ body, init })) } }));
vi.mock('next-auth', () => ({ getServerSession: vi.fn() }));
vi.mock('@/lib/auth', () => ({ authOptions: {}, allowedEmailDomain: 'lilikoiagency.com' }));
vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));
vi.mock('@/lib/seoAuditV2/jobStore', () => ({ listOpenJobs: vi.fn() }));
vi.mock('@/lib/seoAuditV2/auditStore', () => ({
  getAudit: vi.fn(),
  addCorrection: vi.fn(),
  removeCorrection: vi.fn(),
  jobCanReplan: vi.fn(),
}));
vi.mock('@/lib/seoAuditV2/briefStore', () => ({ addExclusion: vi.fn() }));

const { getServerSession } = await import('next-auth');
const dbConnect = (await import('@/lib/mongoose')).default;
const audits = await import('@/lib/seoAuditV2/auditStore');
const briefs = await import('@/lib/seoAuditV2/briefStore');
const post = await import('@/app/api/seo-audit/v2/audits/[id]/corrections/route.js');
const del = await import('@/app/api/seo-audit/v2/audits/[id]/corrections/[correctionId]/route.js');
const history = await import('@/app/api/seo-audit/history/route.js');

const USER = 'a@lilikoiagency.com';
const params = { id: 'aud1' };
const req = (body) => ({ json: async () => body });

beforeEach(() => {
  vi.clearAllMocks();
  getServerSession.mockResolvedValue({ user: { email: USER } });
  audits.getAudit.mockResolvedValue({ domain: 'acme.com', jobId: 'j1' });
  audits.addCorrection.mockImplementation(async (_id, c) => [c]);
});

describe('POST corrections', () => {
  it('401 for a non-agency email', async () => {
    getServerSession.mockResolvedValue({ user: { email: 'x@gmail.com' } });
    const res = await post.POST(req({ kind: 'not_relevant', source_ids: ['CONT-2-3'] }), { params });
    expect(res.init.status).toBe(401);
    expect(audits.addCorrection).not.toHaveBeenCalled();
  });

  it('400 for empty source_ids, unknown kind, or not_offered without a usable service', async () => {
    const bad = [
      { kind: 'not_relevant', source_ids: [] },
      { kind: 'nope', source_ids: ['a'] },
      { kind: 'not_offered', source_ids: ['a'] },
      { kind: 'not_offered', service: 'abc', source_ids: ['a'] },
    ];
    for (const b of bad) expect((await post.POST(req(b), { params })).init.status).toBe(400);
    expect(audits.addCorrection).not.toHaveBeenCalled();
  });

  it('404 when the audit is missing', async () => {
    audits.getAudit.mockResolvedValue(null);
    const res = await post.POST(req({ kind: 'not_relevant', source_ids: ['a'] }), { params });
    expect(res.init.status).toBe(404);
  });

  it('stores a not_relevant correction without touching the brief', async () => {
    const res = await post.POST(req({ kind: 'not_relevant', service: 'ignored', source_ids: ['CONT-2-3'], saveToBrief: true }), { params });
    const stored = audits.addCorrection.mock.calls[0][1];
    expect(stored).toMatchObject({ kind: 'not_relevant', source_ids: ['CONT-2-3'], by: USER });
    expect(stored.service).toBeUndefined();
    expect(stored.id).toBeTruthy();
    expect(stored.at).toMatch(/^\d{4}-/);
    expect(briefs.addExclusion).not.toHaveBeenCalled();
    expect(res.body.corrections).toHaveLength(1);
  });

  it('not_offered stores the trimmed service and adds the exclusion only with saveToBrief', async () => {
    await post.POST(req({ kind: 'not_offered', service: '  roof repair ', source_ids: ['a'] }), { params });
    expect(audits.addCorrection.mock.calls[0][1].service).toBe('roof repair');
    expect(briefs.addExclusion).not.toHaveBeenCalled();
    await post.POST(req({ kind: 'not_offered', service: ' roof repair ', source_ids: ['a'], saveToBrief: true }), { params });
    expect(briefs.addExclusion).toHaveBeenCalledWith('acme.com', 'roof repair', USER);
  });
});

describe('DELETE correction', () => {
  it('401 for a non-agency email', async () => {
    getServerSession.mockResolvedValue(null);
    expect((await del.DELETE({}, { params: { id: 'aud1', correctionId: 'c1' } })).init.status).toBe(401);
  });

  it('returns the remaining corrections and leaves the brief alone', async () => {
    audits.removeCorrection.mockResolvedValue([{ id: 'c2' }]);
    const res = await del.DELETE({}, { params: { id: 'aud1', correctionId: 'c1' } });
    expect(audits.removeCorrection).toHaveBeenCalledWith('aud1', 'c1', expect.any(Date));
    const now = audits.removeCorrection.mock.calls[0][2];
    expect(res.body).toEqual({ corrections: [{ id: 'c2' }], correctionsChangedAt: now.toISOString() });
    expect(briefs.addExclusion).not.toHaveBeenCalled();
  });
});

describe('history canReplan', () => {
  const oidHex = '507f1f77bcf86cd799439011';
  it('single GET includes canReplan', async () => {
    const findOne = vi.fn().mockResolvedValue({ _id: oidHex, jobId: 'j1', domain: 'acme.com' });
    dbConnect.mockResolvedValue({ db: () => ({ collection: () => ({ findOne }) }) });
    audits.jobCanReplan.mockResolvedValue(true);
    const res = await history.GET({ url: `http://localhost/api/seo-audit/history?id=${oidHex}` });
    expect(audits.jobCanReplan).toHaveBeenCalledWith('j1');
    expect(res.body.canReplan).toBe(true);
  });

  it('list projection excludes previousResults', async () => {
    const find = vi.fn(() => ({ sort: () => ({ limit: () => ({ toArray: async () => [] }) }) }));
    dbConnect.mockResolvedValue({ db: () => ({ collection: () => ({ find }) }) });
    const jobStore = await import('@/lib/seoAuditV2/jobStore');
    jobStore.listOpenJobs.mockResolvedValue([]);
    await history.GET({ url: 'http://localhost/api/seo-audit/history' });
    expect(find.mock.calls[0][1].projection).toMatchObject({ previousResults: 0 });
  });
});
