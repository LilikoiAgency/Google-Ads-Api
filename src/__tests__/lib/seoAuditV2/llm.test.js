import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({
  stream: vi.fn(), betaStream: vi.fn(), finalMessage: vi.fn(), ctorArgs: [],
  getCredentials: vi.fn(), logApiUsage: vi.fn(),
}));

vi.mock('@anthropic-ai/sdk', () => {
  class APIUserAbortError extends Error {}
  class FakeClient {
    constructor(opts) {
      m.ctorArgs.push(opts);
      this.messages = { stream: (...a) => { m.stream(...a); return { finalMessage: m.finalMessage }; } };
      this.beta = { messages: { stream: (...a) => { m.betaStream(...a); return { finalMessage: m.finalMessage }; } } };
    }
  }
  FakeClient.APIUserAbortError = APIUserAbortError;
  return { default: FakeClient, APIUserAbortError };
});
vi.mock('@/lib/dbFunctions', () => ({ getCredentials: m.getCredentials }));
vi.mock('@/lib/usageLogger', () => ({ logApiUsage: m.logApiUsage }));

import { runStructured, PassError, AUDIT_MODEL } from '@/lib/seoAuditV2/llm';

const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false };
const args = { system: 'SYS', sharedContext: 'CTX', input: '{"a":1}', schema, effort: 'medium', label: 'pass:content', email: 'a@b.com' };
const msg = (over = {}) => ({
  model: AUDIT_MODEL,
  stop_reason: 'end_turn',
  content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"ok":true}' }],
  usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 0 },
  ...over,
});

const lastBody = () => (m.betaStream.mock.calls.at(-1) || m.stream.mock.calls.at(-1))[0];
const lastOpts = () => (m.betaStream.mock.calls.at(-1) || m.stream.mock.calls.at(-1))[1];

beforeEach(() => {
  vi.clearAllMocks();
  m.ctorArgs.length = 0;
  m.getCredentials.mockResolvedValue({ anthropic_api_key: 'k-db' });
  m.logApiUsage.mockResolvedValue();
});

describe('runStructured', () => {
  it('returns parsed output and usage', async () => {
    m.finalMessage.mockResolvedValue(msg());
    const { output, usage } = await runStructured(args);
    expect(output).toEqual({ ok: true });
    expect(usage).toMatchObject({ input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10 });
    expect(m.ctorArgs[0].apiKey).toBe('k-db');
  });

  it('sends the structured request body with no temperature', async () => {
    m.finalMessage.mockResolvedValue(msg());
    await runStructured(args);
    const body = lastBody();
    expect(body.model).toBe(AUDIT_MODEL);
    expect(body.max_tokens).toBe(32000);
    expect(body.output_config.format.schema).toBe(schema);
    expect(body.output_config).toMatchObject({ effort: 'medium', format: { type: 'json_schema' } });
    expect(body).not.toHaveProperty('temperature');
    expect(body).not.toHaveProperty('thinking');
    expect(body).not.toHaveProperty('tool_choice');
    expect(body.system).toEqual([
      { type: 'text', text: 'CTX', cache_control: { type: 'ephemeral' } },
      { type: 'text', text: 'SYS' },
    ]);
    expect(body.messages).toEqual([{ role: 'user', content: '{"a":1}' }]);
    expect(lastOpts().signal).toBeInstanceOf(AbortSignal);
  });

  it('stringifies an object input', async () => {
    m.finalMessage.mockResolvedValue(msg());
    await runStructured({ ...args, input: { a: 1 } });
    expect(lastBody().messages[0].content).toBe('{"a":1}');
  });

  it('throws PassError(refusal) on a refusal stop_reason', async () => {
    m.finalMessage.mockResolvedValue(msg({ stop_reason: 'refusal', content: [] }));
    await expect(runStructured(args)).rejects.toMatchObject({ name: 'PassError', code: 'refusal' });
  });

  it('throws PassError(max_tokens) on truncation', async () => {
    m.finalMessage.mockResolvedValue(msg({ stop_reason: 'max_tokens', content: [{ type: 'text', text: '{"ok":' }] }));
    const err = await runStructured(args).catch((e) => e);
    expect(err).toBeInstanceOf(PassError);
    expect(err.code).toBe('max_tokens');
  });

  it('logs usage even when the reply is refused', async () => {
    m.finalMessage.mockResolvedValue(msg({ stop_reason: 'refusal', content: [] }));
    await runStructured(args).catch(() => {});
    expect(m.logApiUsage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'claude_tokens', feature: 'seo_audit_v2', email: 'a@b.com', label: 'pass:content', outputTokens: 50,
    }));
  });

  it('maps an abort to PassError(timeout)', async () => {
    const abort = Object.assign(new Error('Request was aborted.'), { name: 'AbortError' });
    m.finalMessage.mockRejectedValue(abort);
    await expect(runStructured(args)).rejects.toMatchObject({ code: 'timeout' });
  });

  it('maps an API error to PassError(api) with only the message', async () => {
    m.finalMessage.mockRejectedValue(Object.assign(new Error('overloaded'), { status: 529 }));
    const err = await runStructured(args).catch((e) => e);
    expect(err.code).toBe('api');
    expect(err.message).toBe('overloaded');
  });

  it('maps unparseable output to PassError(api)', async () => {
    m.finalMessage.mockResolvedValue(msg({ content: [{ type: 'text', text: 'not json' }] }));
    await expect(runStructured(args)).rejects.toMatchObject({ code: 'api' });
  });

  it('falls back to the env key when no credentials record key', async () => {
    m.getCredentials.mockResolvedValue({});
    process.env.ANTHROPIC_API_KEY = 'k-env';
    m.finalMessage.mockResolvedValue(msg());
    await runStructured(args);
    expect(m.ctorArgs[0].apiKey).toBe('k-env');
    delete process.env.ANTHROPIC_API_KEY;
  });
});
