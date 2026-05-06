// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({
    user: { email: 'test@lilikoiagency.com' },
  }),
}));
vi.mock('@/lib/auth', () => ({
  authOptions: {},
  allowedEmailDomain: 'lilikoiagency.com',
}));
vi.mock('@/lib/dbFunctions', () => ({
  getCredentials: vi.fn().mockResolvedValue({ anthropic_api_key: 'test-key' }),
}));
vi.mock('@/lib/usageLogger', () => ({
  logApiUsage: vi.fn().mockResolvedValue(undefined),
  estimateClaudeCost: vi.fn().mockReturnValue(0.001),
  getMonthlyClaudeCost: vi.fn().mockResolvedValue(0),
  getClaudeBudgetCap: vi.fn().mockResolvedValue(100),
}));

const mockCreate = vi.fn();
vi.mock('@anthropic-ai/sdk', () => {
  class MockAnthropic {
    constructor() {
      this.messages = { create: mockCreate };
    }
  }
  return { default: MockAnthropic };
});

import { POST } from '@/app/api/claude/seo-meta/route.js';

function makeRequest(body) {
  return { json: async () => body };
}

// Alias used in new tests for consistency with the plan's naming
const makePostRequest = makeRequest;

function mockClaudeSuccess() {
  mockCreate.mockResolvedValueOnce({
    stop_reason: 'end_turn',
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          titles: ['Title One Fifty Characters Long Here OK', 'Title Two Fifty Characters Long Here OK', 'Title Three Fifty Characters Long Here OK'],
          descriptions: [
            'Description one that is exactly one hundred and fifty characters long padded out here to meet length requirement.',
            'Description two that is exactly one hundred and fifty characters long padded out here to meet length requirement.',
            'Description three that is exactly one hundred and fifty characters long padded out here to meet length.',
          ],
        }),
      },
    ],
    usage: { input_tokens: 100, output_tokens: 200 },
  });
}

describe('POST /api/claude/seo-meta', () => {
  it('returns 400 when pageTitle is missing', async () => {
    const res = await POST(makeRequest({ pageTitle: '', pageContent: '' }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle or pageContent/i);
  });

  it('returns 400 when pageTitle is empty string', async () => {
    const res = await POST(makeRequest({ pageTitle: '   ', pageContent: '' }));
    const data = await res.json();
    expect(res.status).toBe(400);
    expect(data.error).toMatch(/pageTitle or pageContent/i);
  });

  it('returns 401 when session email is not from allowed domain', async () => {
    const { getServerSession } = await import('next-auth');
    getServerSession.mockResolvedValueOnce({ user: { email: 'user@other.com' } });
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(401);
    expect(data.error).toMatch(/unauthorized/i);
  });

  it('returns 429 when budget cap is reached', async () => {
    const { getMonthlyClaudeCost } = await import('@/lib/usageLogger');
    getMonthlyClaudeCost.mockResolvedValueOnce(100);
    const res = await POST(makeRequest({ pageTitle: 'My Page' }));
    const data = await res.json();
    expect(res.status).toBe(429);
    expect(data.code).toBe('NO_CREDITS');
    expect(data.limitReached).toBe(true);
  });

  it('returns 400 when both pageTitle and pageContent are empty', async () => {
    const req = makePostRequest({ pageTitle: '', pageContent: '' });
    const res = await POST(req);
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.error).toMatch(/pageTitle or pageContent/i);
  });

  it('returns 200 when pageContent is provided without pageTitle', async () => {
    mockClaudeSuccess();
    const req = makePostRequest({ pageContent: 'We sell premium HVAC systems with 10-year warranties.' });
    const res = await POST(req);
    expect(res.status).toBe(200);
  });
});
