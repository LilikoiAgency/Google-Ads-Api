import { describe, it, expect } from 'vitest';
import { buildPacingReport, renderMetaLocationBlock } from '../../lib/pacingReportBuilder';

const META = {
  totalLeads: 83,
  totalSpend: 11123.39,
  locations: [
    { name: 'Los Angeles', leads: 24, sharePct: 28.92, spend: 3216.4 },
    { name: 'San Diego', leads: 19, sharePct: 22.89, spend: 2546.32 },
    { name: 'Fresno', leads: 6, sharePct: 7.23, spend: 804.1 },
  ],
};

const SMP = {
  key: 'SMP', name: 'Semper Solaris',
  pacing: {
    header: { remainingDays: 15 },
    geos: [{ name: 'CA', pacing: 210559.55 }, { name: 'LA', pacing: 3700.66 }],
    lines: [
      { platform: 'GOOGLE', vertical: 'SOLAR', budget: 122000, campaignBudget: 120000, spendMtd: 40973.93, eomPacing: 103973.93 },
      { platform: 'FACEBOOK', vertical: 'SOLAR', budget: 41375, campaignBudget: 41000, spendMtd: 21674, eomPacing: 43375 },
    ],
  },
  validation: { platforms: [] },
  metaLocations: META,
};

const PLS = {
  key: 'PLS', name: 'Payless for Solar',
  pacing: { header: {}, geos: [], lines: [{ platform: 'GOOGLE', vertical: 'SOLAR', budget: 6500, campaignBudget: 6500, spendMtd: 1257.62, eomPacing: 6847.62 }] },
  validation: { platforms: [] },
  metaLocations: null,
};

describe('renderMetaLocationBlock', () => {
  it('returns nothing when there is no meta location data', () => {
    expect(renderMetaLocationBlock(null)).toBe('');
    expect(renderMetaLocationBlock({ locations: [] })).toBe('');
  });

  it('renders each location with leads, share and estimated spend plus a total', () => {
    const html = renderMetaLocationBlock(META);
    expect(html).toContain('Meta Spend by Location');
    expect(html).toContain('lead-weighted estimate');
    expect(html).toContain('Los Angeles');
    expect(html).toContain('28.9%');
    expect(html).toContain('$3,216.40');
    expect(html).toContain('$11,123.39');
    expect(html).toContain('>83<');
  });
});

describe('buildPacingReport', () => {
  const { html, summary } = buildPacingReport({ reportDate: '2026-09-16', clients: [SMP, PLS] });

  it('shows the meta location block only for clients that have the tab', () => {
    const smpStart = html.indexOf('Semper Solaris');
    const plsStart = html.indexOf('Payless for Solar');
    const metaIdx = html.indexOf('Meta Spend by Location');
    expect(metaIdx).toBeGreaterThan(smpStart);
    expect(metaIdx).toBeLessThan(plsStart);
    expect(html.indexOf('Meta Spend by Location', plsStart)).toBe(-1);
  });

  it('renders the geo bar including the LA code', () => {
    expect(html).toContain('Geo Pacing EOM:');
    expect(html).toContain('LA $3,700.66');
  });

  it('exposes meta location spend on the summary', () => {
    expect(summary.clients.find((c) => c.key === 'SMP').metaLocationSpend).toBeCloseTo(11123.39, 2);
    expect(summary.clients.find((c) => c.key === 'PLS').metaLocationSpend).toBeNull();
  });
});
