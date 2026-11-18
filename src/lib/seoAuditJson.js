// Parse the SEO audit model's reply into an object.
// The prompt asks for bare JSON, but replies sometimes arrive wrapped in code
// fences or with a sentence before/after the object. This tries a straight
// parse first, then extracts the first complete top-level {...} object
// (string-aware, so braces inside text don't confuse it). Throws if no
// complete object exists, e.g. when the reply was cut off.

export function parseAuditJson(text) {
  const raw = String(text ?? '');
  try {
    return JSON.parse(raw);
  } catch {
    // fall through to extraction
  }

  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in audit response');

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error('Audit response JSON is incomplete');
}
