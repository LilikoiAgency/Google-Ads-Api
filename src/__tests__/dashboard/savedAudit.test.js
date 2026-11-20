import { describe, it, expect, vi } from 'vitest';
import { loadSavedAudit, finishedAuditView } from '@/app/dashboard/seo-audit/v2/savedAudit.js';

const ok = (body) => vi.fn(async () => ({ ok: true, json: async () => body }));
const JOB_RESULT = { version: 2, domain: 'acme.com', action_plan: [{ id: 'T1' }] };

describe('loadSavedAudit', () => {
  it('reads the audit from history and marks a v2 result missing its version', async () => {
    const fetchImpl = ok({
      _id: 'a1', version: 2, domain: 'acme.com', auditType: 'full', crawlData: null,
      auditResult: { domain: 'acme.com', replanned_at: '2026-11-20T10:00:00.000Z' },
      corrections: [{ id: 'c1' }], canReplan: true, correctionsChangedAt: '2026-11-20T11:00:00.000Z',
    });
    const view = await loadSavedAudit('a1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/seo-audit/history?id=a1');
    expect(view.id).toBe('a1');
    expect(view.result).toEqual({ domain: 'acme.com', replanned_at: '2026-11-20T10:00:00.000Z', version: 2 });
    expect(view.corrections).toEqual([{ id: 'c1' }]);
    expect(view.canReplan).toBe(true);
    expect(view.changedAt).toBe('2026-11-20T11:00:00.000Z');
  });

  it('throws on a failed load and keeps a v1 result as it is', async () => {
    await expect(loadSavedAudit('a1', vi.fn(async () => ({ ok: false, json: async () => ({}) })))).rejects.toThrow("Couldn't load that audit");
    const view = await loadSavedAudit('a2', ok({ auditResult: { audit_summary: {} } }));
    expect(view.result).toEqual({ audit_summary: {} });
    expect(view.id).toBe('a2');
    expect(view.corrections).toEqual([]);
    expect(view.canReplan).toBe(false);
  });
});

describe('finishedAuditView', () => {
  it('a finished job saved as an audit shows the saved audit, with its corrections and updated plan', async () => {
    const fetchImpl = ok({
      _id: 'a1', version: 2,
      auditResult: { domain: 'acme.com', replanned_at: '2026-11-20T10:00:00.000Z', action_plan: [] },
      corrections: [{ id: 'c1' }], canReplan: true,
    });
    const view = await finishedAuditView(JOB_RESULT, 'a1', fetchImpl);
    expect(fetchImpl).toHaveBeenCalledWith('/api/seo-audit/history?id=a1');
    expect(view.result.replanned_at).toBe('2026-11-20T10:00:00.000Z');
    expect(view.result.version).toBe(2);
    expect(view.corrections).toEqual([{ id: 'c1' }]);
    expect(view.canReplan).toBe(true);
  });

  it("falls back to the job's result when the saved audit can't be loaded", async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); });
    const view = await finishedAuditView(JOB_RESULT, 'a1', failing);
    expect(view).toEqual({ id: 'a1', result: JOB_RESULT, corrections: [], canReplan: true, changedAt: null });
  });

  it('without an audit id it shows the job result and loads nothing', async () => {
    const fetchImpl = vi.fn();
    const view = await finishedAuditView(JOB_RESULT, null, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(view).toEqual({ id: null, result: JOB_RESULT, corrections: [], canReplan: false, changedAt: null });
  });
});
