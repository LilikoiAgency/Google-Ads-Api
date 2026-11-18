// @vitest-environment jsdom
// Web Traffic (GA4) page logic: URL params and the report fetch hook.
// (page.js itself is JSX in a .js file, which vitest can't import.)
import { renderHook, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parseParams, buildQuery, resolveProperty, localToday, isUrlPropertyMissing } from '@/app/dashboard/google/analytics/urlState';
import { useTrafficReport, makeReportKey, _clearReportCache } from '@/app/dashboard/google/analytics/useTrafficReport';

const sp = (s) => new URLSearchParams(s);

describe('urlState', () => {
  it('uses defaults with no params', () => {
    expect(parseParams(sp(''))).toEqual({
      property: null, rangeKey: 'last_month', custom: null, compare: 'prev', view: 'nonPaid', gran: null,
    });
  });

  it('falls back to defaults for bad params instead of crashing', () => {
    const p = parseParams(sp('view=bogus&range=nope&compare=x&gran=hour&property=../etc'));
    expect(p).toEqual({ property: null, rangeKey: 'last_month', custom: null, compare: 'prev', view: 'nonPaid', gran: null });
  });

  it('accepts a valid custom range and rejects an invalid one', () => {
    expect(parseParams(sp('range=custom&start=2024-02-29&end=2024-06-30')).custom)
      .toEqual({ startDate: '2024-02-29', endDate: '2024-06-30' });
    const bad = parseParams(sp('range=custom&start=2026-13-01&end=2026-01-01'));
    expect(bad.rangeKey).toBe('last_month');
    expect(bad.custom).toBeNull();
    expect(parseParams(sp('range=custom&start=2026-05-01&end=2026-04-01')).rangeKey).toBe('last_month');
  });

  it('round-trips through buildQuery', () => {
    const state = { property: 'properties/123', rangeKey: 'custom', custom: { startDate: '2026-01-01', endDate: '2026-06-30' }, compare: 'yoy', view: 'paid', gran: 'month' };
    expect(parseParams(sp(buildQuery(state).slice(1)))).toEqual(state);
    expect(buildQuery({ ...state, rangeKey: 'last_7', custom: null, gran: null })).not.toMatch(/start=|gran=/);
  });

  it('resolves the property: current, then URL, then remembered, then first', () => {
    const properties = [{ id: 'properties/1' }, { id: 'properties/2' }, { id: 'properties/3' }];
    expect(resolveProperty({ properties, current: null, fromUrl: 'properties/3', stored: 'properties/2' })).toBe('properties/3');
    expect(resolveProperty({ properties, current: null, fromUrl: 'properties/9', stored: 'properties/2' })).toBe('properties/2');
    expect(resolveProperty({ properties, current: null, fromUrl: null, stored: 'properties/9' })).toBe('properties/1');
    expect(resolveProperty({ properties, current: 'properties/2', fromUrl: 'properties/3', stored: null })).toBe('properties/2');
    expect(resolveProperty({ properties: [], current: null })).toBeNull();
  });

  it('flags a link property that is not in the connected list', () => {
    const properties = [{ id: 'properties/1' }, { id: 'properties/2' }];
    expect(isUrlPropertyMissing({ properties, fromUrl: 'properties/9' })).toBe(true);
    expect(isUrlPropertyMissing({ properties, fromUrl: 'properties/2' })).toBe(false);
    expect(isUrlPropertyMissing({ properties, fromUrl: null })).toBe(false);
    expect(isUrlPropertyMissing({ properties: [], fromUrl: 'properties/9' })).toBe(false);
  });

  it('localToday uses the local calendar date', () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
  });
});

const keyFor = (property) => makeReportKey({ property, startDate: '2026-10-01', endDate: '2026-10-31', compare: 'prev', granularity: 'day' });
const ok = (body) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });

describe('useTrafficReport', () => {
  beforeEach(() => _clearReportCache());
  afterEach(() => vi.unstubAllGlobals());

  it('fetches with the right query and caches the response', async () => {
    const fetchMock = vi.fn(() => ok({ id: 'r1' }));
    vi.stubGlobal('fetch', fetchMock);
    const { result, rerender } = renderHook(({ k }) => useTrafficReport(k), { initialProps: { k: keyFor('properties/1') } });
    await waitFor(() => expect(result.current.report).toEqual({ id: 'r1' }));
    const q = new URL(fetchMock.mock.calls[0][0], 'http://x').searchParams;
    expect(Object.fromEntries(q)).toEqual({ property: 'properties/1', startDate: '2026-10-01', endDate: '2026-10-31', compare: 'prev', granularity: 'day' });

    rerender({ k: keyFor('properties/2') });
    await waitFor(() => expect(result.current.key).toBe(keyFor('properties/2')));
    rerender({ k: keyFor('properties/1') });
    await waitFor(() => expect(result.current.key).toBe(keyFor('properties/1')));
    expect(fetchMock).toHaveBeenCalledTimes(2); // the return trip came from the cache
  });

  it('aborts a slow earlier request so it cannot overwrite a newer one', async () => {
    let releaseSlow;
    let slowSignal;
    vi.stubGlobal('fetch', vi.fn((url, { signal }) => {
      const property = new URL(url, 'http://x').searchParams.get('property');
      if (property === 'properties/1') {
        slowSignal = signal;
        return new Promise((resolve) => { releaseSlow = () => resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: 'slow' }) }); });
      }
      return ok({ id: 'fast' });
    }));
    const { result, rerender } = renderHook(({ k }) => useTrafficReport(k), { initialProps: { k: keyFor('properties/1') } });
    expect(result.current.loading).toBe(true);
    rerender({ k: keyFor('properties/2') });
    expect(slowSignal.aborted).toBe(true);
    await waitFor(() => expect(result.current.report).toEqual({ id: 'fast' }));
    await act(async () => { releaseSlow(); });
    expect(result.current.report).toEqual({ id: 'fast' });
    expect(result.current.key).toBe(keyFor('properties/2'));
    expect(result.current.loading).toBe(false);
  });

  it('surfaces the API error code and message', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({ error: 'quota', message: 'slow down' }) })));
    const { result } = renderHook(() => useTrafficReport(keyFor('properties/1')));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error.code).toBe('quota');
    expect(result.current.report).toBeNull();
  });

  it('treats a non-JSON failure as ga_error', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: false, status: 504, json: () => Promise.reject(new Error('html')) })));
    const { result } = renderHook(() => useTrafficReport(keyFor('properties/1')));
    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.error.code).toBe('ga_error');
    expect(result.current.error.message).toBe('Request failed (504)');
  });
});
