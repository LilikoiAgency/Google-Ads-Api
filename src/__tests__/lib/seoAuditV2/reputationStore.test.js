import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/mongoose', () => ({ default: vi.fn() }));

const dbConnect = (await import('@/lib/mongoose')).default;
let store;

describe('reputationStore (Mongo calls)', () => {
  const colls = {};
  const coll = (name) => {
    colls[name] ||= {
      updateOne: vi.fn(async () => ({})),
      findOne: vi.fn(async () => null),
      deleteOne: vi.fn(async () => ({})),
      createIndex: vi.fn(async () => 'createdAt_1'),
    };
    return colls[name];
  };

  beforeEach(async () => {
    for (const k of Object.keys(colls)) delete colls[k];
    dbConnect.mockResolvedValue({ db: (name) => { expect(name).toBe('tokensApi'); return { collection: coll }; } });
    vi.resetModules();
    store = await import('@/lib/seoAuditV2/reputationStore');
  });

  it('saveLocations upserts by bare domain', async () => {
    const locs = [{ source: 'places', id: 'ChIJ0000000001', name: 'A' }];
    await store.saveLocations('www.X.com', locs);
    const [filter, update, opts] = coll('SeoAuditLocations').updateOne.mock.calls[0];
    expect(filter).toEqual({ domain: 'x.com' });
    expect(update.$set.locations).toEqual(locs);
    expect(update.$set.updatedAt).toBeInstanceOf(Date);
    expect(opts).toEqual({ upsert: true });
  });

  it('getSavedLocations returns the picks or null', async () => {
    expect(await store.getSavedLocations('www.x.com')).toBeNull();
    expect(coll('SeoAuditLocations').findOne.mock.calls[0][0]).toEqual({ domain: 'x.com' });
    coll('SeoAuditLocations').findOne.mockResolvedValueOnce({ domain: 'x.com', locations: [{ source: 'gbp', id: 'locations/1', name: 'A' }] });
    expect(await store.getSavedLocations('x.com')).toEqual([{ source: 'gbp', id: 'locations/1', name: 'A' }]);
  });

  it('saveReviewTexts creates the TTL index once', async () => {
    const by = { ChIJ0000000001: [{ stars: 5, date: '2026-11-01', text: 'Great' }] };
    await store.saveReviewTexts('job1', by);
    await store.saveReviewTexts('job2', by);
    const c = coll('SeoAuditPlacesCache');
    expect(c.createIndex).toHaveBeenCalledTimes(1);
    expect(c.createIndex).toHaveBeenCalledWith({ createdAt: 1 }, { expireAfterSeconds: 86400 });
    const [filter, update, opts] = c.updateOne.mock.calls[0];
    expect(filter).toEqual({ jobId: 'job1' });
    expect(update.$set).toMatchObject({ jobId: 'job1', byLocation: by });
    expect(update.$set.createdAt).toBeInstanceOf(Date);
    expect(opts).toEqual({ upsert: true });
  });

  it('getReviewTexts returns null when expired/missing', async () => {
    expect(await store.getReviewTexts('gone')).toBeNull();
    coll('SeoAuditPlacesCache').findOne.mockResolvedValueOnce({ jobId: 'j', byLocation: { a: [] } });
    expect(await store.getReviewTexts('j')).toEqual({ a: [] });
  });

  describe('slimReviewSources', () => {
    const ID = '507f1f77bcf86cd799439011';
    const found = (reviews) => coll('SeoAuditJobs').findOne.mockResolvedValueOnce({ data: { sources: { reviews } } });

    it('keeps only source, id, name and coverage for places locations; gbp entries untouched', async () => {
      const gbp = { source: 'gbp', id: 'locations/1', name: 'G', city: 'Tampa', coverage: 'full', stats: { rating: 5 } };
      found([{ source: 'places', id: 'p1', name: 'A', city: 'Tampa', region: 'FL', coverage: 'sample', stats: { rating: 4 } }, gbp]);
      coll('SeoAuditJobs').updateOne.mockResolvedValueOnce({ modifiedCount: 1 });
      expect(await store.slimReviewSources(ID)).toBe(true);
      const [filter, update] = coll('SeoAuditJobs').updateOne.mock.calls[0];
      expect(filter.status).toEqual({ $in: ['done', 'failed'] });
      expect(update.$set['data.sources.reviews']).toEqual([{ source: 'places', id: 'p1', name: 'A', coverage: 'sample' }, gbp]);
    });

    it('is idempotent: already slim, absent or bad id writes nothing', async () => {
      found([{ source: 'places', id: 'p1', name: 'A', coverage: 'sample' }]);
      expect(await store.slimReviewSources(ID)).toBe(false);
      found(null);
      expect(await store.slimReviewSources(ID)).toBe(false);
      expect(await store.slimReviewSources('nope')).toBe(false);
      expect(coll('SeoAuditJobs').updateOne).not.toHaveBeenCalled();
    });
  });

  it('dropReviewTexts deletes by job id', async () => {
    await store.dropReviewTexts('job1');
    expect(coll('SeoAuditPlacesCache').deleteOne).toHaveBeenCalledWith({ jobId: 'job1' });
  });
});
