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

  it('throws on truncated JSON', () => {
    expect(() => parseAuditJson('{"a":{"b":"unfinished')).toThrow();
  });

  it('throws when there is no JSON object', () => {
    expect(() => parseAuditJson('no json here')).toThrow();
  });
});
