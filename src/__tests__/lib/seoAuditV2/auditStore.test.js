import { beforeEach, describe, expect, it, vi } from 'vitest';

const c = { updateOne: vi.fn(), findOne: vi.fn(), findOneAndUpdate: vi.fn() };
vi.mock('@/lib/mongoose', () => ({ default: vi.fn(async () => ({ db: () => ({ collection: () => c }) })) }));

const store = await import('@/lib/seoAuditV2/auditStore');

const ID = '64b7f0c2a1b2c3d4e5f60718';
const NOW = new Date('2026-11-20T12:00:00Z');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('claimReplan', () => {
  it('claims only when no update is running or the last one is older than 6 minutes', async () => {
    c.updateOne.mockResolvedValue({ modifiedCount: 1 });
    expect(await store.claimReplan(ID, NOW)).toBe(true);
    const [filter, update] = c.updateOne.mock.calls[0];
    expect(String(filter._id)).toBe(ID);
    expect(filter.$or).toEqual([
      { replanning: { $exists: false } },
      { replanning: { $lt: '2026-11-20T11:54:00.000Z' } },
    ]);
    expect(update).toEqual({ $set: { replanning: NOW.toISOString() } });
  });

  it('false when another update holds it, or the id is malformed', async () => {
    c.updateOne.mockResolvedValue({ modifiedCount: 0 });
    expect(await store.claimReplan(ID, NOW)).toBe(false);
    expect(await store.claimReplan('bad', NOW)).toBe(false);
  });
});

describe('removeCorrection', () => {
  it('pulls the correction and records when the corrections last changed', async () => {
    c.findOneAndUpdate.mockResolvedValue({ _id: ID, corrections: [{ id: 'c2' }] });
    expect(await store.removeCorrection(ID, 'c1', NOW)).toEqual([{ id: 'c2' }]);
    const [, update] = c.findOneAndUpdate.mock.calls[0];
    expect(update).toEqual({ $pull: { corrections: { id: 'c1' } }, $set: { correctionsChangedAt: NOW.toISOString() } });
  });
});

describe('finishReplan / releaseReplan', () => {
  it('saves the result, keeps the last 3 previous results, clears the claim and updates scores', async () => {
    const old = { audit_date: '2026-11-01' };
    c.findOne.mockResolvedValue({ auditResult: old });
    const result = { scores: { seo: { score: 30 }, geo: { score: 20 }, aeo: { score: 10 } } };
    await store.finishReplan(ID, result);
    const [, update] = c.updateOne.mock.calls[0];
    expect(update).toEqual({
      $set: { auditResult: result, scores: { seo: 30, geo: 20, aeo: 10, combined: 60 } },
      $push: { previousResults: { $each: [old], $slice: -3 } },
      $unset: { replanning: '' },
    });
  });

  it('combined is null when a score is missing', async () => {
    c.findOne.mockResolvedValue({ auditResult: {} });
    await store.finishReplan(ID, { scores: { seo: { score: 30 } } });
    expect(c.updateOne.mock.calls[0][1].$set.scores).toEqual({ seo: 30, geo: null, aeo: null, combined: null });
  });

  it('releaseReplan clears the claim', async () => {
    await store.releaseReplan(ID);
    expect(c.updateOne.mock.calls[0][1]).toEqual({ $unset: { replanning: '' } });
  });
});
