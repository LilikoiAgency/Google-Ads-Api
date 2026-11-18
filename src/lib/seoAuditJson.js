// Parse the SEO audit model's reply into an object.
// The prompt asks for bare JSON, but long replies sometimes arrive wrapped in
// code fences, with a sentence before/after the object, or with a structural
// slip: a stray "}" that closes the root object early while more sections
// follow (", "seo_analysis": {...}"). This parses the clean case directly,
// otherwise extracts the root object string-aware, dropping any stray early
// closing brace that is followed by more keys. Throws if no complete object
// exists (e.g. the reply was cut off).

const BACKSLASH = '\\';

// Fields the schema puts inside audit_summary; the model sometimes emits them at the root.
const SUMMARY_FIELDS = ['executive_summary', 'top_3_priorities', 'biggest_strength', 'scores', 'pages_reviewed'];

// Index of the "}" that closes the object starting at `start`, or -1.
function findClose(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === BACKSLASH) escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

function extractRoot(raw) {
  const start = raw.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in audit response');
  let text = raw.slice(start);
  // A root closed early is followed by `, "key"`; drop that brace and rescan (bounded).
  for (let attempt = 0; attempt < 10; attempt++) {
    const end = findClose(text, 0);
    if (end === -1) throw new Error('Audit response JSON is incomplete');
    if (/^\s*,\s*"/.test(text.slice(end + 1))) {
      text = text.slice(0, end) + text.slice(end + 1);
      continue;
    }
    return JSON.parse(text.slice(0, end + 1));
  }
  throw new Error('Audit response JSON could not be repaired');
}

function normalize(audit) {
  if (audit && typeof audit === 'object' && audit.audit_summary && typeof audit.audit_summary === 'object') {
    for (const f of SUMMARY_FIELDS) {
      if (f in audit && !(f in audit.audit_summary)) {
        audit.audit_summary[f] = audit[f];
        delete audit[f];
      }
    }
  }
  return audit;
}

export function parseAuditJson(text) {
  const raw = String(text ?? '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = extractRoot(raw);
  }
  return normalize(parsed);
}
