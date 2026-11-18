// Structured model calls for SEO Audit v2. One request per call: streamed,
// schema-constrained JSON out, usage logged, and every failure mapped to a
// PassError code the job runner can retry on.

import Anthropic from '@anthropic-ai/sdk';
import { getCredentials } from '../dbFunctions';
import { logApiUsage } from '../usageLogger';

export const AUDIT_MODEL = 'claude-opus-5-5';
export const MAX_TOKENS = 32000;
export const CALL_TIMEOUT_MS = 240000;

// USD per million tokens for AUDIT_MODEL. Cache writes bill at 1.25x input.
const RATES = { input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 };

// Server-side refusal fallback: on a policy decline the same request is re-run
// on a fallback model inside the same call.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };
const USE_FALLBACK = true;

export class PassError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = 'PassError';
    this.code = code; // refusal | max_tokens | timeout | api
  }
}

async function resolveApiKey() {
  let creds = null;
  try {
    creds = await getCredentials();
  } catch (err) {
    console.warn('[seo-audit-v2] credentials lookup failed:', err?.message || String(err));
  }
  return creds?.anthropic_api_key || process.env.ANTHROPIC_API_KEY;
}

function estimateCost(u) {
  return ((u.input_tokens || 0) * RATES.input
    + (u.cache_creation_input_tokens || 0) * RATES.cacheWrite
    + (u.cache_read_input_tokens || 0) * RATES.cacheRead
    + (u.output_tokens || 0) * RATES.output) / 1_000_000;
}

function usageOf(message) {
  const u = message?.usage || {};
  return {
    model: message?.model || AUDIT_MODEL,
    input_tokens: u.input_tokens || 0,
    output_tokens: u.output_tokens || 0,
    cache_read_input_tokens: u.cache_read_input_tokens || 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens || 0,
  };
}

const isAbort = (err, signal) => signal?.aborted
  || err?.name === 'AbortError'
  || err instanceof Anthropic.APIUserAbortError
  || /aborted|timed? ?out/i.test(err?.message || '');

export async function runStructured({ system, sharedContext, input, schema, effort = 'high', label, email } = {}) {
  if (typeof sharedContext !== 'string' || !sharedContext.trim()) {
    throw new Error('runStructured: sharedContext is required (build it with buildSharedContext)');
  }
  const apiKey = await resolveApiKey();
  if (!apiKey) throw new PassError('api', 'API key not configured');
  const client = new Anthropic({ apiKey });

  const body = {
    model: AUDIT_MODEL,
    max_tokens: MAX_TOKENS,
    // Shared context (rules + audit context) first so the cached prefix is the same for
    // every pass and the synthesis; the second breakpoint also caches the pass prompt,
    // which repeats across content chunks.
    system: [
      { type: 'text', text: sharedContext, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: system, cache_control: { type: 'ephemeral' } },
    ],
    messages: [{ role: 'user', content: typeof input === 'string' ? input : JSON.stringify(input) }],
    output_config: { effort, format: { type: 'json_schema', schema } },
  };

  const signal = AbortSignal.timeout(CALL_TIMEOUT_MS);
  let message;
  try {
    message = USE_FALLBACK
      ? await client.beta.messages.stream({ ...body, ...FALLBACK }, { signal }).finalMessage()
      : await client.messages.stream(body, { signal }).finalMessage();
  } catch (err) {
    if (isAbort(err, signal)) throw new PassError('timeout', 'The request timed out');
    throw new PassError('api', err?.message || String(err));
  }

  const usage = usageOf(message);
  logApiUsage({
    type: 'claude_tokens',
    email,
    model: usage.model,
    feature: 'seo_audit_v2',
    label,
    inputTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens,
    cacheWriteTokens: usage.cache_creation_input_tokens,
    totalTokens: usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens + usage.output_tokens,
    estimatedCostUsd: estimateCost(usage),
  })?.catch?.(() => {});

  if (message.stop_reason === 'refusal') {
    throw new PassError('refusal', `Declined${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') throw new PassError('max_tokens', 'The reply hit the output limit');

  const text = (message.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  let output;
  try {
    output = JSON.parse(text);
  } catch {
    throw new PassError('api', 'The reply was not valid JSON');
  }
  return { output, usage };
}
