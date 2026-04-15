import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock mongodb before importing the module under test
const mockConnect = vi.fn().mockResolvedValue('mock-client');
const MockMongoClient = vi.fn(function () { return { connect: mockConnect }; });

vi.mock('mongodb', () => ({
  MongoClient: MockMongoClient,
}));

describe('dbConnect', () => {
  beforeEach(() => {
    // Clear the cached promise between tests by deleting the global
    delete global._mongoClientPromise;
    vi.resetModules();
    MockMongoClient.mockClear();
    mockConnect.mockClear();
  });

  it('returns the same promise on repeated calls without creating a second client', async () => {
    const { default: dbConnect } = await import('@/lib/mongoose.js');

    const p1 = dbConnect();
    const p2 = dbConnect();

    expect(MockMongoClient).toHaveBeenCalledTimes(1);
    expect(await p1).toBe(await p2);
  });

  it('reuses the cached global promise across module reloads', async () => {
    const { default: dbConnect } = await import('@/lib/mongoose.js');
    await dbConnect();

    vi.resetModules();
    const { default: dbConnect2 } = await import('@/lib/mongoose.js');
    await dbConnect2();

    expect(MockMongoClient).toHaveBeenCalledTimes(1);
  });
});
