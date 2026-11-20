import { describe, it, expect } from 'vitest';
import { BRIEF_HEADING, parseBrief, briefBlock, withBrief, sameBrief } from '@/lib/seoAuditV2/briefs';

const FULL = {
  services: 'Roof repair and replacement',
  exclude: ['gutter cleaning', 'solar panels'],
  areas: 'Austin, Round Rock',
  notes: 'Family owned since 1990',
};

describe('parseBrief', () => {
  it('returns null when every field is empty', () => {
    expect(parseBrief({})).toEqual({ brief: null });
    expect(parseBrief(undefined)).toEqual({ brief: null });
    expect(parseBrief({ services: '  ', exclude: [], areas: '', notes: ' ' })).toEqual({ brief: null });
  });

  it('trims fields and keeps the key order services, exclude, areas, notes', () => {
    const { brief } = parseBrief({ notes: ' n ', areas: ' a ', exclude: [' abcd '], services: ' s ' });
    expect(Object.keys(brief)).toEqual(['services', 'exclude', 'areas', 'notes']);
    expect(brief).toEqual({ services: 's', exclude: ['abcd'], areas: 'a', notes: 'n' });
  });

  it('fills missing fields with empty values when the brief is not empty', () => {
    expect(parseBrief({ notes: 'hello' }).brief).toEqual({ services: '', exclude: [], areas: '', notes: 'hello' });
  });

  it('dedupes exclusions case-insensitively, keeping the first spelling', () => {
    const { brief } = parseBrief({ exclude: ['Solar Panels', 'solar panels', 'SOLAR PANELS', 'roofing'] });
    expect(brief.exclude).toEqual(['Solar Panels', 'roofing']);
  });

  it('accepts exclusions as lines', () => {
    expect(parseBrief({ exclude: 'one item\ntwo item' }).brief.exclude).toEqual(['one item', 'two item']);
  });

  it('rejects an exclusion under 4 characters', () => {
    expect(parseBrief({ exclude: ['abc'] })).toEqual({
      error: 'Use at least 4 characters for each service not to recommend.',
    });
  });

  it('enforces the limits', () => {
    expect(parseBrief({ services: 'x'.repeat(1000) }).brief).toBeTruthy();
    expect(parseBrief({ services: 'x'.repeat(1001) }).error).toBeTruthy();
    expect(parseBrief({ areas: 'x'.repeat(301) }).error).toBeTruthy();
    expect(parseBrief({ areas: 'x'.repeat(300) }).brief).toBeTruthy();
    expect(parseBrief({ notes: 'x'.repeat(1001) }).error).toBeTruthy();
    expect(parseBrief({ exclude: ['x'.repeat(81)] }).error).toBeTruthy();
    expect(parseBrief({ exclude: ['x'.repeat(80)] }).brief).toBeTruthy();
    const many = Array.from({ length: 31 }, (_, i) => `service ${i}`);
    expect(parseBrief({ exclude: many }).error).toBeTruthy();
    expect(parseBrief({ exclude: many.slice(0, 30) }).brief.exclude).toHaveLength(30);
  });
});

describe('briefBlock', () => {
  it('is empty for null or an empty brief', () => {
    expect(briefBlock(null)).toBe('');
    expect(briefBlock({ services: '', exclude: [], areas: '', notes: '' })).toBe('');
  });

  it('renders the heading and the non-empty lines', () => {
    expect(briefBlock(FULL)).toBe([
      BRIEF_HEADING,
      'Services: Roof repair and replacement',
      'Service areas: Austin, Round Rock',
      'Do not recommend: gutter cleaning; solar panels',
      'Notes: Family owned since 1990',
    ].join('\n'));
    expect(briefBlock({ services: '', exclude: ['abcd'], areas: '', notes: '' }))
      .toBe(`${BRIEF_HEADING}\nDo not recommend: abcd`);
  });
});

describe('withBrief', () => {
  it('appends the block to a context without one', () => {
    expect(withBrief('Context here', FULL)).toBe(`Context here\n\n${briefBlock(FULL)}`);
  });

  it('replaces an old block', () => {
    const old = `Context here\n\n${briefBlock({ ...FULL, services: 'Old' })}`;
    expect(withBrief(old, FULL)).toBe(`Context here\n\n${briefBlock(FULL)}`);
  });

  it('removes the block when the brief is null and leaves other contexts intact', () => {
    expect(withBrief(`Context here\n\n${briefBlock(FULL)}`, null)).toBe('Context here\n\n');
    expect(withBrief('Context here', null)).toBe('Context here');
  });
});

describe('sameBrief', () => {
  it('compares the four fields and is null-safe', () => {
    expect(sameBrief(FULL, { ...FULL, exclude: [...FULL.exclude] })).toBe(true);
    expect(sameBrief(FULL, { ...FULL, notes: 'x' })).toBe(false);
    expect(sameBrief(FULL, { ...FULL, exclude: ['gutter cleaning'] })).toBe(false);
    expect(sameBrief(null, undefined)).toBe(true);
    expect(sameBrief(null, FULL)).toBe(false);
    expect(sameBrief(FULL, null)).toBe(false);
  });
});
