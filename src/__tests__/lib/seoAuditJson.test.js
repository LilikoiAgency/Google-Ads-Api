import { describe, it, expect } from 'vitest';
import { parseAuditJson } from '@/lib/seoAuditJson';

describe('parseAuditJson', () => {
  it('parses plain JSON', () => {
    expect(parseAuditJson('{"a":1}')).toEqual({ a: 1 });
  });

  it('strips markdown code fences', () => {
    expect(parseAuditJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it('ignores text before and after the JSON object', () => {
    expect(parseAuditJson('Here is the audit:\n{"a":{"b":"x}y"}}\n\nLet me know if you need more.')).toEqual({ a: { b: 'x}y' } });
  });

  it('handles braces and escaped quotes inside strings', () => {
    const obj = { t: 'He said "{hi}" \\ ok', n: [1, { m: '}' }] };
    expect(parseAuditJson(`${JSON.stringify(obj)} trailing`)).toEqual(obj);
  });

  it('takes the first complete object when two are concatenated', () => {
    expect(parseAuditJson('{"a":1}{"b":2}')).toEqual({ a: 1 });
  });

  it('repairs a stray closing brace that ends the object early (real model slip)', () => {
    const slipped = '{"audit_summary":{"domain":"x.com","top_3_priorities":["a"]},"biggest_strength":"b"}, "seo_analysis":{"summary":"s"}, "strengths":[]}';
    expect(parseAuditJson(slipped)).toEqual({
      audit_summary: { domain: 'x.com', top_3_priorities: ['a'], biggest_strength: 'b' },
      seo_analysis: { summary: 's' },
      strengths: [],
    });
  });

  it('moves summary fields that landed at the top level back into audit_summary', () => {
    expect(parseAuditJson('{"audit_summary":{"domain":"x"},"executive_summary":"e","seo_analysis":{}}')).toEqual({
      audit_summary: { domain: 'x', executive_summary: 'e' },
      seo_analysis: {},
    });
  });

  it('throws on truncated JSON', () => {
    expect(() => parseAuditJson('{"a":{"b":"unfinished')).toThrow();
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseAuditJson('no json here')).toThrow();
  });
});
